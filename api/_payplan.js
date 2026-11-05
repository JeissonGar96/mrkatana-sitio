// api/_payplan.js (con guion bajo = no cuenta como función de Vercel; lo llaman api/cart.js, el webhook y el cron)
// Planes de pago por cuotas que arma el closer en Admin → Planes de pago.
//
//   1. El closer crea el plan: programa, total, cuotas con fecha y desde qué cuota se da el acceso. Sale un link.
//   2. El cliente abre el link (/checkout?pp=CODIGO), crea su cuenta o inicia sesión y paga la cuota 1 con tarjeta (Whop).
//      El link queda ligado a esa cuenta: nadie más lo puede usar.
//   3. Las demás cuotas se cobran solas con la tarjeta guardada en su fecha (cron diario), con aviso 5 días antes.
//      Si un cobro falla se reintenta a los 2 días; tras 3 intentos el plan queda "atrasado" y el admin decide.
//   4. Al pagar la cuota elegida (access_from) se activa el programa completo, igual que una compra normal.

const crypto = require('crypto');
const SITE = 'https://www.mrkatanafx.com';
const MAX_FAILS = 3;

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function fdate(d) { return new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Guayaquil' }); }
const money = n => '$' + (Math.round(Number(n) * 100) / 100).toLocaleString('en-US');
const r2 = n => Math.round(Number(n) * 100) / 100;

async function mail(to, subject, html) {
  if (!process.env.RESEND_API_KEY || !to) return false;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Mr Katana FX <noreply@mrkatanafx.com>', to: [to], subject,
      html: '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#222;line-height:1.55">' + html + '</div>' })
  }).catch(() => null);
  return !!(r && r.ok);
}
const btn = (t, href) => '<p><a href="' + href + '" style="display:inline-block;background:#c9a646;color:#111;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">' + t + '</a></p>';

function digId(o, re, d) {
  if (!o || typeof o !== 'object' || d > 5) return '';
  for (const k of Object.keys(o)) { const v = o[k]; if (typeof v === 'string' && re.test(v)) return v; }
  for (const k of Object.keys(o)) { const v = digId(o[k], re, (d || 0) + 1); if (v) return v; }
  return '';
}

// Admin siempre; staff (closers) si tiene el permiso "Planes de pago" en Admin → Planes → Permisos de Staff
async function isStaff(sb, user) {
  const me = await sb.from('profiles').select('role').eq('id', user.id).single();
  const role = me.data && me.data.role;
  if (role === 'admin') return true;
  if (role !== 'staff') return false;
  const sp = await sb.from('staff_permissions').select('access_payplans').eq('id', 1).maybeSingle();
  return !!(sp.data && sp.data.access_payplans);
}

// ── Público: lo que muestra el checkout al abrir el link ──
async function get(sb, body, res) {
  const code = String(body.code || '').trim();
  if (!/^[A-Za-z0-9]{6,16}$/.test(code)) return res.status(400).json({ error: 'pp_bad' });
  const q = await sb.from('pay_plans').select('*').eq('code', code).maybeSingle();
  const pp = q.data;
  if (!pp || pp.status === 'canceled') return res.status(404).json({ error: 'pp_not_found' });
  const pl = (await sb.from('checkout_plans').select('id, name, description, category, access_clases, duration_clases_months, duration_live_months, access_1on1, sessions_1on1, extra_1on1').eq('id', pp.plan_id).maybeSingle()).data;
  return res.status(200).json({
    code: pp.code, plan: pl || { id: pp.plan_id, name: pp.plan_id }, client_name: pp.client_name || '',
    installments: pp.installments, total: Number(pp.total), access_from: pp.access_from,
    used: pp.paid_count > 0, owner: pp.user_id || null
  });
}

