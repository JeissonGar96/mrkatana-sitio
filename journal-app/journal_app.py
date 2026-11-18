"""
Kairus Journal: ventana que sincroniza las cuentas MT5 de los alumnos con el Journal de la página.

- Usa SOLO los MT5 portables del Journal (C:\\Journal\\...). Nunca toca el MT5 con la cuenta real,
  el de FundingPips personal ni el del bot (C:\\Kairus\\MT5).
- Un proceso por MT5 (la librería MetaTrader5 solo habla con un terminal por proceso).
- Cuentas con operaciones abiertas o que operaron hoy: cada 5 min. Las demás: cada 45 min.
- La configuración privada (clave de Supabase, etc.) está en config.ini, junto a este archivo.
"""
import collections
import configparser
import datetime as dt
import json
import logging
import logging.handlers
import multiprocessing as mp
import os
import queue
import socket
import sys
import threading
import time

import requests

import journal_worker as jw

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, "config.ini")
STATE_PATH = os.path.join(HERE, "estado.json")
LOG_PATH = os.path.join(HERE, "kairus_journal.log")
PARTNER_API = "https://my.exnessaffiliates.com"
ACC_COLS = "id,user_id,nickname,broker,server,login,investor_password_enc,status,last_error,last_sync_at,balance,equity,currency"
STUCK_SEC = 300  # si un MT5 tarda más de esto con una cuenta, se reinicia su proceso

log = logging.getLogger("kairus_journal")


# ── Configuración ──
def load_config():
    cp = configparser.RawConfigParser()
    cp.optionxform = str
    if not os.path.isfile(CONFIG_PATH):
        raise SystemExit("No encuentro config.ini. Copia config.ejemplo.ini como config.ini y llénalo.")
    cp.read(CONFIG_PATH, encoding="utf-8-sig")

    def get(sec, key, default="", env=None):
        v = cp.get(sec, key, fallback="").strip()
        return v or (os.environ.get(env, "") if env else "") or default

    def num(sec, key, default):
        try:
            return float(get(sec, key, str(default)))
        except ValueError:
            return default

    cfg = {
        "supabase_url": get("supabase", "url", "https://rxyezbyvwqwihggechsc.supabase.co", "SUPABASE_URL"),
        "service_key": get("supabase", "service_key", env="SUPABASE_SERVICE_KEY"),
        "journal_key": get("supabase", "journal_key", env="JOURNAL_KEY"),
        "journal_root": get("journal", "carpeta", "C:\\Journal"),
        "active_min": num("journal", "cada_min_activas", 5),
        "idle_min": num("journal", "cada_min_inactivas", 45),
        "error_min": num("journal", "reintentar_error_min", 15),
        "equity_min": num("journal", "equity_min", 60),
        "margin_hours": num("journal", "margen_horas", 2),
        "login_timeout_ms": int(num("journal", "login_timeout_seg", 20) * 1000),
        "autostart": get("journal", "arrancar_solo", "si").lower() in ("si", "sí", "yes", "1", "true"),
        "partner_email": get("exness_partner", "email", env="EXNESS_PARTNER_EMAIL"),
        "partner_password": get("exness_partner", "password", env="EXNESS_PARTNER_PASSWORD"),
        "terminals": [],
    }
    if cp.has_section("terminales"):
        for name, val in cp.items("terminales"):
            broker, _, path = val.partition("|")
            cfg["terminals"].append({"name": name.strip(), "broker": broker.strip().lower(), "path": path.strip()})
    if not cfg["service_key"] or not cfg["journal_key"]:
        raise SystemExit("Faltan service_key o journal_key en config.ini.")
    if not cfg["terminals"]:
        raise SystemExit("No hay terminales en la sección [terminales] de config.ini.")
    return cfg


def worker_cfg(cfg):
    keys = ("supabase_url", "service_key", "journal_key", "journal_root", "margin_hours", "login_timeout_ms", "equity_min")
    return {k: cfg[k] for k in keys}


