// api/cart.js
// Carrito dentro de la app: el alumno ya logueado compra o renueva cualquier servicio
// (en vivo, Kairus, sesiones 1-1 extra, o lo que se agregue en Admin > Planes con
// "Mostrar en el carrito").
//
//   POST /api/cart  { action: 'create', items: [{ plan_id, variant_id }] }
//     → calcula el total con los precios de la base (no los del navegador),
//       crea el pedido en PayPal y devuelve su id
//   POST /api/cart  { action: 'capture', orderID }
//     → cobra en PayPal, verifica el monto y activa todo lo comprado
//
// Variables en Vercel: PAYPAL_SECRET (y PAYPAL_CLIENT_ID si cambia), SUPABASE_SERVICE_KEY,
// TV_SESSIONID (sesión de TradingView del dueño de Kairus, para dar el acceso solo).

const { createClient } = require('@supabase/supabase-js');

const SB_URL = 'https://rxyezbyvwqwihggechsc.supabase.co';
const PP_CLIENT = process.env.PAYPAL_CLIENT_ID || 'AYqmenNbm9toSrKHvVt5BxHZglY06A2a5Fgi_ffQrKbPoeLxtXlNc4wseA89j24Cv8iJjLoLYV08A0vu';
const PP_API = process.env.PAYPAL_API || 'https://api-m.paypal.com';
const UNLIMITED = '2099-12-31T00:00:00.000Z';

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
    if (!process.env.SUPABASE_SERVICE_KEY) return res.status(500).json({ error: 'missing_service_key' });
    if (!process.env.PAYPAL_SECRET) return res.status(500).json({ error: 'missing_paypal_secret' });
    const sb = createClient(SB_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const u = token ? await sb.auth.getUser(token) : null;
    const user = u && u.data && u.data.user;
    if (!user) return res.status(401).json({ error: 'no_session' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (body.action === 'create') return await create(sb, user, body, res);
    if (body.action === 'capture') return await capture(sb, user, body, res);
    if (body.action === 'tv_grant') return await adminTv(sb, user, body, res);
    return res.status(400).json({ error: 'bad_action' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};

// ── Precios reales desde la base ──
async function priceItems(sb, items) {
  if (!Array.isArray(items) || !items.length || items.length > 10) throw new Error('empty_cart');
  const ids = [...new Set(items.map(i => String(i.plan_id || '')))];
  const pr = await sb.from('checkout_plans').select('*').in('id', ids);
  const vr = await sb.from('checkout_plan_variants').select('*').in('plan_id', ids);
  const plans = {}; (pr.data || []).forEach(p => { plans[p.id] = p; });
  const vars = {}; (vr.data || []).forEach(v => { vars[v.id] = v; });
  return items.map(i => {
    const p = plans[i.plan_id];
    if (!p || !p.in_store) throw new Error('not_in_store');
    const pv = (vr.data || []).filter(v => v.plan_id === p.id);
    let v = null;
    if (pv.length) { v = vars[i.variant_id]; if (!v || v.plan_id !== p.id) throw new Error('pick_variant'); }
    const price = Number(v ? v.price : p.price);
    if (!(price > 0)) throw new Error('no_price');
    return {
      plan_id: p.id, variant_id: v ? v.id : null,
      name: p.name + (v ? ' · ' + v.name : ''), price,
      access_clases: v && v.access_clases != null ? v.access_clases : p.access_clases,
      clases_months: v && v.duration_clases_months != null ? v.duration_clases_months : p.duration_clases_months,
      live_months: v && v.duration_live_months != null ? v.duration_live_months : p.duration_live_months,
      tv_months: v && v.duration_tv_months != null ? v.duration_tv_months : p.duration_tv_months,
      extra_1on1: v && v.extra_1on1 != null ? v.extra_1on1 : (p.extra_1on1 || 0),
      access_1on1: !!p.access_1on1, category: p.category, tv_pine_id: p.tv_pine_id || null,
      roadmap_mode: p.roadmap_mode || null
    };
  });
}

async function paypalToken() {
  const r = await fetch(PP_API + '/v1/oauth2/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(PP_CLIENT + ':' + process.env.PAYPAL_SECRET).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('paypal_auth');
  return j.access_token;
}

async function create(sb, user, body, res) {
  let items;
  try { items = await priceItems(sb, body.items); } catch (e) { return res.status(400).json({ error: e.message }); }
  if (items.some(i => i.tv_pine_id)) {
    const s = await sb.from('user_settings').select('tv_username').eq('id', user.id).maybeSingle();
    if (!s.data || !s.data.tv_username) return res.status(400).json({ error: 'need_tv_user' });
  }
  const total = Math.round(items.reduce((a, i) => a + i.price, 0) * 100) / 100;
  const tk = await paypalToken();
  const r = await fetch(PP_API + '/v2/checkout/orders', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        description: ('Mr Katana FX: ' + items.map(i => i.name).join(', ')).slice(0, 127),
        amount: { currency_code: 'USD', value: total.toFixed(2) }
      }]
    })
  });
  const o = await r.json();
  if (!o.id) return res.status(502).json({ error: 'paypal_order', detail: o.message || o.name });
  const ins = await sb.from('cart_orders').insert({ user_id: user.id, paypal_order_id: o.id, items, total });
  if (ins.error) return res.status(500).json({ error: ins.error.message });
  return res.status(200).json({ id: o.id, total });
}

