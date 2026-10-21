"""
Journal automático de Mr Katana: lector de cuentas MT5 (corre en el VPS con Windows).

Cada INTERVAL_MIN minutos:
  1. Lee de Supabase las cuentas conectadas (journal_accounts).
  2. Entra a cada una con la contraseña de inversor (solo lectura) en el terminal MT5 de su bróker.
  3. Verifica que la cuenta sea realmente de Exness o de Funding Pips (dato que da el bróker),
     y que las de Exness estén abiertas con el link de partner de Mr Katana.
  4. Guarda las operaciones cerradas (journal_trades) y el balance diario (journal_snapshots).
  5. Marca la cuenta como "ok" o "error" con un mensaje que el alumno entiende.

Configuración (variables de entorno del VPS, nunca en el código):
  SUPABASE_URL, SUPABASE_SERVICE_KEY, JOURNAL_KEY
  MT5_PATH_EXNESS, MT5_PATH_FUNDINGPIPS   ruta a terminal64.exe de cada bróker
  EXNESS_PARTNER_EMAIL, EXNESS_PARTNER_PASSWORD   (opcional: sin ellas no se valida el link)
  INTERVAL_MIN (60 por defecto), FIRST_SYNC_DAYS (90 por defecto)

Uso:  python journal_sync.py          (se queda corriendo)
      python journal_sync.py --once   (una pasada y termina)
"""
import base64
import datetime as dt
import hashlib
import logging
import os
import sys
import time

import requests
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

log = logging.getLogger("journal")

SB_URL = os.environ.get("SUPABASE_URL", "https://rxyezbyvwqwihggechsc.supabase.co").rstrip("/")
SB_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
JOURNAL_KEY = os.environ.get("JOURNAL_KEY", "")
INTERVAL_MIN = int(os.environ.get("INTERVAL_MIN", "60"))
FIRST_SYNC_DAYS = int(os.environ.get("FIRST_SYNC_DAYS", "90"))
MT5_PATHS = {
    "exness": os.environ.get("MT5_PATH_EXNESS", ""),
    "fundingpips": os.environ.get("MT5_PATH_FUNDINGPIPS", ""),
}
# Palabras que deben aparecer en el nombre de la empresa o del servidor que reporta MT5
BROKER_MARKS = {"exness": ("exness",), "fundingpips": ("funding pips", "fundingpips", "funding-pips")}
PARTNER_API = "https://my.exnessaffiliates.com"

MSG_LOGIN = "No pudimos entrar. Revisa el servidor, el número de cuenta y la contraseña de inversor."
MSG_BROKER = {"exness": "Esta cuenta no es de Exness.", "fundingpips": "Esta cuenta no es de Funding Pips."}
MSG_PARTNER = "Esta cuenta no está abierta con el link de Mr Katana."


