// api/_renew.js (con guion bajo = no cuenta como función de Vercel; lo llama api/cart.js)
// Renovación automática con la tarjeta guardada en Whop.
//
// Cron diario (vercel.json → /api/cart?cron=renew, solo corre en la página real):
//   1. Aviso por correo 5 días antes del cobro.
//   2. Cobro el día que termina el en vivo: se crea un pedido (cart_orders) y se cobra la tarjeta
//      guardada. El webhook de Whop (payment.succeeded) activa lo comprado igual que una compra
//      normal y mueve next_charge_at a la nueva fecha.
//   3. Si el cobro falla: correo al alumno, se reintenta a los 2 días, y tras 3 intentos se apaga.
//
// Prueba desde Admin (renew_test): cobra $1 a una cuenta de prueba para comprobar que Whop acepta
// el cobro sin la persona presente.

const SITE = 'https://www.mrkatanafx.com';
const PRICES = { live: 100, kairus: 75 };
const MAX_FAILS = 3;

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function fdate(d) { return new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Guayaquil' }); }

async function mail(to, subject, html) {
  if (!process.env.RESEND_API_KEY || !to) return false;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Mr Katana FX <noreply@mrkatanafx.com>', to: [to], subject,
      html: '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#222;line-height:1.55">' + html +
        '<p style="color:#888;font-size:12px;margin-top:22px">Puedes apagar la renovación automática o quitar tu tarjeta en Ajustes, Membresía y pagos.</p></div>' })
  }).catch(() => null);
  return !!(r && r.ok);
}
const btn = (t, href) => '<p><a href="' + href + '" style="display:inline-block;background:#c9a646;color:#111;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">' + t + '</a></p>';

// Busca un id de Whop (ej. mber_) dentro de cualquier respuesta
function digId(o, re, d) {
  if (!o || typeof o !== 'object' || d > 5) return '';
  for (const k of Object.keys(o)) { const v = o[k]; if (typeof v === 'string' && re.test(v)) return v; }
  for (const k of Object.keys(o)) { const v = digId(o[k], re, (d || 0) + 1); if (v) return v; }
  return '';
}

// Lo que se renueva: 1 mes de en vivo (y 1 mes de Kairus si el alumno lo tenía en su renovación)
async function renewItems(h, a) {
  const vr = await h.sb.from('checkout_plan_variants').select('id, plan_id, price, duration_live_months, duration_tv_months').in('plan_id', ['live', 'kairus']);
  const pick = (plan, key) => ((vr.data || []).find(v => v.plan_id === plan && Number(v[key]) === 1 && Number(v.price) > 1) || {}).id;
  const want = [];
  if (a.live) want.push({ plan_id: 'live', variant_id: pick('live', 'duration_live_months') });
  if (a.live && a.kairus) want.push({ plan_id: 'kairus', variant_id: pick('kairus', 'duration_tv_months') });
  if (!want.length || want.some(w => !w.variant_id)) throw new Error('no_renew_items');
  return await h.priceItems(h.sb, want, false);
}

async function memberId(h, a) {
  if (a.whop_member_id) return a.whop_member_id;
  const lp = await h.sb.from('cart_orders').select('whop_payment_id').eq('user_id', a.user_id).not('whop_payment_id', 'is', null).order('created_at', { ascending: false }).limit(3);
  for (const o of (lp.data || [])) {
    const r = await h.whopFetch('/payments/' + encodeURIComponent(o.whop_payment_id), { method: 'GET' }).catch(() => null);
    const m = r && r.ok && digId(r.data, /^mber_[A-Za-z0-9]+$/, 0);
    if (m) { await h.sb.from('auto_renew').update({ whop_member_id: m }).eq('user_id', a.user_id); return m; }
  }
  return '';
}

// Cobra la tarjeta guardada. test = cobro de $1 para comprobar desde Admin.
async function charge(h, a, test) {
  const items = await renewItems(h, a);
  if (test) { items.length = 1; items[0].price = 1; items[0].name = items[0].name + ' (prueba de renovación)'; }
  const total = Math.round(items.reduce((s, i) => s + i.price, 0) * 100) / 100;
  const mid = await memberId(h, a);
  if (!a.whop_payment_method_id) return { ok: false, error: 'no_card' };
  if (!mid) return { ok: false, error: 'no_member' };
  const ins = await h.sb.from('cart_orders').insert({ user_id: a.user_id, provider: 'whop', items, total, renew: { live: !!a.live, kairus: !!(a.live && a.kairus) } }).select('id').single();
  if (ins.error) return { ok: false, error: ins.error.message };
  const day = String(a.next_charge_at || '').slice(0, 10);
  const p = await h.whopFetch('/payments', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'mk-renew-' + a.user_id + '-' + (test ? 'test-' + ins.data.id : day + '-' + (a.fail_count || 0)) },
    body: JSON.stringify({
      account_id: h.WHOP_COMPANY, member_id: mid, payment_method_id: a.whop_payment_method_id, off_session: true,
      variant: { product_id: h.WHOP_PRODUCT, currency: 'usd', billing_type: 'one_time', initial_price: total, visibility: 'hidden',
        title: (test ? 'Prueba renovación' : 'Renovación Mr Katana').slice(0, 30) },
      metadata: { order_id: ins.data.id, user_id: a.user_id, renew: '1' }
    })
  });
  const d = p.data || {};
  if (d.id) await h.sb.from('cart_orders').update({ whop_payment_id: d.id }).eq('id', ins.data.id);
  const st = String(d.status || '') + ' ' + String(d.substatus || '');
  if (!p.ok || /fail|void|uncollectible|declin/i.test(st) || d.failure_message) {
    await h.sb.from('cart_orders').update({ status: 'error', result: { whop: st.trim() || p.status, failure: d.failure_message || d.message || null } }).eq('id', ins.data.id);
    return { ok: false, error: String(d.failure_message || d.message || (d.error && d.error.message) || d.error || ('http_' + p.status)).slice(0, 200), order: ins.data.id };
  }
  return { ok: true, order: ins.data.id, status: st.trim(), total };
}

