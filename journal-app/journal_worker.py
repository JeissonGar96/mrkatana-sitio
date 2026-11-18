"""
Kairus Journal: el "trabajador" de un MT5.

Cada MT5 portable del Journal (C:\\Journal\\...) tiene su propio proceso de Python, porque la
librería MetaTrader5 solo puede hablar con un terminal por proceso. El proceso recibe cuentas
por una cola, entra con la clave de inversor (solo lectura), lee lo nuevo y lo guarda en Supabase.

Reglas importantes:
- Solo se escribe en Supabase si algo cambió (cada escritura gasta "Disk IO" del plan gratis).
- Lectura incremental: solo los movimientos desde el último sync (con margen), no todo el historial.
- Si la cuenta falla, se marca el error y se sigue con la siguiente: nunca se queda atascado.
"""
import base64
import datetime as dt
import hashlib
import os
import time

import requests

MSG_LOGIN = "No pudimos entrar. Revisa el servidor, el número de cuenta y la contraseña de inversor."
MSG_SERVER = "El servidor del bróker no respondió. Lo intentamos de nuevo en unos minutos."
MSG_PWD = "Vuelve a escribir la contraseña de inversor."
MSG_BROKER = {"exness": "Esta cuenta no es de Exness.", "fundingpips": "Esta cuenta no es de Funding Pips."}
MSG_PARTNER = "Esta cuenta no está abierta con el link de Mr Katana."
SERVER_PREFIX = {"exness": "exness-", "fundingpips": "fundingpips-"}
BROKER_MARKS = {"exness": ("exness",), "fundingpips": ("funding pips", "fundingpips", "funding-pips")}
AUTH_FAILED = -6  # código de MT5 cuando la clave o el servidor no son correctos


# ── Seguridad: nunca tocar los MT5 que no son del Journal ──
def check_terminal_path(path, root):
    """Devuelve un texto de error si la ruta no es un MT5 del Journal, o None si está bien."""
    p = os.path.normcase(os.path.abspath(path or ""))
    r = os.path.normcase(os.path.abspath(root or "C:\\Journal"))
    if not path:
        return "Falta la ruta del terminal."
    if not p.startswith(r + os.sep):
        return "La ruta no está dentro de %s. Por seguridad solo se usan los MT5 del Journal." % root
    if "kairus" in p.replace(r, "") or "program files" in p:
        return "Esa ruta parece de otro MT5 (Kairus o Program Files). No se usa."
    if not os.path.isfile(path):
        return "No existe el archivo %s" % path
    return None


# ── Supabase (REST con la service key) ──
class Supabase:
    def __init__(self, url, key):
        self.url, self.key = url.rstrip("/"), key
        self.s = requests.Session()

    def req(self, method, path, **kw):
        h = {"apikey": self.key, "Authorization": "Bearer " + self.key, "Content-Type": "application/json"}
        h.update(kw.pop("headers", {}))
        r = self.s.request(method, self.url + "/rest/v1/" + path, headers=h, timeout=30, **kw)
        if r.status_code >= 300:
            raise RuntimeError("Supabase %s %s: %s %s" % (method, path.split("?")[0], r.status_code, r.text[:300]))
        return r.json() if r.text else None

    def upsert(self, table, rows, conflict):
        for i in range(0, len(rows), 500):
            self.req("POST", table + "?on_conflict=" + conflict, json=rows[i:i + 500],
                     headers={"Prefer": "resolution=merge-duplicates,return=minimal"})

    def update_account(self, acc_id, **fields):
        self.req("PATCH", "journal_accounts?id=eq." + acc_id, json=fields, headers={"Prefer": "return=minimal"})


# ── Clave cifrada por /api/journal-account (formato v1:iv:tag:texto, AES-256-GCM) ──
def decrypt(enc, journal_key):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    v, iv, tag, ct = enc.split(":")
    if v != "v1":
        raise ValueError("formato desconocido")
    key = hashlib.sha256(journal_key.encode()).digest()
    return AESGCM(key).decrypt(base64.b64decode(iv), base64.b64decode(ct) + base64.b64decode(tag), None).decode()


