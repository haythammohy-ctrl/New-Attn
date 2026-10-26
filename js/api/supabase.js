// Live backend. Needs SUPABASE_URL and SUPABASE_ANON_KEY in js/config.js.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { CONFIG } from '../config.js';
import { loginEmail } from '../lib/registration.js';
import { codedError } from './errors.js';
import { PK, UNIQUE, TABLES_ORDER } from './tables.js';

const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

const SERVER_CODES = new Set([
  'not_active', 'no_location', 'shift_not_open', 'bad_shift', 'low_accuracy', 'out_of_range',
  'already_checked_in', 'already_checked_out', 'not_checked_in', 'run_locked',
  'self_edit', 'month_locked', 'reason_required', 'forbidden_status', 'role_forbidden',
  'verification_not_pending', 'invalid_decision', 'signup_role_forbidden',
]);

function fail(error) {
  if (!error) return;
  const msg = error.message || '';
  let code = 'server_error';
  if (SERVER_CODES.has(msg)) code = msg;
  else if (error.code === '42501') code = 'forbidden';
  else if (error.code === '23505') code = 'duplicate';
  else if (error.code === '23503') code = 'in_use';
  // The app was updated before the database: a table, column or function it needs does not exist yet.
  else if (['PGRST205', 'PGRST204', 'PGRST202', '42P01', '42703', '42883'].includes(error.code)) code = 'needs_migration';
  else if (/invalid login credentials/i.test(msg)) code = 'bad_credentials';
  else if (/email not confirmed/i.test(msg)) code = 'email_unconfirmed';
  else if (/already registered/i.test(msg)) code = 'already_registered';
  else if (/database error saving new user/i.test(msg)) code = 'signup_failed';
  else if (/unable to validate email|invalid format/i.test(msg)) code = 'bad_email';
  else if (/password should be at least/i.test(msg)) code = 'weak_password';
  else if (error.status === 429 || /rate limit|too many requests/i.test(msg)) code = 'rate_limited';
  throw codedError(code, msg);
}

function applyFilters(q, { eq = {}, gte = {}, lte = {}, inList = {} }) {
  for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
  for (const [k, v] of Object.entries(gte)) q = q.gte(k, v);
  for (const [k, v] of Object.entries(lte)) q = q.lte(k, v);
  for (const [k, v] of Object.entries(inList)) q = q.in(k, v);
  return q;
}