async function capture(sb, user, body, res) {
  const orderID = String(body.orderID || '');
  const q = await sb.from('cart_orders').select('*').eq('paypal_order_id', orderID).eq('user_id', user.id).maybeSingle();
  const ord = q.data;
  if (!ord) return res.status(404).json({ error: 'order_not_found' });
  if (ord.status !== 'pending') return res.status(200).json({ ok: true, already: true, result: ord.result });

  const tk = await paypalToken();
  const r = await fetch(PP_API + '/v2/checkout/orders/' + encodeURIComponent(orderID) + '/capture', {
    method: 'POST', headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' }
  });
  const c = await r.json();
  const cap = c.purchase_units && c.purchase_units[0] && c.purchase_units[0].payments && c.purchase_units[0].payments.captures && c.purchase_units[0].payments.captures[0];
  if (c.status !== 'COMPLETED' || !cap || Math.abs(Number(cap.amount.value) - Number(ord.total)) > 0.01) {
    await sb.from('cart_orders').update({ status: 'error', result: { paypal: c.status || c.name || 'fail' } }).eq('id', ord.id);
    return res.status(402).json({ error: 'payment_not_completed' });
  }
  // Marca como pagado una sola vez (evita activar dos veces si llegan dos llamadas)
  const claim = await sb.from('cart_orders').update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', ord.id).eq('status', 'pending').select('id');
  if (!claim.data || !claim.data.length) return res.status(200).json({ ok: true, already: true });

  const result = await applyItems(sb, user, ord, c.payer && c.payer.email_address);
  await sb.from('cart_orders').update({ status: result.errors.length ? 'error' : 'applied', result }).eq('id', ord.id);
  return res.status(200).json({ ok: true, result });
}