# ── Supabase (REST con la service key) ──
def sb(method, path, **kw):
    h = {"apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY, "Content-Type": "application/json"}
    h.update(kw.pop("headers", {}))
    r = requests.request(method, SB_URL + "/rest/v1/" + path, headers=h, timeout=30, **kw)
    if r.status_code >= 300:
        raise RuntimeError("Supabase %s %s: %s %s" % (method, path, r.status_code, r.text[:300]))
    return r.json() if r.text else None


def update_account(acc_id, **fields):
    sb("PATCH", "journal_accounts?id=eq." + acc_id, json=fields)


def upsert(table, rows, conflict):
    for i in range(0, len(rows), 500):
        sb("POST", table + "?on_conflict=" + conflict, json=rows[i:i + 500],
           headers={"Prefer": "resolution=merge-duplicates,return=minimal"})


# ── Contraseña cifrada por /api/journal-account (formato v1:iv:tag:texto, AES-256-GCM) ──
def decrypt(enc):
    v, iv, tag, ct = enc.split(":")
    if v != "v1":
        raise ValueError("formato desconocido")
    key = hashlib.sha256(JOURNAL_KEY.encode()).digest()
    return AESGCM(key).decrypt(base64.b64decode(iv), base64.b64decode(ct) + base64.b64decode(tag), None).decode()


# ── Exness: lista de cuentas referidas por el partner ──
_partner_cache = {"at": 0, "logins": None}


def exness_partner_logins():
    """Números de cuenta de los clientes referidos. None si no se pudo consultar (no se bloquea a nadie)."""
    email, pwd = os.environ.get("EXNESS_PARTNER_EMAIL"), os.environ.get("EXNESS_PARTNER_PASSWORD")
    if not email or not pwd:
        return None
    if _partner_cache["logins"] is not None and time.time() - _partner_cache["at"] < 3600:
        return _partner_cache["logins"]
    try:
        # Rutas según la guía de la API de partners; se confirman con el esquema (my.exnessaffiliates.com/api/schema/)
        r = requests.post(PARTNER_API + "/api/v2/auth/", json={"login": email, "password": pwd}, timeout=30)
        r.raise_for_status()
        token = r.json().get("token")
        h = {"Authorization": "JWT " + token}
        logins, url = set(), PARTNER_API + "/api/reports/clients/accounts/?limit=1000"
        while url:
            r = requests.get(url, headers=h, timeout=30)
            r.raise_for_status()
            j = r.json()
            for row in j.get("data", j.get("results", [])):
                n = row.get("client_account") or row.get("account") or row.get("login")
                if n:
                    logins.add(str(n))
            url = j.get("next")
        _partner_cache.update(at=time.time(), logins=logins)
        log.info("Partner Exness: %d cuentas referidas", len(logins))
        return logins
    except Exception as e:  # si la API falla no rechazamos cuentas: lo dejamos en el registro
        log.warning("No se pudo consultar la API de partners de Exness: %s", e)
        return None


# ── MT5 ──
def server_offset(mt5):
    """Horas que el reloj del servidor del bróker va por delante de UTC (MT5 da fechas en hora del servidor)."""
    for sym in ("EURUSD", "EURUSDm", "XAUUSD", "XAUUSDm", "BTCUSD", "BTCUSDm"):
        t = mt5.symbol_info_tick(sym)
        if t and t.time:
            off = round((t.time - time.time()) / 3600)
            if 0 <= off <= 4 and abs(t.time - time.time() - off * 3600) < 600:
                return off
    return int(os.environ.get("SERVER_UTC_OFFSET", "2"))


def to_utc(ts, off):
    return dt.datetime.fromtimestamp(ts - off * 3600, dt.timezone.utc)


def read_positions(mt5, date_from, off, acc):
    """Agrupa los deals por posición y devuelve las operaciones cerradas."""
    deals = mt5.history_deals_get(date_from, dt.datetime.now() + dt.timedelta(days=2)) or []
    orders = mt5.history_orders_get(date_from, dt.datetime.now() + dt.timedelta(days=2)) or []
    sltp = {}
    for o in orders:  # el último SL/TP conocido de cada posición
        if o.position_id and (o.sl or o.tp):
            sltp[o.position_id] = (o.sl or None, o.tp or None)
    pos = {}
    for d in deals:
        if not d.position_id or d.type not in (mt5.DEAL_TYPE_BUY, mt5.DEAL_TYPE_SELL):
            continue
        p = pos.setdefault(d.position_id, {"ins": [], "outs": []})
        (p["ins"] if d.entry == mt5.DEAL_ENTRY_IN else p["outs"]).append(d)
    rows = []
    for pid, p in pos.items():
        if not p["ins"] or not p["outs"]:
            continue  # sigue abierta o empezó antes del rango
        fi, lo = min(p["ins"], key=lambda x: x.time_msc), max(p["outs"], key=lambda x: x.time_msc)
        vol = sum(x.volume for x in p["ins"])
        out_vol = sum(x.volume for x in p["outs"])
        if out_vol + 1e-9 < vol:
            continue  # cerrada solo en parte: se guarda cuando cierre completa
        all_d = p["ins"] + p["outs"]
        sl, tp = sltp.get(pid, (None, None))
        rows.append({
            "account_id": acc["id"], "user_id": acc["user_id"], "ticket": int(pid), "symbol": fi.symbol,
            "side": "buy" if fi.type == mt5.DEAL_TYPE_BUY else "sell", "volume": round(vol, 2),
            "open_time": to_utc(fi.time, off).isoformat(), "close_time": to_utc(lo.time, off).isoformat(),
            "open_price": sum(x.price * x.volume for x in p["ins"]) / vol,
            "close_price": sum(x.price * x.volume for x in p["outs"]) / out_vol,
            "sl": sl, "tp": tp,
            "commission": round(sum(x.commission + getattr(x, "fee", 0) for x in all_d), 2),
            "swap": round(sum(x.swap for x in all_d), 2),
            "profit": round(sum(x.profit for x in all_d), 2),
        })
    return rows, deals


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


def sync_account(mt5, acc, partner_logins):
    try:
        pwd = decrypt(acc["investor_password_enc"])
    except Exception:
        return update_account(acc["id"], status="error", last_error="Vuelve a escribir la contraseña de inversor.")
    if not mt5.login(int(acc["login"]), password=pwd, server=acc["server"], timeout=60000):
        log.info("Login falló %s %s: %s", acc["broker"], acc["login"], mt5.last_error())
        return update_account(acc["id"], status="error", last_error=MSG_LOGIN)
    info = mt5.account_info()
    who = ((info.company or "") + " " + (info.server or "")).lower()
    if not any(m in who for m in BROKER_MARKS[acc["broker"]]):
        log.info("Bróker no coincide %s: %s", acc["login"], who)
        return update_account(acc["id"], status="error", last_error=MSG_BROKER[acc["broker"]])
    if acc["broker"] == "exness" and partner_logins is not None and str(acc["login"]) not in partner_logins:
        return update_account(acc["id"], status="error", last_error=MSG_PARTNER)

    off = server_offset(mt5)
    if acc.get("last_sync_at"):
        since = dt.datetime.fromisoformat(acc["last_sync_at"].replace("Z", "+00:00")).replace(tzinfo=None) - dt.timedelta(days=3)
    else:
        since = dt.datetime.now() - dt.timedelta(days=FIRST_SYNC_DAYS)
    trades, deals = read_positions(mt5, since, off, acc)
    if trades:
        upsert("journal_trades", trades, "account_id,ticket")
    snaps = daily_balances(deals, info.balance, off, since, acc)
    snaps[0]["equity"] = round(info.equity, 2)  # hoy: equidad real
    if not acc.get("last_sync_at"):
        upsert("journal_snapshots", snaps, "account_id,day")
    else:
        upsert("journal_snapshots", snaps[:4], "account_id,day")
    update_account(acc["id"], status="ok", last_error=None, balance=info.balance, equity=info.equity,
                   currency=info.currency, last_sync_at=dt.datetime.now(dt.timezone.utc).isoformat())
    log.info("OK %s %s: %d operaciones", acc["broker"], acc["login"], len(trades))


def run_once():
    import MetaTrader5 as mt5  # solo existe en Windows
    accounts = sb("GET", "journal_accounts?select=*&status=neq.paused&order=broker")
    partner_logins = exness_partner_logins() if any(a["broker"] == "exness" for a in accounts) else None
    for broker in ("exness", "fundingpips"):
        group = [a for a in accounts if a["broker"] == broker]
        if not group:
            continue
        if not MT5_PATHS[broker] or not mt5.initialize(path=MT5_PATHS[broker], timeout=60000):
            log.error("No se pudo abrir el MT5 de %s (%s): %s", broker, MT5_PATHS[broker], mt5.last_error())
            continue
        for acc in group:
            try:
                sync_account(mt5, acc, partner_logins)
            except Exception as e:
                log.exception("Error en la cuenta %s: %s", acc.get("login"), e)
        mt5.shutdown()


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        handlers=[logging.StreamHandler(), logging.FileHandler("journal_sync.log", encoding="utf-8")])
    if not SB_KEY or not JOURNAL_KEY:
        sys.exit("Faltan SUPABASE_SERVICE_KEY o JOURNAL_KEY en las variables de entorno.")
    while True:
        start = time.time()
        try:
            run_once()
        except Exception as e:
            log.exception("Fallo general: %s", e)
        if "--once" in sys.argv:
            break
        time.sleep(max(60, INTERVAL_MIN * 60 - (time.time() - start)))


if __name__ == "__main__":
    main()