async function cron(h, req, res) {
  const key = process.env.CRON_SECRET;
  if (!key || req.headers.authorization !== 'Bearer ' + key) return res.status(401).json({ error: 'auth' });
  const sb = h.sb, now = new Date(), out = { reminded: 0, charged: 0, failed: 0 };
  const rows = (await sb.from('auto_renew').select('*').eq('active', true).not('next_charge_at', 'is', null)).data || [];
  const ids = rows.map(r => r.user_id);
  const pr = ids.length ? (await sb.from('profiles').select('id, email, full_name, live_end').in('id', ids)).data || [] : [];
  const who = {}; pr.forEach(p => { who[p.id] = p; });
  for (const a of rows) {
    const p = who[a.user_id] || {}, nx = new Date(a.next_charge_at), name = esc(String(p.full_name || '').split(' ')[0] || 'Hola');
    const amt = (a.live ? PRICES.live : 0) + (a.live && a.kairus ? PRICES.kairus : 0), what = a.live && a.kairus ? 'tus clases en vivo y Kairus' : 'tus clases en vivo';
    // 1. Aviso 5 días antes (una vez por fecha de cobro)
    const daysTo = (nx - now) / 864e5;
    if (daysTo > 0 && daysTo <= 5 && String(a.reminded_for || '') !== String(a.next_charge_at)) {
      const ok = await mail(p.email, 'Tu renovación es el ' + fdate(nx),
        '<p>' + name + ', el <b>' + fdate(nx) + '</b> se renuevan ' + what + ' por <b>$' + amt + ' USD</b> con tu tarjeta guardada.</p>' +
        '<p>No tienes que hacer nada. Si prefieres no renovar, apágalo antes de esa fecha.</p>' + btn('Ver mi membresía', SITE + '/app/perfil'));
      if (ok) { out.reminded++; await sb.from('auto_renew').update({ reminded_for: a.next_charge_at }).eq('user_id', a.user_id); }
    }
    // 2. Cobro (si ya llegó la fecha y no se intentó en las últimas 47 horas)
    if (nx > now) continue;
    if (a.last_try_at && now - new Date(a.last_try_at) < 47 * 3600e3) continue;
    // Si el en vivo ya se extendió por otra compra, solo se mueve la fecha
    if (p.live_end && new Date(p.live_end) > new Date(nx.getTime() + 864e5)) { await sb.from('auto_renew').update({ next_charge_at: p.live_end, fail_count: 0 }).eq('user_id', a.user_id); continue; }
    // Nunca cobrar dos veces: si hay un cobro de Whop de los últimos 3 días que no falló, se espera al aviso de Whop
    const rec = await sb.from('cart_orders').select('id').eq('user_id', a.user_id).not('whop_payment_id', 'is', null).neq('status', 'error').gte('created_at', new Date(now - 3 * 864e5).toISOString()).limit(1);
    if (rec.data && rec.data.length) continue;
    await sb.from('auto_renew').update({ last_try_at: now.toISOString() }).eq('user_id', a.user_id);
    let r; try { r = await charge(h, a, false); } catch (e) { r = { ok: false, error: String(e.message || e) }; }
    if (r.ok) { out.charged++; await sb.from('auto_renew').update({ fail_count: 0, last_error: null, last_charge_at: now.toISOString() }).eq('user_id', a.user_id); continue; }
    out.failed++;
    const fc = (a.fail_count || 0) + 1, off = fc >= MAX_FAILS;
    await sb.from('auto_renew').update({ fail_count: fc, last_error: r.error, active: !off }).eq('user_id', a.user_id);
    await mail(p.email, off ? 'No pudimos renovar tu plan' : 'No pudimos cobrar tu renovación',
      '<p>' + name + ', intentamos cobrar <b>$' + amt + ' USD</b> para renovar ' + what + ', pero tu banco no lo aprobó.</p>' +
      (off ? '<p>Apagamos la renovación automática. Puedes renovar cuando quieras desde tu panel.</p>' : '<p>Lo intentaremos de nuevo en 2 días. Si quieres, puedes renovar ahora con otra tarjeta desde tu panel.</p>') +
      btn('Renovar desde mi panel', SITE + '/app/sesiones'));
  }
  // Cuotas de los planes de pago (api/_payplan.js)
  try { Object.assign(out, await require('./_payplan').cron(h)); } catch (e) { out.pp_error = String(e.message || e).slice(0, 200); }
  return res.status(200).json(Object.assign({ ok: true }, out));
}

// Admin: cobro de prueba de $1 a una cuenta (por correo) con su tarjeta guardada
async function adminTest(h, user, body, res) {
  const me = await h.sb.from('profiles').select('role').eq('id', user.id).single();
  if (!me.data || me.data.role !== 'admin') return res.status(403).json({ error: 'admin_only' });
  const em = String(body.email || '').trim().toLowerCase();
  const pr = await h.sb.from('profiles').select('id').ilike('email', em).maybeSingle();
  if (!pr.data) return res.status(404).json({ error: 'no_user' });
  const a = (await h.sb.from('auto_renew').select('*').eq('user_id', pr.data.id).maybeSingle()).data;
  if (!a) return res.status(404).json({ error: 'no_card' });
  let r; try { r = await charge(h, a, true); } catch (e) { r = { ok: false, error: String(e.message || e) }; }
  return res.status(200).json(r);
}

module.exports = { cron, adminTest };
