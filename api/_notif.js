// api/_notif.js
// Notificaciones de la app: las guarda en la tabla notifications (campana) y las manda al celular.
// - add(sb, filas): guarda avisos (no repite gracias a la columna dedupe)
// - run(req): lo llama /api/notify-live?tick=1 cada 5 minutos (Supabase pg_cron) y la app al abrirse.
//   Revisa fechas (1-1 mañana, accesos por vencer), calendario, journal y ranking, y manda al celular
//   lo que todavía no se mandó. Con ?push=1 solo manda lo pendiente (lo usa Admin al enviar un anuncio).
// No necesita clave: todo es idempotente y el tick tiene freno de 3 minutos.

const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');
const M = require('./_mail');

const SB_URL = 'https://rxyezbyvwqwihggechsc.supabase.co';
const VAPID_PUBLIC = 'BFq0c3NiHS9LLzjgZJImePJ7dXBAvG-EYgRF8v8tI4jWfwdVLEDI7BetU4bfVhs9fhKZQ88nAVsmq9ZhyXh18oc';
const SITE = 'https://www.mrkatanafx.com';
const PREF = { class: 'notify_class', mtg: 'notify_mtg', exp: 'notify_pay', pay: 'notify_pay', cal: 'notify_calendar', journal: 'notify_journal', rank: 'notify_rank', news: 'notify_news' };
const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const EC = -5 * 3600e3, MX = -6 * 3600e3; // Ecuador y Ciudad de México (sin horario de verano)

const ymd = (ms, off) => new Date(ms + off).toISOString().slice(0, 10);
function fecha(iso) { // "jueves 6 nov · 4:00 pm" (hora de Ecuador)
  const d = new Date(new Date(iso).getTime() + EC);
  let h = d.getUTCHours(), m = d.getUTCMinutes(), ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
  return DIA[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MES[d.getUTCMonth()].slice(0, 3) + ' · ' + h + ':' + String(m).padStart(2, '0') + ' ' + ap;
}

async function add(sb, rows) {
  rows = [].concat(rows || []).filter(Boolean);
  if (!rows.length) return 0;
  const r = await sb.from('notifications').upsert(rows, { onConflict: 'dedupe', ignoreDuplicates: true });
  if (r.error) console.log('notif add', r.error.message);
  return rows.length;
}

// ¿Quiénes reciben un aviso de grupo? (igual que notif_seg_ok en la base)
function inSeg(p, seg, set) {
  const now = Date.now(), team = p.role === 'admin' || p.role === 'staff';
  const mem = p.membership_end && new Date(p.membership_end + 'T23:59:59Z').getTime() >= now;
  const live = p.live_end && new Date(p.live_end).getTime() > now;
  if (seg === 'all') return true;
  if (seg === 'paid') return team || mem || live;
  if (seg === 'live') return team || live;
  if (seg === 'free') return !team && !mem && !live;
  if (seg === 'course') return team || (p.membership_end && new Date(p.membership_end).getTime() > now);
  if (seg === 'cal') return !(set[p.id] && set[p.id].notify_calendar === false);
  return false;
}
const wants = (set, uid, kind) => {
  const k = PREF[kind], s = set[uid];
  return !s || !k || s[k] !== false;
};

// Manda al celular (y por correo los anuncios que lo piden) lo que aún no se mandó
async function pushPending(sb) {
  const now = new Date().toISOString(), since = new Date(Date.now() - 3 * 3600e3).toISOString();
  const cl = await sb.from('notifications').update({ pushed_at: now }).is('pushed_at', null).gte('created_at', since).select('*');
  const list = (cl.data || []);
  if (!list.length) return { pushed: 0 };
  const people = (await sb.from('profiles').select('id, email, full_name, role, membership_end, live_end')).data || [];
  const set = {}; ((await sb.from('user_settings').select('*')).data || []).forEach(s => { set[s.id] = s; });
  // Varias clases nuevas juntas: un solo aviso
  const cls = list.filter(n => n.kind === 'class'), msgs = [];
  list.filter(n => n.kind !== 'class' || cls.length < 3).forEach(n => msgs.push(n));
  if (cls.length >= 3) msgs.push({ id: 'cls', kind: 'class', segment: 'course', title: cls.length + ' clases nuevas en el curso', body: 'Entra a verlas en el curso.', link: 'clases' });
  const sends = []; // { uid, n }
  const mails = []; // anuncios por correo
  msgs.forEach(n => {
    const ids = n.user_id ? [n.user_id] : people.filter(p => inSeg(p, n.segment, set)).map(p => p.id);
    if (!(n.data && n.data.nopush)) ids.filter(uid => wants(set, uid, n.kind)).forEach(uid => sends.push({ uid, n }));
    if (n.kind === 'news' && n.email && !n.user_id) people.filter(p => p.email && inSeg(p, n.segment, set) && wants(set, p.id, 'news')).forEach(p => mails.push({ p, n }));
  });
  let pushed = 0, mailed = 0;
  if (process.env.VAPID_PRIVATE_KEY && sends.length) {
    webpush.setVapidDetails('mailto:soporte@mrkatanafx.com', VAPID_PUBLIC, process.env.VAPID_PRIVATE_KEY.trim());
    const uids = [...new Set(sends.map(s => s.uid))];
    const subs = (await sb.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', uids)).data || [];
    const byU = {}; subs.forEach(s => { (byU[s.user_id] = byU[s.user_id] || []).push(s); });
    await Promise.all(sends.flatMap(({ uid, n }) => (byU[uid] || []).map(s => {
      const msg = JSON.stringify({ title: n.title, body: n.body || (n.kind === 'mtg' && n.data && n.data.at ? fecha(n.data.at) + ' con Mr Katana' : 'Mr Katana FX'), url: '/app/' + (n.link === 'journal' ? 'herramientas' : (n.link || '')), tag: n.kind + '-' + n.id });
      return webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, msg, { TTL: 3600 })
        .then(() => { pushed++; })
        .catch(e => { if (e.statusCode === 404 || e.statusCode === 410) return sb.from('push_subscriptions').delete().eq('id', s.id); });
    })));
  }
  if (process.env.RESEND_API_KEY && mails.length) {
    const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const html = n => M.page({ art: 'aviso', eyebrow: 'Mr Katana FX', title: esc(n.title), body: '<div style="white-space:pre-line;">' + M.p(esc(n.body)) + '</div>', cta: 'Abrir la plataforma', url: SITE + '/app' });
    for (let i = 0; i < mails.length; i += 100) {
      const batch = mails.slice(i, i + 100).map(({ p, n }) => ({ from: 'Mr Katana FX <noreply@mrkatanafx.com>', to: [p.email], subject: n.title, html: html(n) }));
      const r = await fetch('https://api.resend.com/emails/batch', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY.trim(), 'Content-Type': 'application/json' }, body: JSON.stringify(batch) }).catch(() => null);
      if (r && r.ok) mailed += batch.length;
    }
  }
  return { pushed, mailed, items: list.length };
}

