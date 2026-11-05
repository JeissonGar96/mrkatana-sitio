// api/fathom-webhook.js
// Fathom avisa aquí cuando termina de procesar una grabación (reunión 1-1 por Meet/Zoom).
// Se busca al alumno por su correo entre los invitados, se encuentra su reunión 1-1
// más cercana a esa hora y se guarda el resumen, las tareas pendientes y el link de Fathom.
// La firma se verifica con FATHOM_WEBHOOK_SECRET (variable de entorno en Vercel).

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SB_URL = 'https://rxyezbyvwqwihggechsc.supabase.co';

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function validSignature(secret, id, ts, body, header) {
  if (!secret || !id || !ts || !header) return false;
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!isFinite(age) || age > 5 * 60) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest();
  return String(header).split(' ').some(part => {
    const sig = Buffer.from(part.split(',')[1] || '', 'base64');
    return sig.length === expected.length && crypto.timingSafeEqual(sig, expected);
  });
}

async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
    const raw = await readRaw(req);
    if (!validSignature(process.env.FATHOM_WEBHOOK_SECRET, req.headers['webhook-id'],
      req.headers['webhook-timestamp'], raw, req.headers['webhook-signature'])) {
      return res.status(401).json({ error: 'bad_signature' });
    }
    if (!process.env.SUPABASE_SERVICE_KEY) return res.status(500).json({ error: 'missing_service_key' });
    const m = JSON.parse(raw || '{}');
    const sb = createClient(SB_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

    // Correos de los invitados (sin el de quien grabó)
    const host = ((m.recorded_by && m.recorded_by.email) || '').toLowerCase();
    const emails = [...new Set((m.calendar_invitees || [])
      .map(i => (i && i.email || '').toLowerCase().trim())
      .filter(e => e && e !== host))];
    if (!emails.length) return res.status(200).json({ ok: true, matched: false, reason: 'no_invitees' });

    const { data: studs } = await sb.from('profiles').select('id, email').in('email', emails);
    const ids = (studs || []).map(s => s.id);
    if (!ids.length) return res.status(200).json({ ok: true, matched: false, reason: 'no_student' });

    // Reunión 1-1 de ese alumno más cercana a la hora de la llamada (máximo 6 horas de diferencia)
    const when = new Date(m.scheduled_start_time || m.recording_start_time || m.created_at || Date.now()).getTime();
    const from = new Date(when - 6 * 3600000).toISOString(), to = new Date(when + 6 * 3600000).toISOString();
    const { data: mts } = await sb.from('meetings_1on1').select('id, scheduled_at, status')
      .in('student_id', ids).gte('scheduled_at', from).lte('scheduled_at', to);
    const cands = (mts || []).filter(x => x.status !== 'cancelled')
      .sort((a, b) => Math.abs(new Date(a.scheduled_at) - when) - Math.abs(new Date(b.scheduled_at) - when));
    if (!cands.length) return res.status(200).json({ ok: true, matched: false, reason: 'no_meeting' });

    const actions = (m.action_items || []).map(a => ({
      text: a.description || '',
      done: !!a.completed,
      who: (a.assignee && a.assignee.name) || '',
      at: a.recording_playback_url || ''
    })).filter(a => a.text);

    const upd = {
      fathom_summary: (m.default_summary && m.default_summary.markdown_formatted) || null,
      fathom_actions: actions,
      fathom_url: m.share_url || m.url || null
    };
    if (cands[0].status !== 'completed') upd.status = 'completed';
    const { error } = await sb.from('meetings_1on1').update(upd).eq('id', cands[0].id);
    if (error) return res.status(500).json({ error: 'db', detail: error.message });
    return res.status(200).json({ ok: true, matched: true, meeting: cands[0].id });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', detail: e && e.message });
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