# ── Exness: lista de cuentas referidas por el partner (opcional) ──
def exness_partner_logins(cfg, cache):
    if not cfg["partner_email"] or not cfg["partner_password"]:
        return None
    if cache.get("logins") is not None and time.time() - cache.get("at", 0) < 3600:
        return cache["logins"]
    if time.time() - cache.get("fail_at", 0) < 900:
        return cache.get("logins")
    try:
        r = requests.post(PARTNER_API + "/api/v2/auth/", json={"login": cfg["partner_email"], "password": cfg["partner_password"]}, timeout=30)
        r.raise_for_status()
        h = {"Authorization": "JWT " + r.json().get("token")}
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
        cache.update(at=time.time(), logins=logins)
        log.info("Partner Exness: %d cuentas referidas", len(logins))
        return logins
    except Exception as e:  # si la API falla no se rechaza a nadie
        cache["fail_at"] = time.time()
        log.warning("No se pudo consultar la API de partners de Exness: %s", e)
        return cache.get("logins")


class Terminal:
    def __init__(self, t):
        self.name, self.broker, self.path = t["name"], t["broker"], t["path"]
        self.proc, self.q = None, None
        self.ok, self.msg = False, "Sin iniciar"
        self.jobs = set()        # cuentas mandadas a este MT5 que aún no terminan
        self.busy, self.busy_since = None, 0


