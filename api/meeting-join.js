// api/meeting-join.js
// Cuando el alumno toca "Entrar" en una reunión 1-1 con link externo (Meet, Zoom...),
// la app avisa aquí y queda anotada la hora en que entró (student_joined_at).
// Así la asistencia se marca sola también en reuniones fuera de la app.

const { createClient } = require('@supabase/supabase-js');

const SB_URL = 'https://rxyezbyvwqwihggechsc.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4eWV6Ynl2d3F3aWhnZ2VjaHNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNzA3NDEsImV4cCI6MjA4ODk0Njc0MX0.1JSsDMb08NiHwrRtzgp46UZ5pqTuUTGTkpKIOmm9WRc';

module.exports = async function handler(req, res) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const id = String((req.query && req.query.meeting) || '');
    if (!token) return res.status(401).json({ error: 'no_token' });
    if (!/^[\w-]{1,64}$/.test(id)) return res.status(400).json({ error: 'bad_meeting' });

    let claims = null;
    try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); } catch (e) {}
    if (!claims || !claims.sub) return res.status(401).json({ error: 'invalid_token' });

    // Se lee la reunión con el token del propio alumno: si el token es falso, Supabase no la devuelve
    const sb = createClient(SB_URL, SB_ANON, {
      global: { headers: { Authorization: 'Bearer ' + token } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: mt } = await sb.from('meetings_1on1').select('id, student_id, scheduled_at').eq('id', id).single();
    if (!mt) return res.status(404).json({ error: 'no_meeting' });
    if (mt.student_id !== claims.sub) return res.status(403).json({ error: 'not_yours' });

    const t = new Date(mt.scheduled_at).getTime(), n = Date.now();
    if (n < t - 15 * 60000 || n > t + 3 * 3600000) return res.status(200).json({ ok: false, reason: 'out_of_window' });

    if (!process.env.SUPABASE_SERVICE_KEY) return res.status(500).json({ error: 'missing_service_key' });
    await createClient(SB_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
      .from('meetings_1on1').update({ student_joined_at: new Date().toISOString() })
      .eq('id', mt.id).is('student_joined_at', null);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', detail: e && e.message });
  }
};
