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

const SB_URL = 'https://rxyezbyvwqwihggechsc.supabase.co';
const VAPID_PUBLIC = 'BFq0c3NiHS9LLzjgZJImePJ7dXBAvG-EYgRF8v8tI4jWfwdVLEDI7BetU4bfVhs9fhKZQ88nAVsmq9ZhyXh18oc';
const SITE = 'https://mrkatanafx.com';

module.exports = async function handler(req, res) {
  try {
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
    }

    // Email (Resend)
    if (process.env.RESEND_API_KEY) {
      const from = process.env.MAIL_FROM || 'Mr Katana FX <avisos@mrkatanafx.com>';
      const mails = people.filter(p => wantMail(p) && p.email).map(p => ({
        from, to: [p.email], subject: 'En vivo ahora: ' + title,
        html: '<div style="font-family:Arial,sans-serif;font-size:15px;color:#222;line-height:1.5">' +
          '<p>Hola ' + esc((p.full_name || '').split(' ')[0] || '') + ',</p>' +
          '<p>Acaba de empezar el en vivo <b>' + esc(title) + '</b>.</p>' +
          '<p><a href="' + SITE + '/app/sesiones" style="display:inline-block;background:#c9a646;color:#111;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Entrar al en vivo</a></p>' +
          '<p style="color:#888;font-size:12px">Puedes apagar estos avisos en Ajustes, Notificaciones.</p></div>'
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

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
