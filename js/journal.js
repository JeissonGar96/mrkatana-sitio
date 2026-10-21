/* Journal automático: panel con los datos reales de cada cuenta MT5.
   Las operaciones, el balance diario y el estado de la cuenta los escribe el servidor Windows (vps/journal_sync.py).
   Aquí solo se leen; el alumno puede escribir su nota y su captura por operación y marcar días "No operé".
   Usa las funciones del panel: sb, cUser, tst, _mkEsc, rTools, rJournal (administrar cuentas) y _jnForm (conectar). */
(function() {
  var JX = { acc: [], cur: null, trades: [], snaps: [], days: {}, month: null, range: 'all', hist: 25, prefs: null };
  var PN = [
    ['top', 'Resumen de la cuenta', 'Balance, equidad, hoy y disciplina', 1],
    ['curva', 'Curva de la cuenta', 'Balance y equidad en el tiempo', 0],
    ['kpis', 'Estadísticas', 'Ganancia media, acierto, profit factor…', 0],
    ['cal', 'Calendario', 'Resultado por día y por semana', 1],
    ['analisis', 'Ventas y compras', 'Acierto y resultado por dirección', 0],
    ['graficas', 'Instrumentos y duración', 'Dónde y cuánto tiempo ganas', 0],
    ['hist', 'Historial de operaciones', 'Todas tus operaciones cerradas', 0]
  ];
  var PRE = [
    ['Paleta de la página', 'Los colores de tu panel', { page: true }],
    ['Clásico', 'Verde y rojo', { win: '#34c27a', loss: '#ef5350', curve: '#34c27a' }],
    ['Suave', 'Verde salvia y coral', { win: '#7fbf9a', loss: '#d98276', curve: '#7fbf9a' }],
    ['Azul y naranja', 'Fácil de distinguir', { win: '#4f8ef7', loss: '#f0914b', curve: '#4f8ef7' }],
    ['Monocromo', 'Blanco y gris', { win: '#ececec', loss: '#7d7d85', curve: '#ececec' }]
  ];
  var MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var MESL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var BROKER = { exness: 'Exness', fundingpips: 'Funding Pips' };
  var ACC_COLS = 'id, nickname, broker, server, login, account_size, status, last_error, last_sync_at, balance, equity, currency, created_at';
  var TR_COLS = 'id, ticket, symbol, side, volume, open_time, close_time, open_price, close_price, sl, tp, commission, swap, profit, note, screenshot_path';
  var CAM = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
  var CHEV = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  var GEAR = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
  var GRIP = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><g fill="currentColor"><circle cx="5" cy="3" r="1.2"/><circle cx="9" cy="3" r="1.2"/><circle cx="5" cy="7" r="1.2"/><circle cx="9" cy="7" r="1.2"/><circle cx="5" cy="11" r="1.2"/><circle cx="9" cy="11" r="1.2"/></g></svg>';
  var LOCK = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

  /* ── Estilos (todo bajo .jx para no chocar con el resto del panel) ── */
  var CSS = [
    '.jx{--jx-win:rgb(var(--c-acc));--jx-loss:#c96f68;--jx-curve:rgb(var(--c-acc));--jx-eq:var(--c-muted);--jx-card2:color-mix(in srgb,var(--c-card),rgb(var(--c-ov)) 4%);--jx-inset:var(--c-bg);--jx-pop:var(--c-panel);display:flex;flex-direction:column;gap:16px;font-size:13px;}',
    ':root[data-theme="light"] .jx{--jx-loss:#b5524b;}',
    '.jx .num{font-variant-numeric:tabular-nums;} .jx .g{color:var(--jx-win);} .jx .l{color:var(--jx-loss);} .jx .m{color:var(--c-text2);}',
    '.jx [hidden]{display:none!important;}',
    '.jx-card{background:var(--c-card);background-image:var(--k-sheen);border:1px solid var(--k-line);border-radius:18px;box-shadow:var(--k-sh);min-width:0;}',
    '.jx-ch{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:18px 22px 0;flex-wrap:wrap;}',
    '.jx-ch h2{font-size:15px;font-weight:700;margin:0;letter-spacing:-.015em;color:var(--c-text);}',
    '.jx-lbl{font-size:11.5px;color:var(--c-text2);}',
    '.jx-btn{appearance:none;border:1px solid var(--k-line);background:transparent;color:var(--c-text);font:600 12px inherit;font-family:inherit;padding:8px 13px;border-radius:10px;cursor:pointer;}',
    '.jx-btn.pri{background:rgb(var(--c-acc));border-color:transparent;color:var(--c-ongold);}',
    '.jx-btn:disabled{opacity:.55;cursor:default;}',
    '.jx-seg{display:inline-flex;background:var(--jx-inset);border:1px solid var(--k-line);border-radius:11px;padding:3px;gap:2px;}',
    '.jx-seg button{appearance:none;border:0;background:transparent;color:var(--c-text2);font:600 12px inherit;font-family:inherit;padding:6px 12px;border-radius:8px;cursor:pointer;}',
    '.jx-seg button.on{background:var(--jx-card2);color:var(--c-text);box-shadow:inset 0 1px 0 rgba(var(--c-ov),.05),0 1px 2px rgba(0,0,0,.25);}',
    '.jx button:focus-visible,.jx-dov button:focus-visible,.jx-ov button:focus-visible{outline:2px solid rgb(var(--c-acc));outline-offset:2px;}',
    '.jx-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;}',
    '.jx-head .asub{margin-bottom:0;}',
    '.jx-live{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--c-muted);flex:none;}',
    '.jx-live.ok{background:rgb(var(--c-acc));box-shadow:0 0 0 3px rgba(var(--c-acc),.16);} .jx-live.error{background:var(--jx-loss);}',
    '.jx-acts{display:flex;gap:8px;flex-wrap:wrap;}',
    '.jx-body{display:flex;flex-direction:column;gap:16px;}',
    /* fila superior */
    '.jx-top,.jx-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;}',
    '.jx-st{padding:18px 20px;} .jx-st .v{font-size:23px;font-weight:700;letter-spacing:-.03em;margin-top:10px;color:var(--c-text);}',
    '.jx-st .sub{font-size:11px;color:var(--c-muted);margin-top:8px;}',
    '.jx-bar{height:4px;border-radius:3px;background:rgba(var(--c-ov),.06);margin-top:14px;position:relative;}',
    '.jx-bar i{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:linear-gradient(90deg,rgb(var(--c-acc)),rgb(var(--c-acc2)));}',
    '.jx-kp{padding:16px 20px;} .jx-kp .v{font-size:20px;font-weight:700;margin-top:9px;letter-spacing:-.025em;color:var(--c-text);}',
    /* curva */
    '.jx-curve{position:relative;padding:6px 14px 12px 6px;} .jx-curve svg{display:block;width:100%;height:290px;}',
    '.jx-tip{position:absolute;pointer-events:none;background:var(--jx-pop);border:1px solid var(--k-line);border-radius:12px;box-shadow:0 14px 34px -12px rgba(0,0,0,.6);min-width:190px;font-size:12px;opacity:0;transition:opacity .12s;}',
    '.jx-tip.on{opacity:1;} .jx-tip h4{margin:0;padding:10px 14px;border-bottom:1px solid var(--k-line);font-size:12px;font-weight:700;text-align:center;color:var(--c-text);}',
    '.jx-tip div{display:flex;justify-content:space-between;gap:18px;padding:7px 14px;color:var(--c-text2);} .jx-tip div:last-child{padding-bottom:11px;} .jx-tip b{color:var(--c-text);font-weight:600;}',
    '.jx-tip i,.jx-legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;vertical-align:0;}',
    '.jx-legend{display:flex;gap:16px;font-size:11.5px;color:var(--c-text2);}',
    '.jx-empty{padding:40px 22px;text-align:center;color:var(--c-muted);font-size:12.5px;}',
    /* calendario */
    '.jx-calw{display:grid;grid-template-columns:minmax(0,1fr) 250px;padding:14px 0 0;}',
    '.jx-cal{padding:0 16px 18px 18px;min-width:0;}',
    '.jx-dows,.jx-days{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;}',
    '.jx-dows div{font-size:10px;color:var(--c-muted);text-align:center;padding:4px 0 8px;letter-spacing:.12em;font-weight:600;}',
    '.jx-day{position:relative;aspect-ratio:1.25/1;border-radius:11px;background:rgba(var(--c-ov),.022);border:1px solid rgba(var(--c-ov),.035);padding:8px 9px;display:flex;flex-direction:column;justify-content:space-between;min-width:0;transition:border-color .15s,transform .15s;font:inherit;color:inherit;text-align:left;}',
    'button.jx-day{cursor:pointer;} button.jx-day:hover{transform:translateY(-1px);border-color:rgba(var(--c-ov),.18);}',
    '.jx-day .d{font-size:12px;color:var(--c-muted);font-weight:600;} .jx-day.t .d{color:var(--c-text);}',
    '.jx-day .pn{font-size:12.5px;font-weight:700;text-align:right;letter-spacing:-.02em;} .jx-day .tc{font-size:10px;color:var(--c-text2);text-align:right;margin-bottom:2px;}',
    '.jx-day.w{background:linear-gradient(160deg,color-mix(in srgb,var(--jx-win) 17%,transparent),color-mix(in srgb,var(--jx-win) 3%,transparent));border-color:color-mix(in srgb,var(--jx-win) 22%,transparent);}',
    '.jx-day.lo{background:linear-gradient(160deg,color-mix(in srgb,var(--jx-loss) 14%,transparent),color-mix(in srgb,var(--jx-loss) 2%,transparent));border-color:color-mix(in srgb,var(--jx-loss) 18%,transparent);}',
    '.jx-day.no .pn{color:var(--c-text2);font-weight:500;font-size:11px;}',
    '.jx-day.today{box-shadow:0 0 0 1.5px rgb(var(--c-acc));} .jx-day.x{background:transparent;border-color:transparent;} .jx-day.fut{opacity:.45;}',
    '.jx-day .cam{position:absolute;top:8px;right:9px;width:12px;height:12px;color:var(--c-text2);}',
    '.jx-weeks{border-left:1px solid var(--k-line);display:flex;flex-direction:column;margin-bottom:18px;}',
    '.jx-wk{padding:12px 20px;display:grid;gap:7px;border-bottom:1px solid rgba(var(--c-ov),.05);} .jx-wk:last-child{border-bottom:0;}',
    '.jx-wk .r{display:flex;justify-content:space-between;align-items:baseline;gap:8px;} .jx-wk b{font-size:13px;font-weight:700;color:var(--c-text);}',
    '.jx-mtot{display:flex;gap:18px;font-size:12px;color:var(--c-text2);} .jx-mtot b{font-weight:700;}',
    /* medidores y gráficas */
    '.jx-g3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;}',
    '.jx-gg{padding:18px 20px 16px;display:flex;flex-direction:column;align-items:center;}',
    '.jx-gg h3{align-self:flex-start;font-size:13.5px;font-weight:700;margin:0 0 10px;color:var(--c-text);} .jx-gg svg{width:100%;max-width:210px;height:auto;}',
    '.jx-gg .row{display:grid;grid-template-columns:repeat(3,1fr);width:100%;text-align:center;border-top:1px solid var(--k-line);padding-top:12px;margin-top:8px;}',
    '.jx-gg .row .v{font-size:12.5px;font-weight:700;margin-top:4px;color:var(--c-text);}',
    '.jx-two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;}',
    '.jx-chart{padding:8px 14px 14px;} .jx-chart svg{display:block;width:100%;height:auto;}',
    '.jx svg text{font-family:inherit;}',
    /* historial */
    '.jx-tbl{overflow-x:auto;margin-top:12px;}',
    '.jx-tbl table{width:100%;border-collapse:collapse;font-size:12.5px;min-width:820px;}',
    '.jx-tbl th{font-weight:600;color:var(--c-muted);text-align:left;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;padding:11px 22px;border-block:1px solid var(--k-line);}',
    '.jx-tbl td{padding:14px 22px;border-bottom:1px solid rgba(var(--c-ov),.05);color:var(--c-text2);white-space:nowrap;}',
    '.jx-tbl tr:last-child td{border-bottom:0;} .jx-tbl tbody tr:hover td{background:rgba(var(--c-ov),.018);}',
    '.jx-tbl .r{text-align:right;} .jx-tbl .sym{font-weight:700;color:var(--c-text);}',
    '.jx .sb,.jx-ov .sb{color:var(--jx-win);font-weight:600;} .jx .ss,.jx-ov .ss{color:var(--c-text2);font-weight:600;}',
    '.jx-more{display:flex;justify-content:center;padding:14px;}',
    /* selector de cuenta */
    '.jx-accsel{position:relative;}',
    '.jx-accbtn{appearance:none;display:flex;align-items:center;gap:11px;text-align:left;background:var(--c-card);background-image:var(--k-sheen);border:1px solid var(--k-line);box-shadow:var(--k-sh);color:var(--c-text);font-family:inherit;padding:9px 14px;border-radius:12px;cursor:pointer;min-width:260px;}',
    '.jx-accbtn>span:nth-child(2){flex:1;min-width:0;} .jx-accbtn b{display:block;font-size:13px;font-weight:700;} .jx-accbtn small{display:block;font-size:11px;color:var(--c-text2);margin-top:2px;} .jx-accbtn svg{color:var(--c-text2);}',
    '.jx-menu{position:absolute;right:0;top:calc(100% + 8px);z-index:30;width:330px;max-width:calc(100vw - 32px);background:var(--jx-pop);border:1px solid var(--k-line);border-radius:14px;box-shadow:0 24px 60px -18px rgba(0,0,0,.6);padding:6px;}',
    '.jx-amh{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--c-muted);font-weight:600;padding:10px 12px 8px;}',
    '.jx-ai{display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:10px;cursor:pointer;}',
    '.jx-ai:hover{background:rgba(var(--c-ov),.035);} .jx-ai div{flex:1;min-width:0;} .jx-ai b{display:block;font-size:13px;font-weight:600;color:var(--c-text);} .jx-ai small{font-size:11px;color:var(--c-text2);}',
    '.jx-ai.on .jx-live{background:rgb(var(--c-acc));box-shadow:0 0 0 3px rgba(var(--c-acc),.16);}',
    '.jx-ai .ren{appearance:none;border:0;background:none;color:var(--c-muted);font:600 11px inherit;font-family:inherit;cursor:pointer;padding:4px;} .jx-ai .ren:hover{color:rgb(var(--c-acc));}',
    '.jx-ai input{width:100%;background:var(--jx-inset);border:1px solid rgb(var(--c-acc));border-radius:7px;color:var(--c-text);font:600 13px inherit;font-family:inherit;padding:5px 8px;}',
    '.jx-madd{appearance:none;width:100%;margin-top:4px;border:1px dashed var(--k-line);background:none;color:rgb(var(--c-acc));font:600 12.5px inherit;font-family:inherit;padding:11px;border-radius:10px;cursor:pointer;}',
    '.jx-mman{appearance:none;width:100%;border:0;background:none;color:var(--c-text2);font:600 12px inherit;font-family:inherit;padding:10px;cursor:pointer;} .jx-mman:hover{color:var(--c-text);}',
    '.jx-gear{appearance:none;display:flex;align-items:center;gap:9px;min-height:52px;background:var(--c-card);background-image:var(--k-sheen);border:1px solid var(--k-line);box-shadow:var(--k-sh);color:var(--c-text);font:600 12.5px inherit;font-family:inherit;padding:0 14px;border-radius:12px;cursor:pointer;}',
    /* personalizar */
    '.jx-dov{position:fixed;inset:0;z-index:960;background:rgba(5,5,7,.5);backdrop-filter:blur(4px);}',
    '.jx-drw{position:absolute;top:0;right:0;bottom:0;width:min(400px,100%);background:var(--c-card);border-left:1px solid var(--k-line);box-shadow:-30px 0 80px -30px rgba(0,0,0,.6);display:flex;flex-direction:column;color:var(--c-text);font-size:13px;}',
    '.jx-drb{flex:1;overflow:auto;padding:8px 14px 18px;} .jx-drw .jx-amh{padding:12px 8px 4px;}',
    '.jx-hint{font-size:11.5px;color:var(--c-text2);margin:0 8px 10px;}',
    '.jx-pl{display:grid;gap:6px;}',
    '.jx-pi{display:flex;align-items:center;gap:10px;padding:11px 12px;border:1px solid var(--k-line);border-radius:12px;background:var(--jx-card2);user-select:none;}',
    '.jx-pi.drag{opacity:.4;} .jx-pi.over{border-color:rgb(var(--c-acc));}',
    '.jx-pi .hd{cursor:grab;color:var(--c-muted);display:grid;place-items:center;}',
    '.jx-pi .nm{flex:1;font-weight:600;font-size:13px;} .jx-pi .nm small{display:block;font-weight:500;font-size:11px;color:var(--c-text2);margin-top:1px;} .jx-pi.off .nm{color:var(--c-muted);}',
    '.jx-pi .mv{appearance:none;border:0;background:none;color:var(--c-muted);cursor:pointer;padding:3px;font-size:12px;border-radius:6px;} .jx-pi .mv:hover{color:var(--c-text);background:rgba(var(--c-ov),.06);} .jx-pi .mv:disabled{opacity:.3;cursor:default;}',
    '.jx-fx{font-size:10.5px;color:var(--c-text2);display:flex;align-items:center;gap:4px;}',
    '.jx-swt{appearance:none;width:34px;height:20px;border-radius:20px;background:rgba(var(--c-ov),.14);position:relative;cursor:pointer;flex:none;transition:background .15s;margin:0;}',
    '.jx-swt:after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:transform .15s;}',
    '.jx-swt:checked{background:rgb(var(--c-acc));} .jx-swt:checked:after{transform:translateX(14px);}',
    '.jx-pr{appearance:none;display:flex;align-items:center;gap:11px;width:100%;border:0;background:none;color:var(--c-text);font:600 13px inherit;font-family:inherit;padding:9px 12px;border-radius:10px;cursor:pointer;text-align:left;}',
    '.jx-pr:hover{background:rgba(var(--c-ov),.035);} .jx-pr.on{background:rgba(var(--c-ov),.05);} .jx-pr small{display:block;font-size:11px;color:var(--c-text2);font-weight:500;margin-top:1px;} .jx-pr .ok{margin-left:auto;color:rgb(var(--c-acc));}',
    '.jx-sw{display:inline-flex;} .jx-sw i{width:16px;height:16px;border-radius:50%;border:2px solid var(--c-card);} .jx-sw i+i{margin-left:-5px;}',
    '.jx-cust{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:12px 8px 0;border-top:1px solid var(--k-line);margin-top:6px;}',
    '.jx-cust label{display:grid;gap:6px;font-size:11px;color:var(--c-text2);cursor:pointer;}',
    '.jx-cust input{appearance:none;-webkit-appearance:none;width:100%;height:30px;border:1px solid var(--k-line);border-radius:8px;background:none;padding:2px;cursor:pointer;}',
    '.jx-cust input::-webkit-color-swatch-wrapper{padding:0;} .jx-cust input::-webkit-color-swatch{border:0;border-radius:6px;} .jx-cust input::-moz-color-swatch{border:0;border-radius:6px;}',
    /* ventana del día */
    '.jx-ov{position:fixed;inset:0;z-index:960;background:rgba(5,5,7,.66);backdrop-filter:blur(6px);display:grid;place-items:center;padding:16px;color:var(--c-text);font-size:13px;}',
    '.jx-md{width:min(720px,100%);max-height:100%;overflow:auto;background:var(--c-card);background-image:var(--k-sheen);border:1px solid var(--k-line);border-radius:20px;box-shadow:0 40px 90px -30px rgba(0,0,0,.8);}',
    '.jx-mh{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:20px 22px 16px;border-bottom:1px solid var(--k-line);}',
    '.jx-mh h3{margin:0;font-size:18px;font-weight:800;letter-spacing:-.02em;} .jx-mh p{margin:5px 0 0;font-size:12px;color:var(--c-text2);}',
    '.jx-x{appearance:none;border:1px solid var(--k-line);background:none;color:var(--c-text2);width:32px;height:32px;border-radius:9px;cursor:pointer;font-size:16px;line-height:1;flex:none;}',
    '.jx-mf{display:flex;justify-content:flex-end;gap:8px;padding:14px 22px;border-top:1px solid var(--k-line);}',
    '.jx-tl{padding:8px 12px 14px;}',
    '.jx-tr{border:1px solid transparent;border-radius:14px;margin-top:6px;} .jx-tr.open{border-color:var(--k-line);background:var(--jx-inset);}',
    '.jx-trh{display:grid;grid-template-columns:auto 1fr auto auto;gap:14px;align-items:center;padding:12px;cursor:pointer;border-radius:13px;}',
    '.jx-trh:hover{background:rgba(var(--c-ov),.025);}',
    '.jx-trh .ic{width:38px;height:38px;border-radius:10px;border:1px solid var(--k-line);display:grid;place-items:center;color:var(--c-text2);overflow:hidden;background:var(--jx-inset);}',
    '.jx-trh .ic img{width:100%;height:100%;object-fit:cover;}',
    '.jx-trh b{font-size:13.5px;} .jx-trh small{display:block;font-size:11.5px;color:var(--c-text2);margin-top:3px;} .jx-trh .res{font-weight:700;font-size:13.5px;}',
    '.jx-trh .chev{color:var(--c-muted);transition:transform .15s;} .jx-tr.open .chev{transform:rotate(180deg);}',
    '.jx-trb{padding:0 12px 14px;display:grid;grid-template-columns:1.3fr 1fr;gap:12px;}',
    '.jx-drop{border:1.5px dashed var(--k-line);border-radius:12px;min-height:170px;display:grid;place-items:center;text-align:center;padding:16px;color:var(--c-text2);font-size:12px;cursor:pointer;position:relative;overflow:hidden;transition:border-color .15s;}',
    '.jx-drop:hover,.jx-drop.over{border-color:rgba(var(--c-acc),.6);} .jx-drop b{display:block;color:var(--c-text);font-size:13px;margin:8px 0 3px;}',
    '.jx-drop img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}',
    '.jx-drop .chg{position:absolute;right:8px;bottom:8px;background:rgba(10,10,12,.8);border:1px solid var(--k-line);color:#f0f0f0;font-size:11px;font-weight:600;padding:5px 9px;border-radius:8px;}',
    '.jx-drop.busy{opacity:.6;pointer-events:none;} .jx-drop input{display:none;}',
    '.jx-nt label{font-size:11px;color:var(--c-text2);display:block;margin-bottom:6px;}',
    '.jx-nt textarea{width:100%;height:132px;resize:none;background:var(--c-card);border:1px solid var(--k-line);border-radius:12px;color:var(--c-text);font:13px/1.5 inherit;font-family:inherit;padding:10px 12px;box-sizing:border-box;}',
    '.jx-nt textarea:focus{outline:none;border-color:rgba(var(--c-acc),.6);}',
    '.jx-kv{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px;font-size:11px;color:var(--c-text2);} .jx-kv b{display:block;color:var(--c-text);font-size:12px;margin-top:2px;font-weight:600;}',
    '.jx-nod{padding:22px;text-align:center;color:var(--c-text2);font-size:12.5px;line-height:1.6;}',
    '.jx-wait{padding:44px 24px;text-align:center;} .jx-wait h3{margin:0 0 8px;font-size:1.05rem;color:var(--c-text);} .jx-wait p{margin:0 auto 18px;max-width:460px;color:var(--c-text2);font-size:.86rem;line-height:1.6;}',
    '@media (max-width:1020px){.jx-top,.jx-kpis{grid-template-columns:repeat(2,minmax(0,1fr));} .jx-calw,.jx-two,.jx-g3{grid-template-columns:minmax(0,1fr);} .jx-weeks{border-left:0;border-top:1px solid var(--k-line);margin:0;}}',
    '@media (max-width:620px){.jx-trb{grid-template-columns:1fr;} .jx-accbtn{min-width:0;width:100%;} .jx-acts,.jx-accsel{width:100%;} .jx-accsel{flex:1;}}',
    '@media (max-width:560px){.jx-days,.jx-dows{gap:4px;} .jx-day{padding:5px;border-radius:8px;} .jx-day .tc{display:none;} .jx-day .pn{font-size:10px;} .jx-st .v{font-size:19px;} .jx-curve svg{height:230px;} .jx-kv{grid-template-columns:repeat(2,1fr);}}',
    '@media (prefers-reduced-motion:reduce){.jx *,.jx-ov *{transition:none!important;}}'
  ].join('\n');
  function css() {
    if (document.getElementById('jx-css')) return;
    var s = document.createElement('style'); s.id = 'jx-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  /* ── Ayudas ── */
  var esc = function(t) { return _mkEsc(t); };
  var net = function(t) { return (+t.profit || 0) + (+t.commission || 0) + (+t.swap || 0); };
  var money = function(v) { return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var short = function(v) { var a = Math.abs(v); return (v < 0 ? '−$' : '$') + (a >= 10000 ? (a / 1000).toFixed(1) + 'k' : a.toFixed(0)); };
  var kfmt = function(v) { var a = Math.abs(v); return (v < 0 ? '−$' : '$') + (a >= 1000 ? (a / 1000).toFixed(a >= 10000 ? 0 : 1) + 'k' : a.toFixed(0)); };
  var pad = function(n) { return String(n).padStart(2, '0'); };
  var dk = function(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var hm = function(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  var dt = function(d) { return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' ' + hm(d); };
  var px = function(v) { return v == null || v === '' || +v === 0 ? '—' : String(+v); };
  var mins = function(t) { return Math.max(0, (new Date(t.close_time) - new Date(t.open_time)) / 60000); };
  var dur = function(m) { m = Math.round(m); if (m >= 1440) return Math.floor(m / 1440) + ' d ' + Math.floor(m % 1440 / 60) + ' h'; return m >= 60 ? Math.floor(m / 60) + ' h ' + pad(m % 60) : m + ' min'; };
  var sideLbl = function(t) { return t.side === 'buy' ? '<span class="sb">Compra</span>' : '<span class="ss">Venta</span>'; };
  var cls = function(v) { return v < 0 ? 'l' : 'g'; };
  var sizeLbl = function(a) { return a.account_size ? (a.account_size >= 1000 ? Math.round(a.account_size / 1000) + 'K' : String(a.account_size)) : ''; };
  var accMeta = function(a) { return [BROKER[a.broker] || '', sizeLbl(a), '#' + a.login].filter(Boolean).join(' · '); };
  function ticks(min, max, n) {
    var span = max - min || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), st = [1, 2, 2.5, 5, 10].map(function(k) { return k * mag; }).find(function(k) { return k >= raw; });
    var out = [], v = Math.ceil(min / st) * st;
    for (; v <= max + 1e-9; v += st) out.push(+v.toFixed(8));
    return out;
  }
  function smooth(P) {
    var n = P.length, d = [], m = [], i;
    if (n < 2) return 'M' + P[0][0] + ',' + P[0][1];
    for (i = 0; i < n - 1; i++) d.push((P[i + 1][1] - P[i][1]) / ((P[i + 1][0] - P[i][0]) || 1));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    var s = 'M' + P[0][0] + ',' + P[0][1];
    for (i = 0; i < n - 1; i++) {
      var h = (P[i + 1][0] - P[i][0]) / 3;
      s += ' C' + (P[i][0] + h) + ',' + (P[i][1] + m[i] * h) + ' ' + (P[i + 1][0] - h) + ',' + (P[i + 1][1] - m[i + 1] * h) + ' ' + P[i + 1][0] + ',' + P[i + 1][1];
    }
    return s;
  }
  var txt = function(x, y, s, a) { return '<text x="' + x + '" y="' + y + '" ' + (a || '') + '>' + s + '</text>'; };
  var dimTxt = 'font-size="10.5" style="fill:var(--c-muted)"';
  var gridLn = function(x1, x2, y) { return '<line x1="' + x1 + '" x2="' + x2 + '" y1="' + y + '" y2="' + y + '" style="stroke:rgba(var(--c-ov),.05)"/>'; };

  /* ── Preferencias del alumno (orden y paneles visibles + colores), guardadas en user_settings.journal_prefs ── */
  function defPrefs() { return { order: PN.map(function(x) { return x[0]; }), hide: [], col: { page: true } }; }
  function loadPrefs(cb) {
    if (JX.prefs) return cb();
    JX.prefs = defPrefs();
    sb.from('user_settings').select('journal_prefs').eq('id', cUser.id).maybeSingle().then(function(r) {
      var p = r && r.data && r.data.journal_prefs;
      if (p && p.order) {
        var ids = PN.map(function(x) { return x[0]; });
        JX.prefs.order = p.order.filter(function(x) { return ids.indexOf(x) >= 0; });
        ids.forEach(function(x) { if (JX.prefs.order.indexOf(x) < 0) JX.prefs.order.push(x); });
        JX.prefs.hide = (p.hide || []).filter(function(x) { return ids.indexOf(x) >= 0; });
      }
      if (p && p.col && (p.col.page || p.col.win)) JX.prefs.col = p.col;
      cb();
    });
  }
  var saveT;
  function savePrefs() {
    clearTimeout(saveT);
    saveT = setTimeout(function() {
      sb.from('user_settings').upsert({ id: cUser.id, journal_prefs: JX.prefs, updated_at: new Date().toISOString() }).then(function(r) {
        if (r.error) tst('No se pudo guardar tu configuración del journal.', 1);
      });
    }, 500);
  }
  function applyCol() {
    var root = document.getElementById('jx'); if (!root) return;
    var c = JX.prefs.col;
    ['win', 'loss', 'curve'].forEach(function(k) { if (c.page) root.style.removeProperty('--jx-' + k); else root.style.setProperty('--jx-' + k, c[k]); });
  }
  function applyPanels() {
    JX.prefs.order.forEach(function(id, i) {
      var s = document.querySelector('#jx [data-pn="' + id + '"]');
      if (s) { s.style.order = i; s.hidden = JX.prefs.hide.indexOf(id) >= 0; }
    });
    if (JX.prefs.hide.indexOf('curva') < 0) drawCurve();
  }

  /* ── Entrada: Herramientas › Journal ── */
  window.rJournalDash = function() {
    css();
    var m = document.getElementById('amain');
    m.innerHTML = '<div class="mk-card" style="color:var(--c-muted)">Cargando tu journal…</div>';
    sb.from('journal_accounts').select(ACC_COLS).order('created_at').then(function(r) {
      if (r.error) { m.innerHTML = '<div class="mk-card" style="color:var(--c-muted)">No se pudo cargar tu journal. Recarga la página.</div>'; return; }
      JX.acc = r.data || [];
      if (!JX.acc.length) return rJournal();
      var saved = null; try { saved = localStorage.getItem('mk-jn-acc'); } catch (e) {}
      JX.cur = JX.acc.find(function(a) { return a.id === saved; }) || JX.acc[0];
      loadPrefs(function() { shell(); loadAccount(); });
    });
  };

  function shell() {
    var m = document.getElementById('amain'), a = JX.cur;
    var ago = '';
    if (a.last_sync_at) {
      var mn = Math.round((Date.now() - new Date(a.last_sync_at)) / 60000);
      ago = ' · Actualizado ' + (mn < 1 ? 'hace un momento' : mn < 60 ? 'hace ' + mn + ' min' : mn < 1440 ? 'hace ' + Math.round(mn / 60) + ' h' : 'el ' + new Date(a.last_sync_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }));
    }
    m.innerHTML = '<div class="jx" id="jx">' +
      '<div><button class="jn-back" id="jx-back">‹ Herramientas</button>' +
      '<div class="jx-head"><div><div class="atit">Journal</div><div class="asub">Toca un día del calendario para ver sus operaciones y subir tus capturas' + ago + '</div></div>' +
      '<div class="jx-acts"><button class="jx-gear" id="jx-gear" aria-haspopup="dialog" aria-label="Personalizar journal">' + GEAR + '</button>' +
      '<div class="jx-accsel"><button class="jx-accbtn" id="jx-accbtn" aria-haspopup="true" aria-expanded="false"><span class="jx-live ' + esc(a.status) + '"></span><span><b>' + esc(a.nickname) + '</b><small>' + esc(accMeta(a)) + '</small></span>' + CHEV + '</button>' +
      '<div class="jx-menu" id="jx-menu" hidden></div></div></div></div></div>' +
      '<div class="jx-body" id="jx-body"><div class="jx-card jx-empty">Cargando operaciones…</div></div></div>';
    applyCol();
    document.getElementById('jx-back').onclick = function() { rTools(); };
    document.getElementById('jx-gear').onclick = function(e) { e.stopPropagation(); closeMenu(); openGear(); };
    var btn = document.getElementById('jx-accbtn'), menu = document.getElementById('jx-menu');
    btn.onclick = function(e) { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', !menu.hidden); if (!menu.hidden) renderMenu(); };
    menu.onclick = function(e) { e.stopPropagation(); };
  }
  function closeMenu() {
    var menu = document.getElementById('jx-menu'), btn = document.getElementById('jx-accbtn');
    if (menu) menu.hidden = true; if (btn) btn.setAttribute('aria-expanded', 'false');
  }
  document.addEventListener('click', closeMenu);
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeMenu(); });

  function renderMenu() {
    var menu = document.getElementById('jx-menu');
    menu.innerHTML = '<div class="jx-amh">Tus cuentas conectadas</div>' + JX.acc.map(function(a) {
      return '<div class="jx-ai' + (a.id === JX.cur.id ? ' on' : '') + '" data-id="' + esc(a.id) + '"><span class="jx-live ' + esc(a.status) + '"></span><div><b>' + esc(a.nickname) + '</b><small>' + esc(accMeta(a)) + '</small></div><button class="ren" data-ren>Renombrar</button></div>';
    }).join('') + (JX.acc.length < 5 ? '<button class="jx-madd" id="jx-add">+ Conectar otra cuenta</button>' : '') +
      '<button class="jx-mman" id="jx-man">Administrar cuentas</button>';
    var add = document.getElementById('jx-add'); if (add) add.onclick = function() { closeMenu(); _jnForm(); };
    document.getElementById('jx-man').onclick = function() { rJournal(); };
    menu.querySelectorAll('.jx-ai').forEach(function(row) {
      var a = JX.acc.find(function(x) { return x.id === row.dataset.id; });
      row.onclick = function(e) {
        if (e.target.closest('[data-ren]') || e.target.tagName === 'INPUT') return;
        JX.cur = a; try { localStorage.setItem('mk-jn-acc', a.id); } catch (er) {}
        JX.month = null; JX.hist = 25; shell(); loadAccount();
      };
      row.querySelector('[data-ren]').onclick = function() {
        var b = row.querySelector('b'), inp = document.createElement('input');
        inp.value = a.nickname; inp.maxLength = 28; inp.setAttribute('aria-label', 'Nombre de la cuenta'); b.replaceWith(inp); inp.focus(); inp.select();
        var done = function(save) {
          var v = inp.value.trim(); inp.onblur = null;
          if (!save || !v || v === a.nickname) return renderMenu();
          sb.from('journal_accounts').update({ nickname: v }).eq('id', a.id).then(function(u) {
            if (u.error) { tst('No se pudo cambiar el nombre.', 1); return renderMenu(); }
            a.nickname = v; var keep = !document.getElementById('jx-menu').hidden;
            if (a.id === JX.cur.id) { var bb = document.querySelector('#jx-accbtn b'); if (bb) bb.textContent = v; }
            if (keep) renderMenu();
          });
        };
        inp.onkeydown = function(e) { if (e.key === 'Enter') done(true); if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
        inp.onblur = function() { done(true); };
      };
    });
  }

  /* ── Datos de la cuenta elegida ── */
  function loadAccount() {
    var a = JX.cur, body = document.getElementById('jx-body');
    Promise.all([
      sb.from('journal_trades').select(TR_COLS).eq('account_id', a.id).order('close_time', { ascending: false }).limit(3000),
      sb.from('journal_snapshots').select('day, balance, equity').eq('account_id', a.id).order('day'),
      sb.from('journal_days').select('day, no_trade, note')
    ]).then(function(r) {
      if (JX.cur !== a || !document.getElementById('jx-body')) return;
      if (r[0].error || r[1].error) { body.innerHTML = '<div class="jx-card jx-empty">No se pudieron cargar las operaciones. Recarga la página.</div>'; return; }
      JX.trades = (r[0].data || []).filter(function(t) { return t.close_time; });
      JX.trades.forEach(function(t) { t._n = net(t); t._c = new Date(t.close_time); t._o = new Date(t.open_time); t._k = dk(t._c); });
      JX.snaps = (r[1].data || []).map(function(s) { return { d: new Date(s.day + 'T12:00:00'), b: +s.balance, e: +s.equity }; });
      JX.days = {}; (r[2].data || []).forEach(function(d) { if (d.no_trade) JX.days[d.day] = d; });
      if (!JX.trades.length && !JX.snaps.length) return waiting();
      render();
    });
  }
  function waiting() {
    var a = JX.cur, body = document.getElementById('jx-body');
    var h, p, btn = '';
    if (a.status === 'error') {
      h = 'No pudimos leer esta cuenta'; p = esc(a.last_error || 'Revisa el servidor, el número de cuenta y la contraseña de inversor.');
      btn = '<button class="mk-btn" id="jx-fix">Cambiar contraseña</button>';
    } else if (a.status === 'paused') {
      h = 'Esta cuenta está en pausa'; p = 'No estamos leyendo sus operaciones por ahora.';
    } else if (a.status === 'ok') {
      h = 'Todavía no hay operaciones'; p = 'La cuenta está conectada. Cuando cierres tu primera operación aparecerá aquí sola, con tu calendario, tu curva y tus estadísticas.';
    } else {
      h = 'Estamos conectando tu cuenta'; p = 'Revisamos las cuentas cada hora. Cuando terminemos la primera lectura vas a ver aquí tus operaciones, tu curva y tus estadísticas.';
    }
    body.innerHTML = '<div class="jx-card jx-wait"><h3>' + h + '</h3><p>' + p + '</p>' + btn + '</div>';
    var f = document.getElementById('jx-fix'); if (f) f.onclick = function() { _jnForm(a); };
  }

  /* ── Panel completo ── */
  function render() {
    var body = document.getElementById('jx-body'), T = JX.trades;
    var today = new Date();
    if (!JX.month) { var last = T.length ? T[0]._c : today; JX.month = new Date(last.getFullYear(), last.getMonth(), 1); }
    body.innerHTML =
      '<section data-pn="top" class="jx-top" id="jx-top"></section>' +
      '<section data-pn="curva" class="jx-card"><div class="jx-ch"><h2>Curva de la cuenta</h2><div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">' +
        '<div class="jx-legend"><span><i style="background:var(--jx-curve)"></i>Balance</span><span><i style="background:var(--jx-eq)"></i>Equidad</span></div>' +
        '<div class="jx-seg" id="jx-rng"><button data-r="1m">1M</button><button data-r="3m">3M</button><button data-r="all">Todo</button></div></div></div>' +
        '<div class="jx-curve" id="jx-cbox"><svg id="jx-curve" aria-label="Curva de balance y equidad"></svg><div class="jx-tip" id="jx-tip"></div></div></section>' +
      '<section data-pn="kpis" class="jx-kpis" id="jx-kpis"></section>' +
      '<section data-pn="cal" class="jx-card" id="jx-calc"></section>' +
      '<section data-pn="analisis" class="jx-g3" id="jx-gauges"></section>' +
      '<section data-pn="graficas" class="jx-two"><div class="jx-card"><div class="jx-ch"><h2>Resultado por instrumento</h2><span class="jx-lbl">Ganado y perdido</span></div><div class="jx-chart"><svg id="jx-inst" viewBox="0 0 520 240"></svg></div></div>' +
        '<div class="jx-card"><div class="jx-ch"><h2>Resultado según duración</h2><span class="jx-lbl">Cada punto es una operación</span></div><div class="jx-chart"><svg id="jx-scat" viewBox="0 0 520 240"></svg></div></div></section>' +
      '<section data-pn="hist" class="jx-card" id="jx-hist"></section>';
    renderTop(); renderKpis(); renderCal(); renderGauges(); renderInst(); renderScatter(); renderHist();
    var rng = document.getElementById('jx-rng');
    var setR = function(r) { JX.range = r; rng.querySelectorAll('button').forEach(function(b) { b.classList.toggle('on', b.dataset.r === r); }); drawCurve(); };
    rng.onclick = function(e) { var b = e.target.closest('[data-r]'); if (b) setR(b.dataset.r); };
    rng.querySelectorAll('button').forEach(function(b) { b.classList.toggle('on', b.dataset.r === JX.range); });
    applyPanels();
  }

  function stats(T) {
    var w = T.filter(function(t) { return t._n > 0; }), l = T.filter(function(t) { return t._n < 0; });
    var sw = w.reduce(function(s, t) { return s + t._n; }, 0), sl = l.reduce(function(s, t) { return s + t._n; }, 0);
    return { n: T.length, w: w.length, l: l.length, sw: sw, sl: sl, net: sw + sl, wr: T.length ? w.length / T.length * 100 : 0,
      aw: w.length ? sw / w.length : 0, al: l.length ? sl / l.length : 0, pf: sl ? sw / -sl : (sw ? Infinity : 0) };
  }

  function renderTop() {
    var a = JX.cur, T = JX.trades, S = JX.snaps;
    var bal = a.balance != null ? +a.balance : (S.length ? S[S.length - 1].b : 0);
    var eq = a.equity != null ? +a.equity : (S.length ? S[S.length - 1].e : bal);
    var bs = S.map(function(s) { return s.b; }).concat([bal]), es = S.map(function(s) { return s.e; }).concat([eq]);
    var maxB = Math.max.apply(null, bs), minB = Math.min.apply(null, bs), maxE = Math.max.apply(null, es), minE = Math.min.apply(null, es);
    var pos = function(v, lo, hi) { return hi > lo ? Math.round((v - lo) / (hi - lo) * 100) : 100; };
    var tk = dk(new Date()), tod = T.filter(function(t) { return t._k === tk; });
    var tn = tod.reduce(function(s, t) { return s + t._n; }, 0);
    var syms = tod.map(function(t) { return t.symbol; }).filter(function(x, i, arr) { return arr.indexOf(x) === i; }).slice(0, 2).join(', ');
    var d = discipline(T);
    document.getElementById('jx-top').innerHTML =
      '<div class="jx-card jx-st"><div class="jx-lbl">Balance</div><div class="v num">' + money(bal) + '</div><div class="jx-bar"><i style="width:' + pos(bal, minB, maxB) + '%"></i></div><div class="sub num">Máximo ' + money(maxB) + '</div></div>' +
      '<div class="jx-card jx-st"><div class="jx-lbl">Equidad</div><div class="v num">' + money(eq) + '</div><div class="jx-bar"><i style="width:' + pos(eq, minE, maxE) + '%"></i></div><div class="sub num">Máximo ' + money(maxE) + '</div></div>' +
      '<div class="jx-card jx-st"><div class="jx-lbl">Resultado de hoy</div><div class="v num ' + (tod.length ? cls(tn) : '') + '">' + (tod.length ? money(tn) : '$0.00') + '</div><div class="sub">' + (tod.length ? tod.length + (tod.length === 1 ? ' operación' : ' operaciones') + ' · ' + esc(syms) : 'Sin operaciones hoy') + '</div></div>' +
      '<div class="jx-card jx-st"><div class="jx-lbl">Puntaje de disciplina</div><div class="v num">' + (d == null ? '—' : d + '<span class="m" style="font-size:14px;font-weight:600"> / 100</span>') + '</div><div class="jx-bar"><i style="width:' + (d || 0) + '%"></i></div><div class="sub">' + (d == null ? 'Se calcula desde 5 operaciones' : 'Stop loss, riesgo/beneficio, consistencia y acierto') + '</div></div>';
  }
  // 0-100: uso de stop loss (30), riesgo/beneficio (25), consistencia de los días (25), acierto (20). Últimas 100 operaciones.
  function discipline(all) {
    var T = all.slice(0, 100); if (T.length < 5) return null;
    var s = stats(T);
    var sl = T.filter(function(t) { return +t.sl > 0; }).length / T.length;
    var rr = s.al ? Math.min(1, (s.aw / -s.al) / 1.5) : (s.aw > 0 ? 1 : 0);
    var byDay = {}; T.forEach(function(t) { byDay[t._k] = (byDay[t._k] || 0) + t._n; });
    var pos = Object.keys(byDay).map(function(k) { return byDay[k]; }).filter(function(v) { return v > 0; });
    var tp = pos.reduce(function(a, b) { return a + b; }, 0), best = pos.length ? Math.max.apply(null, pos) : 0;
    var cons = tp > 0 ? Math.max(0, Math.min(1, 1 - (best / tp - 0.3) / 0.7)) : 0;
    var wr = Math.min(1, s.wr / 50);
    return Math.round(sl * 30 + rr * 25 + cons * 25 + wr * 20);
  }

  function renderKpis() {
    var s = stats(JX.trades), T = JX.trades;
    var lots = T.reduce(function(a, t) { return a + (+t.volume || 0); }, 0);
    var best = T.length ? Math.max.apply(null, T.map(function(t) { return t._n; })) : 0, worst = T.length ? Math.min.apply(null, T.map(function(t) { return t._n; })) : 0;
    var k = function(l, v, c) { return '<div class="jx-card jx-kp"><div class="jx-lbl">' + l + '</div><div class="v num ' + (c || '') + '">' + v + '</div></div>'; };
    document.getElementById('jx-kpis').innerHTML =
      k('Ganancia media', money(s.aw), 'g') + k('Pérdida media', money(s.al), s.al ? 'l' : '') + k('Acierto', s.wr.toFixed(1) + '%') + k('Profit factor', s.pf === Infinity ? '∞' : s.pf.toFixed(2)) +
      k('Operaciones', s.n) + k('Lotes operados', lots.toFixed(2)) + k('Mejor operación', money(best), best > 0 ? 'g' : '') + k('Peor operación', money(worst), worst < 0 ? 'l' : '');
  }

  /* ── Curva de balance y equidad ── */
  var ro;
  function drawCurve() {
    var s = document.getElementById('jx-curve'); if (!s || !s.clientWidth) return;
    var S = JX.snaps.slice();
    if (JX.range !== 'all' && S.length) {
      var from = new Date(); from.setMonth(from.getMonth() - (JX.range === '1m' ? 1 : 3));
      S = S.filter(function(p) { return p.d >= from; });
    }
    var tip = document.getElementById('jx-tip'), box = document.getElementById('jx-cbox');
    if (S.length < 2) { s.innerHTML = txt('50%', '50%', 'Todavía hay pocos días para dibujar la curva', 'text-anchor="middle" font-size="12" style="fill:var(--c-muted)"'); s.removeAttribute('viewBox'); s.onpointermove = null; return; }
    var W = s.clientWidth, H = s.clientHeight, L = 58, R = 82, T = 16, B = 30, n = S.length;
    var lo = Math.min.apply(null, S.map(function(p) { return Math.min(p.b, p.e); })), hi = Math.max.apply(null, S.map(function(p) { return Math.max(p.b, p.e); }));
    var padv = (hi - lo) * 0.12 || hi * 0.01 || 1; lo -= padv; hi += padv;
    var x = function(i) { return L + (W - L - R) * i / (n - 1); }, y = function(v) { return T + (H - T - B) * (1 - (v - lo) / (hi - lo)); };
    var out = '<defs><linearGradient id="jx-ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--jx-curve);stop-opacity:.24"/><stop offset="1" style="stop-color:var(--jx-curve);stop-opacity:0"/></linearGradient></defs>';
    ticks(lo, hi, 5).forEach(function(v) { out += gridLn(L, W - R, y(v)) + txt(L - 12, y(v) + 4, kfmt(v), 'text-anchor="end" ' + dimTxt); });
    var every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - L - R) / 70))));
    S.forEach(function(p, i) { if (i % every === 0 && i > 0 && i < n - 1) out += txt(x(i), H - 9, p.d.getDate() + ' ' + MES[p.d.getMonth()], 'text-anchor="middle" ' + dimTxt); });
    var PB = S.map(function(p, i) { return [x(i), y(p.b)]; }), PE = S.map(function(p, i) { return [x(i), y(p.e)]; }), pb = smooth(PB);
    out += '<path d="' + pb + ' L' + x(n - 1) + ',' + (H - B) + ' L' + x(0) + ',' + (H - B) + ' Z" fill="url(#jx-ga)"/>';
    out += '<path d="' + smooth(PE) + '" fill="none" style="stroke:var(--jx-eq)" stroke-width="1.5" stroke-opacity=".8"/>';
    out += '<path d="' + pb + '" fill="none" style="stroke:var(--jx-curve)" stroke-width="2.2" stroke-linejoin="round"/>';
    if (n <= 90) PB.forEach(function(p) { out += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="2.2" style="fill:var(--jx-curve)" fill-opacity=".55"/>'; });
    var badge = function(v, bg, fg, dy) {
      var yy = y(v) + dy;
      return '<rect x="' + (W - R + 8) + '" y="' + (yy - 11) + '" width="' + (R - 10) + '" height="22" rx="6" style="fill:' + bg + '"/>' + txt(W - R + 8 + (R - 10) / 2, yy + 4, kfmt(v), 'text-anchor="middle" font-size="10.5" font-weight="700" style="fill:' + fg + '"');
    };
    var lb = S[n - 1].b, le = S[n - 1].e, gap = Math.abs(y(lb) - y(le)) < 24;
    out += badge(lb, 'var(--jx-curve)', 'var(--c-ongold)', gap ? (y(lb) <= y(le) ? -12 : 12) : 0);
    out += badge(le, 'rgba(var(--c-ov),.12)', 'var(--c-text)', gap ? (y(lb) <= y(le) ? 12 : -12) : 0);
    out += '<line id="jx-vl" y1="' + T + '" y2="' + (H - B) + '" style="stroke:rgba(var(--c-ov),.18)" stroke-dasharray="3 4" opacity="0"/>';
    out += '<circle id="jx-db" r="5" style="fill:var(--jx-curve);stroke:var(--c-card)" stroke-width="2.5" opacity="0"/><circle id="jx-de" r="4.5" style="fill:var(--jx-eq);stroke:var(--c-card)" stroke-width="2.5" opacity="0"/>';
    s.setAttribute('viewBox', '0 0 ' + W + ' ' + H); s.innerHTML = out;
    var vl = s.querySelector('#jx-vl'), db = s.querySelector('#jx-db'), de = s.querySelector('#jx-de');
    var show = function(i) {
      var p = S[i]; [vl, db, de].forEach(function(e) { e.setAttribute('opacity', 1); });
      vl.setAttribute('x1', x(i)); vl.setAttribute('x2', x(i)); db.setAttribute('cx', x(i)); db.setAttribute('cy', y(p.b)); de.setAttribute('cx', x(i)); de.setAttribute('cy', y(p.e));
      tip.innerHTML = '<h4>' + p.d.getDate() + ' de ' + MESL[p.d.getMonth()] + ', ' + p.d.getFullYear() + '</h4><div><span><i style="background:var(--jx-curve)"></i>Balance</span><b class="num">' + money(p.b) + '</b></div><div><span><i style="background:var(--jx-eq)"></i>Equidad</span><b class="num">' + money(p.e) + '</b></div>';
      tip.classList.add('on');
      var sc = s.getBoundingClientRect().width / W, bw = box.clientWidth, tw = tip.offsetWidth, xx = x(i) * sc + 6, left = xx + 24;
      if (left + tw > bw - 8) left = xx - tw - 12;
      tip.style.left = Math.max(4, left) + 'px'; tip.style.top = Math.max(8, Math.min(y(p.b) * sc - 40, H * sc - 110)) + 'px';
    };
    var hide = function() { [vl, db, de].forEach(function(e) { e.setAttribute('opacity', 0); }); tip.classList.remove('on'); };
    s.onpointermove = function(e) { var r = s.getBoundingClientRect(), p = (e.clientX - r.left) * W / r.width, i = Math.round((p - L) / (W - L - R) * (n - 1)); if (i < 0 || i >= n) return hide(); show(i); };
    s.onpointerleave = hide;
    if (!ro && window.ResizeObserver) { var rt; ro = new ResizeObserver(function() { clearTimeout(rt); rt = setTimeout(drawCurve, 120); }); }
    if (ro) { ro.disconnect(); ro.observe(box); }
  }

  /* ── Calendario del mes ── */
  function renderCal() {
    var M = JX.month, y0 = M.getFullYear(), m0 = M.getMonth(), nd = new Date(y0, m0 + 1, 0).getDate();
    var off = (new Date(y0, m0, 1).getDay() + 6) % 7, tk = dk(new Date());
    var by = {}; JX.trades.forEach(function(t) { if (t._c.getFullYear() === y0 && t._c.getMonth() === m0) (by[t._k] = by[t._k] || []).push(t); });
    var tot = 0, nDays = 0, cells = '', i;
    for (i = 0; i < off; i++) cells += '<div class="jx-day x"></div>';
    var weeks = [], wk = null;
    for (var dd = 1; dd <= nd; dd++) {
      var date = new Date(y0, m0, dd), k = dk(date), T = by[k], no = JX.days[k], fut = k > tk;
      var sum = T ? T.reduce(function(s, t) { return s + t._n; }, 0) : 0;
      if (T) { tot += sum; nDays++; }
      if (!wk || (off + dd - 1) % 7 === 0) { wk = { from: dd, to: dd, sum: 0, days: 0 }; weeks.push(wk); }
      wk.to = dd; if (T) { wk.sum += sum; wk.days++; }
      var c = 'jx-day' + (T ? (sum >= 0 ? ' w t' : ' lo t') : no ? ' no t' : '') + (k === tk ? ' today' : '') + (fut ? ' fut' : '');
      var inner = '<span class="d num">' + dd + '</span>';
      if (T) inner += '<div><div class="tc num">' + T.length + ' op.</div><div class="pn num ' + cls(sum) + '">' + short(sum) + '</div></div>';
      else if (no) inner += '<div class="pn">No operé</div>';
      if (T && T.some(function(t) { return t.screenshot_path; })) inner += CAM.replace('<svg', '<svg class="cam"');
      var lbl = dd + ' de ' + MESL[m0] + (T ? ', ' + T.length + (T.length === 1 ? ' operación' : ' operaciones') : '');
      cells += fut ? '<div class="' + c + '">' + inner + '</div>' : '<button type="button" class="' + c + '" data-k="' + k + '" aria-label="' + lbl + '">' + inner + '</button>';
    }
    var wks = weeks.map(function(w, j) {
      return '<div class="jx-wk"><div class="r"><b>Semana ' + (j + 1) + '</b><span class="jx-lbl">' + w.from + (w.to !== w.from ? ' – ' + w.to : '') + ' ' + MES[m0] + '</span></div><div class="r">' +
        (w.days ? '<span class="num ' + cls(w.sum) + '" style="font-weight:700;font-size:14px">' + money(w.sum) + '</span>' : '<span class="m">Sin operaciones</span>') +
        '<span class="jx-lbl num">' + w.days + (w.days === 1 ? ' día' : ' días') + '</span></div></div>';
    }).join('');
    var now = new Date(), isNow = y0 === now.getFullYear() && m0 === now.getMonth();
    var box = document.getElementById('jx-calc');
    box.innerHTML = '<div class="jx-ch"><h2>' + MESL[m0].charAt(0).toUpperCase() + MESL[m0].slice(1) + ' ' + y0 + '</h2><div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">' +
      '<div class="jx-mtot"><span>Resultado <b class="num ' + (nDays ? cls(tot) : '') + '">' + money(tot) + '</b></span><span>Días operados <b class="num" style="color:var(--c-text)">' + nDays + '</b></span></div>' +
      '<div class="jx-seg"><button data-mv="-1" aria-label="Mes anterior">‹</button><button data-mv="0"' + (isNow ? ' class="on"' : '') + '>Hoy</button><button data-mv="1" aria-label="Mes siguiente"' + (isNow ? ' disabled' : '') + '>›</button></div></div></div>' +
      '<div class="jx-calw"><div class="jx-cal"><div class="jx-dows"><div>LUN</div><div>MAR</div><div>MIÉ</div><div>JUE</div><div>VIE</div><div>SÁB</div><div>DOM</div></div><div class="jx-days">' + cells + '</div></div><div class="jx-weeks">' + wks + '</div></div>';
    box.querySelector('.jx-seg').onclick = function(e) {
      var b = e.target.closest('[data-mv]'); if (!b || b.disabled) return;
      var v = +b.dataset.mv; JX.month = v ? new Date(y0, m0 + v, 1) : new Date(now.getFullYear(), now.getMonth(), 1); renderCal();
    };
    box.querySelector('.jx-days').onclick = function(e) { var d = e.target.closest('[data-k]'); if (d) openDay(d.dataset.k, by[d.dataset.k] || []); };
  }

  /* ── Ventana del día: operaciones, capturas y notas ── */
  var urlCache = {};
  function shotUrl(path) {
    if (urlCache[path]) return Promise.resolve(urlCache[path]);
    return sb.storage.from('journal-capturas').createSignedUrl(path, 3600).then(function(r) { var u = r.data && r.data.signedUrl; if (u) urlCache[path] = u; return u; });
  }
  function openDay(k, T) {
    var last = document.activeElement, p = k.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]);
    T = T.slice().sort(function(a, b) { return a._o - b._o; });
    var tot = T.reduce(function(s, t) { return s + t._n; }, 0), no = JX.days[k];
    var ov = document.createElement('div'); ov.className = 'jx-ov';
    var title = d.getDate() + ' de ' + MESL[d.getMonth()] + ' de ' + d.getFullYear();
    var list = T.length ? T.map(function(t, i) {
      return '<div class="jx-tr' + (i === 0 ? ' open' : '') + '" data-id="' + t.id + '"><div class="jx-trh" role="button" tabindex="0" aria-expanded="' + (i === 0) + '"><span class="ic">' + CAM + '</span><div><b>' + esc(t.symbol) + ' · ' + sideLbl(t) + '</b><small>' + hm(t._o) + ' → ' + hm(t._c) + ' · ' + (+t.volume) + ' lotes<span data-has>' + (t.screenshot_path ? ' · Con captura' : '') + '</span></small></div><span class="res num ' + cls(t._n) + '">' + money(t._n) + '</span><span class="chev">' + CHEV + '</span></div>' +
        '<div class="jx-trb"' + (i === 0 ? '' : ' hidden') + '><label class="jx-drop"><span data-ph>' + CAM + '<b>Agregar captura</b>Arrastra la imagen o toca para elegirla<br>PNG o JPG, hasta 5 MB</span><input type="file" accept="image/png,image/jpeg,image/webp"></label>' +
        '<div class="jx-nt"><label for="jx-n-' + t.id + '">¿Qué viste en esta operación?</label><textarea id="jx-n-' + t.id + '" maxlength="2000" placeholder="Por qué entraste, qué salió bien o mal…">' + esc(t.note || '') + '</textarea>' +
        '<div class="jx-kv"><span>Entrada<b class="num">' + px(t.open_price) + '</b></span><span>Salida<b class="num">' + px(t.close_price) + '</b></span><span>Stop loss<b class="num">' + px(t.sl) + '</b></span><span>Duración<b>' + dur(mins(t)) + '</b></span></div></div></div></div>';
    }).join('') : '<div class="jx-nod">' + (no ? 'Marcaste este día como <b>No operé</b>.' : 'No hay operaciones cerradas este día en esta cuenta.<br>Si no operaste a propósito, márcalo para que cuente en tu racha.') + '</div>';
    ov.innerHTML = '<div class="jx-md" role="dialog" aria-modal="true" aria-labelledby="jx-mdt"><div class="jx-mh"><div><h3 id="jx-mdt">' + title + '</h3><p>' + esc(JX.cur.nickname) +
      (T.length ? ' · ' + T.length + (T.length === 1 ? ' operación' : ' operaciones') + ' · <span class="' + cls(tot) + '" style="font-weight:700">' + money(tot) + '</span>' : '') + '</p></div><button class="jx-x" data-close aria-label="Cerrar">✕</button></div>' +
      '<div class="jx-tl">' + list + '</div><div class="jx-mf">' +
      (T.length ? '<button class="jx-btn" data-close>Cerrar</button><button class="jx-btn pri" id="jx-save">Guardar notas</button>' :
        '<button class="jx-btn" data-close>Cerrar</button><button class="jx-btn pri" id="jx-nt">' + (no ? 'Quitar "No operé"' : 'Marcar "No operé"') + '</button>') + '</div></div>';
    document.body.appendChild(ov);
    var close = function() { ov.remove(); document.removeEventListener('keydown', kd); if (last) last.focus(); };
    var kd = function(e) { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', kd);
    ov.onclick = function(e) { if (e.target === ov || e.target.closest('[data-close]')) close(); };
    ov.querySelector('.jx-x').focus();
    // capturas ya guardadas
    T.forEach(function(t) { if (t.screenshot_path) paintShot(ov, t); });
    var toggle = function(h) { var tr = h.parentElement, open = !tr.classList.contains('open'); tr.classList.toggle('open', open); tr.querySelector('.jx-trb').hidden = !open; h.setAttribute('aria-expanded', open); };
    ov.querySelectorAll('.jx-trh').forEach(function(h) {
      h.onclick = function() { toggle(h); };
      h.onkeydown = function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(h); } };
    });
    ov.querySelectorAll('.jx-drop').forEach(function(dp) {
      var t = T.find(function(x) { return String(x.id) === dp.closest('.jx-tr').dataset.id; });
      dp.querySelector('input').onchange = function(e) { upload(ov, dp, t, e.target.files[0]); };
      dp.ondragover = function(e) { e.preventDefault(); dp.classList.add('over'); };
      dp.ondragleave = function() { dp.classList.remove('over'); };
      dp.ondrop = function(e) { e.preventDefault(); dp.classList.remove('over'); upload(ov, dp, t, e.dataTransfer.files[0]); };
    });
    var sv = ov.querySelector('#jx-save');
    if (sv) sv.onclick = function() {
      var ch = T.filter(function(t) { var v = ov.querySelector('#jx-n-' + t.id).value.trim(); return v !== (t.note || ''); });
      if (!ch.length) return close();
      sv.disabled = true;
      Promise.all(ch.map(function(t) {
        var v = ov.querySelector('#jx-n-' + t.id).value.trim();
        return sb.from('journal_trades').update({ note: v || null }).eq('id', t.id).then(function(r) { if (!r.error) t.note = v || null; return r.error; });
      })).then(function(errs) {
        if (errs.some(Boolean)) { sv.disabled = false; tst('No se pudieron guardar las notas.', 1); return; }
        tst('✓ Notas guardadas'); close();
      });
    };
    var nt = ov.querySelector('#jx-nt');
    if (nt) nt.onclick = function() {
      nt.disabled = true;
      var q = no ? sb.from('journal_days').delete().eq('user_id', cUser.id).eq('day', k) : sb.from('journal_days').upsert({ user_id: cUser.id, day: k, no_trade: true });
      q.then(function(r) {
        if (r.error) { nt.disabled = false; tst('No se pudo guardar el día.', 1); return; }
        if (no) delete JX.days[k]; else JX.days[k] = { day: k, no_trade: true };
        close(); renderCal();
      });
    };
  }
  function paintShot(ov, t) {
    shotUrl(t.screenshot_path).then(function(u) {
      var tr = ov.querySelector('.jx-tr[data-id="' + t.id + '"]'); if (!u || !tr) return;
      tr.querySelector('.ic').innerHTML = '<img src="' + esc(u) + '" alt="">';
      var dp = tr.querySelector('.jx-drop'), ph = dp.querySelector('[data-ph]');
      if (ph) ph.remove();
      dp.querySelectorAll('img,.chg').forEach(function(x) { x.remove(); });
      dp.insertAdjacentHTML('afterbegin', '<img src="' + esc(u) + '" alt="Captura de la operación"><span class="chg">Cambiar</span>');
    });
  }
  function upload(ov, dp, t, file) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return tst('La captura debe ser PNG, JPG o WEBP.', 1);
    if (file.size > 5 * 1024 * 1024) return tst('La captura pesa más de 5 MB.', 1);
    var ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    var path = cUser.id + '/' + JX.cur.id + '/' + t.ticket + '-' + Date.now() + '.' + ext, old = t.screenshot_path;
    dp.classList.add('busy');
    sb.storage.from('journal-capturas').upload(path, file, { contentType: file.type }).then(function(r) {
      if (r.error) throw r.error;
      return sb.from('journal_trades').update({ screenshot_path: path }).eq('id', t.id);
    }).then(function(r) {
      if (r.error) throw r.error;
      t.screenshot_path = path;
      if (old) sb.storage.from('journal-capturas').remove([old]);
      var has = ov.querySelector('.jx-tr[data-id="' + t.id + '"] [data-has]'); if (has) has.textContent = ' · Con captura';
      paintShot(ov, t); renderCal(); tst('✓ Captura guardada');
    }).catch(function() { tst('No se pudo subir la captura.', 1); }).then(function() { dp.classList.remove('busy'); });
  }

  /* ── Ventas / rentabilidad / compras ── */
  function renderGauges() {
    var T = JX.trades, all = stats(T);
    var G = [['Ventas', stats(T.filter(function(t) { return t.side === 'sell'; })), 'res'], ['Rentabilidad', all, 'ops'], ['Compras', stats(T.filter(function(t) { return t.side === 'buy'; })), 'res']];
    document.getElementById('jx-gauges').innerHTML = G.map(function(g) {
      var s = g[1], R = 86, cx = 110, cy = 114, frac = s.n ? s.w / s.n : 0;
      var arc = function(a0, a1) {
        var p = function(a) { return [cx + R * Math.cos(Math.PI * (1 - a)), cy - R * Math.sin(Math.PI * (1 - a))]; }, A = p(a0), Bp = p(a1);
        return 'M' + A[0] + ' ' + A[1] + ' A' + R + ' ' + R + ' 0 0 1 ' + Bp[0] + ' ' + Bp[1];
      };
      var svg = '<svg viewBox="0 0 220 124"><path d="' + arc(0, 1) + '" style="stroke:rgba(var(--c-ov),.05)" stroke-width="12" fill="none" stroke-linecap="round"/>';
      if (s.n) {
        if (frac > 0.02) svg += '<path d="' + arc(0, Math.max(0.001, frac - (frac < 1 ? 0.015 : 0))) + '" style="stroke:var(--jx-win)" stroke-width="12" fill="none" stroke-linecap="round"/>';
        if (frac < 0.98) svg += '<path d="' + arc(Math.min(0.999, frac + (frac > 0 ? 0.015 : 0)), 1) + '" style="stroke:var(--jx-loss)" stroke-opacity=".7" stroke-width="12" fill="none" stroke-linecap="round"/>';
      }
      var cap = g[2] === 'res' ? 'Resultado' : 'Operaciones', val = g[2] === 'res' ? money(s.net) : String(s.n);
      svg += txt(cx, cy - 32, cap, 'text-anchor="middle" font-size="11" style="fill:var(--c-text2)"') +
        txt(cx, cy - 7, val, 'text-anchor="middle" font-size="' + (val.length > 10 ? 19 : 23) + '" font-weight="700" style="fill:' + (g[2] === 'res' && s.n ? (s.net < 0 ? 'var(--jx-loss)' : 'var(--jx-win)') : 'var(--c-text)') + '"') + '</svg>';
      return '<div class="jx-card jx-gg"><h3>' + g[0] + '</h3>' + svg + '<div class="row"><div><div class="jx-lbl">Ganadas (' + s.w + ')</div><div class="v num g">' + money(s.sw) + '</div></div><div><div class="jx-lbl">Acierto</div><div class="v num">' + s.wr.toFixed(1) + '%</div></div><div><div class="jx-lbl">Perdidas (' + s.l + ')</div><div class="v num l">' + money(s.sl) + '</div></div></div></div>';
    }).join('');
  }

  /* ── Resultado por instrumento (los 5 más operados) ── */
  function renderInst() {
    var by = {};
    JX.trades.forEach(function(t) { var o = by[t.symbol] = by[t.symbol] || { n: 0, w: 0, l: 0 }; o.n++; if (t._n >= 0) o.w += t._n; else o.l += t._n; });
    var L = Object.keys(by).map(function(k) { return [k, by[k]]; }).sort(function(a, b) { return b[1].n - a[1].n; }).slice(0, 5);
    var s = document.getElementById('jx-inst'), W = 520, H = 240, Lp = 56, B = 30, T = 14;
    if (!L.length) { s.innerHTML = txt(W / 2, H / 2, 'Sin operaciones', 'text-anchor="middle" font-size="12" style="fill:var(--c-muted)"'); return; }
    var hi = Math.max.apply(null, L.map(function(x) { return x[1].w; }).concat([1])), lo = Math.min.apply(null, L.map(function(x) { return x[1].l; }).concat([-1]));
    var tk = ticks(lo, hi, 5); lo = Math.min(lo, tk[0]); hi = Math.max(hi, tk[tk.length - 1]);
    var y = function(v) { return T + (H - T - B) * (1 - (v - lo) / (hi - lo)); };
    var out = '';
    tk.forEach(function(v) { out += gridLn(Lp, W - 10, y(v)) + txt(Lp - 10, y(v) + 4, kfmt(v), 'text-anchor="end" ' + dimTxt); });
    out += '<line x1="' + Lp + '" x2="' + (W - 10) + '" y1="' + y(0) + '" y2="' + y(0) + '" style="stroke:rgba(var(--c-ov),.14)" stroke-dasharray="3 4"/>';
    var step = (W - Lp - 30) / L.length, bw = Math.min(40, step * 0.4);
    L.forEach(function(x, i) {
      var cx = Lp + step * (i + 0.5), o = x[1], nt = o.w + o.l;
      if (o.w > 0) out += '<rect x="' + (cx - bw / 2) + '" y="' + y(o.w) + '" width="' + bw + '" height="' + Math.max(1, y(0) - y(o.w) - 1) + '" rx="6" style="fill:var(--jx-win)"/>';
      if (o.l < 0) out += '<rect x="' + (cx - bw / 2) + '" y="' + (y(0) + 1) + '" width="' + bw + '" height="' + Math.max(1, y(o.l) - y(0) - 1) + '" rx="6" style="fill:var(--jx-loss)" fill-opacity=".7"/>';
      out += '<circle cx="' + cx + '" cy="' + y(nt) + '" r="4.5" style="fill:var(--c-text);stroke:var(--c-card)" stroke-width="2"/>';
      out += txt(cx, H - 9, esc(x[0].slice(0, 10)), 'text-anchor="middle" font-size="11" font-weight="600" style="fill:var(--c-text2)"');
      out += txt(cx + bw / 2 + 6, y(nt) + 4, short(nt), 'font-size="10.5" font-weight="700" style="fill:' + (nt < 0 ? 'var(--jx-loss)' : 'var(--jx-win)') + '"');
    });
    s.innerHTML = out;
  }

  /* ── Resultado según duración ── */
  function renderScatter() {
    var s = document.getElementById('jx-scat'), W = 520, H = 240, L = 56, B = 30, T = 14, R = 12;
    var P = JX.trades.slice(0, 400).map(function(t) { return [mins(t), t._n]; });
    if (!P.length) { s.innerHTML = txt(W / 2, H / 2, 'Sin operaciones', 'text-anchor="middle" font-size="12" style="fill:var(--c-muted)"'); return; }
    var ds = P.map(function(p) { return p[0]; }).sort(function(a, b) { return a - b; }), cap = ds[Math.floor(ds.length * 0.95)] || ds[ds.length - 1];
    var units = [[60, 15], [120, 30], [240, 60], [480, 120], [1440, 360], [2880, 720], [10080, 1440], [43200, 10080]];
    var u = units.find(function(x) { return x[0] >= cap; }) || units[units.length - 1], tmax = u[0];
    var lo = Math.min.apply(null, P.map(function(p) { return p[1]; }).concat([0])), hi = Math.max.apply(null, P.map(function(p) { return p[1]; }).concat([0]));
    var tk = ticks(lo, hi, 4); lo = Math.min(lo, tk[0]); hi = Math.max(hi, tk[tk.length - 1]); if (hi === lo) hi = lo + 1;
    var x = function(m) { return L + (W - L - R) * Math.min(m, tmax) / tmax; }, y = function(v) { return T + (H - T - B) * (1 - (v - lo) / (hi - lo)); };
    var out = '';
    tk.forEach(function(v) { out += gridLn(L, W - R, y(v)) + txt(L - 10, y(v) + 4, kfmt(v), 'text-anchor="end" ' + dimTxt); });
    out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(0) + '" y2="' + y(0) + '" style="stroke:rgba(var(--c-ov),.14)" stroke-dasharray="3 4"/>';
    for (var m = 0; m <= tmax; m += u[1]) out += txt(x(m), H - 9, m === 0 ? '0' : m >= 1440 ? (m / 1440) + ' d' : m >= 60 ? (m / 60) + ' h' : m + ' min', 'text-anchor="middle" ' + dimTxt);
    P.forEach(function(p) { out += '<circle cx="' + x(p[0]) + '" cy="' + y(p[1]) + '" r="4.2" style="fill:' + (p[1] >= 0 ? 'var(--jx-win)' : 'var(--jx-loss)') + ';stroke:var(--c-card)" fill-opacity="' + (p[1] >= 0 ? .95 : .7) + '" stroke-width="1.2"/>'; });
    s.innerHTML = out;
  }

  /* ── Historial ── */
  function renderHist() {
    var T = JX.trades, n = Math.min(JX.hist, T.length);
    var rows = T.slice(0, n).map(function(t) {
      return '<tr><td class="sym">' + esc(t.symbol) + '</td><td>' + sideLbl(t) + '</td><td class="num m">' + dt(t._o) + '</td><td class="r num">' + px(t.open_price) + '</td><td class="num m">' + dt(t._c) + '</td><td class="r num">' + px(t.close_price) + '</td>' +
        '<td class="r num m">' + px(t.tp) + '</td><td class="r num m">' + px(t.sl) + '</td><td class="r num">' + (+t.volume) + '</td><td class="r num m">' + money(+t.commission || 0) + '</td><td class="r num ' + cls(t._n) + '" style="font-weight:700">' + money(t._n) + '</td></tr>';
    }).join('');
    var box = document.getElementById('jx-hist');
    box.innerHTML = '<div class="jx-ch"><h2>Historial de operaciones</h2><span class="jx-lbl">' + T.length + (T.length === 1 ? ' operación cerrada' : ' operaciones cerradas') + '</span></div>' +
      '<div class="jx-tbl"><table><thead><tr><th>Símbolo</th><th>Tipo</th><th>Apertura</th><th class="r">Precio</th><th>Cierre</th><th class="r">Precio</th><th class="r">TP</th><th class="r">SL</th><th class="r">Lotes</th><th class="r">Comisión</th><th class="r">Resultado</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      (n < T.length ? '<div class="jx-more"><button class="jx-btn" id="jx-more">Ver más</button></div>' : '');
    var mb = document.getElementById('jx-more'); if (mb) mb.onclick = function() { JX.hist += 50; renderHist(); };
  }

  /* ── Personalizar: paneles y colores ── */
  function openGear() {
    var last = document.activeElement;
    var dv = document.createElement('div'); dv.className = 'jx-dov';
    dv.innerHTML = '<aside class="jx-drw" role="dialog" aria-modal="true" aria-labelledby="jx-drt"><div class="jx-mh"><div><h3 id="jx-drt">Personalizar journal</h3><p>Elige qué ver, en qué orden y con qué colores.</p></div><button class="jx-x" data-close aria-label="Cerrar">✕</button></div>' +
      '<div class="jx-drb"><div class="jx-amh">Paneles</div><p class="jx-hint">Arrastra para cambiar el orden. Los paneles fijos no se pueden ocultar.</p><div class="jx-pl" id="jx-pnl"></div>' +
      '<div class="jx-amh" style="margin-top:18px">Colores</div><div id="jx-pre"></div><div class="jx-cust"><label><span>Ganancias</span><input type="color" data-c="win"></label><label><span>Pérdidas</span><input type="color" data-c="loss"></label><label><span>Curva</span><input type="color" data-c="curve"></label></div></div>' +
      '<div class="jx-mf"><button class="jx-btn" id="jx-reset">Restablecer todo</button><button class="jx-btn pri" data-close>Listo</button></div></aside>';
    document.body.appendChild(dv);
    var close = function() { dv.remove(); document.removeEventListener('keydown', kd); if (last) last.focus(); };
    var kd = function(e) { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', kd);
    dv.onclick = function(e) { if (e.target === dv || e.target.closest('[data-close]')) close(); };
    var P = JX.prefs, pnl = dv.querySelector('#jx-pnl'), by = {}, dragId = null;
    PN.forEach(function(x) { by[x[0]] = x; });
    var hexOf = function(v) {
      var c = document.createElement('canvas').getContext('2d'); c.fillStyle = '#000'; c.fillStyle = v; return c.fillStyle.charAt(0) === '#' ? c.fillStyle : '#c9a84c';
    };
    var cur = function(k) { var root = document.getElementById('jx'); return hexOf(getComputedStyle(root).getPropertyValue('--jx-' + k).trim()); };
    function panels() {
      pnl.innerHTML = P.order.map(function(id, i) {
        var x = by[id], off = P.hide.indexOf(id) >= 0;
        return '<div class="jx-pi' + (off ? ' off' : '') + '" draggable="true" data-id="' + id + '"><span class="hd">' + GRIP + '</span><span class="nm">' + x[1] + '<small>' + x[2] + '</small></span>' +
          '<button class="mv" data-mv="-1" aria-label="Subir ' + x[1] + '"' + (i === 0 ? ' disabled' : '') + '>▲</button><button class="mv" data-mv="1" aria-label="Bajar ' + x[1] + '"' + (i === P.order.length - 1 ? ' disabled' : '') + '>▼</button>' +
          (x[3] ? '<span class="jx-fx">' + LOCK + 'Fijo</span>' : '<input type="checkbox" class="jx-swt" aria-label="Mostrar ' + x[1] + '"' + (off ? '' : ' checked') + '>') + '</div>';
      }).join('');
    }
    function colors() {
      var c = P.col;
      dv.querySelector('#jx-pre').innerHTML = PRE.map(function(p, i) {
        var pc = p[2], on = pc.page ? !!c.page : (!c.page && pc.win === c.win && pc.loss === c.loss && pc.curve === c.curve);
        return '<button class="jx-pr' + (on ? ' on' : '') + '" data-p="' + i + '"><span class="jx-sw"><i style="background:' + (pc.page ? 'rgb(var(--c-acc))' : pc.win) + '"></i><i style="background:' + (pc.page ? '#c96f68' : pc.loss) + '"></i></span><span>' + p[0] + '<small>' + p[1] + '</small></span>' + (on ? '<span class="ok">✓</span>' : '') + '</button>';
      }).join('');
      dv.querySelectorAll('[data-c]').forEach(function(inp) { inp.value = cur(inp.dataset.c); });
    }
    var changed = function() { panels(); applyPanels(); savePrefs(); };
    panels(); colors();
    pnl.addEventListener('dragstart', function(e) { var it = e.target.closest('.jx-pi'); dragId = it.dataset.id; it.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; });
    pnl.addEventListener('dragend', function(e) { var it = e.target.closest('.jx-pi'); if (it) it.classList.remove('drag'); pnl.querySelectorAll('.over').forEach(function(x) { x.classList.remove('over'); }); });
    pnl.addEventListener('dragover', function(e) { var it = e.target.closest('.jx-pi'); if (!it || it.dataset.id === dragId) return; e.preventDefault(); pnl.querySelectorAll('.over').forEach(function(x) { x.classList.remove('over'); }); it.classList.add('over'); });
    pnl.addEventListener('drop', function(e) {
      var it = e.target.closest('.jx-pi'); if (!it || !dragId) return; e.preventDefault();
      var after = P.order.indexOf(dragId) < P.order.indexOf(it.dataset.id), o = P.order.filter(function(x) { return x !== dragId; });
      o.splice(o.indexOf(it.dataset.id) + (after ? 1 : 0), 0, dragId); P.order = o; dragId = null; changed();
    });
    pnl.addEventListener('click', function(e) {
      var mv = e.target.closest('[data-mv]'); if (!mv) return;
      var id = mv.closest('.jx-pi').dataset.id, i = P.order.indexOf(id), j = i + (+mv.dataset.mv); if (j < 0 || j >= P.order.length) return;
      var t = P.order[i]; P.order[i] = P.order[j]; P.order[j] = t; changed();
      var f = pnl.querySelector('[data-id="' + id + '"] [data-mv="' + mv.dataset.mv + '"]'); if (f && !f.disabled) f.focus();
    });
    pnl.addEventListener('change', function(e) {
      if (!e.target.classList.contains('jx-swt')) return;
      var id = e.target.closest('.jx-pi').dataset.id;
      P.hide = e.target.checked ? P.hide.filter(function(x) { return x !== id; }) : P.hide.concat([id]); changed();
    });
    dv.querySelector('#jx-pre').onclick = function(e) { var b = e.target.closest('[data-p]'); if (!b) return; P.col = Object.assign({}, PRE[+b.dataset.p][2]); applyCol(); colors(); savePrefs(); };
    dv.querySelectorAll('[data-c]').forEach(function(inp) {
      inp.oninput = function() { var c = { win: cur('win'), loss: cur('loss'), curve: cur('curve') }; c[inp.dataset.c] = inp.value; P.col = c; applyCol(); colors(); savePrefs(); };
    });
    dv.querySelector('#jx-reset').onclick = function() { var d = defPrefs(); P.order = d.order; P.hide = d.hide; P.col = d.col; applyCol(); colors(); changed(); };
    dv.querySelector('.jx-x').focus();
  }
})();