// Reunión 1-1 en las próximas 24 horas
async function mtgSoon(sb) {
  const now = Date.now();
  const r = await sb.from('meetings_1on1').select('id, student_id, scheduled_at, status, created_at')
    .gt('scheduled_at', new Date(now).toISOString()).lte('scheduled_at', ymd(now + 24 * 3600e3, EC) + 'T23:59:59-05:00'); // hasta el fin de mañana (hora Ecuador)
  return add(sb, (r.data || []).filter(m => m.student_id && m.status !== 'cancelled' && new Date(m.created_at).getTime() < now - 2 * 3600e3).map(m => ({
    user_id: m.student_id, kind: 'mtg', link: 'reuniones', data: { at: m.scheduled_at, mtg: m.id },
    title: ymd(new Date(m.scheduled_at).getTime(), EC) === ymd(now, EC) ? 'Tu reunión 1-1 es hoy' : 'Tu reunión 1-1 es mañana',
    body: fecha(m.scheduled_at) + ' con Mr Katana', dedupe: 'mtg1d:' + m.id + ':' + m.scheduled_at
  })));
}

// Reunión 1-1 en 30 minutos
async function mtg30(sb) {
  const now = Date.now();
  const r = await sb.from('meetings_1on1').select('id, student_id, scheduled_at, status')
    .gt('scheduled_at', new Date(now).toISOString()).lte('scheduled_at', new Date(now + 35 * 60e3).toISOString());
  return add(sb, (r.data || []).filter(m => m.student_id && m.status !== 'cancelled').map(m => ({
    user_id: m.student_id, kind: 'mtg', link: 'reuniones', data: { at: m.scheduled_at, mtg: m.id },
    title: 'Tu reunión 1-1 empieza en ' + Math.max(1, Math.round((new Date(m.scheduled_at).getTime() - now) / 60000)) + ' min',
    body: 'Entra desde la pestaña 1-1 cuando sea la hora.', dedupe: 'mtg30:' + m.id + ':' + m.scheduled_at
  })));
}