// ── Admin/staff ──
async function admin(sb, user, body, res) {
  if (!(await isStaff(sb, user))) return res.status(403).json({ error: 'staff_only' });
  const a = body.action;
  if (a === 'pp_list') {
    const q = await sb.from('pay_plans').select('*').order('created_at', { ascending: false }).limit(300);
    const rows = q.data || [];
    const uids = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
    const pr = uids.length ? ((await sb.from('profiles').select('id, email, full_name').in('id', uids)).data || []) : [];
    const who = {}; pr.forEach(p => { who[p.id] = p; });
    const pl = (await sb.from('checkout_plans').select('id, name, price')).data || [];
    return res.status(200).json({ plans: rows.map(r => Object.assign({}, r, { profile: who[r.user_id] || null })), programs: pl });
  }
  if (a === 'pp_create') {
    const plan = (await sb.from('checkout_plans').select('id, name').eq('id', String(body.plan_id || '')).maybeSingle()).data;
    if (!plan) return res.status(400).json({ error: 'pp_plan' });
    const raw = Array.isArray(body.installments) ? body.installments : [];
    if (raw.length < 1 || raw.length > 24) return res.status(400).json({ error: 'pp_count' });
    const today = new Date().toISOString().slice(0, 10);
    let prev = today;
    const inst = [];
    for (let i = 0; i < raw.length; i++) {
      const amount = r2(raw[i].amount);
      if (!(amount >= 1)) return res.status(400).json({ error: 'pp_amount' });
      let due = null;
      if (i > 0) {
        due = String(raw[i].due || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || due <= prev) return res.status(400).json({ error: 'pp_dates' });
        prev = due;
      }
      inst.push({ n: i + 1, amount, due });
    }
    const af = Math.max(1, Math.min(inst.length, parseInt(body.access_from, 10) || inst.length));
    const total = r2(inst.reduce((s, i) => s + i.amount, 0));
    let code = '';
    for (let t = 0; t < 5 && !code; t++) {
      const c = crypto.randomBytes(8).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
      const ex = await sb.from('pay_plans').select('id').eq('code', c).maybeSingle();
      if (c.length === 8 && !ex.data) code = c;
    }
    if (!code) return res.status(500).json({ error: 'pp_code' });
    const ins = await sb.from('pay_plans').insert({
      code, plan_id: plan.id, client_name: String(body.client_name || '').trim().slice(0, 80) || null,
      total, installments: inst, access_from: af, created_by: user.id
    }).select('*').single();
    if (ins.error) return res.status(500).json({ error: ins.error.message });
    return res.status(200).json({ ok: true, plan: ins.data });
  }
  const id = String(body.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'pp_bad' });
  const pp = (await sb.from('pay_plans').select('*').eq('id', id).maybeSingle()).data;
  if (!pp) return res.status(404).json({ error: 'pp_not_found' });
  if (a === 'pp_cancel') {
    await sb.from('pay_plans').update({ status: 'canceled', next_due: null, updated_at: new Date().toISOString() }).eq('id', id);
    return res.status(200).json({ ok: true });
  }
  if (a === 'pp_resume') {
    // Reactiva los cobros de un plan atrasado (ej. el alumno cambió de tarjeta)
    if (pp.status !== 'late') return res.status(400).json({ error: 'pp_state' });
    await sb.from('pay_plans').update({ status: 'active', fail_count: 0, last_try_at: null, last_error: null, updated_at: new Date().toISOString() }).eq('id', id);
    return res.status(200).json({ ok: true });
  }
  if (a === 'pp_date') {
    // Cambiar la fecha de una cuota que aún no se cobra
    const n = parseInt(body.n, 10), due = String(body.due || '').slice(0, 10);
    const inst = (pp.installments || []).map(x => Object.assign({}, x));
    const it = inst.find(x => x.n === n);
    if (!it || n <= pp.paid_count || n === 1 || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return res.status(400).json({ error: 'pp_dates' });
    if (due < new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: 'pp_dates' });
    it.due = due;
    for (let i = 1; i < inst.length; i++) if (inst[i].due && inst[i - 1].due && inst[i].due <= inst[i - 1].due) return res.status(400).json({ error: 'pp_dates' });
    const upd = { installments: inst, updated_at: new Date().toISOString() };
    if (n === pp.paid_count + 1 && pp.status !== 'waiting') { upd.next_due = due + 'T15:00:00.000Z'; upd.reminded_for = null; }
    await sb.from('pay_plans').update(upd).eq('id', id);
    return res.status(200).json({ ok: true });
  }
  return res.status(400).json({ error: 'bad_action' });
}

