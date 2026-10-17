// api/jaas-token.js
// Entrega el "pase" (JWT de Jitsi/8x8) para entrar a la sala de un en vivo
// dentro de la plataforma. Solo lo entrega a:
//   - admin, o staff con permiso de sesiones (entran como moderadores)
//   - alumnos con plan de en vivo activo (live_end en el futuro), y solo
//     mientras la sesión está encendida (is_active)
// La llave privada vive en Vercel (JAAS_PRIVATE_KEY); nunca llega al navegador.

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const APP_ID = process.env.JAAS_APP_ID || 'vpaas-magic-cookie-8f0a17dbb6394df09a3b30a85c948987';
const KEY_ID = process.env.JAAS_KEY_ID || 'vpaas-magic-cookie-8f0a17dbb6394df09a3b30a85c948987/5cd518';

// Se consulta Supabase con la sesión del propio usuario (llave pública + su token),
// igual que hace la app. Así no depende de la service key.
const SB_URL = 'https://rxyezbyvwqwihggechsc.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4eWV6Ynl2d3F3aWhnZ2VjaHNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNzA3NDEsImV4cCI6MjA4ODk0Njc0MX0.1JSsDMb08NiHwrRtzgp46UZ5pqTuUTGTkpKIOmm9WRc';

function b64url(x) {
  return Buffer.from(typeof x === 'string' ? x : JSON.stringify(x))
    .toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// Acepta la llave pegada en Vercel tal cual: con \n escritos, en una sola línea,
// o solo el bloque de letras sin las líneas BEGIN/END.
function wrapPem(label, body) {
  return '-----BEGIN ' + label + '-----\n' + body.match(/.{1,64}/g).join('\n') + '\n-----END ' + label + '-----\n';
}
function loadPrivateKey(raw) {
  const k = String(raw || '').replace(/\\n/g, '\n').replace(/\r/g, '').trim().replace(/^["']|["']$/g, '');
  const m = k.match(/-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END [A-Z ]+-----/);
  const label = m ? m[1] : '';
  const body = (m ? m[2] : k).replace(/[^A-Za-z0-9+/=]/g, '');
  if (/PUBLIC/.test(label)) { const e = new Error('public_key_pasted'); e.code = 'public_key'; throw e; }
  if (!body) { const e = new Error('empty_key'); e.code = 'empty_key'; throw e; }
  const tries = label ? [label, 'PRIVATE KEY', 'RSA PRIVATE KEY'] : ['PRIVATE KEY', 'RSA PRIVATE KEY'];
  for (const t of tries) {
    try { return crypto.createPrivateKey(wrapPem(t, body)); } catch (e) {}
  }
  try { return crypto.createPrivateKey({ key: Buffer.from(body, 'base64'), format: 'der', type: 'pkcs8' }); } catch (e) {}
  const e = new Error('bad_key_format (' + (label || 'sin BEGIN') + ', ' + body.length + ' letras)'); e.code = 'bad_key'; throw e;
}

function signJwt(payload) {
  const key = loadPrivateKey(process.env.JAAS_PRIVATE_KEY);
  const head = b64url({ alg: 'RS256', kid: KEY_ID, typ: 'JWT' });
  const body = b64url(payload);
  const sig = crypto.createSign('RSA-SHA256').update(head + '.' + body).sign(key)
    .toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return head + '.' + body + '.' + sig;
}

module.exports = async function handler(req, res) {
  try {
    if (!process.env.JAAS_PRIVATE_KEY) return res.status(500).json({ error: 'missing_key' });

    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'no_token' });
    const sb = createClient(SB_URL, SB_ANON, {
      global: { headers: { Authorization: 'Bearer ' + token } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    // Leemos quién es desde su token. No hace falta confiar en esto a ciegas:
    // Supabase rechaza la consulta de su perfil si el token es falso o venció.
    let claims = null;
    try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); } catch (e) {}
    if (!claims || !claims.sub || (claims.exp && claims.exp * 1000 < Date.now())) {
      return res.status(401).json({ error: 'invalid_token', detail: 'Vuelve a iniciar sesión' });
    }
    const user = { id: claims.sub };

    // ── Sala privada de una reunión 1-1: solo admin (o staff con alumnos) y el alumno de esa reunión ──
    const meetingId = String((req.query && req.query.meeting) || '');
    if (meetingId) {
      if (!/^[\w-]{1,64}$/.test(meetingId)) return res.status(400).json({ error: 'bad_meeting' });
      const [pR, mR, sR] = await Promise.all([
        sb.from('profiles').select('role, full_name, email, avatar_url').eq('id', user.id).single(),
        sb.from('meetings_1on1').select('id, student_id, scheduled_at, status, meet_url').eq('id', meetingId).single(),
        sb.from('staff_permissions').select('access_students').eq('id', 1).single()
      ]);
      const pp = pR.data, mt = mR.data;
      if (pR.error && /jwt|token|auth/i.test(pR.error.message || '')) return res.status(401).json({ error: 'invalid_token', detail: pR.error.message });
      if (!pp) return res.status(403).json({ error: 'no_profile' });
      if (!mt) return res.status(404).json({ error: 'no_meeting' });
      const mod = pp.role === 'admin' || (pp.role === 'staff' && !!(sR.data && sR.data.access_students));
      if (!mod) {
        if (mt.student_id !== user.id) return res.status(403).json({ error: 'not_yours' });
        if (mt.status === 'cancelled') return res.status(403).json({ error: 'cancelled' });
        if (mt.status === 'completed' || mt.status === 'no_show') return res.status(403).json({ error: 'meeting_over' });
        const t = new Date(mt.scheduled_at).getTime(), n = Date.now();
        if (n < t - 10 * 60000) return res.status(403).json({ error: 'too_early' });
        if (n > t + 3 * 3600000) return res.status(403).json({ error: 'meeting_over' });
        // Asistencia: queda anotado que el alumno entró (con la service key, solo la primera vez)
        if (process.env.SUPABASE_SERVICE_KEY) {
          try {
            await createClient(SB_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
              .from('meetings_1on1').update({ student_joined_at: new Date().toISOString() })
              .eq('id', mt.id).is('student_joined_at', null);
          } catch (e) {}
        }
      }
      const room1 = 'mrkatana-1a1-' + String(mt.id).toLowerCase().replace(/[^a-z0-9]/g, '');
      const now1 = Math.floor(Date.now() / 1000);
      const jwt1 = signJwt({
        aud: 'jitsi', iss: 'chat', sub: APP_ID, room: room1, iat: now1, nbf: now1 - 10, exp: now1 + 4 * 3600,
        context: {
          user: { id: user.id, name: pp.full_name || (pp.email || '').split('@')[0] || 'Alumno', email: pp.email || '', avatar: pp.avatar_url || '', moderator: mod ? 'true' : 'false' },
          features: { livestreaming: 'false', recording: 'false', transcription: 'false', 'outbound-call': 'false', 'sip-outbound-call': 'false' }
        }
      });
      return res.status(200).json({ jwt: jwt1, room: APP_ID + '/' + room1, appId: APP_ID, moderator: mod });
    }

    const sessionId = String((req.query && req.query.session) || '');
    if (!/^[\w-]{1,64}$/.test(sessionId)) return res.status(400).json({ error: 'bad_session' });

    const [profileR, sessionR, permsR] = await Promise.all([
      sb.from('profiles').select('role, full_name, email, avatar_url, live_end').eq('id', user.id).single(),
      sb.from('live_sessions').select('id, is_active, discord_url').eq('id', sessionId).single(),
      sb.from('staff_permissions').select('access_sesiones').eq('id', 1).single()
    ]);
    const p = profileR.data;
    const s = sessionR.data;
    if (profileR.error && /jwt|token|auth/i.test(profileR.error.message || '')) return res.status(401).json({ error: 'invalid_token', detail: profileR.error.message });
    if (!p) return res.status(403).json({ error: 'no_profile', detail: profileR.error ? profileR.error.message : '' });
    if (!s) return res.status(404).json({ error: 'no_session' });

    const isMod = p.role === 'admin' || (p.role === 'staff' && !!(permsR.data && permsR.data.access_sesiones));
    if (!isMod) {
      const hasLive = p.live_end && new Date(p.live_end) > new Date();
      if (!hasLive) return res.status(403).json({ error: 'no_live_plan' });
      if (!s.is_active) return res.status(403).json({ error: 'not_live' });
    }

    const room = 'mrkatana-sesion-' + String(s.id).toLowerCase().replace(/[^a-z0-9]/g, '');
    const now = Math.floor(Date.now() / 1000);
    const jwt = signJwt({
      aud: 'jitsi',
      iss: 'chat',
      sub: APP_ID,
      room: room,
      iat: now,
      nbf: now - 10,
      exp: now + 4 * 3600,
      context: {
        user: {
          // id fijo por alumno: así cuenta como una sola persona aunque entre desde varios equipos
          id: user.id,
          name: p.full_name || (p.email || '').split('@')[0] || 'Alumno',
          email: p.email || '',
          avatar: p.avatar_url || '',
          moderator: isMod ? 'true' : 'false'
        },
        // Todo lo que se cobra aparte queda apagado
        features: {
          livestreaming: 'false',
          recording: 'false',
          transcription: 'false',
          'outbound-call': 'false',
          'sip-outbound-call': 'false'
        }
      }
    });

    return res.status(200).json({ jwt: jwt, room: APP_ID + '/' + room, appId: APP_ID, moderator: isMod });
  } catch (e) {
    if (e && e.code) return res.status(500).json({ error: e.code, detail: e.message });
    return res.status(500).json({ error: 'server_error', detail: e && e.message });
  }
};