export const api = {
  mode: 'supabase',

  async currentProfile() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return null;
    const { data, error } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    fail(error);
    // app_metadata only the admin-users Edge Function can set, so a signed-in person cannot clear it themselves.
    if (data) data.must_change_password = Boolean(session.user.app_metadata?.must_change_password);
    return data;
  },

  async verifyAttendance({ id, decision, note }) {
    const { data, error } = await sb.rpc('verify_attendance', {
      p_id: id, p_decision: decision, p_note: note || '',
    });
    fail(error);
    return data;
  },

  // `identifier` is an email, a 14-digit national id for an employee, or a full name for staff
  async signIn({ identifier, email, password }) {
    const raw = (identifier ?? email ?? '').trim();
    let targetEmail = loginEmail(raw);

    // If identifier doesn't have '@' and isn't 14 digits, it's a Name login (for Manager, Supervisor, Admin).
    // Look up the profile by name to find their registered auth email.
    if (!raw.includes('@') && !/^\d{14}$/.test(raw.replace(/[\s-]/g, ''))) {
      const { data, error } = await sb.from('profiles').select('email').ilike('full_name', raw).maybeSingle();
      if (!error && data?.email) {
        targetEmail = data.email;
      }
    }

    const { error } = await sb.auth.signInWithPassword({ email: targetEmail, password });
    fail(error);
  },

  // `profile` (full_name, national_id, job_title, manager_id) travels as user metadata; the handle_new_user
  // trigger in the database stores it, so a failure leaves nothing half-created.
  async signUp({ email, password, profile }) {
    const { data, error } = await sb.auth.signUp({ email, password, options: { data: profile } });
    fail(error);
    return { needsConfirmation: !data.session };
  },

  // What the sign-up form lists. Works before anyone is signed in.
  async signupOptions() {
    const [titles, supervisors] = await Promise.all([
      sb.from('job_titles').select('*').eq('kind', 'employee').order('name'),
      sb.rpc('list_supervisors'),
    ]);
    fail(titles.error);
    fail(supervisors.error);
    return { jobTitles: titles.data, supervisors: supervisors.data };
  },

  async assignEmployeeCode(id) {
    const { data, error } = await sb.rpc('assign_employee_code', { p_id: id });
    fail(error);
    return data;
  },

  async signOut() {
    await sb.auth.signOut();
  },

  // opts: { eq, gte, lte, inList: {col: [..]}, order: 'col' | '-col' }
  async list(table, opts = {}) {
    const PAGE = 1000;
    const orderCol = (opts.order || PK[table] || 'id').replace(/^-/, '');
    const ascending = !(opts.order || '').startsWith('-');
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const q = applyFilters(sb.from(table).select('*'), opts)
        .order(orderCol, { ascending })
        .range(from, from + PAGE - 1);
      const { data, error } = await q;
      fail(error);
      rows.push(...data);
      if (data.length < PAGE) return rows;
    }
  },

  async save(table, row) {
    const key = PK[table] || 'id';
    const t = sb.from(table);
    let q;
    if (UNIQUE[table]) {
      q = t.upsert(row, { onConflict: UNIQUE[table] });
    } else if (row[key] != null) {
      const { [key]: keyValue, ...rest } = row;
      q = t.update(rest).eq(key, keyValue);
    } else {
      q = t.insert(row);
    }
    const { data, error } = await q.select().single();
    fail(error);
    return data;
  },

  now: () => new Date(),

  // { feature: 'team_edit', ... } for the signed-in user (the admin gets everything).
  async myPermissions() {
    const { data, error } = await sb.rpc('my_permissions');
    fail(error);
    return Object.fromEntries(data.map((r) => [r.feature, r.access]));
  },

  async updateMyPhone(phone) {
    const { error } = await sb.rpc('update_my_phone', { p_phone: phone });
    fail(error);
  },

  // One request for many rows. Only for tables with a unique key (see tables.js).
  async saveMany(table, rows) {
    if (!rows.length) return [];
    const { data, error } = await sb.from(table).upsert(rows, { onConflict: UNIQUE[table] }).select();
    fail(error);
    return data;
  },

  async restore(backupData) {
    if (!backupData || backupData.app !== 'attendance-payroll' || typeof backupData.tables !== 'object') {
      throw new Error('ملف النسخة الاحتياطية غير صالح أو تالف');
    }
    const counts = {};
    for (const table of TABLES_ORDER) {
      const rows = backupData.tables[table];
      if (Array.isArray(rows) && rows.length > 0) {
        const onConflict = UNIQUE[table] || 'id';
        const { error } = await sb.from(table).upsert(rows, { onConflict });
        fail(error);
        counts[table] = rows.length;
      }
    }
    return counts;
  },

  async remove(table, id) {
    const { error } = await sb.from(table).delete().eq(PK[table] || 'id', id);
    fail(error);
  },

  async checkIn({ lat, lng, accuracy, shiftId }) {
    const { data, error } = await sb.rpc('check_in', { p_lat: lat, p_lng: lng, p_accuracy: accuracy, p_shift_id: shiftId });
    fail(error);
    return data;
  },

  async checkOut({ lat, lng, accuracy }) {
    const { data, error } = await sb.rpc('check_out', { p_lat: lat, p_lng: lng, p_accuracy: accuracy });
    fail(error);
    return data;
  },

  // Privileged account operations must go through the server-side admin-users Edge Function.
  async adminCreateUser({ email, password, profile }) {
    const { data, error } = await sb.functions.invoke('admin-users', { body: { action: 'create', email, password, profile } });
    fail(error);
    if (!data) throw codedError('server_error', 'The account service returned no response.');
    if (data.error) throw codedError(data.error, data.detail);
    return data;
  },

  async adminResetPassword({ id, password }) {
    const { data, error } = await sb.functions.invoke('admin-users', { body: { action: 'reset_password', id, password } });
    fail(error);
    if (!data) throw codedError('server_error', 'The account service returned no response.');
    if (data.error) throw codedError(data.error, data.detail);
    return data;
  },

  // Sets your OWN password and clears the "must change password" flag an admin-issued password sets.
  async changeMyPassword(password) {
    const { data, error } = await sb.functions.invoke('admin-users', { body: { action: 'change_my_password', password } });
    fail(error);
    if (!data) throw codedError('server_error', 'The account service returned no response.');
    if (data.error) throw codedError(data.error, data.detail);
    return data;
  },
};
