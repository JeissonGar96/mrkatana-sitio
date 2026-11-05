// api/journal-account.js
// Conecta una cuenta MT5 (Exness o Funding Pips) al journal automático.
// La contraseña de inversor se cifra aquí (AES-256-GCM con JOURNAL_KEY de Vercel)
// y se guarda con la service key; el navegador nunca puede leerla de vuelta.
// El servidor Windows la descifra con la misma JOURNAL_KEY para leer las operaciones.
//   POST  { nickname, broker, server, login, password, account_size } → crea la cuenta
//   PATCH { id, password }                                            → cambia la contraseña (si falló)

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SB_URL = 'https://rxyezbyvwqwihggechsc.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4eWV6Ynl2d3F3aWhnZ2VjaHNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNzA3NDEsImV4cCI6MjA4ODk0Njc0MX0.1JSsDMb08NiHwrRtzgp46UZ5pqTuUTGTkpKIOmm9WRc';
const BROKERS = ['exness', 'fundingpips'];
const MAX_ACCOUNTS = 5;
// Servidores MT5 de cada bróker (ej. Exness-MT5Real8, FundingPips-SIM1 / -Prime / -SIM / -Trial)
const SERVER_PREFIX = { exness: /^Exness-/i, fundingpips: /^FundingPips-/i };
const PUBLIC_COLS = 'id, nickname, broker, server, login, account_size, status, last_error, last_sync_at, balance, equity, currency, created_at';

function encrypt(text) {
  const key = crypto.createHash('sha256').update(String(process.env.JOURNAL_KEY)).digest();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST' && req.method !== 'PATCH') return res.status(405).json({ error: 'method' });
    if (!process.env.JOURNAL_KEY || !process.env.SUPABASE_SERVICE_KEY) {
      return res.status(500).json({ error: 'missing_key', detail: 'Falta configurar el journal en el servidor' });
    }
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'no_token' });
    const pub = createClient(SB_URL, SB_ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: u, error: uErr } = await pub.auth.getUser(token);
    if (uErr || !u || !u.user) return res.status(401).json({ error: 'invalid_token', detail: 'Vuelve a iniciar sesión' });
    const userId = u.user.id;

    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const password = String(b.password || '');
    if (password.length < 4 || password.length > 64) return res.status(400).json({ error: 'bad_password', detail: 'Revisa la contraseña de inversor' });

    const admin = createClient(SB_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

    if (req.method === 'PATCH') {
      const id = String(b.id || '');
      const { data, error } = await admin.from('journal_accounts')
        .update({ investor_password_enc: encrypt(password), status: 'pending', last_error: null })
        .eq('id', id).eq('user_id', userId).select(PUBLIC_COLS).single();
      if (error || !data) return res.status(404).json({ error: 'not_found' });
      return res.status(200).json({ account: data });
    }

    const nickname = String(b.nickname || '').trim().slice(0, 28);
    const broker = String(b.broker || '');
    const server = String(b.server || '').trim();
    const login = String(b.login || '').replace(/\s+/g, '');
    const size = b.account_size === '' || b.account_size == null ? null : Number(b.account_size);
    if (!nickname) return res.status(400).json({ error: 'bad_nickname', detail: 'Ponle un nombre a la cuenta' });
    if (!BROKERS.includes(broker)) return res.status(400).json({ error: 'bad_broker' });
    if (!/^[\w.\-]{3,64}$/.test(server)) return res.status(400).json({ error: 'bad_server', detail: 'Revisa el servidor MT5' });
    if (!SERVER_PREFIX[broker].test(server)) return res.status(400).json({ error: 'bad_server', detail: broker === 'exness' ? 'El servidor de Exness empieza por "Exness-"' : 'El servidor de Funding Pips empieza por "FundingPips-"' });
    if (!/^\d{4,15}$/.test(login)) return res.status(400).json({ error: 'bad_login', detail: 'El número de cuenta solo lleva números' });
    if (size != null && !(size > 0 && size < 1e8)) return res.status(400).json({ error: 'bad_size' });

    const { count } = await admin.from('journal_accounts').select('id', { count: 'exact', head: true }).eq('user_id', userId);
    if ((count || 0) >= MAX_ACCOUNTS) return res.status(400).json({ error: 'limit', detail: 'Puedes conectar hasta ' + MAX_ACCOUNTS + ' cuentas' });

    const { data, error } = await admin.from('journal_accounts').insert({
      user_id: userId, nickname, broker, server, login, account_size: size,
      investor_password_enc: encrypt(password), status: 'pending'
    }).select(PUBLIC_COLS).single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'duplicate', detail: 'Esta cuenta ya está conectada' });
      return res.status(500).json({ error: 'db', detail: error.message });
    }
    return res.status(200).json({ account: data });
  } catch (e) {
    return res.status(500).json({ error: 'server', detail: String(e && e.message || e) });
  }
};
