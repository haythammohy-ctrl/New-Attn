// Demo backend: everything lives in this browser's localStorage. It applies the same permission
// rules as the Supabase version (lib/access.js mirrors the SQL), minus real security.
import { accessOf, canAccess, canRead, checkWrite, FEATURES } from '../lib/access.js';
import { todayIn } from '../lib/dates.js';
import { cleanNationalId, formatEmployeeCode, pseudoEmail, validNationalId } from '../lib/registration.js';
import { checkGeofence, RuleError } from '../lib/rules.js';
import { checkoutMinutesAt, lateMinutesAt, openInstance, shiftInstance } from '../lib/shifts.js';
import { codedError } from './errors.js';
import { buildSeed } from './seed.js';
import { PK, UNIQUE, TABLES_ORDER } from './tables.js';

const DB_KEY = 'attn.demo.db.v7';   // bumped when the data shape changed, so old demo data is not reused
const USER_KEY = 'attn.demo.user';
const CLOCK_KEY = 'attn.demo.now';   // optional ISO time to pretend "now" is, for trying late/overtime

let db = JSON.parse(localStorage.getItem(DB_KEY) || 'null');
if (!db) {
  db = buildSeed();
  persist();
}

function persist() {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

const clone = (v) => JSON.parse(JSON.stringify(v));
const now = () => new Date(localStorage.getItem(CLOCK_KEY) || Date.now());

function me() {
  const id = localStorage.getItem(USER_KEY);
  return db.profiles.find((p) => p.id === id && p.active) || null;
}

// A person who has signed up but is not active yet still sees their own profile (the pending screen).
const signedInProfile = () => db.profiles.find((p) => p.id === localStorage.getItem(USER_KEY)) || null;

const nextEmployeeCode = () => {
  db.counters.employee_code += 1;
  return formatEmployeeCode(db.settings[0].employee_code_prefix, db.counters.employee_code);
};

// The permission functions throw RuleError; the app expects coded errors.
function rule(fn) {
  try {
    return fn();
  } catch (err) {
    if (err instanceof RuleError) throw codedError(err.code);
    throw err;
  }
}

function matches(row, { eq = {}, gte = {}, lte = {}, inList = {} }) {
  return Object.entries(eq).every(([k, v]) => row[k] === v)
    && Object.entries(gte).every(([k, v]) => row[k] >= v)
    && Object.entries(lte).every(([k, v]) => row[k] <= v)
    && Object.entries(inList).every(([k, v]) => v.includes(row[k]));
}

// Verifies the caller is at their branch and returns the settings. Shift rules come after, as on the server.
function guardedWork(user, coords) {
  if (!user) throw codedError('not_active');
  const settings = db.settings[0];
  const location = db.work_locations.find((l) => l.id === user.location_id);
  if (!location) throw codedError('no_location');
  rule(() => checkGeofence({ coords, location, maxAccuracy: settings.max_accuracy_m }));
  return settings;
}

// Every manual change to attendance leaves a row, like the guard trigger does on the server.
function logEdit(user, action, before, after) {
  const base = after || before;
  db.attendance_edits.push({
    id: crypto.randomUUID(), attendance_id: base.id, employee_id: base.employee_id, work_date: base.work_date,
    actor_id: user.id, action, old_data: before ? clone(before) : null, new_data: after ? clone(after) : null,
    reason: after ? after.note : null, at: now().toISOString(),
  });
}

export const api = {
  mode: 'local',

  async currentProfile() {
    return clone(signedInProfile());
  },

  demoAccounts() {
    return db.profiles.filter((p) => p.active).map(({ email, full_name, role, job_title }) => ({ email, full_name, role, job_title }));
  },

  // Demo accounts are chosen from a list or entered by username (name/nid/email).
  async signIn({ email, identifier }) {
    const term = (identifier || email || '').trim().toLowerCase();
    const p = db.profiles.find((x) => {
      if (!x.active) return false;
      if ((x.email || '').toLowerCase() === term) return true;
      if ((x.full_name || '').toLowerCase() === term) return true;
      // Also match by national ID if stored
      const priv = db.profile_private.find((pv) => pv.id === x.id);
      if (priv && priv.national_id === term) return true;
      return false;
    });
    if (!p) throw codedError('bad_credentials');
    localStorage.setItem(USER_KEY, p.id);
  },

  // What the sign-up form lists. Works before anyone is signed in.
  async signupOptions() {
    return {
      jobTitles: clone(db.job_titles.filter((title) => title.kind === 'employee')).sort((a, b) => a.name.localeCompare(b.name)),
      supervisors: db.profiles.filter((p) => p.role === 'supervisor' && p.active)
        .map(({ id, full_name, job_title }) => ({ id, full_name, job_title })),
    };
  },

  // Does what the handle_new_user trigger does on the server: stores the answers, numbers employees,
  // puts the person in their manager's team, and leaves the account waiting for activation.
  async signUp({ email, profile: answers }) {
    const nid = cleanNationalId(answers.national_id);
    if (!validNationalId(nid)) throw codedError('invalid_national_id');
    if (answers.role && answers.role !== 'employee') throw codedError('forbidden');
    if (db.profile_private.some((r) => r.national_id === nid)) throw codedError('signup_failed');
    if (email && db.profiles.some((p) => (p.email || '').toLowerCase() === email.toLowerCase())) throw codedError('already_registered');
    // Like the trigger: whoever registers with a national id is an employee with the default employee title,
    // whatever job title the browser sent.
    const job = db.job_titles.find((t) => t.name === 'موظف' && t.kind === 'employee') || db.job_titles.find((t) => t.kind === 'employee');
    const manager = db.profiles.find((p) => p.id === answers.manager_id && p.role === 'supervisor' && p.active);
    const person = {
      id: crypto.randomUUID(), full_name: (answers.full_name || '').trim(), email: email && email !== pseudoEmail(nid) ? email : null,
      phone: '', role: 'employee', team_id: manager ? manager.team_id : null, manager_id: manager ? manager.id : null,
      job_title: job ? job.name : 'موظف', employee_code: nextEmployeeCode(),
      shift_id: null, location_id: null, hire_date: null, active: false, created_at: new Date().toISOString(),
    };
    db.profiles.push(person);
    db.profile_private.push({ id: person.id, national_id: nid });
    localStorage.setItem(USER_KEY, person.id);   // signed in straight away, like Supabase with "Confirm email" off
    persist();
    return { needsConfirmation: false };
  },

  // Demo accounts don't really have passwords, so these just mirror what the live Edge Function does
  // to the profile data (enough to try the admin screens without a real backend).
  async adminCreateUser({ email, profile: answers }) {
    if (me()?.role !== 'admin') throw codedError('forbidden');
    const isStaff = answers.role && answers.role !== 'employee';
    let nid = null;
    if (!isStaff) {
      nid = cleanNationalId(answers.national_id);
      if (!validNationalId(nid)) throw codedError('invalid_national_id');
      if (db.profile_private.some((r) => r.national_id === nid)) throw codedError('signup_failed');
    }
    if (email && db.profiles.some((p) => (p.email || '').toLowerCase() === email.toLowerCase())) throw codedError('already_registered');
    const job = db.job_titles.find((t) => t.name === answers.job_title);
    const manager = db.profiles.find((p) => p.id === answers.manager_id && p.role === 'supervisor' && p.active);
    const person = {
      id: crypto.randomUUID(), full_name: (answers.full_name || '').trim(), email: email || null,
      phone: '', role: answers.role || 'employee', team_id: manager ? manager.team_id : null, manager_id: manager ? manager.id : null,
      job_title: answers.job_title || (job ? job.name : (answers.role === 'assistant_manager' ? 'Assistant Manager' : answers.role === 'supervisor' ? 'Supervisor' : null)),
      employee_code: (!isStaff && job && job.kind === 'employee') ? nextEmployeeCode() : null,
      shift_id: null, location_id: null, hire_date: null, active: Boolean(isStaff), created_at: new Date().toISOString(),
      must_change_password: true,   // mirrors the real backend: an admin-issued password must be changed
    };
    db.profiles.push(person);
    if (nid) {
      db.profile_private.push({ id: person.id, national_id: nid });
    }
    persist();
    return { id: person.id };
  },

  async adminResetPassword({ id }) {
    const target = db.profiles.find((p) => p.id === id);
    if (!target) throw codedError('forbidden');
    target.must_change_password = true;
    persist();
    return { ok: true };
  },

  // Demo accounts have no real password, so this just clears the flag the forced-change screen checks.
  async changeMyPassword() {
    const mine = signedInProfile();
    if (mine) { mine.must_change_password = false; persist(); }
    return { ok: true };
  },

  async assignEmployeeCode(id) {
    const user = me();
    const target = db.profiles.find((p) => p.id === id);
    if (!user || !target) throw codedError('forbidden');
    if (!target.employee_code) {
      // permission first, so a refused request never uses up a number
      rule(() => checkWrite({ user, db }, 'profiles', 'update', { ...target, employee_code: 'new' }, target));
      target.employee_code = nextEmployeeCode();
      persist();
    }
    return target.employee_code;
  },

  async signOut() {
    localStorage.removeItem(USER_KEY);
  },

  async list(table, opts = {}) {
    const user = me();
    const ctx = { user, db };
    let rows = user ? db[table].filter((r) => canRead(ctx, table, r)) : [];
    rows = rows.filter((r) => matches(r, opts));
    if (opts.order) {
      const col = opts.order.replace(/^-/, '');
      const dir = opts.order.startsWith('-') ? -1 : 1;
      rows = [...rows].sort((a, b) => (a[col] > b[col] ? dir : a[col] < b[col] ? -dir : 0));
    }
    return clone(rows);
  },

  async save(table, row) {
    const user = me();
    if (!user) throw codedError('forbidden');
    const rows = db[table];
    const uniq = UNIQUE[table] ? UNIQUE[table].split(',') : undefined;
    const existing = uniq
      ? rows.find((r) => uniq.every((k) => r[k] === row[k]))
      : row.id && rows.find((r) => r.id === row.id);
    const after = existing ? { ...existing, ...clone(row) } : clone(row);
    if (table === 'attendance') {
      if (!after.verification_status) after.verification_status = 'approved';
      if (!after.source) after.source = 'manual';
    }
    rule(() => checkWrite({ user, db }, table, existing ? 'update' : 'insert', after, existing));
    // the database has a unique constraint on team names and on job titles
    if (['teams', 'job_titles'].includes(table) && rows.some((r) => r.name === after.name && r.id !== after.id)) throw codedError('duplicate');

    if (existing) {
      const before = clone(existing);
      Object.assign(existing, after);
      if (table === 'attendance') logEdit(user, 'update', before, existing);
      persist();
      return clone(existing);
    }
    if (table === 'attendance' && rows.some((r) => r.employee_id === after.employee_id && r.work_date === after.work_date)) {
      throw codedError('duplicate');
    }
    const created = { ...after };
    if (!PK[table] && !created.id) created.id = crypto.randomUUID();
    rows.push(created);
    if (table === 'attendance') logEdit(user, 'insert', null, created);
    persist();
    return clone(created);
  },

  async remove(table, id) {
    const user = me();
    if (!user) throw codedError('forbidden');
    const key = PK[table] || 'id';
    const existing = db[table].find((r) => r[key] === id);
    if (!existing) return;
    rule(() => checkWrite({ user, db }, table, 'delete', null, existing));
    if (table === 'attendance') logEdit(user, 'delete', existing, null);
    db[table] = db[table].filter((r) => r[key] !== id);
    if (table === 'teams') db.profiles.forEach((p) => { if (p.team_id === id) p.team_id = null; });
    persist();
  },

  now,

  // Same rule as saveMany on the live backend: one call, many rows.
  async saveMany(table, rows) {
    const saved = [];
    for (const row of rows) saved.push(await this.save(table, row));
    return saved;
  },

  async restore(backupData) {
    const user = me();
    if (!user) throw codedError('forbidden');
    if (!backupData || backupData.app !== 'attendance-payroll' || typeof backupData.tables !== 'object') {
      throw new Error('ملف النسخة الاحتياطية غير صالح أو تالف');
    }
    const counts = {};
    for (const table of TABLES_ORDER) {
      if (Array.isArray(backupData.tables[table])) {
        db[table] = clone(backupData.tables[table]);
        counts[table] = db[table].length;
      }
    }
    persist();
    return counts;
  },

  // { feature: 'team_edit', ... } for the signed-in user (the admin gets everything).
  async myPermissions() {
    const user = me();
    return Object.fromEntries(FEATURES.map((f) => [f.key, accessOf(user.role, f.key, db.role_permissions)]));
  },

  async updateMyPhone(phone) {
    const mine = db.profiles.find((p) => p.id === me().id);
    mine.phone = (phone || '').trim();
    persist();
  },

  // The employee picks the shift (shiftId); it is only accepted while that shift is open.
  async checkIn({ shiftId, ...coords }) {
    const user = me();
    const settings = guardedWork(user, coords);
    const shift = db.shifts.find((s) => s.id === shiftId);
    if (!shift) throw codedError('bad_shift');
    const nowDate = now();
    const nowMs = nowDate.getTime();
    const inst = openInstance({
      shift, nowMs, tz: settings.timezone, windowMin: settings.checkin_window_min !== undefined && settings.checkin_window_min !== null ? settings.checkin_window_min : 60,
      today: todayIn(settings.timezone, nowDate),
    });
    if (!inst) throw codedError('shift_not_open');
    const existing = db.attendance.find((a) => a.employee_id === user.id && a.work_date === inst.date);
    if (existing && existing.check_in_at) throw codedError('already_checked_in');
    const row = {
      ...(existing || { id: crypto.randomUUID(), early_leave_minutes: 0, overtime_minutes: 0, note: null, edited_by: null }),
      employee_id: user.id, work_date: inst.date, shift_id: inst.shift.id, check_in_at: nowDate.toISOString(),
      check_in_lat: coords.lat, check_in_lng: coords.lng,
      late_minutes: lateMinutesAt(inst, nowMs), status: 'present',
      verification_status: 'pending', verified_by: null, verified_at: null, verification_note: null, source: 'gps',
    };
    if (existing) Object.assign(existing, row);
    else db.attendance.push(row);
    persist();
    return clone(row);
  },

  // Closes the latest open check-in, so a forgotten check-out never blocks the next shift.
  async checkOut(coords) {
    const user = me();
    const settings = guardedWork(user, coords);
    const nowDate = now();
    const latest = db.attendance
      .filter((a) => a.employee_id === user.id && a.check_in_at)
      .sort((a, b) => b.check_in_at.localeCompare(a.check_in_at))[0];
    if (!latest || nowDate.getTime() - Date.parse(latest.check_in_at) > 36 * 3600000) throw codedError('not_checked_in');
    if (latest.check_out_at) throw codedError('already_checked_out');
    const shift = db.shifts.find((s) => s.id === (latest.shift_id || user.shift_id));
    Object.assign(latest, {
      check_out_at: nowDate.toISOString(), check_out_lat: coords.lat, check_out_lng: coords.lng,
      ...(shift
        ? checkoutMinutesAt(shiftInstance(latest.work_date, shift, settings.timezone), nowDate.getTime(), settings.overtime_threshold_min)
        : { early_leave_minutes: 0, overtime_minutes: 0 }),
    });
    persist();
    return clone(latest);
  },

  async verifyAttendance({ id, decision, note }) {
    const user = me();
    const row = db.attendance.find((entry) => entry.id === id);
    const reason = (note || '').trim();
    if (!user || !row || row.verification_status !== 'pending') throw codedError('verification_not_pending');
    if (!['approved', 'rejected'].includes(decision)) throw codedError('invalid_decision');
    if (decision === 'rejected' && !reason) throw codedError('reason_required');
    if (row.employee_id === user.id || !canAccess({ user, db }, 'attendance', 'edit', row.employee_id)) throw codedError('forbidden');
    const month = `${row.work_date.slice(0, 7)}-01`;
    if (user.role !== 'assistant_manager' && user.role !== 'admin'
      && db.payroll_runs.some((run) => run.month === month && run.status !== 'draft')) throw codedError('month_locked');
    const old = clone(row);
    Object.assign(row, {
      verification_status: decision,
      verified_by: user.id,
      verified_at: now().toISOString(),
      verification_note: decision === 'approved' ? null : reason,
      edited_by: user.id,
    });
    db.attendance_edits.push({
      id: crypto.randomUUID(), attendance_id: row.id, employee_id: row.employee_id, work_date: row.work_date,
      actor_id: user.id, action: 'update', old_data: old, new_data: clone(row), reason: reason || null, at: now().toISOString(),
    });
    persist();
    return clone(row);
  },

  resetDemo() {
    localStorage.removeItem(DB_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(CLOCK_KEY);
    location.reload();
  },
};