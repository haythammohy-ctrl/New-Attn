// Roles, features and permission rules. supabase/schema.sql enforces the rules in the database;
// the demo backend runs the functions below, and the UI uses them to show or hide screens and buttons.
import { RuleError } from './rules.js';
import { getLang, t } from './i18n.js';

// The chain of responsibility, highest first:
//   admin > manager > assistant_manager > supervisor > employee
// A manager oversees everything and may only read (they report, they do not act); an assistant
// manager runs several teams picked by the admin; a supervisor runs one team.
export const ROLES = ['employee', 'supervisor', 'assistant_manager', 'manager', 'admin'];

// Roles the permission matrix can be edited for (the admin is always full access).
export const MATRIX_ROLES = ['employee', 'supervisor', 'assistant_manager', 'manager'];

// One source of labels: the translations. Nothing here should hardcode a role name again.
export const roleLabel = (role) => (ROLES.includes(role) ? t(`roles.${role}`) : role);

// Kept for older callers that imported the map; prefer roleLabel.
export const ROLE_LABELS = Object.fromEntries(ROLES.map((r) => [r, roleLabel(r)]));

const ROLE_RANKS = { employee: 0, supervisor: 1, assistant_manager: 2, manager: 3, admin: 4 };
export const rankOf = (role) => ROLE_RANKS[role] ?? -1;

// A manager and the admin only read: every feature is all_view, never *_edit.
export const isReadOnlyRole = (role) => role === 'manager';

// Permissions administrators can grant for each feature:
//   none | team_view | team_edit | all_view | all_edit
// "team" = people who share the same team; "edit" includes "view".
const SCOPED = ['none', 'team_view', 'team_edit', 'all_view', 'all_edit'];
const EXCUSE = ['none', 'team_edit', 'all_edit'];
const LEVELS = ['none', 'all_view', 'all_edit'];
const ALLOW = ['none', 'all_edit'];

export const FEATURES = [
  { key: 'attendance', get label() { return translated('سجلات الحضور وتقاريرها وتعديلها', 'Attendance Records, Reports, and Editing'); }, kind: 'scoped', options: SCOPED, get none() { return translated('الموظف فقط', 'Employee Only'); } },
  { key: 'attendance_excuse', get label() { return translated('اعتماد تحويل الغياب إلى غياب بعذر', 'Approve Excused Absences'); }, kind: 'excuse', options: EXCUSE, get none() { return translated('لا', 'No'); } },
  { key: 'leave_approvals', get label() { return translated('اعتماد طلبات الإجازة', 'Approve Leave Requests'); }, kind: 'scoped', options: SCOPED, get none() { return translated('لا', 'No'); } },
  { key: 'employees', get label() { return translated('بيانات الموظفين والفرق', 'Employee and Team Data'); }, kind: 'scoped', options: SCOPED, get none() { return translated('مخفي', 'Hidden'); } },
  { key: 'national_ids', get label() { return translated('الرقم القومي للموظفين', 'Employee National IDs'); }, kind: 'level', options: LEVELS, get none() { return translated('مخفي', 'Hidden'); }, sensitive: true },
  { key: 'salaries', get label() { return translated('الرواتب والبدلات الشهرية', 'Salaries and Monthly Allowances'); }, kind: 'level', options: LEVELS, get none() { return translated('مخفي', 'Hidden'); }, sensitive: true },
  { key: 'adjustments', get label() { return translated('المكافآت والاستقطاعات والسلف', 'Bonuses, Deductions, and Advances'); }, kind: 'level', options: LEVELS, get none() { return translated('مخفي', 'Hidden'); }, sensitive: true },
  { key: 'payroll', get label() { return translated('إعداد مسيرات الرواتب', 'Prepare Payroll'); }, kind: 'level', options: LEVELS, get none() { return translated('مخفي', 'Hidden'); }, sensitive: true },
  { key: 'payroll_approve', get label() { return translated('اعتماد مسير الرواتب النهائي', 'Approve Final Payroll'); }, kind: 'allow', options: ALLOW, get none() { return translated('ممنوع', 'Not Allowed'); }, sensitive: true },
  { key: 'setup', get label() { return translated('الفروع والورديات والعطلات وأنواع الإجازات', 'Branches, Shifts, Holidays, and Leave Types'); }, kind: 'level', options: LEVELS, get none() { return translated('مخفي', 'Hidden'); } },
  { key: 'rules', get label() { return translated('قواعد احتساب الراتب والإعدادات العامة', 'Payroll Rules and General Settings'); }, kind: 'level', options: LEVELS, get none() { return translated('مخفي', 'Hidden'); } },
  { key: 'backup', get label() { return translated('النسخ الاحتياطي للنظام', 'System Backup'); }, kind: 'allow', options: ALLOW, get none() { return translated('ممنوع', 'Not Allowed'); }, sensitive: true },
];

