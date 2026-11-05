// api/site-home.js
// Devuelve el contenido de la página de inicio que el admin edita en Admin > Página de inicio
// (site_settings fila id=2, columna theme). La página pública no tiene sesión, por eso pasa por aquí.
// No expone nada más de la tabla.

const { createClient } = require('@supabase/supabase-js');

const SB_URL = 'https://rxyezbyvwqwihggechsc.supabase.co';

module.exports = async function handler(req, res) {
  try {
    if (!process.env.SUPABASE_SERVICE_KEY) return res.status(200).json({ ok: false, error: 'missing_service_key' });
    const sb = createClient(SB_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
    const r = await sb.from('site_settings').select('theme').eq('id', 2).maybeSingle();
    if (r.error) return res.status(200).json({ ok: false, error: r.error.message });
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=300');
    return res.status(200).json({ ok: true, home: (r.data && r.data.theme) || null });
  } catch (e) {
    return res.status(200).json({ ok: false });
  }
};