// ── Admin: dar o reintentar el acceso a un indicador a mano (respaldo) ──
async function adminTv(sb, user, body, res) {
  const me = await sb.from('profiles').select('role').eq('id', user.id).single();
  if (!me.data || me.data.role !== 'admin') return res.status(403).json({ error: 'not_admin' });
  const pl = await sb.from('checkout_plans').select('id, tv_pine_id').eq('id', String(body.plan_id || '')).maybeSingle();
  if (!pl.data || !pl.data.tv_pine_id) return res.status(400).json({ error: 'plan_without_indicator' });
  const months = body.months == null ? 0 : parseInt(body.months, 10);
  const uid = String(body.user_id || '');
  const tvu = String(body.tv_username || '').trim();
  if (tvu) await sb.from('user_settings').upsert({ id: uid, tv_username: tvu, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  const tv = await grantTv(sb, uid, { plan_id: pl.data.id, tv_pine_id: pl.data.tv_pine_id, tv_months: months || null }, !!body.retry);
  return res.status(200).json(Object.assign({ ok: false }, tv));
}

// ── Activa lo comprado: suma tiempo a lo que ya tiene, nunca lo acorta ──
function addMonths(fromISO, months) {
  const now = new Date();
  let d = fromISO ? new Date(fromISO) : now;
  if (isNaN(d) || d < now) d = now;
  d = new Date(d); d.setMonth(d.getMonth() + months);
  return d.toISOString();
}
const fmt = x => new Date(x).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Guayaquil' });
const isUnl = x => x && new Date(x).getFullYear() >= 2099;

async function applyItems(sb, user, ord, payerEmail) {
  const out = { lines: [], errors: [] };
  const pr = await sb.from('profiles').select('plan, membership_start, membership_end, live_end, live_plan, access_1on1').eq('id', user.id).single();
  const p = pr.data || {};
  const upd = {};
  let end = p.membership_end, liveEnd = p.live_end;
  const purchases = [];

  for (const it of ord.items) {
    let expires = null;
    // Clases (planes de formación)
    if ((it.category === 'clases' || it.category === 'ambos') && it.access_clases !== false) {
      if (!it.clases_months) end = UNLIMITED;
      else if (!isUnl(end)) end = addMonths(end, it.clases_months);
      upd.membership_end = end; if (!p.membership_start) upd.membership_start = new Date().toISOString();
      upd.plan = it.plan_id; if (it.roadmap_mode) upd.roadmap_mode = it.roadmap_mode;
      expires = end;
      out.lines.push({ name: it.name, text: isUnl(end) ? 'Acceso ilimitado a las clases' : 'Clases hasta el ' + fmt(end) });
    }
    // En vivo
    if (it.live_months) {
      liveEnd = addMonths(liveEnd, it.live_months);
      upd.live_end = liveEnd; upd.live_plan = it.plan_id; expires = liveEnd;
      out.lines.push({ name: it.name, text: 'En vivo hasta el ' + fmt(liveEnd) });
    }
    // Sesiones 1-1
    if (it.access_1on1 || it.extra_1on1) upd.access_1on1 = true;
    if (it.extra_1on1) out.lines.push({ name: it.name, text: '+' + it.extra_1on1 + ' sesión' + (it.extra_1on1 === 1 ? '' : 'es') + ' 1-1' });
    // Indicador de TradingView
    if (it.tv_pine_id) {
      const tv = await grantTv(sb, user.id, it);
      expires = tv.expires || expires;
      if (tv.ok) out.lines.push({ name: it.name, text: 'Activo en TradingView (' + tv.username + ')' + (tv.expires ? ' hasta el ' + fmt(tv.expires) : '') });
      else { out.lines.push({ name: it.name, text: 'Pago recibido. Te damos el acceso en TradingView en breve.' }); out.errors.push('tv:' + tv.error); }
    }
    if (!out.lines.some(l => l.name === it.name)) out.lines.push({ name: it.name, text: 'Pago recibido' });
    purchases.push({
      user_id: user.id, plan_id: it.plan_id, amount: it.price, currency: 'USD', payment_method: 'paypal',
      paypal_order_id: ord.paypal_order_id, paypal_payer_email: payerEmail || null, status: 'completed',
      starts_at: new Date().toISOString(), expires_at: expires, extra_1on1: it.extra_1on1 || 0, cart_order_id: ord.id
    });
  }
  if (Object.keys(upd).length) {
    const u = await sb.from('profiles').update(upd).eq('id', user.id);
    if (u.error) out.errors.push('profile:' + u.error.message);
  }
  const ins = await sb.from('purchases').insert(purchases);
  if (ins.error) out.errors.push('purchases:' + ins.error.message);
  out.total = ord.total;
  return out;
}

// TradingView no tiene API oficial: se usa la misma llamada que hace su página de
// "Administrar acceso" del script, con la sesión del dueño (TV_SESSIONID en Vercel).
async function grantTv(sb, userId, it, retry) {
  const s = await sb.from('user_settings').select('tv_username').eq('id', userId).maybeSingle();
  const username = s.data && s.data.tv_username;
  const prev = await sb.from('tv_access').select('expires_at').eq('user_id', userId).eq('pine_id', it.tv_pine_id).maybeSingle();
  const lifetime = !it.tv_months || (prev.data && prev.data.expires_at === null);
  const expires = retry && prev.data ? prev.data.expires_at : (lifetime ? null : addMonths(prev.data && prev.data.expires_at, it.tv_months));
  let ok = false, error = null;
  if (!username) error = 'no_username';
  else if (!process.env.TV_SESSIONID) error = 'missing_tv_session';
  else {
    try {
      const pine = await resolvePine(it.tv_pine_id);
      ok = await tvCall('add', pine, username, expires);
      if (!ok) ok = await tvCall('modify_user_expiration', pine, username, expires);
      if (!ok) error = 'tv_rejected';
    } catch (e) { error = String(e.message || e); }
  }
  await sb.from('tv_access').upsert({
    user_id: userId, plan_id: it.plan_id, pine_id: it.tv_pine_id, tv_username: username || '',
    expires_at: expires, status: ok ? 'ok' : 'error', last_error: error, updated_at: new Date().toISOString()
  }, { onConflict: 'user_id,pine_id' });
  return { ok, error, expires, username };
}

// En Admin se puede poner el ID (PUB;...) o simplemente el link de la página del script:
// en ese caso se lee el ID real desde esa página.
const _pineCache = {};
async function resolvePine(v) {
  v = String(v || '').trim();
  if (/^PUB;/.test(v)) return v;
  if (_pineCache[v]) return _pineCache[v];
  const url = v.replace(/^https?:\/\/[a-z]{2,3}\.tradingview\.com/, 'https://www.tradingview.com');
  const r = await fetch(url, { headers: { cookie: 'sessionid=' + process.env.TV_SESSIONID.trim(), 'user-agent': 'Mozilla/5.0' } });
  const html = await r.text();
  const m = html.match(/PUB;[A-Za-z0-9]{16,}/);
  if (!m) throw new Error('pine_id_not_found');
  return (_pineCache[v] = m[0]);
}

async function tvCall(kind, pineId, username, expires) {
  const form = new URLSearchParams({ pine_id: pineId, username_recip: username });
  if (expires) form.set('expiration', expires);
  const r = await fetch('https://www.tradingview.com/pine_perm/' + kind + '/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      cookie: 'sessionid=' + process.env.TV_SESSIONID.trim(),
      origin: 'https://www.tradingview.com', referer: 'https://www.tradingview.com/'
    },
    body: form.toString()
  });
  if (!r.ok) return false;
  const j = await r.json().catch(() => ({}));
  return j.status === 'ok' || (kind === 'modify_user_expiration' && r.status === 200 && !j.status);
}