# ── Ventanas: dejar los MT5 del Journal minimizados ──
def minimize_terminal(path):
    try:
        import ctypes
        from ctypes import wintypes
        user32, kernel32 = ctypes.windll.user32, ctypes.windll.kernel32
        target = os.path.normcase(os.path.abspath(path))
        found = []

        @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        def cb(hwnd, _):
            if not user32.IsWindowVisible(hwnd) or user32.GetWindow(hwnd, 4):  # 4 = GW_OWNER
                return True
            pid = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            h = kernel32.OpenProcess(0x1000, False, pid.value)  # PROCESS_QUERY_LIMITED_INFORMATION
            if h:
                buf, n = ctypes.create_unicode_buffer(1024), wintypes.DWORD(1024)
                if kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(n)):
                    if os.path.normcase(buf.value) == target:
                        found.append(hwnd)
                kernel32.CloseHandle(h)
            return True

        user32.EnumWindows(cb, 0)
        for hwnd in found:
            user32.ShowWindow(hwnd, 6)  # SW_MINIMIZE
    except Exception:
        pass


# ── Lectura de MT5 ──
def server_offset(mt5):
    """Horas que el reloj del servidor del bróker va por delante de UTC (MT5 da fechas en hora del servidor)."""
    for sym in ("EURUSD", "EURUSDm", "XAUUSD", "XAUUSDm", "BTCUSD", "BTCUSDm"):
        t = mt5.symbol_info_tick(sym)
        if t and t.time:
            off = round((t.time - time.time()) / 3600)
            if 0 <= off <= 4 and abs(t.time - time.time() - off * 3600) < 600:
                return off
    return 2


def to_utc(ts, off):
    return dt.datetime.fromtimestamp(ts - off * 3600, dt.timezone.utc)


def _far():
    return dt.datetime.now() + dt.timedelta(days=2)


def wait_history(mt5, balance, limit):
    """Después de entrar, MT5 baja el historial en segundo plano. Espera a que los movimientos sumen el
    balance o a que dejen de cambiar. Las cuentas que este MT5 ya conoce terminan en 1 o 2 segundos."""
    last = -1
    for _ in range(limit):
        deals = mt5.history_deals_get(dt.datetime(2000, 1, 1), _far()) or ()
        total = sum(d.profit + d.commission + d.swap + getattr(d, "fee", 0) for d in deals)
        if deals and abs(total - balance) < 0.05:
            return
        if deals and len(deals) == last:
            return  # dos lecturas iguales seguidas: ya terminó
        last = len(deals)
        time.sleep(1)


def build_trades(mt5, deals, orders, off, acc):
    """Agrupa los movimientos por posición y devuelve solo las operaciones cerradas por completo."""
    sltp = {}
    for o in orders:
        if o.position_id and (o.sl or o.tp):
            sltp[o.position_id] = (o.sl or None, o.tp or None)
    pos = {}
    for d in deals:
        if not d.position_id or d.type not in (mt5.DEAL_TYPE_BUY, mt5.DEAL_TYPE_SELL):
            continue
        p = pos.setdefault(d.position_id, {"ins": {}, "outs": {}})
        (p["ins"] if d.entry == mt5.DEAL_ENTRY_IN else p["outs"])[d.ticket] = d
    rows = []
    for pid, p in pos.items():
        ins, outs = list(p["ins"].values()), list(p["outs"].values())
        if not ins or not outs:
            continue
        vol, out_vol = sum(x.volume for x in ins), sum(x.volume for x in outs)
        if out_vol + 1e-9 < vol:
            continue  # cerrada solo en parte: se guarda cuando cierre completa
        fi, lo = min(ins, key=lambda x: x.time_msc), max(outs, key=lambda x: x.time_msc)
        all_d = ins + outs
        sl, tp = sltp.get(pid, (None, None))
        rows.append({
            "account_id": acc["id"], "user_id": acc["user_id"], "ticket": int(pid), "symbol": fi.symbol,
            "side": "buy" if fi.type == mt5.DEAL_TYPE_BUY else "sell", "volume": round(vol, 2),
            "open_time": to_utc(fi.time, off).isoformat(), "close_time": to_utc(lo.time, off).isoformat(),
            "open_price": sum(x.price * x.volume for x in ins) / vol,
            "close_price": sum(x.price * x.volume for x in outs) / out_vol,
            "sl": sl, "tp": tp,
            "commission": round(sum(x.commission + getattr(x, "fee", 0) for x in all_d), 2),
            "swap": round(sum(x.swap for x in all_d), 2),
            "profit": round(sum(x.profit for x in all_d), 2),
        })
    rows.sort(key=lambda r: r["ticket"])
    return rows


def daily_balances(deals, balance, off, date_from, acc):
    """Balance al cierre de cada día, reconstruido hacia atrás desde el balance actual."""
    by_day = {}
    for d in deals:
        day = to_utc(d.time, off).date()
        by_day[day] = by_day.get(day, 0) + d.profit + d.commission + d.swap + getattr(d, "fee", 0)
    today = dt.datetime.now(dt.timezone.utc).date()
    rows, bal, day = [], balance, today
    while day >= date_from.date():
        rows.append({"account_id": acc["id"], "user_id": acc["user_id"], "day": day.isoformat(),
                     "balance": round(bal, 2), "equity": round(bal, 2)})
        bal -= by_day.get(day, 0)
        day -= dt.timedelta(days=1)
    return rows


