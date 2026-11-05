// ── TUTORIAL DEL PANEL ──
// Recorrido guiado: la pantalla se oscurece y una luz dorada señala cada parte con una explicación corta.
// Dos versiones: "bienvenida" (cuentas nuevas) y "novedades" (cuentas que ya estaban antes del lanzamiento).
// Se abre solo una vez (se guarda en la cuenta, así no se repite en otro dispositivo) y se vuelve a ver en Ajustes > Preferencias.
(function() {
  var CUT = new Date('2026-11-08T00:00:00Z').getTime(); // cuentas creadas antes de esta fecha = alumnos que ya estaban
  var VER = 1;

  function paid() { try { return _hasClasesAccess() || _hasLiveAccess() || !!(cProfile && cProfile.access_1on1) || _isTeam(); } catch (e) { return true; } }
  function lockTx() { return paid() ? '' : ' Con tu cuenta gratis está con candado: toca "Conocer planes" para desbloquearla.'; }
  // Dibujos para los pasos destacados (progreso y ranking)
  var IMG_PROG = '<svg class="tr-img" viewBox="0 0 280 92" aria-hidden="true"><defs><linearGradient id="trg" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="rgb(var(--c-acc))" stop-opacity=".25"/><stop offset="1" stop-color="rgb(var(--c-acc2))"/></linearGradient></defs>' +
    [1, .75, .5, 1, .25, .75, 0].map(function(h, i) { var x = 8 + i * 39, H = 62; return '<rect x="' + x + '" y="6" width="28" height="' + H + '" rx="7" fill="rgba(var(--c-acc),.08)"/>' + (h ? '<rect x="' + x + '" y="' + (6 + H * (1 - h)) + '" width="28" height="' + (H * h) + '" rx="7" fill="url(#trg)"/>' : '') + '<text x="' + (x + 14) + '" y="86" text-anchor="middle" font-size="10" fill="currentColor" opacity=".55">' + 'LMMJVSD'.charAt(i) + '</text>'; }).join('') + '</svg>';
  var IMG_RANK = '<svg class="tr-img" viewBox="0 0 280 100" aria-hidden="true">' +
    '<rect x="40" y="52" width="62" height="40" rx="8" fill="rgba(var(--c-acc),.16)"/><rect x="109" y="34" width="62" height="58" rx="8" fill="rgba(var(--c-acc),.32)"/><rect x="178" y="64" width="62" height="28" rx="8" fill="rgba(var(--c-acc),.1)"/>' +
    '<text x="71" y="78" text-anchor="middle" font-size="16" font-weight="700" fill="currentColor" opacity=".7">2</text><text x="140" y="70" text-anchor="middle" font-size="20" font-weight="800" fill="rgb(var(--c-acc))">1</text><text x="209" y="84" text-anchor="middle" font-size="14" font-weight="700" fill="currentColor" opacity=".6">3</text>' +
    '<circle cx="71" cy="38" r="11" fill="rgba(var(--c-acc),.22)"/><circle cx="140" cy="20" r="12" fill="rgba(var(--c-acc),.4)"/><circle cx="209" cy="50" r="10" fill="rgba(var(--c-acc),.16)"/>' +
    '<path d="M129 6l4 4 7-7 7 7 4-4-2 9h-18z" fill="rgb(var(--c-acc))" transform="translate(0,-2)"/></svg>';
  var PROG = { s: ['#rp-chart', '#mpw'], t: 'Tu progreso de la semana', img: IMG_PROG, big: 1,
    p: 'Cada barra es un día y se llena en 4 pasos:',
    li: ['Entra a la plataforma', 'Opera o marca "No operé"', 'Anota tu trade con foto o nota', 'Mira una clase o un en vivo'],
    p2: 'Llénala todos los días. Operar o marcar "No operé" también te da puntos en el ranking.' };
  var RANK = { s: ['.rp-rank', '.mpw-rk'], t: 'Ranking del mes', img: IMG_RANK, big: 1,
    p: 'Compites con los demás alumnos por ser el más constante del mes:',
    li: ['+1 punto por cada día hábil que operas o marcas "No operé"', '−1 punto si un día hábil no haces ninguna de las dos', 'Para entrar, conecta tu cuenta real de Exness o Funding Pips en el Journal'],
    p2: '<b class="tr-pz">Los primeros del mes pueden ganar premios, como efectivo o cuentas de fondeo.</b>' };

  function nav(v) { return ['.snav[data-v="' + v + '"]', '#mob-nav .mob-nav-btn[data-v="' + v + '"]', '#mtb-who']; }

  function stepsNew() {
    return [
      { t: 'Bienvenido a Mr Katana', p: 'Te mostramos en 1 minuto dónde está cada cosa para que sepas por dónde empezar.', go: 'Empezar', skip: 'Ahora no' },
      { s: nav('dash'), t: 'Inicio', p: 'Tu resumen del día: anuncios, plan de la semana y calendario económico.' },
      PROG, RANK,
      { s: nav('clases'), t: 'Curso', p: 'Las clases grabadas por niveles. Empieza por el Nivel 1 y avanza en orden.' + lockTx() },
      { s: nav('sesiones'), t: 'En vivo', p: 'Las sesiones en directo. Cuando estoy en vivo entras desde aquí, sin salir del panel.' + lockTx() },
      { s: nav('reuniones'), t: 'Reuniones 1-1', p: 'Tus sesiones privadas conmigo: cuándo es la próxima y las grabaciones de las pasadas.' + lockTx() },
      { s: nav('herramientas'), t: 'Herramientas', p: 'El Journal que anota tus trades solo, el ranking del mes y Kairus.' },
      { s: ['#mk-bell'], t: 'Avisos', p: 'La campana te avisa de clases nuevas, tus 1-1, pagos y noticias fuertes del mercado.' },
      { s: ['#mk-cart-btn'], t: 'Carrito', p: 'Para sumar meses, sesiones en vivo o Kairus pagando con tu tarjeta.' },
      { s: nav('perfil'), t: 'Ajustes', p: 'Tu perfil, tu membresía y renovación, tu tarjeta y qué avisos quieres recibir. Aquí también puedes ver este tutorial otra vez.', go: 'Listo' }
    ];
  }
  function stepsOld() {
    return [
      { t: 'Renovamos tu panel', p: 'Te mostramos lo nuevo en 7 pasos para que no te pierdas nada.', go: 'Ver lo nuevo', skip: 'Ahora no' },
      { s: ['.aside', '#mob-nav'], t: 'Todo está en el menú', p: 'Inicio, Curso, En vivo, Reuniones 1-1 y Herramientas están en el menú de la izquierda.', pm: 'Tus secciones están en la barra de abajo. Toca tu foto, arriba, para ver todo lo demás.' },
      PROG, RANK,
      { s: nav('herramientas'), t: 'Journal automático', p: 'Conecta tu cuenta de Exness o Funding Pips y tus trades se anotan solos, en Herramientas.' },
      { s: nav('sesiones'), t: 'En vivo dentro del panel', p: 'Ya no necesitas otro link: entras a los directos desde aquí.' + lockTx() },
      { s: ['#mk-bell'], t: 'Avisos', p: 'La campana nueva te avisa de clases, 1-1 y pagos. Puedes apagar los que no quieras en Ajustes.' },
      { s: ['#mk-cart-btn'], t: 'Pago con tarjeta', p: 'Suma meses o servicios desde el carrito. La renovación automática y el cambio de tarjeta están en Ajustes > Membresía.', go: 'Listo' }
    ];
  }

  var st = null, ov, hole, card;

  function css() {
    if (document.getElementById('mk-tour-css')) return;
    var c = document.createElement('style'); c.id = 'mk-tour-css';
    c.textContent =
      '#mk-tour{position:fixed;inset:0;z-index:9999;font-family:inherit;}' +
      '#mk-tour .tr-bg{position:absolute;inset:0;background:rgba(0,0,0,.62);transition:opacity .25s;}' +
      '#mk-tour.has-h .tr-bg{opacity:0;}' +
      '#mk-tour .tr-h{position:absolute;border-radius:14px;box-shadow:0 0 0 2px rgb(var(--c-acc)),0 0 0 9999px rgba(0,0,0,.62);pointer-events:none;opacity:0;transition:left .35s ease,top .35s ease,width .35s ease,height .35s ease,opacity .25s;}' +
      '#mk-tour.has-h .tr-h{opacity:1;}' +
      '#mk-tour .tr-c{position:absolute;width:300px;max-width:calc(100vw - 32px);background:var(--c-card);color:var(--c-text);border:1px solid var(--c-line);border-radius:16px;padding:16px 16px 13px;box-shadow:0 16px 44px rgba(0,0,0,.4);transition:left .35s ease,top .35s ease,opacity .2s;}' +
      '#mk-tour .tr-c.big{width:340px;}' +
      '#mk-tour .tr-img{display:block;width:100%;height:auto;margin:6px 0 12px;color:var(--c-text);}' +
      '#mk-tour .tr-c ul{margin:8px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;}' +
      '#mk-tour .tr-c li{position:relative;padding-left:16px;font-size:.84rem;line-height:1.45;color:var(--c-text);}' +
      '#mk-tour .tr-c li:before{content:"";position:absolute;left:2px;top:.55em;width:6px;height:6px;border-radius:50%;background:rgb(var(--c-acc));}' +
      '#mk-tour .tr-p2{margin-top:10px !important;}' +
      '#mk-tour .tr-c b.tr-pz{display:inline;font-size:inherit;margin:0;color:rgb(var(--c-acc));font-weight:600;}' +
      '#mk-tour .tr-c.ct{text-align:center;width:340px;padding:24px 22px 18px;}' +
      '#mk-tour .tr-c b{display:block;font-size:.98rem;font-weight:700;margin-bottom:5px;}' +
      '#mk-tour .tr-c.ct b{font-size:1.15rem;}' +
      '#mk-tour .tr-c p{margin:0;color:var(--c-text2);font-size:.86rem;line-height:1.5;}' +
      '#mk-tour .tr-f{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:14px;}' +
      '#mk-tour .tr-c.ct .tr-f{flex-direction:column-reverse;gap:6px;margin-top:18px;}' +
      '#mk-tour .tr-n{color:var(--c-muted);font-size:.76rem;font-variant-numeric:tabular-nums;}' +
      '#mk-tour .tr-bs{display:flex;align-items:center;gap:6px;}' +
      '#mk-tour .tr-c.ct .tr-bs{flex-direction:column-reverse;width:100%;}' +
      '#mk-tour button{font:inherit;cursor:pointer;border:none;border-radius:10px;}' +
      '#mk-tour .tr-sk,#mk-tour .tr-bk{background:none;color:var(--c-muted);font-size:.8rem;padding:8px 8px;}' +
      '#mk-tour .tr-sk:hover,#mk-tour .tr-bk:hover{color:var(--c-text);}' +
      '#mk-tour .tr-go{background:rgb(var(--c-btn));color:var(--c-ongold);font-weight:700;font-size:.84rem;padding:9px 16px;}' +
      '#mk-tour .tr-c.ct .tr-go{width:100%;padding:12px 16px;}' +
      '#mk-tour button:focus-visible{outline:2px solid rgb(var(--c-acc));outline-offset:2px;}' +
      '@media(prefers-reduced-motion:reduce){#mk-tour .tr-h,#mk-tour .tr-c{transition:none;}}';
    document.head.appendChild(c);
  }

  function vis(el) {
    if (!el) return null;
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return null;
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return null;
    var cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') return null;
    return r;
  }
  function find(sel) {
    for (var i = 0; i < (sel || []).length; i++) {
      var els = document.querySelectorAll(sel[i]);
      for (var j = 0; j < els.length; j++) { var r = vis(els[j]); if (r) return { el: els[j], r: r }; }
    }
    return null;
  }

  function draw() {
    if (!st) return;
    var s = st.list[st.i], n = st.list.length, f = s.s ? find(s.s) : null;
    // si el elemento está fuera de la vista (por ejemplo, abajo en el celular), lo traemos y volvemos a medir
    if (s.s && !f) {
      var el0 = null; for (var k = 0; k < s.s.length && !el0; k++) { var c0 = document.querySelector(s.s[k]); if (c0 && c0.getBoundingClientRect().height > 3) el0 = c0; }
      if (el0 && !st.scrolled) { st.scrolled = 1; try { el0.scrollIntoView({ block: 'center' }); } catch (e) {} return setTimeout(draw, 350); }
    }
    st.scrolled = 0;
    var last = st.i === n - 1, first = st.i === 0;
    card.className = 'tr-c' + (f ? '' : ' ct') + (s.big ? ' big' : '');
    var tx = (innerWidth <= 860 && s.pm) ? s.pm : s.p;
    if (f && f.el.id === 'mtb-who' && !s.pm) tx += ' En el celular lo abres tocando tu foto, arriba.';
    card.innerHTML = '<b>' + s.t + '</b>' + (s.img || '') + '<p>' + tx + '</p>' + (s.li ? '<ul>' + s.li.map(function(x) { return '<li>' + x + '</li>'; }).join('') + '</ul>' : '') + (s.p2 ? '<p class="tr-p2">' + s.p2 + '</p>' : '') + '<div class="tr-f">' +
      (f ? '<span class="tr-n">' + st.i + ' de ' + (n - 1) + '</span>' : '') +
      '<span class="tr-bs">' + (first ? '<button class="tr-sk" data-a="x">' + (s.skip || 'Saltar') + '</button>' : (f && !last ? '<button class="tr-sk" data-a="x">Saltar</button>' : '') + (st.i > 1 ? '<button class="tr-bk" data-a="b">Atrás</button>' : '')) +
      '<button class="tr-go" data-a="n">' + (s.go || 'Siguiente') + '</button></span></div>';
    ov.classList.toggle('has-h', !!f);
    var W = innerWidth, H = innerHeight, cw = Math.min(f ? (s.big ? 340 : 300) : 340, W - 32);
    if (f) {
      var r = f.r, pad = 6;
      hole.style.left = (r.left - pad) + 'px'; hole.style.top = (r.top - pad) + 'px';
      hole.style.width = (r.width + pad * 2) + 'px'; hole.style.height = (r.height + pad * 2) + 'px';
      var ch = card.offsetHeight || 150, x, y;
      if (W <= 860 || r.width > W * .5) { // celular o elemento ancho: tarjeta arriba o abajo
        x = (W - cw) / 2;
        y = r.bottom + 16 + ch < H - 8 ? r.bottom + 16 : Math.max(12, r.top - 16 - ch);
      } else if (r.right + 18 + cw < W - 12) { // a la derecha
        x = r.right + 18; y = Math.min(Math.max(12, r.top + r.height / 2 - ch / 2), H - ch - 12);
      } else if (r.left - 18 - cw > 12) { // a la izquierda
        x = r.left - 18 - cw; y = Math.min(Math.max(12, r.top + r.height / 2 - ch / 2), H - ch - 12);
      } else { // debajo o arriba
        x = Math.max(12, Math.min(r.left + r.width / 2 - cw / 2, W - cw - 12));
        y = r.bottom + 16 + ch < H - 8 ? r.bottom + 16 : Math.max(12, r.top - 16 - ch);
      }
      card.style.left = x + 'px'; card.style.top = y + 'px';
    } else {
      card.style.left = (W - cw) / 2 + 'px';
      card.style.top = Math.max(12, (H - (card.offsetHeight || 200)) / 2) + 'px';
    }
  }

  function save() {
    try { localStorage.setItem('mk-tour-' + cUser.id, String(VER)); } catch (e) {}
    try { if (!(cUser.user_metadata && cUser.user_metadata.mk_tour >= VER)) sb.auth.updateUser({ data: { mk_tour: VER } }).then(function(r) { if (r && r.data && r.data.user) cUser = r.data.user; }); } catch (e) {}
  }
  function end() {
    if (!st) return;
    st = null; window._tourOn = false; save();
    ov.remove(); removeEventListener('resize', onRs); removeEventListener('keydown', onKey);
    if (window._pushAsk) setTimeout(_pushAsk, 1500);
  }
  function onRs() { clearTimeout(onRs.t); onRs.t = setTimeout(draw, 120); }
  function onKey(e) {
    if (!st) return;
    if (e.key === 'Escape') end();
    else if (e.key === 'ArrowRight') act('n');
    else if (e.key === 'ArrowLeft' && st.i > 1) act('b');
  }
  function act(a) {
    if (a === 'x') return end();
    if (a === 'b') st.i = Math.max(1, st.i - 1);
    else if (st.i >= st.list.length - 1) return end();
    else st.i++;
    draw();
  }

  window.mkTour = function(kind) {
    if (st || !window.cUser) return;
    var onDash = document.querySelector('.snav.on[data-v="dash"]') || (history.state && history.state.section === 'dash');
    if (!onDash && window.navigateTo) { navigateTo('dash'); return setTimeout(function() { mkTour(kind); }, 700); }
    var ps = document.getElementById('push-ask'); if (ps) ps.remove();
    css(); window._tourOn = true;
    st = { list: kind === 'old' ? stepsOld() : stepsNew(), i: 0 };
    ov = document.createElement('div'); ov.id = 'mk-tour'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Tutorial');
    ov.innerHTML = '<div class="tr-bg"></div><div class="tr-h"></div><div class="tr-c"></div>';
    hole = ov.querySelector('.tr-h'); card = ov.querySelector('.tr-c');
    card.onclick = function(e) { var b = e.target.closest('button[data-a]'); if (b) act(b.getAttribute('data-a')); };
    document.body.appendChild(ov);
    addEventListener('resize', onRs); addEventListener('keydown', onKey);
    draw();
  };

  // Se abre solo la primera vez que la persona llega a Inicio
  window._tourAuto = function() {
    try {
      if (!window.cUser || st) return;
      if (/[?&](whop|vista-pago)/.test(location.search)) return;
      if (cUser.user_metadata && cUser.user_metadata.mk_tour >= VER) return;
      try { if (+localStorage.getItem('mk-tour-' + cUser.id) >= VER) return; } catch (e) {}
      var onDash = document.querySelector('.snav.on[data-v="dash"]') || (history.state && history.state.section === 'dash');
      if (!onDash || document.querySelector('.mk-onb')) return;
      var made = new Date(cUser.created_at || Date.now()).getTime();
      var old = made < CUT && Date.now() - made > 3 * 864e5;
      mkTour(old ? 'old' : 'new');
    } catch (e) {}
  };
})();