const translated = (ar, en) => getLang() === 'ar' ? ar : en;

export function optionLabel(feature, access) {
  if (access === 'none') return feature.none;
  switch (feature.kind) {
    case 'allow': return translated('متاح', 'Allowed');
    case 'level': return access === 'all_view' ? translated('عرض', 'View') : translated('تعديل', 'Edit');
    case 'excuse': return access === 'team_edit' ? translated('فريق العمل', 'Team') : translated('الجميع', 'Everyone');
    default: return (getLang() === 'ar'
      ? { team_view: 'الفريق — عرض', team_edit: 'الفريق — تعديل', all_view: 'الجميع — عرض', all_edit: 'الجميع — تعديل' }
      : { team_view: 'Team — View', team_edit: 'Team — Edit', all_view: 'Everyone — View', all_edit: 'Everyone — Edit' })[access];
  }
}

const none = () => Object.fromEntries(FEATURES.map((f) => [f.key, 'none']));

// The SQL seeds these initial values; the admin can change them through the Permissions screen.
export const DEFAULT_PERMISSIONS = {
  // Manager: every screen, read only. It reports; it never edits.
  manager: Object.fromEntries(FEATURES.map((f) => [f.key, 'all_view'])),
  // Assistant manager: runs several teams, and does the operational work.
  assistant_manager: {
    ...none(), attendance: 'all_edit', attendance_excuse: 'all_edit', leave_approvals: 'all_edit', employees: 'all_edit',
    national_ids: 'all_edit', salaries: 'all_edit', adjustments: 'all_edit', payroll: 'all_edit', setup: 'all_edit', rules: 'all_view',
  },
  // Supervisor: one team, its employees (not their co-supervisors).
  supervisor: { ...none(), attendance: 'team_edit', leave_approvals: 'team_edit', employees: 'team_view' },
  employee: none(),
};

export const defaultRows = () => Object.entries(DEFAULT_PERMISSIONS).flatMap(([role, features]) =>
  Object.entries(features).map(([feature, access]) => ({ role, feature, access })));

// The admin hands out every role; an assistant manager may only staff teams below them.
export const assignableRoles = (actorRole) => {
  if (actorRole === 'admin') return ROLES;
  if (actorRole === 'assistant_manager') return ['employee', 'supervisor'];
  return ['employee'];
};

// ---- what the signed-in person may do (UI side). perms = { role, access: { feature: 'team_edit', ... } }
const accessIn = (perms, feature) => perms.access?.[feature] || 'none';

export function can(perms, feature, level = 'view') {
  if (perms.role === 'admin') return true;
  const a = accessIn(perms, feature);
  return a !== 'none' && (level === 'view' || a.endsWith('_edit'));
}

// 'none' | 'team' | 'all'
export function scopeOf(perms, feature) {
  if (perms.role === 'admin') return 'all';
  const a = accessIn(perms, feature);
  return a === 'none' ? 'none' : a.split('_')[0];
}