def read_transfers(mt5, deals, off, acc):
    """Depósitos y retiros (tabla journal_transfers). Positivo = depósito, negativo = retiro."""
    return [{"account_id": acc["id"], "user_id": acc["user_id"], "ticket": int(d.ticket),
             "time": to_utc(d.time, off).isoformat(), "amount": round(d.profit, 2),
             "comment": (d.comment or "")[:80] or None}
            for d in deals if d.type == mt5.DEAL_TYPE_BALANCE and d.profit]


def sig(obj):
    return hashlib.sha1(repr(obj).encode()).hexdigest()


class Syncer:
    def __init__(self, cfg, log):
        self.cfg, self.log = cfg, log
        self.sb = Supabase(cfg["supabase_url"], cfg["service_key"])

    def _error(self, acc, msg, job):
        """Guarda el error solo si es distinto al que ya tiene la cuenta."""
        if not (acc.get("status") == "error" and acc.get("last_error") == msg):
            self.sb.update_account(acc["id"], status="error", last_error=msg)
        return {"ok": False, "error": msg}

    def sync(self, mt5, job):
        acc, cfg = job["acc"], self.cfg
        label = "%s %s" % (acc["broker"], acc["login"])
        try:
            pwd = decrypt(acc["investor_password_enc"], cfg["journal_key"])
        except Exception:
            return self._error(acc, MSG_PWD, job)
        t0 = time.time()
        ok = mt5.login(int(acc["login"]), password=pwd, server=acc["server"], timeout=cfg["login_timeout_ms"])
        pwd = None
        if not ok:
            code, text = mt5.last_error()
            self.log("Login falló %s: %s %s" % (label, code, text))
            if code == AUTH_FAILED:
                return self._error(acc, MSG_LOGIN, job)
            # Servidor caído o lento: solo se muestra el error si falla dos veces seguidas
            if job.get("fails", 0) >= 1:
                return self._error(acc, MSG_SERVER, job)
            return {"ok": False, "error": MSG_SERVER, "soft": True}
        info = mt5.account_info()
        if info is None:
            return {"ok": False, "error": MSG_SERVER, "soft": True}
        who = ((info.company or "") + " " + (info.server or "")).lower()
        if not any(m in who for m in BROKER_MARKS[acc["broker"]]) or not str(acc["server"]).lower().startswith(SERVER_PREFIX[acc["broker"]]):
            self.log("Bróker no coincide %s: %s" % (label, who))
            return self._error(acc, MSG_BROKER[acc["broker"]], job)
        partner = job.get("partner")
        if acc["broker"] == "exness" and partner is not None and str(acc["login"]) not in partner:
            return self._error(acc, MSG_PARTNER, job)

        full = job.get("full") or not acc.get("last_sync_at")
        off = server_offset(mt5)
        wait_history(mt5, info.balance, 40 if full else 8)
        now_srv = dt.datetime.now()
        if full:
            all_deals = mt5.history_deals_get(dt.datetime(2000, 1, 1), _far()) or ()
            if all_deals:
                since = to_utc(min(d.time for d in all_deals), off).replace(tzinfo=None, hour=0, minute=0, second=0, microsecond=0)
            else:
                since = now_srv.replace(hour=0, minute=0, second=0, microsecond=0)
        else:
            # Incremental: desde el último sync menos un margen (por si MT5 tardó en bajar algo)
            last = dt.datetime.fromisoformat(acc["last_sync_at"].replace("Z", "+00:00")).replace(tzinfo=None)
            since = last - dt.timedelta(hours=cfg["margin_hours"])
            since = since.replace(hour=0, minute=0, second=0, microsecond=0)
        deals = list(mt5.history_deals_get(since, _far()) or ())
        orders = list(mt5.history_orders_get(since, _far()) or ())
        # Posiciones que cerraron en el rango pero abrieron antes: se piden completas por su número
        trade_types = (mt5.DEAL_TYPE_BUY, mt5.DEAL_TYPE_SELL)
        have_in = {d.position_id for d in deals if d.type in trade_types and d.entry == mt5.DEAL_ENTRY_IN}
        closed = {d.position_id for d in deals if d.type in trade_types and d.entry != mt5.DEAL_ENTRY_IN and d.position_id}
        extra_deals, extra_orders = [], []
        for pid in closed - have_in:
            extra_deals += list(mt5.history_deals_get(position=pid) or ())
            extra_orders += list(mt5.history_orders_get(position=pid) or ())
        trades = build_trades(mt5, deals + extra_deals, orders + extra_orders, off, acc)
        snaps = daily_balances(deals, info.balance, off, since, acc)
        snaps[0]["equity"] = round(info.equity, 2)  # hoy: equidad real
        transfers = read_transfers(mt5, deals, off, acc)
        open_pos = mt5.positions_total() or 0
        today_utc = dt.datetime.now(dt.timezone.utc).date()
        traded_today = any(d.type in trade_types and to_utc(d.time, off).date() == today_utc for d in deals)
        # ¿Operó en los últimos N días? Si no, la cuenta "duerme" y se lee una vez al día
        quiet_from = dt.datetime.now() - dt.timedelta(days=cfg.get("dormant_days", 60))
        recent_trades = [d for d in (mt5.history_deals_get(quiet_from, _far()) or ()) if d.type in trade_types]
        dormant = open_pos == 0 and not recent_trades
        took = time.time() - t0

        # ¿Cambió algo? Si no, no se escribe nada en Supabase.
        core = sig((trades, [(s["day"], s["balance"]) for s in snaps], transfers, round(info.balance, 2)))
        prev = job.get("prev") or {}
        status_ok = acc.get("status") == "ok"
        equity_due = (abs(round(info.equity, 2) - (prev.get("equity") if prev.get("equity") is not None else -1e18)) >= 0.01
                      and time.time() - prev.get("eq_at", 0) >= cfg["equity_min"] * 60)
        if not full and status_ok and prev.get("core") == core and not equity_due:
            self.log("Sin cambios %s (%.1f s)" % (label, took))
            return {"ok": True, "wrote": False, "balance": info.balance, "equity": info.equity,
                    "open": open_pos, "today": traded_today, "dormant": dormant, "prev": prev}
        if full:
            self.sb.req("DELETE", "journal_snapshots?account_id=eq.%s&day=lt.%s" % (acc["id"], since.date().isoformat()))
        if trades and (full or prev.get("trades") != sig(trades)):
            self.sb.upsert("journal_trades", trades, "account_id,ticket")
        if transfers and (full or prev.get("tf") != sig(transfers)):
            self.sb.upsert("journal_transfers", transfers, "account_id,ticket")
        self.sb.upsert("journal_snapshots", snaps, "account_id,day")
        now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
        self.sb.update_account(acc["id"], status="ok", last_error=None, balance=info.balance, equity=info.equity,
                               currency=info.currency, last_sync_at=now_iso)
        self.log("OK %s: %d operaciones nuevas o revisadas%s (%.1f s)" % (label, len(trades), " (historial completo)" if full else "", took))
        return {"ok": True, "wrote": True, "balance": info.balance, "equity": info.equity, "open": open_pos,
                "today": traded_today, "dormant": dormant, "last_sync_at": now_iso,
                "prev": {"core": core, "trades": sig(trades), "tf": sig(transfers),
                         "equity": round(info.equity, 2), "eq_at": time.time()}}


