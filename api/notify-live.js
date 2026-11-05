// api/notify-live.js
// Avisa a los alumnos cuando un en vivo se enciende (is_active = true):
//   - notificación al celular/computador (Web Push) a quien la tenga activada
//   - email (solo si RESEND_API_KEY está configurada en Vercel)
// Lo llama la app al encender el en vivo y también Supabase (trigger) como respaldo.
// No necesita clave: solo avisa si el en vivo de verdad está encendido, y una sola
// vez por encendido (columna notified_at), así que llamarlo de más no hace nada.
// La llave privada de avisos vive en Vercel (VAPID_PRIVATE_KEY).

const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');
const M = require('./_mail');

const SB_URL = 'https://rxyezbyvwqwihggechsc.supabase.co';
const VAPID_PUBLIC = 'BFq0c3NiHS9LLzjgZJImePJ7dXBAvG-EYgRF8v8tI4jWfwdVLEDI7BetU4bfVhs9fhKZQ88nAVsmq9ZhyXh18oc';
const SITE = 'https://www.mrkatanafx.com';

module.exports = async function handler(req, res) {
  try {
    if (req.query && req.query.weekly === '1') return await weekly(req, res);
    if (req.query && req.query.launch === '1') return await launchMail(req, res);
    // Notificaciones de la app (campana): tick cada 5 min y envío de pendientes
    if (req.query && (req.query.tick === '1' || req.query.push === '1')) return res.status(200).json(await require('./_notif').run(req));
    if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
    if (!process.env.SUPABASE_SERVICE_KEY) return res.status(500).json({ error: 'missing_service_key' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const id = body.id || (body.record && body.record.id);
    if (!id) return res.status(400).json({ error: 'no_id' });

    const sb = createClient(SB_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

    // Reclama el aviso: solo pasa si está encendido y no se avisó en las últimas 6 horas
    const cut = new Date(Date.now() - 6 * 3600e3).toISOString();
    const claim = await sb.from('live_sessions').update({ notified_at: new Date().toISOString() })
      .eq('id', id).eq('is_active', true).or('notified_at.is.null,notified_at.lt.' + cut)
      .select('id, title');
    if (claim.error) return res.status(500).json({ error: claim.error.message });
    if (!claim.data || !claim.data.length) return res.status(200).json({ ok: true, skipped: true });
    const live = claim.data[0];

    // Alumnos con en vivo activo (y el equipo)
    const now = new Date().toISOString();
    const pr = await sb.from('profiles').select('id, email, full_name, role, live_end')
      .or('live_end.gt.' + now + ',role.eq.admin');
    const people = pr.data || [];
    if (!people.length) return res.status(200).json({ ok: true, push: 0, email: 0 });
    const ids = people.map(p => p.id);

    const st = await sb.from('user_settings').select('id, notify_live_push, notify_live_email').in('id', ids);
    const set = {}; (st.data || []).forEach(s => { set[s.id] = s; });
    const wantPush = p => !set[p.id] || set[p.id].notify_live_push !== false;
    const wantMail = p => !set[p.id] || set[p.id].notify_live_email !== false;

    const title = live.title || 'En vivo';
    let pushSent = 0, mailSent = 0;

    // Web Push
    if (process.env.VAPID_PRIVATE_KEY) {
      webpush.setVapidDetails('mailto:soporte@mrkatanafx.com', VAPID_PUBLIC, process.env.VAPID_PRIVATE_KEY.trim());
      const pushIds = people.filter(wantPush).map(p => p.id);
      const subs = pushIds.length ? ((await sb.from('push_subscriptions').select('id, endpoint, p256dh, auth').in('user_id', pushIds)).data || []) : [];
      const msg = JSON.stringify({ title: 'Mr Katana · En vivo ahora', body: title + '. Entra ahora desde la plataforma.', url: '/app/sesiones', tag: 'live-' + live.id });
      await Promise.all(subs.map(s => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, msg, { TTL: 3600 })
        .then(() => { pushSent++; })
        .catch(e => { if (e.statusCode === 404 || e.statusCode === 410) return sb.from('push_subscriptions').delete().eq('id', s.id); })));

      // Cuentas sin en vivo pagado: mismo aviso, invitando a comprar el acceso
      const paid = new Set(ids);
      const allSubs = (await sb.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth')).data || [];
      const freeSubs = allSubs.filter(s => !paid.has(s.user_id));
      const fIds = [...new Set(freeSubs.map(s => s.user_id))];
      if (fIds.length) {
        const fs = (await sb.from('user_settings').select('id, notify_live_push').in('id', fIds)).data || [];
        const off = new Set(fs.filter(x => x.notify_live_push === false).map(x => x.id));
        const team = new Set(((await sb.from('profiles').select('id, role').in('id', fIds)).data || []).filter(x => x.role === 'staff' || x.role === 'admin').map(x => x.id));
        const fmsg = JSON.stringify({ title: 'Mr Katana está en vivo ahora', body: title + '. Únete con la Mentoría o el acceso a los en vivo para entrar.', url: '/app/sesiones', tag: 'live-' + live.id });
        await Promise.all(freeSubs.filter(s => !off.has(s.user_id) && !team.has(s.user_id)).map(s => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, fmsg, { TTL: 3600 })
          .then(() => { pushSent++; })
          .catch(e => { if (e.statusCode === 404 || e.statusCode === 410) return sb.from('push_subscriptions').delete().eq('id', s.id); })));
      }
    }

    // Email (Resend)
    if (process.env.RESEND_API_KEY) {
      const from = process.env.MAIL_FROM || 'Mr Katana FX <noreply@mrkatanafx.com>';
      const mails = people.filter(p => wantMail(p) && p.email).map(p => ({
        from, to: [p.email], subject: 'En vivo ahora: ' + title,
        html: M.page({ art: 'live', eyebrow: 'En vivo ahora', title: esc(title), sub: 'Acaba de empezar. Entra desde tu panel.',
          body: M.p('Hola ' + esc((p.full_name || '').split(' ')[0] || '') + ', ya estamos operando en vivo. Entra ahora y sigue la sesión desde la plataforma, sin otros links.', true),
          cta: 'Entrar al en vivo', url: SITE + '/app/sesiones' })
      }));
      for (let i = 0; i < mails.length; i += 100) {
        const r = await fetch('https://api.resend.com/emails/batch', {
          method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify(mails.slice(i, i + 100))
        });
        if (r.ok) mailSent += mails.slice(i, i + 100).length;
      }
    }

    return res.status(200).json({ ok: true, push: pushSent, email: mailSent });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};

// Correo semanal (sábado 18:00 Ecuador, cron de Vercel) a quienes no tienen en vivo pagado: lo que se perdieron.
// Solo corre con la clave CRON_SECRET (Vercel la manda sola en el cron) y una vez por semana.
async function weekly(req, res) {
  const key = process.env.CRON_SECRET;
  if (!key || req.headers.authorization !== 'Bearer ' + key) return res.status(401).json({ error: 'auth' });
  if (!process.env.SUPABASE_SERVICE_KEY || !process.env.RESEND_API_KEY) return res.status(500).json({ error: 'missing_keys' });
  const sb = createClient(SB_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const wk = new Date().toISOString().slice(0, 10);
  const prev = await sb.from('site_settings').select('theme').eq('id', 3).maybeSingle();
  const last = prev.data && prev.data.theme && prev.data.theme.weekly_sent;
  if (last && Date.now() - new Date(last).getTime() < 5 * 864e5) return res.status(200).json({ ok: true, skipped: 'already' });
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const ls = (await sb.from('live_sessions').select('title, scheduled_at, notified_at').or('scheduled_at.gte.' + since + ',notified_at.gte.' + since)).data || [];
  const lives = ls.filter(x => (x.notified_at && x.notified_at >= since) || (x.scheduled_at && x.scheduled_at >= since && x.scheduled_at <= new Date().toISOString()));
  if (!lives.length) return res.status(200).json({ ok: true, skipped: 'no_lives' });
  await sb.from('site_settings').upsert({ id: 3, theme: { weekly_sent: new Date().toISOString() }, updated_at: new Date().toISOString() });
  const now = new Date().toISOString();
  const pr = (await sb.from('profiles').select('id, email, full_name, role, live_end, avatar_url').not('avatar_url', 'is', null)).data || [];
  const free = pr.filter(p => p.email && p.role !== 'admin' && p.role !== 'staff' && !(p.live_end && p.live_end > now));
  const st = free.length ? ((await sb.from('user_settings').select('id, notify_live_email').in('id', free.map(p => p.id))).data || []) : [];
  const off = new Set(st.filter(x => x.notify_live_email === false).map(x => x.id));
  const n = lives.length;
  const from = process.env.MAIL_FROM || 'Mr Katana FX <noreply@mrkatanafx.com>';
  const mails = free.filter(p => !off.has(p.id)).map(p => ({
    from, to: [p.email], subject: n === 1 ? 'Esta semana hubo 1 en vivo y te lo perdiste' : 'Esta semana hubo ' + n + ' en vivos y te los perdiste',
    html: M.page({ art: 'week', eyebrow: 'Resumen de la semana', title: n === 1 ? 'Esta semana hubo<br>1 en vivo' : 'Esta semana hubo<br>' + n + ' en vivos', sub: 'Esto es lo que operamos en directo.',
      body: M.p('Hola ' + esc((p.full_name || '').split(' ')[0] || '') + ', esta semana operamos en vivo ' + (n === 1 ? '1 vez' : n + ' veces') + ':') + M.bl(lives.slice(0, 6).map(x => esc(x.title || 'Sesión en vivo'))) +
        M.p('Para entrar a los próximos, únete con la Mentoría o compra el acceso a los en vivo.'),
      cta: 'Ver opciones', url: SITE + '/app/sesiones' })
  }));
  let sent = 0;
  for (let i = 0; i < mails.length; i += 100) {
    const r = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(mails.slice(i, i + 100))
    });
    if (r.ok) sent += mails.slice(i, i + 100).length;
  }
  return res.status(200).json({ ok: true, lives: n, email: sent, week: wk });
}

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// Correo de lanzamiento (Admin > Avisos). Solo admin. test=true: solo al admin. Envío a todos: una sola vez (site_settings id 5).
async function launchMail(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (!process.env.SUPABASE_SERVICE_KEY || !process.env.RESEND_API_KEY) return res.status(500).json({ error: 'missing_keys' });
  const sb = createClient(SB_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const tok = String(req.headers.authorization || '').replace(/^Bearer /, '');
  const u = tok ? (await sb.auth.getUser(tok)).data : null;
  if (!u || !u.user) return res.status(401).json({ error: 'auth' });
  const me = (await sb.from('profiles').select('role, email').eq('id', u.user.id).maybeSingle()).data;
  if (!me || me.role !== 'admin') return res.status(403).json({ error: 'admin' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const from = process.env.MAIL_FROM || 'Mr Katana FX <noreply@mrkatanafx.com>';
  const subject = 'Ya abrimos tu nueva plataforma de trading';
  const html = M.launch('users');
  const send = async list => {
    let sent = 0;
    for (let i = 0; i < list.length; i += 100) {
      const batch = list.slice(i, i + 100).map(to => ({ from, to: [to], subject, html }));
      const r = await fetch('https://api.resend.com/emails/batch', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY.trim(), 'Content-Type': 'application/json' }, body: JSON.stringify(batch) }).catch(() => null);
      if (r && r.ok) sent += batch.length;
    }
    return sent;
  };
  if (body.test) return res.status(200).json({ ok: true, test: true, sent: await send([u.user.email || me.email].filter(Boolean)) });
  const prev = (await sb.from('site_settings').select('theme').eq('id', 5).maybeSingle()).data;
  if (prev && prev.theme && prev.theme.launch_sent) return res.status(200).json({ ok: true, skipped: 'already', at: prev.theme.launch_sent });
  await sb.from('site_settings').upsert({ id: 5, theme: { launch_sent: new Date().toISOString() }, updated_at: new Date().toISOString() });
  const pr = (await sb.from('profiles').select('email, role')).data || [];
  const list = [...new Set(pr.filter(p => p.email && p.role !== 'admin' && p.role !== 'staff').map(p => p.email.trim().toLowerCase()))];
  return res.status(200).json({ ok: true, total: list.length, sent: await send(list) });
}