// ---- the rules themselves (demo backend and tests). ctx = { user, db } where db has the tables as arrays.
export function accessOf(role, feature, rolePerms) {
  if (role === 'admin') return 'all_edit';
  const access = rolePerms.find((p) => p.role === role && p.feature === feature)?.access || 'none';
  // A manager reports: whatever the matrix says, it never holds an edit permission.
  if (isReadOnlyRole(role) && access.endsWith('_edit')) return access.replace('_edit', '_view');
  return access;
}

// "Team" scope means different people depending on who is asking:
//   - a supervisor covers the employees on their own team, without the other supervisors of that
//     team: a supervisor reviews employees, not their peers;
//   - an assistant manager covers every team they are responsible for (teams.manager_id), with its
//     supervisors and its employees.
// A person is always their own scope, whether or not they belong to a team.
const isSupervisorRole = (role) => role === 'supervisor';
const belongsToSupervisorScope = (user, target) =>
  target.team_id === user.team_id && (!isSupervisorRole(target.role) || target.id === user.id);

// The team ids a person covers: the teams a manager owns, otherwise the team they belong to.
export function teamsOf(user, teams = []) {
  if (!user) return [];
  const owned = teams.filter((t) => t.manager_id && t.manager_id === user.id).map((t) => t.id);
  if (owned.length) return owned;
  return user.team_id ? [user.team_id] : [];
}

export function canAccess({ user, db }, feature, level, targetId = null) {
  const a = accessOf(user.role, feature, db.role_permissions);
  if (a === 'none') return false;
  if (level === 'edit' && !a.endsWith('_edit')) return false;
  if (a.startsWith('all')) return true;
  if (targetId == null) return false;
  const target = db.profiles.find((p) => p.id === targetId);
  if (!target) return false;
  if (targetId === user.id) return true;
  const myTeams = teamsOf(user, db.teams || []);
  if (!myTeams.includes(target.team_id)) return false;
  if (user.role === 'assistant_manager') return true;   // their own teams, supervisors included
  return belongsToSupervisorScope(user, target);
}

const PEOPLE_FEATURES = ['employees', 'attendance', 'leave_approvals', 'salaries', 'adjustments', 'payroll'];
export const canSeePerson = (ctx, personId) =>
  personId === ctx.user.id || PEOPLE_FEATURES.some((f) => canAccess(ctx, f, 'view', personId));

// Mirrors the select policies: may this row be shown to this user?
export function canRead(ctx, table, row) {
  const { user, db } = ctx;
  const own = (id) => id === user.id;
  switch (table) {
    case 'profiles': return canSeePerson(ctx, row.id);
    case 'attendance': return own(row.employee_id) || canAccess(ctx, 'attendance', 'view', row.employee_id);
    case 'attendance_edits': return canAccess(ctx, 'attendance', 'view', row.employee_id);
    case 'leave_requests': return own(row.employee_id) || canAccess(ctx, 'leave_approvals', 'view', row.employee_id);
    case 'salary_structures':
      return own(row.employee_id) || canAccess(ctx, 'salaries', 'view', row.employee_id) || canAccess(ctx, 'payroll', 'view', row.employee_id);
    case 'adjustments':
      return canAccess(ctx, 'adjustments', 'view', row.employee_id) || canAccess(ctx, 'payroll', 'view', row.employee_id);
    case 'payroll_runs': return canAccess(ctx, 'payroll', 'view');
    case 'payslips': {
      const released = db.payroll_runs.some((r) => r.id === row.run_id && r.status !== 'draft');
      return (own(row.employee_id) && released) || canAccess(ctx, 'payroll', 'view', row.employee_id);
    }
    case 'profile_private': return own(row.id) || canAccess(ctx, 'national_ids', 'view', row.id);
    case 'role_permissions': return user.role === 'admin';
    default: return true;   // shifts, locations, holidays, leave types, job titles, settings, teams: the app needs them everywhere
  }
}