// ── Alumno: su plan en Ajustes → Membresía ──
async function mine(sb, user, res) {
  const q = await sb.from('pay_plans').select('id, plan_id, total, installments, paid_count, paid_total, next_due, status, access_from, access_given').eq('user_id', user.id).neq('status', 'canceled').order('created_at', { ascending: false }).limit(3);
  const pl = (await sb.from('checkout_plans').select('id, name')).data || [];
  const nm = {}; pl.forEach(p => { nm[p.id] = p.name; });
  return res.status(200).json({ plans: (q.data || []).map(p => Object.assign({}, p, { plan_name: nm[p.plan_id] || p.plan_id })) });
}

// ── Pedido de la cuota 1 (lo llama whopCreate cuando el checkout trae ?pp=) ──
async function firstOrder(sb, user, code) {
  const pp = (await sb.from('pay_plans').select('*').eq('code', String(code || '')).maybeSingle()).data;
  if (!pp || pp.status === 'canceled') return { error: 'pp_not_found' };
  if (pp.paid_count > 0 || (pp.user_id && pp.user_id !== user.id)) return { error: 'pp_used' };
  const plan = (await sb.from('checkout_plans').select('name').eq('id', pp.plan_id).maybeSingle()).data || {};
  const first = (pp.installments || [])[0];
  if (!first) return { error: 'pp_bad' };
  const n = (pp.installments || []).length;
  const items = [{ plan_id: pp.plan_id, name: (plan.name || 'Plan') + ' · Cuota 1 de ' + n, price: Number(first.amount), pay_plan: true }];
  const ins = await sb.from('cart_orders').insert({ user_id: user.id, provider: 'whop', items, total: Number(first.amount), renew: null, pay_plan_id: pp.id, pp_n: 1 }).select('id').single();
  if (ins.error) return { error: ins.error.message };
  return { order: ins.data.id, total: Number(first.amount) };
}

// ── Webhook: una cuota quedó pagada ──
// h = { applyItems, priceItems }. Devuelve el resultado que se guarda en el pedido.
async function paid(sb, h, ord, pay) {
  const pp = (await sb.from('pay_plans').select('*').eq('id', ord.pay_plan_id).maybeSingle()).data;
  if (!pp) return { lines: [{ name: 'Cuota', text: 'Pago recibido' }], errors: ['pp_not_found'] };
  const inst = pp.installments || [], n = ord.pp_n || 1, N = inst.length;
  // Cada cuota se cuenta una sola vez y en orden
  if (n !== pp.paid_count + 1) return { lines: [{ name: 'Cuota ' + n, text: 'Pago recibido' }], errors: [], already: true };
  const now = new Date().toISOString();
  const nx = inst[n] ? inst[n].due + 'T15:00:00.000Z' : null;
  const upd = {
    paid_count: n, paid_total: r2(Number(pp.paid_total) + Number(ord.total)), user_id: pp.user_id || ord.user_id,
    status: n >= N ? 'done' : 'active', next_due: nx, fail_count: 0, last_error: null, last_try_at: null, reminded_for: null, updated_at: now
  };
  const pm = pay.payment_method_id || (pay.payment_method && pay.payment_method.id) || digId(pay, /^payt_[A-Za-z0-9]+$/, 0);
  const mb = (pay.member && pay.member.id) || pay.member_id || digId(pay, /^mber_[A-Za-z0-9]+$/, 0);
  if (pm) upd.whop_payment_method_id = pm;
  if (mb) upd.whop_member_id = mb;
  // El pedido de la cuota no da acceso; el acceso se da una vez, al llegar a la cuota elegida
  const out = { lines: [{ name: 'Cuota ' + n + ' de ' + N, text: 'Pagado ' + money(upd.paid_total) + ' de ' + money(pp.total) + (nx ? '. Próxima cuota el ' + fdate(nx) : '. Plan completo') }], errors: [], total: ord.total };
  const claim = await sb.from('pay_plans').update(upd).eq('id', pp.id).eq('paid_count', pp.paid_count).select('id');
  if (!claim.data || !claim.data.length) return Object.assign(out, { already: true });
  if (!pp.access_given && n >= pp.access_from) {
    const lock = await sb.from('pay_plans').update({ access_given: true }).eq('id', pp.id).eq('access_given', false).select('id');
    if (lock.data && lock.data.length) {
      try {
        const items = await h.priceItems(sb, [{ plan_id: pp.plan_id }], true);
        // Se registra la compra por el total del plan (lo que el alumno termina pagando)
        const sum = items.reduce((s, i) => s + i.price, 0) || 1;
        items.forEach(i => { i.price = r2(i.price * Number(pp.total) / sum); });
        const res = await h.applyItems(sb, { id: ord.user_id }, { id: ord.id, provider: 'whop', items, total: Number(pp.total) }, null);
        out.lines = out.lines.concat(res.lines || []); out.errors = out.errors.concat(res.errors || []);
        out.access = true;
      } catch (e) {
        await sb.from('pay_plans').update({ access_given: false }).eq('id', pp.id);
        out.errors.push('pp_access:' + (e.message || e));
      }
    }
  }
  return out;
}

