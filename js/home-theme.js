// Colores de la página de inicio: usa los mismos que el admin guarda en Admin > Apariencia (modo oscuro).
// Copia de los cálculos de login.html para derivar acentos a partir del color principal.
var MK_THEME_DEFAULT = {
  dark:  { acc:'#c9a84c', bg:'#0e0e10', card:'#1c1c20', text:'#f0f0f0' },
  light: { acc:'#a8822b', bg:'#f4f2ec', card:'#ffffff', text:'#18181b' }
};
function _mkHexRgb(h) {
  h = String(h || '').replace('#','');
  if (h.length === 3) h = h.replace(/./g, function(c){ return c + c; });
  var n = parseInt(h, 16);
  if (isNaN(n) || h.length !== 6) return [0,0,0];
  return [(n>>16)&255, (n>>8)&255, n&255];
}
function _mkMix(a, b, t) {
  var x = _mkHexRgb(a), y = _mkHexRgb(b);
  return '#' + [0,1,2].map(function(i){ var v = Math.round(x[i] + (y[i]-x[i])*t); return ('0'+v.toString(16)).slice(-2); }).join('');
}
function _mkTrip(h) { return _mkHexRgb(h).join(','); }
function _mkOnColor(h) {
  var c = _mkHexRgb(h);
  return (0.299*c[0] + 0.587*c[1] + 0.114*c[2]) > 150 ? '#151309' : '#ffffff';
}
// Paleta: el color principal pinta los botones; acentos, detalles suaves y texto en botones
// se calculan solos a partir de él (salvo que el admin los fije a mano con el candado).
function _mkHsl(h) {
  var c = _mkHexRgb(h).map(function(v){ return v / 255; }), mx = Math.max.apply(null, c), mn = Math.min.apply(null, c);
  var l = (mx + mn) / 2, d = mx - mn, hh = 0, ss = 0;
  if (d) {
    ss = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
    hh = mx === c[0] ? (c[1] - c[2]) / d + (c[1] < c[2] ? 6 : 0) : mx === c[1] ? (c[2] - c[0]) / d + 2 : (c[0] - c[1]) / d + 4;
    hh /= 6;
  }
  return [hh, ss, l];
}
function _mkFromHsl(h, s, l) {
  function f(p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1/6 ? p + (q - p) * 6 * t : t < 1/2 ? q : t < 2/3 ? p + (q - p) * (2/3 - t) * 6 : p; }
  var r, g, b;
  if (!s) r = g = b = l;
  else { var q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; r = f(p, q, h + 1/3); g = f(p, q, h); b = f(p, q, h - 1/3); }
  return '#' + [r, g, b].map(function(v){ return ('0' + Math.round(v * 255).toString(16)).slice(-2); }).join('');
}
function _mkAuto(acc, mode) {
  var x = _mkHsl(acc), l = mode === 'light' ? Math.max(.28, Math.min(x[2], .38)) : Math.min(.78, Math.max(x[2], .62));
  var a = _mkFromHsl(x[0], Math.min(x[1], .75), l), c = _mkHexRgb(acc);
  return { accent: a, soft: 'rgba(' + c.join(',') + ',' + (mode === 'light' ? .12 : .14) + ')', on: _mkOnColor(acc) };
}
function _mkPal(cfg, mode) {
  var p = Object.assign({}, MK_THEME_DEFAULT[mode], (cfg && cfg[mode]) || {}), au = _mkAuto(p.acc, mode);
  ['accent','soft','on'].forEach(function(k){ if (!p[k]) p[k] = au[k]; });
  return p;
}
function _homeThemeCss(cfg) {
  if (!cfg || !cfg.dark || !Object.keys(cfg.dark).length) return '';
  var d = _mkPal(cfg, 'dark');
  return ':root{--bg:' + _mkMix(d.bg, '#000000', .3) + ';--bg2:' + d.bg + ';--pn:' + _mkMix(d.bg, d.card, .4) +
    ';--t:' + d.text + ';--t2:' + _mkMix(d.text, d.bg, .35) + ';--mu:' + _mkMix(d.text, d.bg, .58) +
    ';--g:' + _mkTrip(d.accent) + ';--gl:' + d.accent + ';--btn1:' + _mkMix(d.acc, '#ffffff', .12) + ';--btn2:' + _mkMix(d.acc, '#000000', .12) + ';--btng:' + _mkTrip(d.acc) + ';--on:' + d.on + ';}';
}
// Pide los colores al servidor; si cambiaron, los aplica y los recuerda para la próxima visita
function _homeTheme(onChange) {
  fetch('/api/site-theme').then(function(r) { return r.json(); }).then(function(d) {
    if (!d || !d.ok) return;
    var css = _homeThemeCss(d.theme), el = document.getElementById('mk-home-theme');
    var old = el ? el.textContent : '';
    if (css === old) return;
    if (!el) { el = document.createElement('style'); el.id = 'mk-home-theme'; document.head.appendChild(el); }
    el.textContent = css;
    try { css ? localStorage.setItem('mk-home-css', css) : localStorage.removeItem('mk-home-css'); } catch (e) {}
    if (onChange) onChange();
  }).catch(function() {});
}