class Engine:
    """Decide qué cuenta toca, la manda al MT5 que corresponde y recibe los resultados."""

    def __init__(self, cfg):
        self.cfg = cfg
        self.lock = threading.RLock()
        self.running = False
        self.stop = threading.Event()
        self.accounts = {}       # id -> fila de Supabase
        self.st = {}             # id -> estado local (próximo sync, resultado, etc.)
        self.inflight = {}       # id -> nombre del MT5
        self.terms = [Terminal(t) for t in cfg["terminals"]]
        self.results = mp.Queue()
        self.sb = jw.Supabase(cfg["supabase_url"], cfg["service_key"])
        self.partner_cache = {}
        self.logs = collections.deque(maxlen=800)
        self.last_fetch = 0
        self.fetch_error = None
        self.last_beat = time.time()
        self.last_save = time.time()
        self._load_state()

    # ── registro ──
    def add_log(self, msg, level=logging.INFO):
        log.log(level, msg)
        self.logs.append(time.strftime("%H:%M:%S ") + msg)

    # ── estado guardado (para no reescribir todo al reiniciar la app) ──
    def _load_state(self):
        try:
            with open(STATE_PATH, encoding="utf-8") as f:
                for k, v in json.load(f).items():
                    self.st[k] = {"prev": v.get("prev") or {}, "term": v.get("term"), "next": 0}
        except Exception:
            pass

    def _save_state(self):
        try:
            with self.lock:
                data = {k: {"prev": v.get("prev"), "term": v.get("term")} for k, v in self.st.items() if k in self.accounts}
            tmp = STATE_PATH + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f)
            os.replace(tmp, STATE_PATH)
        except Exception as e:
            self.add_log("No se pudo guardar estado.json: %s" % e, logging.WARNING)

    # ── procesos de los MT5 ──
    def start_terminal(self, t):
        t.q = mp.Queue()
        t.ok, t.msg, t.busy = False, "Abriendo…", None
        t.proc = mp.Process(target=jw.worker_main, args=(t.name, t.path, worker_cfg(self.cfg), t.q, self.results),
                            name="mt5-" + t.name, daemon=True)
        t.proc.start()

    def restart_terminal(self, t, why):
        self.add_log("Reiniciando %s: %s" % (t.name, why), logging.WARNING)
        try:
            t.proc.terminate()
            t.proc.join(5)
        except Exception:
            pass
        with self.lock:
            for acc_id in list(t.jobs):
                self.inflight.pop(acc_id, None)
            t.jobs.clear()
        self.start_terminal(t)

    def start(self):
        for t in self.terms:
            err = jw.check_terminal_path(t.path, self.cfg["journal_root"])
            if err:
                t.msg = err
                self.add_log("%s no se usa: %s" % (t.name, err), logging.ERROR)
                continue
            if t.broker not in jw.SERVER_PREFIX:
                t.msg = "Bróker desconocido: %s (usa exness o fundingpips)" % t.broker
                self.add_log(t.msg, logging.ERROR)
                continue
            self.start_terminal(t)
        threading.Thread(target=self._results_loop, daemon=True).start()
        threading.Thread(target=self._loop, daemon=True).start()

    def shutdown(self):
        self.stop.set()
        self._save_state()
        for t in self.terms:
            if t.proc and t.proc.is_alive():
                try:
                    t.q.put(None)
                except Exception:
                    pass
        for t in self.terms:
            if t.proc:
                t.proc.join(5)
                if t.proc.is_alive():
                    t.proc.terminate()

    # ── acciones de los botones ──
    def sync_now(self, ids=None, full=False):
        with self.lock:
            for acc_id in (ids or list(self.accounts)):
                s = self.st.setdefault(acc_id, {"prev": {}, "next": 0})
                s["next"], s["forced"] = 0, True
                if full:
                    s["full"] = True
        self.last_fetch = 0  # de paso, volver a leer la lista de cuentas

    # ── bucle principal ──
    def _loop(self):
        while not self.stop.is_set():
            try:
                now = time.time()
                if now - self.last_fetch >= 60:
                    self._fetch_accounts()
                for t in self.terms:
                    if t.proc is None:
                        continue
                    if not t.proc.is_alive():
                        self.restart_terminal(t, "el proceso se cerró")
                    elif t.busy and now - t.busy_since > STUCK_SEC:
                        self.restart_terminal(t, "se quedó pegado con una cuenta")
                if self.running:
                    self._dispatch()
                if now - self.last_beat >= self.cfg["equity_min"] * 60:
                    self._heartbeat()
                if now - self.last_save >= 300:
                    self.last_save = now
                    self._save_state()
            except Exception as e:
                self.add_log("Fallo general: %s" % e, logging.ERROR)
            self.stop.wait(1)

    def _fetch_accounts(self):
        self.last_fetch = time.time()
        try:
            rows = self.sb.req("GET", "journal_accounts?select=%s&status=neq.paused&order=broker,nickname" % ACC_COLS)
            self.fetch_error = None
        except Exception as e:
            self.fetch_error = "No se pudo leer Supabase: %s" % str(e)[:120]
            self.add_log(self.fetch_error, logging.ERROR)
            return
        with self.lock:
            fresh = {r["id"]: r for r in rows}
            for acc_id, r in fresh.items():
                old = self.accounts.get(acc_id)
                s = self.st.setdefault(acc_id, {"prev": {}, "next": 0})
                # Cuenta nueva o el alumno volvió a escribir la contraseña: se lee ya
                changed_pwd = old is not None and old.get("investor_password_enc") != r.get("investor_password_enc")
                if (r.get("status") == "pending" and time.time() - s.get("done_at", 0) > 120) or changed_pwd:
                    s["next"] = 0
                    s["fails"] = 0
            self.accounts = fresh
        if any(r["broker"] == "exness" for r in rows):
            exness_partner_logins(self.cfg, self.partner_cache)

    def _dispatch(self):
        now = time.time()
        with self.lock:
            due = [a for i, a in self.accounts.items()
                   if i not in self.inflight and self.st.get(i, {}).get("next", 0) <= now]
            due.sort(key=lambda a: (0 if a.get("status") == "pending" or self.st[a["id"]].get("forced") else 1,
                                    self.st[a["id"]].get("next", 0)))
            for a in due:
                s = self.st[a["id"]]
                ready = [t for t in self.terms if t.broker == a["broker"] and t.ok and len(t.jobs) < 2]
                if not ready:
                    continue
                pref = [t for t in ready if t.name == s.get("term")]
                t = pref[0] if pref else min(ready, key=lambda x: len(x.jobs))
                job = {"acc": a, "prev": s.get("prev") or {}, "full": bool(s.get("full")), "fails": s.get("fails", 0),
                       "partner": self.partner_cache.get("logins") if a["broker"] == "exness" else None}
                t.q.put(job)
                t.jobs.add(a["id"])
                self.inflight[a["id"]] = t.name
                s["term"] = t.name

    def _heartbeat(self):
        """Una sola escritura por hora: marca "Actualizado" en las cuentas que se leyeron bien pero no cambiaron."""
        self.last_beat = time.time()
        cutoff = time.time() - self.cfg["equity_min"] * 60
        with self.lock:
            ids = [i for i, s in self.st.items() if i in self.accounts and s.get("ok") and s.get("done_at", 0) > cutoff
                   and s.get("wrote_at", 0) < cutoff]
        if not ids:
            return
        now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
        try:
            for i in range(0, len(ids), 100):
                self.sb.req("PATCH", "journal_accounts?id=in.(%s)&status=eq.ok" % ",".join(ids[i:i + 100]),
                            json={"last_sync_at": now_iso}, headers={"Prefer": "return=minimal"})
            with self.lock:
                for i in ids:
                    if i in self.accounts:
                        self.accounts[i]["last_sync_at"] = now_iso
            self.add_log("Marcadas como actualizadas: %d cuentas sin cambios" % len(ids))
        except Exception as e:
            self.add_log("No se pudo marcar las cuentas: %s" % e, logging.WARNING)

    def _results_loop(self):
        while not self.stop.is_set():
            try:
                msg = self.results.get(timeout=1)
            except queue.Empty:
                continue
            except Exception:
                continue
            kind, name = msg[0], msg[1]
            t = next((x for x in self.terms if x.name == name), None)
            if kind == "log":
                self.add_log("[%s] %s" % (name, msg[2]))
            elif kind == "terminal" and t:
                t.ok, t.msg = msg[2], msg[3]
                self.add_log("[%s] %s" % (name, msg[3]), logging.INFO if msg[2] else logging.ERROR)
            elif kind == "start" and t:
                t.busy, t.busy_since = msg[2], time.time()
            elif kind == "done" and t:
                self._done(t, msg[2], msg[3])

    def _done(self, t, acc_id, res):
        now = time.time()
        with self.lock:
            t.busy = None
            t.jobs.discard(acc_id)
            self.inflight.pop(acc_id, None)
            s = self.st.setdefault(acc_id, {"prev": {}})
            s.update(done_at=now, ok=res.get("ok"), error=res.get("error"), forced=False)
            a = self.accounts.get(acc_id)
            if res.get("ok"):
                s.update(fails=0, full=False, balance=res.get("balance"), equity=res.get("equity"),
                         open=res.get("open", 0), today=res.get("today"), prev=res.get("prev") or s.get("prev"))
                active = res.get("open") or res.get("today")
                s["next"] = now + (self.cfg["active_min"] if active else self.cfg["idle_min"]) * 60
                if res.get("wrote"):
                    s["wrote_at"] = now
                    if a:
                        a.update(status="ok", last_error=None, last_sync_at=res.get("last_sync_at"),
                                 balance=res.get("balance"), equity=res.get("equity"))
            else:
                s["fails"] = s.get("fails", 0) + 1
                wait = 5 if res.get("soft") and s["fails"] < 2 else self.cfg["error_min"]
                s["next"] = now + wait * 60
                if a and not res.get("soft"):  # error definitivo (el MT5 ya lo guardó en Supabase)
                    a.update(status="error", last_error=res.get("error"))

    # ── datos para la ventana ──
    def snapshot(self):
        with self.lock:
            rows = []
            for acc_id, a in self.accounts.items():
                s = self.st.get(acc_id, {})
                busy = any(t.busy == acc_id for t in self.terms)
                rows.append({
                    "id": acc_id, "nickname": a.get("nickname") or "", "broker": a.get("broker"), "login": a.get("login"),
                    "term": s.get("term") or "", "status": "sync" if busy else ("queued" if acc_id in self.inflight else a.get("status")),
                    "last_sync_at": a.get("last_sync_at"), "checked": s.get("done_at"),
                    "balance": s.get("balance", a.get("balance")), "equity": s.get("equity", a.get("equity")),
                    "currency": a.get("currency") or "", "next": s.get("next", 0), "error": a.get("last_error") or "",
                    "open": s.get("open", 0),
                })
            terms = [(t.name, t.broker, t.ok, t.msg, len(t.jobs)) for t in self.terms]
            return rows, terms