// ── Cron diario: avisos y cobro de las cuotas que tocan ──
// h = { sb, whopFetch, WHOP_COMPANY, WHOP_PRODUCT }
async function cron(h) {
  const sb = h.sb, now = new Date(), out = { pp_reminded: 0, pp_charged: 0, pp_failed: 0 };
  const rows = (await sb.from('pay_plans').select('*').eq('status', 'active').not('next_due', 'is', null)).data || [];
  const ids = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
  const pr = ids.length ? ((await sb.from('profiles').select('id, email, full_name').in('id', ids)).data || []) : [];
  const who = {}; pr.forEach(p => { who[p.id] = p; });
  const pl = (await sb.from('checkout_plans').select('id, name')).data || [];
  const pnm = {}; pl.forEach(p => { pnm[p.id] = p.name; });
  for (const pp of rows) {
    const p = who[pp.user_id] || {}, nx = new Date(pp.next_due), name = esc(String(p.full_name || '').split(' ')[0] || 'Hola');
    const n = pp.paid_count + 1, N = (pp.installments || []).length, it = (pp.installments || [])[n - 1];
    if (!it) continue;
    const prog = esc(pnm[pp.plan_id] || 'tu programa');
    // Aviso 5 días antes
    const daysTo = (nx - now) / 864e5;
    if (daysTo > 0 && daysTo <= 5 && String(pp.reminded_for || '') !== String(pp.next_due)) {
      const ok = await mail(p.email, 'Tu cuota ' + n + ' de ' + N + ' es el ' + fdate(nx),
        '<p>' + name + ', el <b>' + fdate(nx) + '</b> se cobra la cuota ' + n + ' de ' + N + ' de ' + prog + ' por <b>' + money(it.amount) + ' USD</b> con tu tarjeta guardada.</p>' +
        '<p>No tienes que hacer nada. Si quieres usar otra tarjeta, cámbiala en Ajustes, Membresía y pagos.</p>' + btn('Ver mi membresía', SITE + '/app/perfil'));
      if (ok) { out.pp_reminded++; await sb.from('pay_plans').update({ reminded_for: pp.next_due }).eq('id', pp.id); }
    }
    if (nx > now) continue;
    if (pp.last_try_at && now - new Date(pp.last_try_at) < 47 * 3600e3) continue;
    // Nunca cobrar dos veces la misma cuota: si ya hay un cobro de esta cuota que no falló, se espera al aviso de Whop
    const rec = await sb.from('cart_orders').select('id').eq('pay_plan_id', pp.id).eq('pp_n', n).not('whop_payment_id', 'is', null).neq('status', 'error').limit(1);
    if (rec.data && rec.data.length) continue;
    await sb.from('pay_plans').update({ last_try_at: now.toISOString() }).eq('id', pp.id);
    let r; try { r = await charge(h, pp, n, N, pnm[pp.plan_id]); } catch (e) { r = { ok: false, error: String(e.message || e) }; }
    if (r.ok) { out.pp_charged++; continue; }
    out.pp_failed++;
    const fc = (pp.fail_count || 0) + 1, late = fc >= MAX_FAILS;
    await sb.from('pay_plans').update({ fail_count: fc, last_error: r.error, status: late ? 'late' : 'active', updated_at: now.toISOString() }).eq('id', pp.id);
    await mail(p.email, 'No pudimos cobrar tu cuota ' + n + ' de ' + N,
      '<p>' + name + ', intentamos cobrar <b>' + money(it.amount) + ' USD</b> (cuota ' + n + ' de ' + N + ' de ' + prog + '), pero tu banco no lo aprobó.</p>' +
      (late ? '<p>Escríbenos por WhatsApp para ponernos al día con tu plan de pago.</p>' : '<p>Lo intentaremos de nuevo en 2 días. Si quieres usar otra tarjeta, cámbiala en Ajustes, Membresía y pagos.</p>') +
      btn('Ver mi membresía', SITE + '/app/perfil'));
  }
  return out;
}

