// api/discord-callback.js
// Handles Discord OAuth2 callback — exchanges code for token, gets user info,
// adds user to server and assigns the active roles (managed from the admin
// panel, tabla discord_roles), then saves to Supabase profiles

const { createClient } = require('@supabase/supabase-js');

const DISCORD_CLIENT_ID     = '1482794976118046851';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_BOT_TOKEN     = process.env.DISCORD_BOT_TOKEN;
const DISCORD_SERVER_ID     = '1458313559271276617';
const DISCORD_ROLE_ID       = '1461911161267032279'; // rol de respaldo por si discord_roles aún no está configurada

const sb = createClient(
  'https://rxyezbyvwqwihggechsc.supabase.co',
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  const { code, state } = req.query;
  // Detecta automáticamente el dominio desde donde llegó la petición
  // (funciona igual en producción y en cualquier preview de Vercel)
  const REDIRECT_URI = `https://${req.headers.host}/api/discord-callback`;

  if (!code) {
    return res.redirect('/?discord_error=no_code');
  }

  try {
    // 1. Exchange code for access token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  REDIRECT_URI,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('Token error:', tokenData);
      return res.redirect('/?discord_error=token_failed');
    }

    const accessToken = tokenData.access_token;

    // 2. Get Discord user info
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const discordUser = await userRes.json();

    if (!discordUser.id) {
      return res.redirect('/?discord_error=user_failed');
    }

    // 3. Determine which roles to assign — los que estén activos en discord_roles
    //    (gestionados desde el panel admin). Si esa tabla aún no existe o está
    //    vacía, se usa el rol fijo de respaldo para no romper el flujo.
    let roleIds = [DISCORD_ROLE_ID];
    try {
      const { data: activeRoles } = await sb
        .from('discord_roles')
        .select('discord_role_id')
        .eq('active', true);
      if (activeRoles && activeRoles.length) {
        roleIds = activeRoles.map(function (r) { return r.discord_role_id; });
      }
    } catch (e) {
      console.error('No se pudo leer discord_roles, usando rol de respaldo:', e);
    }

    // 4. Add user to server with those roles (if not already a member)
    await fetch(`https://discord.com/api/guilds/${DISCORD_SERVER_ID}/members/${discordUser.id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        access_token: accessToken,
        roles: roleIds,
      }),
    });

    // 5. Assign each role individually too (por si el usuario ya era miembro —
    //    el PUT anterior solo fija roles cuando se une por primera vez)
    await Promise.all(roleIds.map(function (roleId) {
      return fetch(`https://discord.com/api/guilds/${DISCORD_SERVER_ID}/members/${discordUser.id}/roles/${roleId}`, {
        method: 'PUT',
        headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
      });
    }));

    // 6. Save discord info to Supabase
    if (state) {
      await sb.from('profiles').update({
        discord_id:       discordUser.id,
        discord_username: discordUser.username,
      }).eq('id', state);
    }

    // 7. Redirect back to app with success
    const discordTag = encodeURIComponent(discordUser.username);
    res.redirect(`/app/dash?discord_ok=1&discord_user=${discordTag}`);

  } catch (err) {
    console.error('Discord callback error:', err);
    res.redirect('/?discord_error=server_error');
  }
};
