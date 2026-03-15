// api/discord-callback.js
// Handles Discord OAuth2 callback — exchanges code for token, gets user info,
// adds user to server and assigns Estudiante role, then saves to Supabase profiles

const DISCORD_CLIENT_ID     = '1482794976118046851';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_BOT_TOKEN     = process.env.DISCORD_BOT_TOKEN;
const DISCORD_SERVER_ID     = '1458313559271276617';
const DISCORD_ROLE_ID       = '1461911161267032279';
const REDIRECT_URI          = 'https://www.mrkatanafx.com/api/discord-callback';

module.exports = async function handler(req, res) {
  const { code, state } = req.query;

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

    // 3. Add user to server (if not already a member)
    await fetch(`https://discord.com/api/guilds/${DISCORD_SERVER_ID}/members/${discordUser.id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        access_token: accessToken,
        roles: [DISCORD_ROLE_ID],
      }),
    });

    // 4. Assign Estudiante role (in case user was already a member)
    await fetch(`https://discord.com/api/guilds/${DISCORD_SERVER_ID}/members/${discordUser.id}/roles/${DISCORD_ROLE_ID}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    // 5. Save discord info to Supabase
    if (state) {
      const { createClient } = require('@supabase/supabase-js');
      const sb = createClient(
        'https://rxyezbyvwqwihggechsc.supabase.co',
        process.env.SUPABASE_SERVICE_KEY
      );
      await sb.from('profiles').update({
        discord_id:       discordUser.id,
        discord_username: discordUser.username,
      }).eq('id', state);
    }

    // 6. Redirect back to app with success
    const discordTag = encodeURIComponent(discordUser.username);
    res.redirect(`/app/sesiones?discord_ok=1&discord_user=${discordTag}`);

  } catch (err) {
    console.error('Discord callback error:', err);
    res.redirect('/?discord_error=server_error');
  }
};
