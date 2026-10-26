// Edge Function: "admin-users"
// Lets an admin reset a password or create an account for someone else, using the service-role key
// which must never be shipped to the browser. The app calls this via sb.functions.invoke('admin-users', ...).
//
// Deploy from the Supabase Dashboard (no CLI / no install needed):
//   Project -> Edge Functions -> Deploy a new function -> name it "admin-users" -> paste this file -> Deploy.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically to every Edge Function; nothing
// extra to configure.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Always 200 with a JSON body (even for "expected" failures) so the app's own error-code
// handling (js/api/errors.js) can read it the same way it reads every other API error.
function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'forbidden' });

    // Who is calling, checked with their own token (not the service key).
    const caller = createClient(SUPABASE_URL, ANON_KEY);
    const { data: { user }, error: userErr } = await caller.auth.getUser(token);
    if (userErr || !user) return json({ error: 'forbidden' });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const body = await req.json();

    // Anyone signed in may set their OWN password this way (used right after a temporary password an
    // admin handed out). Scoped to the caller's own id only — no admin check, and no "id" from the body.
    if (body.action === 'change_my_password') {
      const { password } = body;
      if (!password || String(password).length < 6) return json({ error: 'weak_password' });
      const { data: existing } = await admin.auth.admin.getUserById(user.id);
      const appMeta = { ...(existing?.user?.app_metadata || {}) };
      delete appMeta.must_change_password;
      const { error } = await admin.auth.admin.updateUserById(user.id, { password, app_metadata: appMeta });
      if (error) {
        const code = /rate limit|too many/i.test(error.message) ? 'rate_limited' : 'server_error';
        return json({ error: code, detail: error.message });
      }
      return json({ ok: true });
    }

    // Everything past this point hands out or resets someone ELSE's password, so it's admin-only.
    const { data: callerProfile, error: profileError } = await admin.from('profiles').select('role, active').eq('id', user.id).maybeSingle();
    if (profileError || callerProfile?.role !== 'admin' || !callerProfile.active) return json({ error: 'forbidden' });

    if (body.action === 'reset_password') {
      const { id, password } = body;
      if (!id || !password || String(password).length < 6) return json({ error: 'weak_password' });
      const { data: existing } = await admin.auth.admin.getUserById(id);
      const appMeta = { ...(existing?.user?.app_metadata || {}), must_change_password: true };
      const { error } = await admin.auth.admin.updateUserById(id, { password, app_metadata: appMeta });
      if (error) {
        const code = /rate limit|too many/i.test(error.message) ? 'rate_limited' : 'server_error';
        return json({ error: code, detail: error.message });
      }
      return json({ ok: true });
    }

    if (body.action === 'create') {
      const { email, password, profile: meta } = body;
      if (!email || !password || String(password).length < 6) return json({ error: 'weak_password' });
      const role = meta?.role || 'employee';
      // Must match js/lib/access.js ROLES (minus "admin", which this screen never hands out).
      if (!['employee', 'supervisor', 'assistant_manager', 'manager'].includes(role)) return json({ error: 'forbidden' });
      const jobTitle = meta?.job_title;
      const userMetadata = { ...meta };
      delete userMetadata.job_title;
      delete userMetadata.role;
      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { ...userMetadata, role: 'employee' },
        app_metadata: { must_change_password: true },
      });
      if (error) {
        const code = /already registered|already exists|duplicate/i.test(error.message) ? 'already_registered'
          : /rate limit|too many/i.test(error.message) ? 'rate_limited'
          : /invalid/i.test(error.message) ? 'bad_email' : 'server_error';
        return json({ error: code, detail: error.message });
      }
      const userId = data.user?.id;
      if (!userId) return json({ error: 'server_error', detail: 'Created auth user has no id.' });
      // A supervisor/assistant manager/manager account the admin creates is ready immediately. An
      // "employee" account still waits in "طلبات جديدة" for team/branch/salary, same as self-sign-up.
      const { error: updateError } = await admin.from('profiles')
        .update({ role, active: role !== 'employee', job_title: jobTitle || null })
        .eq('id', userId);
      if (updateError) {
        const { error: cleanupError } = await admin.auth.admin.deleteUser(userId);
        return json({
          error: 'server_error',
          detail: cleanupError
            ? `${updateError.message}; account cleanup failed: ${cleanupError.message}`
            : updateError.message,
        });
      }

      // A regular employee gets a numbered id (DC000001...) just like self-sign-up does; the same
      // function the "توليد رقم آي دي" button on this account would call later if this is skipped.
      if (jobTitle) {
        const { data: title } = await admin.from('job_titles').select('kind').eq('name', jobTitle).maybeSingle();
        if (title?.kind === 'employee') {
          const { error: codeError } = await admin.rpc('assign_employee_code', { p_id: userId });
          // Not fatal: the account still works, and "توليد رقم آي دي" on this employee's edit screen covers it.
          if (codeError) console.error('assign_employee_code failed', codeError.message);
        }
      }

      return json({ ok: true, id: userId });
    }

    return json({ error: 'server_error', detail: 'unknown action' });
  } catch (err) {
    return json({ error: 'server_error', detail: String((err as Error)?.message || err) });
  }
});