def worker_main(name, path, cfg, jobs, results):
    """Proceso de un MT5 del Journal. Corre hasta recibir None por la cola."""
    def log(msg):
        results.put(("log", name, msg))

    err = check_terminal_path(path, cfg["journal_root"])
    if err:
        results.put(("terminal", name, False, err))
        return
    try:
        import MetaTrader5 as mt5
    except Exception as e:
        results.put(("terminal", name, False, "No está instalada la librería MetaTrader5: %s" % e))
        return
    syncer = Syncer(cfg, log)

    def connect():
        while True:
            if mt5.initialize(path=path, portable=True, timeout=60000):
                minimize_terminal(path)
                results.put(("terminal", name, True, "Conectado"))
                return
            results.put(("terminal", name, False, "No abrió el MT5: %s" % (mt5.last_error(),)))
            time.sleep(60)

    connect()
    while True:
        job = jobs.get()
        if job is None:
            break
        if mt5.terminal_info() is None:  # el MT5 se cerró: se vuelve a abrir
            mt5.shutdown()
            connect()
        acc = job["acc"]
        results.put(("start", name, acc["id"]))
        try:
            res = syncer.sync(mt5, job)
        except Exception as e:
            log("Error en la cuenta %s: %s" % (acc.get("login"), e))
            res = {"ok": False, "error": str(e)[:200], "soft": True}
        results.put(("done", name, acc["id"], res))
    mt5.shutdown()