// Accesos por vencer: 7 días y 1 día antes
async function expiring(sb) {
  const now = Date.now(), until = new Date(now + 7 * 864e5);
  const [pr, ar] = await Promise.all([
    sb.from('profiles').select('id, role, membership_end, live_end, live_plan')
      .or('membership_end.lte.' + until.toISOString().slice(0, 10) + ',live_end.lte.' + until.toISOString()),
    sb.from('auto_renew').select('user_id, live, active')
  ]);
  const auto = {}; (ar.data || []).forEach(a => { if (a.active) auto[a.user_id] = a; });
  const rows = [];
  (pr.data || []).forEach(p => {
    if (p.role === 'admin' || p.role === 'staff') return;
    const one = (end, kind, label) => {
      const left = (end - now) / 864e5; if (!(left > 0 && left <= 7)) return;
      const w = left <= 1.05 ? 1 : 7; if (w === 7 && left <= 1.05) return;
      const day = new Date(end).toISOString().slice(0, 10);
      const renew = kind === 'l' && auto[p.id] && auto[p.id].live;
      rows.push({ user_id: p.id, kind: 'exp', link: 'perfil', dedupe: 'exp' + w + ':' + kind + ':' + p.id + ':' + day,
        title: 'Tu acceso a ' + label + (w === 1 ? ' vence mañana' : ' vence en 7 días'),
        body: renew ? 'Se renueva solo con tu tarjeta guardada.' : 'Renuévalo desde Ajustes > Membresía para no perderlo.' });
    };
    if (p.membership_end && p.membership_end < '2090-01-01') one(new Date(p.membership_end + 'T23:59:59-05:00').getTime(), 'm', 'las clases');
    if (p.live_end) one(new Date(p.live_end).getTime(), 'l', 'En vivo');
  });
  return add(sb, rows);
}

// Noticia de alto impacto en 30 minutos (solo para quien lo activó)
async function calendar(sb, origin) {
  const r = await fetch(origin + '/api/calendar', { signal: AbortSignal.timeout(9000) }).then(x => x.json()).catch(() => null);
  if (!r || !Array.isArray(r.events)) return 0;
  const now = Date.now(), rows = [];
  r.events.forEach(e => {
    if (e.impact !== 'high' || !e.isoDate) return;
    const m = String(e.time || '').match(/(\d{1,2}):(\d{2})\s*([AP])M/i); if (!m) return;
    let h = (+m[1]) % 12 + (/p/i.test(m[3]) ? 12 : 0);
    const at = Date.parse(e.isoDate + 'T' + String(h).padStart(2, '0') + ':' + m[2] + ':00-05:00');
    const mins = Math.round((at - now) / 60000);
    if (!(mins > 0 && mins <= 35)) return;
    rows.push({ segment: 'cal', kind: 'cal', link: 'dash', title: 'Noticia de alto impacto en ' + mins + ' min',
      body: (e.currency || 'USD') + ' · ' + e.name + ' a las ' + e.time, dedupe: 'cal:' + e.isoDate + ':' + e.name });
  });
  return add(sb, rows);
}

