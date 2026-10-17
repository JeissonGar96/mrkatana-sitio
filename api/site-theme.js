// api/site-theme.js
// Devuelve solo los colores que el admin guarda en Admin > Apariencia (site_settings.theme),
// para que las páginas públicas (login, checkout...) usen los mismos colores que el panel.
// No expone nada más de la tabla.

const { createClient } = require('@supabase/supabase-js');

const SB_URL = 'https://rxyezbyvwqwihggechsc.supabase.co';

module.exports = async function handler(req, res) {
  try {
    if (!process.env.SUPABASE_SERVICE_KEY) return res.status(200).json({ theme: null });
    const sb = createClient(SB_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
    const r = await sb.from('site_settings').select('theme').eq('id', 1).maybeSingle();
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
    return res.status(200).json({ theme: (r.data && r.data.theme) || null });
  } catch (e) {
    return res.status(200).json({ theme: null });
  }
};
