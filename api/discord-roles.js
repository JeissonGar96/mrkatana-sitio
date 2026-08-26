// api/discord-roles.js
// Endpoint solo para admins: trae los roles reales del servidor de Discord
// (usando el bot) y los sincroniza en Supabase (tabla discord_roles) para
// que el panel admin pueda elegir cuáles se asignan automáticamente.

const { createClient } = require('@supabase/supabase-js');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_SERVER_ID = '1458313559271276617';

const sb = createClient(
  'https://rxyezbyvwqwihggechsc.supabase.co',
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // 1. Verificar que quien llama es un admin logueado
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'no_token' });

  const { data: userData, error: userErr } = await sb.auth.getUser(token);
  if (userErr || !userData || !userData.user) {
    return res.status(401).json({ error: 'invalid_token' });
  }

  const { data: profile, error: profileErr } = await sb
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .single();

  if (profileErr || !profile || profile.role !== 'admin') {
    return res.status(403).json({ error: 'not_admin' });
  }

  // 2. Traer los roles reales desde Discord
  try {
    const discordRes = await fetch(`https://discord.com/api/guilds/${DISCORD_SERVER_ID}/roles`, {
      headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
    });
    const roles = await discordRes.json();

    if (!Array.isArray(roles)) {
      console.error('Discord roles error:', roles);
      return res.status(502).json({ error: 'discord_fetch_failed' });
    }

    // Excluir @everyone (su id siempre es igual al id del servidor) y roles administrados por bots/integraciones
    const realRoles = roles.filter(function (r) {
      return r.id !== DISCORD_SERVER_ID && !r.managed;
    });

    // 3. Upsert en Supabase — se conserva el "active" de los roles que ya conocíamos;
    // los roles nuevos entran como inactivos por defecto (para no auto-activar nada por sorpresa)
    const { data: existing } = await sb.from('discord_roles').select('discord_role_id, active');
    const existingMap = {};
    (existing || []).forEach(function (r) { existingMap[r.discord_role_id] = r.active; });

    const rows = realRoles.map(function (r, i) {
      return {
        discord_role_id: r.id,
        name: r.name,
        color: r.color ? '#' + r.color.toString(16).padStart(6, '0') : null,
        active: existingMap.hasOwnProperty(r.id) ? existingMap[r.id] : false,
        sort_order: i,
        synced_at: new Date().toISOString(),
      };
    });

    const { error: upsertErr } = await sb
      .from('discord_roles')
      .upsert(rows, { onConflict: 'discord_role_id' });

    if (upsertErr) {
      console.error('Supabase upsert error:', upsertErr);
      return res.status(500).json({ error: 'db_sync_failed' });
    }

    return res.status(200).json({ ok: true, count: rows.length });

  } catch (err) {
    console.error('discord-roles error:', err);
    return res.status(500).json({ error: 'server_error' });
  }
};