// Journal: a las 8 pm (Ecuador), quien no operó ni marcó "No operé" hoy
async function journal(sb) {
  const now = Date.now(), ecH = new Date(now + EC).getUTCHours(), day = ymd(now, MX), dow = new Date(day + 'T12:00:00Z').getUTCDay();
  if (ecH < 20 || dow === 0 || dow === 6) return 0;
  const acc = (await sb.from('journal_accounts').select('id, user_id, server')).data || [];
  const users = [...new Set(acc.filter(a => !/trial/i.test(a.server || '')).map(a => a.user_id))];
  if (!users.length) return 0;
  const start = new Date(day + 'T00:00:00-06:00').toISOString();
  const [tr, jd] = await Promise.all([
    sb.from('journal_trades').select('user_id, open_time, close_time').in('user_id', users).gte('close_time', start).limit(5000),
    sb.from('journal_days').select('user_id, no_trade').in('user_id', users).eq('day', day)
  ]);
  const mins = {}; (tr.data || []).forEach(t => { mins[t.user_id] = (mins[t.user_id] || 0) + (new Date(t.close_time) - new Date(t.open_time)) / 60000; });
  const nt = {}; (jd.data || []).forEach(j => { if (j.no_trade) nt[j.user_id] = 1; });
  // Quien no lo llenó: recordatorio. Quien sí: felicitación.
  return add(sb, users.map(u => (mins[u] >= 5 || nt[u]) ? {
    user_id: u, kind: 'journal', link: 'journal', dedupe: 'jok:' + u + ':' + day, title: '¡Journal de hoy completo!',
    body: mins[u] >= 5 ? 'Registraste tu día de trading. Sigue así para subir en el ranking.' : 'Marcaste "No operé" y cuidaste tu racha. Bien hecho.' } : {
    user_id: u, kind: 'journal', link: 'journal', dedupe: 'jr:' + u + ':' + day, title: '¿Operaste hoy?',
    body: 'Registra tu trade o marca "No operé" antes de medianoche para no perder tu punto del ranking.' }));
}

// Ranking: una vez al día (desde las 8 am Ecuador). Avisa si subiste de puesto y el cierre del mes.
async function ranking(sb) {
  const now = Date.now(), ecH = new Date(now + EC).getUTCHours(), today = ymd(now, MX), month = today.slice(0, 7);
  if (ecH < 8) return 0;
  const st = ((await sb.from('notif_state').select('v').eq('k', 'rank').maybeSingle()).data || {}).v || {};
  if (st.day === today) return 0;
  const sc = await sb.rpc('journal_rank_scores');
  if (sc.error) return 0;
  const L = (sc.data || []).slice().sort((a, b) => b.score - a.score || b.days - a.days);
  const pos = {}; L.forEach(x => { pos[x.user_id] = 1 + L.filter(y => y.score > x.score || (y.score === x.score && y.days > x.days)).length; });
  const rows = [];
  if (st.month && st.month !== month && st.pos) {
    const mi = +st.month.slice(5, 7) - 1;
    Object.keys(st.pos).forEach(u => rows.push({ user_id: u, kind: 'rank', link: 'dash', dedupe: 'rkm:' + u + ':' + st.month,
      title: 'Cerraste ' + MES[mi] + ' en el puesto ' + st.pos[u] + ' del ranking', body: 'Empieza un mes nuevo: todos arrancan de cero.' }));
  } else if (st.month === month && st.pos) {
    L.forEach(x => { const was = st.pos[x.user_id]; if (was && pos[x.user_id] < was && x.score > 0) rows.push({ user_id: x.user_id, kind: 'rank', link: 'dash', dedupe: 'rk:' + x.user_id + ':' + today,
      title: 'Subiste al puesto ' + pos[x.user_id] + ' del ranking', body: 'Llevas ' + x.days + (x.days === 1 ? ' día' : ' días') + ' operando este mes.' }); });
  }
  await sb.from('notif_state').upsert({ k: 'rank', v: { day: today, month, pos }, at: new Date().toISOString() });
  return add(sb, rows);
}

let lastTick = 0;
async function run(req) {
  if (!process.env.SUPABASE_SERVICE_KEY) return { error: 'missing_service_key' };
  const sb = createClient(SB_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const q = req.query || {};
  if (q.push === '1') return pushPending(sb);
  // Freno: una vuelta cada 3 minutos como máximo (en memoria, sin escribir en la base de datos:
  // escrituras periódicas gastan el "Disk IO budget" de Supabase)
  const cron = !!process.env.CRON_SECRET && (req.headers || {}).authorization === 'Bearer ' + process.env.CRON_SECRET;
  if (!cron && Date.now() - lastTick < 170e3) return { ok: true, skipped: true };
  lastTick = Date.now();
  const host = (req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '';
  const origin = host ? 'https://' + host : SITE;
  const out = {};
  for (const [k, f] of [['mtg', mtgSoon], ['mtg30', mtg30], ['exp', expiring], ['cal', s => calendar(s, origin)], ['journal', journal], ['rank', ranking]]) {
    try { out[k] = await f(sb); } catch (e) { out[k] = 'error: ' + e.message; }
  }
  try { Object.assign(out, await pushPending(sb)); } catch (e) { out.push_error = e.message; }
  return out;
}

module.exports = { add, run, fecha };
