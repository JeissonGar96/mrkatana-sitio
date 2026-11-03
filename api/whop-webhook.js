// api/whop-webhook.js
// Whop avisa aquí cuando se completa un pago con tarjeta (evento payment.succeeded).
// Se busca el pedido por metadata.order_id (lo pone /api/cart al crear el pago), se confirma
// el pago preguntando a Whop y se activa lo comprado con la misma función que usa PayPal.
// Si el alumno dejó marcada la renovación automática, se guarda en auto_renew para cobrarla después.
// Variables en Vercel: WHOP_WEBHOOK_SECRET (empieza con ws_), WHOP_API_KEY, SUPABASE_SERVICE_KEY.

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { applyItems } = require('./cart');

const SB_URL = 'https://rxyezbyvwqwihggechsc.supabase.co';
const WHOP_API = 'https://api.whop.com/api/v1';

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Firma estilo "Standard Webhooks": HMAC-SHA256 de "id.timestamp.cuerpo", en base64.
// Whop dice usar el secreto tal cual (con su prefijo ws_); por si acaso se prueba también decodificado.
function validSignature(secret, id, ts, body, header) {
  if (!secret || !id || !ts || !header) return false;
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!isFinite(age) || age > 5 * 60) return false;
  const keys = [Buffer.from(secret, 'utf8')];
  const bare = secret.replace(/^(ws_|whsec_)/, '');
  if (/^[A-Za-z0-9+/=]+$/.test(bare)) keys.push(Buffer.from(bare, 'base64'));
  const sigs = String(header).split(' ').map(p => Buffer.from(p.split(',')[1] || '', 'base64'));
  return keys.some(k => {
    const expected = crypto.createHmac('sha256', k).update(`${id}.${ts}.${body}`).digest();
    return sigs.some(sig => sig.length === expected.length && crypto.timingSafeEqual(sig, expected));
  });
}

const pick = (o, keys) => { for (const k of keys) { if (o && o[k] != null) return o[k]; } return null; };

async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
    const raw = await readRaw(req);
    if (!validSignature(process.env.WHOP_WEBHOOK_SECRET, req.headers['webhook-id'],
      req.headers['webhook-timestamp'], raw, req.headers['webhook-signature'])) {
      return res.status(401).json({ error: 'bad_signature' });
    }
    const ev = JSON.parse(raw || '{}');
    if (ev.type !== 'payment.succeeded') return res.status(200).json({ ok: true, ignored: ev.type || null });
    if (!process.env.SUPABASE_SERVICE_KEY) return res.status(500).json({ error: 'missing_service_key' });
    const sb = createClient(SB_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

    let pay = ev.data || {};
    // Se confirma con Whop (no basta con lo que llega en el aviso)
    if (process.env.WHOP_API_KEY && pay.id) {
      const r = await fetch(WHOP_API + '/payments/' + encodeURIComponent(pay.id), { headers: { Authorization: 'Bearer ' + process.env.WHOP_API_KEY } });
      if (r.ok) { try { pay = Object.assign({}, pay, await r.json()); } catch (e) {} }
    }
    const meta = pay.metadata || {};
    const orderId = String(meta.order_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(orderId)) return res.status(200).json({ ok: true, ignored: 'no_order' });

    const q = await sb.from('cart_orders').select('*').eq('id', orderId).maybeSingle();
    const ord = q.data;
    if (!ord || ord.provider !== 'whop') return res.status(200).json({ ok: true, ignored: 'order_not_found' });
    if (ord.status !== 'pending') return res.status(200).json({ ok: true, already: true });

    const st = String(pick(pay, ['status', 'substatus']) || '').toLowerCase();
    const amount = Number(pick(pay, ['total', 'final_amount', 'subtotal', 'amount']));
    const badStatus = st && !/paid|succeeded|success|complete/.test(st);
    const badAmount = isFinite(amount) && amount > 0 && amount + 0.01 < Number(ord.total);
    if (badStatus || badAmount || (meta.user_id && meta.user_id !== ord.user_id)) {
      await sb.from('cart_orders').update({ status: 'error', result: { whop: st || 'check', amount: isFinite(amount) ? amount : null, payment: pay.id || null } }).eq('id', ord.id);
      return res.status(200).json({ ok: false, error: 'payment_mismatch' });
    }

    // Marca como pagado una sola vez (Whop puede repetir el aviso)
    const claim = await sb.from('cart_orders').update({ status: 'paid', paid_at: new Date().toISOString(), whop_payment_id: pay.id || null })
      .eq('id', ord.id).eq('status', 'pending').select('id');
    if (!claim.data || !claim.data.length) return res.status(200).json({ ok: true, already: true });

    const email = pick(pay.user || {}, ['email']) || pick(pay.member || {}, ['email']) || null;
    const result = await applyItems(sb, { id: ord.user_id }, ord, email);
    await sb.from('cart_orders').update({ status: result.errors.length ? 'error' : 'applied', result }).eq('id', ord.id);

    // Renovación automática: se guarda la tarjeta de Whop y la fecha del primer cobro (cuando termina el en vivo)
    const rw = ord.renew || {};
    if (rw.live || rw.kairus) {
      const pr = await sb.from('profiles').select('live_end').eq('id', ord.user_id).single();
      await sb.from('auto_renew').upsert({
        user_id: ord.user_id, live: !!rw.live, kairus: !!rw.kairus, active: true,
        whop_member_id: pick(pay.member || {}, ['id']) || pick(pay, ['member_id']) || null,
        whop_user_id: pick(pay.user || {}, ['id']) || pick(pay, ['user_id']) || null,
        whop_payment_method_id: pick(pay, ['payment_method_id']) || pick(pay.payment_method || {}, ['id']) || null,
        next_charge_at: (pr.data && pr.data.live_end) || null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