# ── Ventana (Tkinter, viene con Python) ──
def run_ui(engine):
    import tkinter as tk
    from tkinter import messagebox, ttk
    from tkinter.scrolledtext import ScrolledText

    BG, CARD, TXT, MUTED, BLUE = "#0E0E10", "#1C1C20", "#F0F0F0", "#9A9AA2", "#197AE1"
    root = tk.Tk()
    root.title("Kairus Journal")
    root.geometry("1280x620")
    root.configure(bg=BG)
    st = ttk.Style(root)
    st.theme_use("clam")
    st.configure(".", background=BG, foreground=TXT, font=("Segoe UI", 10))
    st.configure("Treeview", background=CARD, fieldbackground=CARD, foreground=TXT, rowheight=26, borderwidth=0,
                 bordercolor=CARD, lightcolor=CARD, darkcolor=CARD)
    st.configure("Treeview.Heading", background=BG, foreground=MUTED, font=("Segoe UI", 9, "bold"), borderwidth=0)
    st.map("Treeview", background=[("selected", "#2A3B52")])
    st.configure("TButton", background=CARD, foreground=TXT, borderwidth=0, padding=(14, 6))
    st.map("TButton", background=[("active", "#2A2A30")])
    st.configure("Blue.TButton", background=BLUE, foreground="#FFFFFF")
    st.map("Blue.TButton", background=[("active", "#3B8EE8")])

    top = tk.Frame(root, bg=BG)
    top.pack(fill="x", padx=16, pady=(14, 6))
    tk.Label(top, text="Kairus Journal", bg=BG, fg=TXT, font=("Segoe UI", 15, "bold")).pack(side="left")
    status = tk.Label(top, text="", bg=BG, fg=MUTED, font=("Segoe UI", 10))
    status.pack(side="left", padx=14)

    btns = tk.Frame(root, bg=BG)
    btns.pack(fill="x", padx=16, pady=(0, 8))

    def selected():
        return list(tree.selection())

    def do_start():
        engine.running = True
        engine.add_log("Sincronización iniciada")

    def do_pause():
        engine.running = False
        engine.add_log("Sincronización en pausa (las cuentas que ya estaban en curso terminan)")

    def do_now():
        ids = selected()
        engine.sync_now(ids or None)
        engine.running = True
        engine.add_log("Sincronizar ahora: %s" % ("%d cuentas elegidas" % len(ids) if ids else "todas"))

    def do_full():
        ids = selected()
        if not ids:
            messagebox.showinfo("Kairus Journal", "Primero elige una o más cuentas en la tabla.")
            return
        engine.sync_now(ids, full=True)
        engine.running = True
        engine.add_log("Releer historial completo: %d cuentas" % len(ids))

    log_win = {}

    def do_log():
        if log_win.get("w") and log_win["w"].winfo_exists():
            log_win["w"].lift()
            return
        w = tk.Toplevel(root)
        w.title("Kairus Journal · registro")
        w.geometry("900x480")
        w.configure(bg=BG)
        txt = ScrolledText(w, bg=CARD, fg=TXT, insertbackground=TXT, font=("Consolas", 9), borderwidth=0)
        txt.pack(fill="both", expand=True, padx=10, pady=10)
        log_win.update(w=w, txt=txt, n=-1)

        def refresh():
            if not w.winfo_exists():
                return
            lines = list(engine.logs)
            if len(lines) != log_win["n"] or (lines and lines[-1] != log_win.get("last")):
                at_end = txt.yview()[1] > 0.98
                txt.delete("1.0", "end")
                txt.insert("end", "\n".join(lines))
                if at_end:
                    txt.see("end")
                log_win.update(n=len(lines), last=lines[-1] if lines else None)
            w.after(1500, refresh)

        refresh()

    ttk.Button(btns, text="Iniciar", style="Blue.TButton", command=do_start).pack(side="left", padx=(0, 8))
    ttk.Button(btns, text="Pausar", command=do_pause).pack(side="left", padx=(0, 8))
    ttk.Button(btns, text="Sincronizar ahora", command=do_now).pack(side="left", padx=(0, 8))
    ttk.Button(btns, text="Releer historial completo", command=do_full).pack(side="left", padx=(0, 8))
    ttk.Button(btns, text="Ver log", command=do_log).pack(side="left")

    terms_lbl = tk.Label(root, text="", bg=BG, fg=MUTED, font=("Segoe UI", 9), anchor="w", justify="left")
    terms_lbl.pack(fill="x", padx=16, pady=(0, 6))

    cols = ("cuenta", "broker", "login", "mt5", "estado", "sync", "balance", "equity", "proximo", "error")
    heads = ("Cuenta", "Bróker", "Número", "MT5", "Estado", "Último sync", "Balance", "Equity", "Próximo", "Error")
    widths = (150, 105, 95, 60, 130, 115, 120, 120, 75, 330)
    frame = tk.Frame(root, bg=BG)
    frame.pack(fill="both", expand=True, padx=16, pady=(0, 14))
    tree = ttk.Treeview(frame, columns=cols, show="headings", selectmode="extended")
    for c, h, w in zip(cols, heads, widths):
        tree.heading(c, text=h, anchor="w")
        tree.column(c, width=w, anchor="w", stretch=(c == "error"))
    sb_ = ttk.Scrollbar(frame, orient="vertical", command=tree.yview)
    tree.configure(yscrollcommand=sb_.set)
    tree.pack(side="left", fill="both", expand=True)
    sb_.pack(side="right", fill="y")
    tree.tag_configure("ok", foreground="#86D9A3")
    tree.tag_configure("error", foreground="#F87171")
    tree.tag_configure("busy", foreground="#AFC9E4")
    tree.tag_configure("wait", foreground=MUTED)

    def ago(ts):
        if not ts:
            return "—"
        mn = int((time.time() - ts) / 60)
        return "hace un momento" if mn < 1 else ("hace %d min" % mn if mn < 60 else ("hace %d h" % (mn // 60) if mn < 1440 else "hace %d d" % (mn // 1440)))

    def iso_ts(v):
        try:
            return dt.datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp()
        except Exception:
            return None

    def money(v, cur):
        return "—" if v is None else "{:,.2f} {}".format(float(v), cur).strip()

    LABEL = {"ok": "● OK", "error": "● Error", "pending": "● Nueva", "sync": "● Sincronizando", "queued": "● En cola"}
    TAG = {"ok": "ok", "error": "error", "sync": "busy", "queued": "busy"}

    def refresh():
        rows, terms = engine.snapshot()
        seen = set()
        for r in rows:
            seen.add(r["id"])
            nxt = r["next"] - time.time()
            vals = (r["nickname"], "Exness" if r["broker"] == "exness" else "Funding Pips", r["login"], r["term"],
                    LABEL.get(r["status"], r["status"] or "—"), ago(max(filter(None, [iso_ts(r["last_sync_at"]), r["checked"]]), default=None)),
                    money(r["balance"], r["currency"]), money(r["equity"], r["currency"]),
                    "ahora" if nxt <= 0 else "%d min" % max(1, round(nxt / 60)),
                    r["error"] if r["status"] == "error" else (("%d abierta%s" % (r["open"], "s" if r["open"] > 1 else "")) if r["open"] else ""))
            tag = (TAG.get(r["status"], "wait"),)
            if tree.exists(r["id"]):
                tree.item(r["id"], values=vals, tags=tag)
            else:
                tree.insert("", "end", iid=r["id"], values=vals, tags=tag)
        for iid in tree.get_children():
            if iid not in seen:
                tree.delete(iid)
        n_err = sum(1 for r in rows if r["status"] == "error")
        n_ok_t = sum(1 for t in terms if t[2])
        state = "Corriendo" if engine.running else "En pausa"
        txt = "%s · %d cuentas · %d con error · %d de %d MT5 conectados" % (state, len(rows), n_err, n_ok_t, len(terms))
        if engine.fetch_error:
            txt += " · " + engine.fetch_error
        status.config(text=txt, fg="#F87171" if engine.fetch_error else MUTED)
        terms_lbl.config(text="   ".join("%s (%s): %s%s" % (n, b, "● " if ok else "✕ ", m if not ok else ("ocupado, %d en cola" % q if q else "libre"))
                                         for n, b, ok, m, q in terms))
        root.after(2000, refresh)

    def on_close():
        if messagebox.askyesno("Kairus Journal", "¿Cerrar Kairus Journal?\nEl Journal de los alumnos deja de actualizarse hasta que lo vuelvas a abrir."):
            engine.shutdown()
            root.destroy()

    root.protocol("WM_DELETE_WINDOW", on_close)
    if engine.cfg["autostart"]:
        engine.running = True
    refresh()
    root.mainloop()


def single_instance():
    """Evita abrir la app dos veces (dos apps moviendo los mismos MT5 se pisan)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", 47391))
    except OSError:
        return None
    return s


def main():
    mp.freeze_support()
    h = logging.handlers.RotatingFileHandler(LOG_PATH, maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", handlers=[h])
    lock = single_instance()
    if lock is None:
        try:
            import tkinter.messagebox as mb
            import tkinter as tk
            r = tk.Tk()
            r.withdraw()
            mb.showinfo("Kairus Journal", "Kairus Journal ya está abierto.")
        finally:
            sys.exit(0)
    try:
        cfg = load_config()
    except SystemExit as e:
        import tkinter as tk
        import tkinter.messagebox as mb
        r = tk.Tk()
        r.withdraw()
        mb.showerror("Kairus Journal", str(e))
        sys.exit(1)
    engine = Engine(cfg)
    engine.add_log("Kairus Journal abierto con %d MT5" % len(cfg["terminals"]))
    engine.start()
    run_ui(engine)


if __name__ == "__main__":
    main()