const monthLocked = (db, workDate) =>
  db.payroll_runs.some((r) => r.month === `${workDate.slice(0, 7)}-01` && r.status !== 'draft');

// Mirrors the write policies and guard triggers. op: 'insert' | 'update' | 'delete'.
// `row` is the row as it will be after the change (merged with the old one on update); `old` is the current row.
export function checkWrite(ctx, table, op, row, old) {
  const { user, db } = ctx;
  const isAdmin = user.role === 'admin';
  const fail = (code) => { throw new RuleError(code); };
  const allowed = (feature, level, target = null) => { if (!canAccess(ctx, feature, level, target)) fail('forbidden'); };

  switch (table) {
    case 'profiles': {
      if (op === 'delete') { if (!isAdmin) fail('forbidden'); return; }
      allowed('employees', 'edit', old.id);
      if (isAdmin) return;
      const roleChanged = row.role !== old.role;
      if (old.role === 'admin') fail('role_forbidden');
      // Only the admin may hand out or take away a role at or above an assistant manager.
      const privileged = (role) => rankOf(role) >= rankOf('assistant_manager');
      if (roleChanged && (privileged(row.role) || privileged(old.role))) fail('role_forbidden');
      if (old.id === user.id && (roleChanged || row.active !== old.active)) fail('role_forbidden');
      return;
    }
    case 'profile_private': allowed('national_ids', 'edit', (op === 'delete' ? old : row).id); return;
    case 'salary_structures': allowed('salaries', 'edit', (op === 'delete' ? old : row).employee_id); return;
    case 'adjustments': allowed('adjustments', 'edit', (op === 'delete' ? old : row).employee_id); return;
    case 'attendance': {
      const emp = (op === 'delete' ? old : row).employee_id;
      const workDate = (op === 'delete' ? old : row).work_date;
      if (op === 'delete') { if (!isAdmin) fail('forbidden'); return; }
      allowed('attendance', 'edit', emp);
      if (row.edited_by !== user.id) fail('forbidden');
      if (emp === user.id && !isAdmin) fail('self_edit');
      if (!['assistant_manager', 'admin'].includes(user.role) && monthLocked(db, workDate)) fail('month_locked');
      if (!(row.note || '').trim() || (op === 'update' && row.note === old.note)) fail('reason_required');
      const statusChanged = op === 'insert' ? row.status !== 'present' : row.status !== old.status;
      if (statusChanged && !canAccess(ctx, 'attendance_excuse', 'edit', emp)) fail('forbidden_status');
      return;
    }
    case 'leave_requests': {
      if (op === 'insert') { if (row.employee_id !== user.id || row.status !== 'pending') fail('forbidden'); return; }
      const decider = canAccess(ctx, 'leave_approvals', 'edit', old.employee_id) && (old.employee_id !== user.id || isAdmin);
      if (op === 'delete') {
        if (!decider && !(old.employee_id === user.id && old.status === 'pending')) fail('forbidden');
        return;
      }
      if (!decider) fail('forbidden');
      if (row.status !== 'pending' && row.decided_by !== user.id) fail('forbidden');
      return;
    }
    case 'payroll_runs': {
      allowed('payroll', 'edit');
      const approving = op === 'insert'
        ? row.status !== 'draft'
        : op === 'update' && row.status !== old.status && ['approved', 'paid'].includes(row.status);
      if (approving && accessOf(user.role, 'payroll_approve', db.role_permissions) !== 'all_edit') fail('forbidden');
      return;
    }
    case 'payslips': allowed('payroll', 'edit', (op === 'delete' ? old : row).employee_id); return;
    case 'settings': allowed('rules', 'edit'); return;
    case 'work_locations':
    case 'shifts':
    case 'holidays':
    case 'job_titles':
    case 'leave_types': allowed('setup', 'edit'); return;
    case 'teams': allowed('employees', 'edit'); return;
    case 'role_permissions': if (!isAdmin) fail('forbidden'); return;
    default: fail('forbidden');
  }
}