async function charge(h, pp, n, N, planName) {
  // La tarjeta: la del plan, o la que el alumno cambió en Ajustes (auto_renew)
  const ar = (await h.sb.from('auto_renew').select('whop_payment_method_id, whop_member_id').eq('user_id', pp.user_id).maybeSingle()).data || {};
  const pm = ar.whop_payment_method_id || pp.whop_payment_method_id, mid = pp.whop_member_id || ar.whop_member_id;
  if (!pm) return { ok: false, error: 'no_card' };
  if (!mid) return { ok: false, error: 'no_member' };
  const amount = Number(pp.installments[n - 1].amount);
  const items = [{ plan_id: pp.plan_id, name: (planName || 'Plan') + ' · Cuota ' + n + ' de ' + N, price: amount, pay_plan: true }];
  const ins = await h.sb.from('cart_orders').insert({ user_id: pp.user_id, provider: 'whop', items, total: amount, renew: null, pay_plan_id: pp.id, pp_n: n }).select('id').single();
  if (ins.error) return { ok: false, error: ins.error.message };
  const p = await h.whopFetch('/payments', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'mk-pp-' + pp.id + '-' + n + '-' + (pp.fail_count || 0) },
    body: JSON.stringify({
      account_id: h.WHOP_COMPANY, member_id: mid, payment_method_id: pm, off_session: true,
      variant: { product_id: h.WHOP_PRODUCT, currency: 'usd', billing_type: 'one_time', initial_price: amount, visibility: 'hidden',
        title: ('Cuota ' + n + ' de ' + N + ' Mr Katana').slice(0, 30) },
      metadata: { order_id: ins.data.id, user_id: pp.user_id, pay_plan: pp.id }
    })
  });
  const d = p.data || {};
  if (d.id) await h.sb.from('cart_orders').update({ whop_payment_id: d.id }).eq('id', ins.data.id);
  const st = String(d.status || '') + ' ' + String(d.substatus || '');
  if (!p.ok || /fail|void|uncollectible|declin/i.test(st) || d.failure_message) {
    await h.sb.from('cart_orders').update({ status: 'error', result: { whop: st.trim() || p.status, failure: d.failure_message || d.message || null } }).eq('id', ins.data.id);
    return { ok: false, error: String(d.failure_message || d.message || (d.error && d.error.message) || d.error || ('http_' + p.status)).slice(0, 200) };
  }
  return { ok: true, order: ins.data.id };
}

module.exports = { get, admin, mine, firstOrder, paid, cron };
