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

const sb = createClient(
  'https://rxyezbyvwqwihggechsc.supabase.co',
  process.env.SUPABASE_SERVICE_KEY
);

function b64url(x) {
  return Buffer.from(typeof x === 'string' ? x : JSON.stringify(x))
    .toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signJwt(payload) {
  const key = String(process.env.JAAS_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
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
    const { data: userData, error: userErr } = await sb.auth.getUser(token);
    if (userErr || !userData || !userData.user) return res.status(401).json({ error: 'invalid_token' });
    const user = userData.user;

    const sessionId = String((req.query && req.query.session) || '');
    if (!/^[\w-]{1,64}$/.test(sessionId)) return res.status(400).json({ error: 'bad_session' });

    const [profileR, sessionR, permsR] = await Promise.all([
      sb.from('profiles').select('role, full_name, email, avatar_url, live_end').eq('id', user.id).single(),
      sb.from('live_sessions').select('id, is_active, discord_url').eq('id', sessionId).single(),
      sb.from('staff_permissions').select('access_sesiones').eq('id', 1).single()
    ]);
    const p = profileR.data;
    const s = sessionR.data;
    if (!p) return res.status(403).json({ error: 'no_profile' });
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
    return res.status(500).json({ error: 'server_error', detail: e && e.message });
  }
};
