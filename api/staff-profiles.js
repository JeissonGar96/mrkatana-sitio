// api/staff-profiles.js
// Endpoint para staff/admin: lee, actualiza o elimina alumnos usando la
// service key (que ignora RLS por completo), verificando primero que quien
// llama sea admin, o staff con el permiso correspondiente activo en
// staff_permissions. Evita por completo el problema de recursión que da
// intentar resolver esto con políticas de RLS directas sobre "profiles".

const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  'https://rxyezbyvwqwihggechsc.supabase.co',
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  // 1. Verificar quién llama
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'no_token' });

  const { data: userData, error: userErr } = await sb.auth.getUser(token);
  if (userErr || !userData || !userData.user) {
    return res.status(401).json({ error: 'invalid_token' });
  }

  const { data: callerProfile } = await sb
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .single();

  if (!callerProfile || (callerProfile.role !== 'admin' && callerProfile.role !== 'staff')) {
    return res.status(403).json({ error: 'not_authorized' });
  }

  // 2. Si es staff, verificar el permiso específico
  if (callerProfile.role === 'staff') {
    const { data: perms } = await sb.from('staff_permissions').select('*').eq('id', 1).single();
    if (!perms || !perms.access_students) {
      return res.status(403).json({ error: 'no_permission' });
    }
    if (req.method === 'DELETE' && !perms.delete_students) {
      return res.status(403).json({ error: 'no_delete_permission' });
    }
  }

  // 3. Ejecutar la acción pedida
  try {
    if (req.method === 'GET') {
      const { id } = req.query;
      if (id) {
        const { data, error } = await sb.from('profiles').select('*').eq('id', id).single();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ data });
      }
      const { data, error } = await sb
        .from('profiles')
        .select('id, full_name, email, role, plan, live_plan, live_end, membership_start, membership_end, avatar_url, created_at')
        .order('created_at', { ascending: false });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ data });
    }

    if (req.method === 'PATCH') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'missing_id' });
      const { error } = await sb.from('profiles').update(req.body).eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'missing_id' });
      const { error } = await sb.from('profiles').delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('staff-profiles error:', err);
    return res.status(500).json({ error: 'server_error' });
  }
};
