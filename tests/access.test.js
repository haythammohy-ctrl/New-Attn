import { test, eq, throwsCode } from './harness.js';
import {
  accessOf, assignableRoles, can, canAccess, canRead, checkWrite, DEFAULT_PERMISSIONS, defaultRows,
  MATRIX_ROLES, rankOf, scopeOf, teamsOf,
} from '../js/lib/access.js';

// admin and the assistant manager are on no team; two teams of supervisors/employees;
// one person on no team.
const P = (id, role, team_id = null) => ({ id, role, team_id, active: true });
const profiles = [
  P('admin', 'admin'), P('hr', 'assistant_manager'), P('mgr', 'manager'),
  P('sup1', 'supervisor', 'A'), P('asst1', 'supervisor', 'A'), P('emp1', 'employee', 'A'), P('emp2', 'employee', 'A'),
  P('sup2', 'supervisor', 'B'), P('emp3', 'employee', 'B'),
  P('lonesup', 'supervisor', null), P('lone', 'employee', null),
];
const TEAMS = [
  { id: 'A', name: 'Team A', manager_id: 'hr' },
  { id: 'B', name: 'Team B', manager_id: 'hr' },
];
const mkdb = (extra = {}) => ({ profiles, teams: TEAMS, role_permissions: defaultRows(), payroll_runs: [], ...extra });
const as = (id, db = mkdb()) => ({ user: profiles.find((p) => p.id === id), db });
const setAccess = (db, role, feature, access) => {
  const row = db.role_permissions.find((p) => p.role === role && p.feature === feature);
  if (!row) throw new Error(`setAccess: no matrix row for ${role}/${feature}`);
  row.access = access;
  return db;
};

const readable = (actor, table, row, db) => canRead(as(actor, db), table, row);
const attRow = (employee_id, extra = {}) => ({
  id: 'a1', employee_id, work_date: '2026-10-10', status: 'present', check_in_at: 'x', note: null, edited_by: null, ...extra,
});
// a manual edit of an existing attendance row, as `actor`
const editAtt = (actor, employee, changes = {}, db) => {
  const old = attRow(employee);
  checkWrite(as(actor, db), 'attendance', 'update', { ...old, note: 'نسي الانصراف', edited_by: actor, ...changes }, old);
};
const addAtt = (actor, employee, changes = {}, db) =>
  checkWrite(as(actor, db), 'attendance', 'insert', { employee_id: employee, work_date: '2026-10-10', status: 'present', note: 'نسي يسجل', edited_by: actor, ...changes }, null);

test('admin can do everything, whatever the matrix says', () => {
  const empty = mkdb({ role_permissions: [] });
  for (const f of ['attendance', 'leave_approvals', 'employees', 'salaries', 'payroll', 'payroll_approve', 'backup']) {
    eq(canAccess(as('admin', empty), f, 'edit', 'emp3'), true, f);
  }
  eq(readable('admin', 'role_permissions', {}, empty), true);
});

test('an employee sees only their own people-data', () => {
  eq(readable('emp1', 'profiles', { id: 'emp1' }), true);
  eq(readable('emp1', 'profiles', { id: 'emp2' }), false);          // even on the same team
  eq(readable('emp1', 'attendance', { employee_id: 'emp1' }), true);
  eq(readable('emp1', 'attendance', { employee_id: 'emp2' }), false);
  eq(readable('emp1', 'salary_structures', { employee_id: 'emp1' }), true);
  eq(readable('emp1', 'salary_structures', { employee_id: 'emp2' }), false);
  eq(readable('emp1', 'adjustments', { employee_id: 'emp1' }), false);
  eq(readable('emp1', 'payroll_runs', {}), false);
  eq(readable('emp1', 'role_permissions', {}), false);
  eq(readable('emp1', 'shifts', {}), true);                          // the app needs these everywhere
});

test('payslips: an employee sees their own only after the month is approved', () => {
  const slip = { employee_id: 'emp1', run_id: 'r1' };
  eq(readable('emp1', 'payslips', slip, mkdb({ payroll_runs: [{ id: 'r1', month: '2026-09-01', status: 'draft' }] })), false);
  eq(readable('emp1', 'payslips', slip, mkdb({ payroll_runs: [{ id: 'r1', month: '2026-09-01', status: 'approved' }] })), true);
  eq(readable('emp2', 'payslips', slip, mkdb({ payroll_runs: [{ id: 'r1', month: '2026-09-01', status: 'approved' }] })), false);
});

test('a supervisor sees the team, not other teams, and no pay', () => {
  eq(readable('sup1', 'profiles', { id: 'emp1' }), true);
  eq(readable('sup1', 'profiles', { id: 'emp3' }), false);
  eq(readable('sup1', 'attendance', { employee_id: 'emp2' }), true);
  eq(readable('sup1', 'attendance', { employee_id: 'emp3' }), false);
  eq(readable('sup1', 'leave_requests', { employee_id: 'emp1' }), true);
  eq(readable('sup1', 'leave_requests', { employee_id: 'emp3' }), false);
  eq(readable('sup1', 'salary_structures', { employee_id: 'emp1' }), false);
  eq(readable('sup1', 'payroll_runs', {}), false);
  eq(readable('sup1', 'attendance_edits', {}), false);               // the audit log is for "all" scopes
});

test('supervisor and assistant supervisor have exactly the same access', () => {
  const checks = [
    ['attendance', 'view', 'emp1'], ['attendance', 'edit', 'emp1'], ['attendance', 'edit', 'emp3'],
    ['leave_approvals', 'edit', 'emp2'], ['employees', 'view', 'emp1'], ['employees', 'edit', 'emp1'],
    ['salaries', 'view', 'emp1'], ['payroll', 'view', null],
  ];
  for (const [feature, level, target] of checks) {
    eq(canAccess(as('asst1'), feature, level, target), canAccess(as('sup1'), feature, level, target), `${feature}/${level}/${target}`);
  }
});

test('a supervisor who is on no team sees nobody', () => {
  eq(readable('lonesup', 'attendance', { employee_id: 'emp1' }), false);
  eq(readable('lonesup', 'attendance', { employee_id: 'lonesup' }), true);   // still sees themself
  eq(canAccess(as('lonesup'), 'leave_approvals', 'edit', 'lone'), false);
});

test('the assistant manager sees everyone and the operational data, but not the matrix', () => {
  eq(readable('hr', 'attendance', { employee_id: 'emp3' }), true);
  eq(readable('hr', 'salary_structures', { employee_id: 'emp3' }), true);
  eq(readable('hr', 'payroll_runs', {}), true);
  eq(readable('hr', 'attendance_edits', {}), true);
  eq(readable('hr', 'role_permissions', {}), false);
});

test('time edit by a supervisor: own team, with a reason, never themself', () => {
  editAtt('sup1', 'emp1');                                          // passes
  throwsCode(() => editAtt('sup1', 'emp3'), 'forbidden');           // other team
  throwsCode(() => editAtt('sup1', 'sup1'), 'self_edit');           // their own record
  throwsCode(() => editAtt('sup1', 'emp1', { note: '   ' }), 'reason_required');
  throwsCode(() => editAtt('sup1', 'emp1', { note: null }), 'reason_required');
  throwsCode(() => editAtt('sup1', 'emp1', { edited_by: 'someone-else' }), 'forbidden');
  throwsCode(() => editAtt('emp1', 'emp2'), 'forbidden');           // employees have no edit right at all
  addAtt('sup1', 'emp2');                                           // a missing record can be added
  throwsCode(() => addAtt('sup1', 'emp2', { note: '' }), 'reason_required');
});

test('a reason must be new on every edit', () => {
  const old = attRow('emp1', { note: 'نسي الانصراف' });
  throwsCode(() => checkWrite(as('sup1'), 'attendance', 'update', { ...old, edited_by: 'sup1' }, old), 'reason_required');
  checkWrite(as('sup1'), 'attendance', 'update', { ...old, note: 'تصحيح تاني', edited_by: 'sup1' }, old);
});

test('nobody edits their own attendance except the admin', () => {
  throwsCode(() => editAtt('hr', 'hr'), 'self_edit');
  editAtt('admin', 'admin');
  editAtt('hr', 'emp1');                                            // the assistant manager can edit anyone on their teams
});

test('after payroll is approved only the assistant manager and admin can still edit that month', () => {
  const locked = () => mkdb({ payroll_runs: [{ id: 'r1', month: '2026-10-01', status: 'approved' }] });
  throwsCode(() => editAtt('sup1', 'emp1', {}, locked()), 'month_locked');
  editAtt('hr', 'emp1', {}, locked());
  editAtt('admin', 'emp1', {}, locked());
  editAtt('sup1', 'emp1', {}, mkdb({ payroll_runs: [{ id: 'r1', month: '2026-10-01', status: 'draft' }] }));   // a draft does not lock
  editAtt('sup1', 'emp1', { work_date: '2026-10-10' }, mkdb({ payroll_runs: [{ id: 'r0', month: '2026-09-01', status: 'paid' }] }));   // another month
});

test('excused / absent has its own permission', () => {
  throwsCode(() => editAtt('sup1', 'emp1', { status: 'excused' }), 'forbidden_status');
  throwsCode(() => addAtt('sup1', 'emp1', { status: 'absent' }), 'forbidden_status');
  editAtt('hr', 'emp1', { status: 'excused' });
  addAtt('hr', 'emp1', { status: 'absent' });
  const db = mkdb();
  setAccess(db, 'supervisor', 'attendance_excuse', 'team_edit');
  editAtt('sup1', 'emp1', { status: 'excused' }, db);               // the admin can grant it
});

test('only the admin deletes attendance records and people', () => {
  throwsCode(() => checkWrite(as('hr'), 'attendance', 'delete', null, attRow('emp1')), 'forbidden');
  throwsCode(() => checkWrite(as('sup1'), 'attendance', 'delete', null, attRow('emp1')), 'forbidden');
  checkWrite(as('admin'), 'attendance', 'delete', null, attRow('emp1'));
  throwsCode(() => checkWrite(as('hr'), 'profiles', 'delete', null, profiles[4]), 'forbidden');
  checkWrite(as('admin'), 'profiles', 'delete', null, profiles[4]);
});

test('leave approval: the supervisor decides for the team, nobody for themself except the admin', () => {
  const decide = (actor, employee, changes = {}) => {
    const old = { id: 'l1', employee_id: employee, status: 'pending', decided_by: null };
    checkWrite(as(actor), 'leave_requests', 'update', { ...old, status: 'approved', decided_by: actor, ...changes }, old);
  };
  decide('sup1', 'emp1');
  decide('asst1', 'emp1');
  decide('hr', 'emp3');
  throwsCode(() => decide('sup1', 'emp3'), 'forbidden');            // another team
  throwsCode(() => decide('sup1', 'sup1'), 'forbidden');            // their own
  throwsCode(() => decide('hr', 'hr'), 'forbidden');
  decide('admin', 'admin');
  throwsCode(() => decide('emp1', 'emp2'), 'forbidden');
  throwsCode(() => decide('sup1', 'emp1', { decided_by: 'someone-else' }), 'forbidden');
});

test('employees file and withdraw only their own pending leave', () => {
  const ctx = as('emp1');
  checkWrite(ctx, 'leave_requests', 'insert', { employee_id: 'emp1', status: 'pending' }, null);
  throwsCode(() => checkWrite(ctx, 'leave_requests', 'insert', { employee_id: 'emp2', status: 'pending' }, null), 'forbidden');
  throwsCode(() => checkWrite(ctx, 'leave_requests', 'insert', { employee_id: 'emp1', status: 'approved' }, null), 'forbidden');
  checkWrite(ctx, 'leave_requests', 'delete', null, { employee_id: 'emp1', status: 'pending' });
  throwsCode(() => checkWrite(ctx, 'leave_requests', 'delete', null, { employee_id: 'emp1', status: 'approved' }), 'forbidden');
  throwsCode(() => checkWrite(ctx, 'leave_requests', 'delete', null, { employee_id: 'emp2', status: 'pending' }), 'forbidden');
});

test('the assistant manager cannot touch admin accounts or hand out manager / admin roles', () => {
  const change = (actor, id, changes) => {
    const old = profiles.find((p) => p.id === id);
    checkWrite(as(actor), 'profiles', 'update', { ...old, ...changes }, old);
  };
  change('hr', 'emp1', { phone: '010' });
  change('hr', 'emp1', { role: 'supervisor' });                    // employee <-> supervisor is fine
  change('hr', 'sup1', { role: 'employee' });
  change('hr', 'emp1', { team_id: 'B' });
  throwsCode(() => change('hr', 'emp1', { role: 'admin' }), 'role_forbidden');
  throwsCode(() => change('hr', 'emp1', { role: 'manager' }), 'role_forbidden');     // read-only manager is admin-only
  throwsCode(() => change('hr', 'emp1', { role: 'assistant_manager' }), 'role_forbidden');
  throwsCode(() => change('hr', 'admin', { phone: '010' }), 'role_forbidden');
  throwsCode(() => change('hr', 'hr', { role: 'employee' }), 'role_forbidden');   // no demoting yourself or a peer
  throwsCode(() => change('hr', 'hr', { active: false }), 'role_forbidden');
  change('admin', 'emp1', { role: 'manager' });
  change('admin', 'hr', { role: 'employee' });
});

test('a supervisor cannot edit people unless the admin allows it', () => {
  const old = profiles.find((p) => p.id === 'emp1');
  throwsCode(() => checkWrite(as('sup1'), 'profiles', 'update', { ...old, phone: '1' }, old), 'forbidden');
  const db = mkdb();
  setAccess(db, 'supervisor', 'employees', 'team_edit');
  checkWrite(as('sup1', db), 'profiles', 'update', { ...old, phone: '1' }, old);                     // own team
  const other = profiles.find((p) => p.id === 'emp3');
  throwsCode(() => checkWrite(as('sup1', db), 'profiles', 'update', { ...other, phone: '1' }, other), 'forbidden');
  throwsCode(() => checkWrite(as('sup1', db), 'profiles', 'update', { ...old, role: 'assistant_manager' }, old), 'role_forbidden');   // still no role hand-outs
});

test('approving payroll needs its own permission', () => {
  const run = { id: 'r1', month: '2026-10-01', status: 'draft' };
  const approve = (actor, db) => checkWrite(as(actor, db), 'payroll_runs', 'update', { ...run, status: 'approved' }, run);
  checkWrite(as('hr'), 'payroll_runs', 'update', run, run);          // editing a draft is fine
  throwsCode(() => approve('hr'), 'forbidden');
  throwsCode(() => checkWrite(as('hr'), 'payroll_runs', 'insert', { ...run, status: 'approved' }, null), 'forbidden');
  approve('admin');
  const db = mkdb();
  setAccess(db, 'assistant_manager', 'payroll_approve', 'all_edit');
  approve('hr', db);                                                // the admin can let an assistant manager approve too
  throwsCode(() => approve('sup1'), 'forbidden');
});

test('setup, rules and teams follow their permissions', () => {
  checkWrite(as('hr'), 'shifts', 'update', {}, {});
  checkWrite(as('hr'), 'teams', 'insert', { name: 'x' }, null);
  throwsCode(() => checkWrite(as('hr'), 'settings', 'update', {}, {}), 'forbidden');   // rules are view-only for the assistant manager
  checkWrite(as('admin'), 'settings', 'update', {}, {});
  throwsCode(() => checkWrite(as('sup1'), 'shifts', 'update', {}, {}), 'forbidden');
  throwsCode(() => checkWrite(as('sup1'), 'teams', 'insert', { name: 'x' }, null), 'forbidden');
  throwsCode(() => checkWrite(as('emp1'), 'work_locations', 'update', {}, {}), 'forbidden');
});

test('salaries and adjustments follow their permissions', () => {
  checkWrite(as('hr'), 'salary_structures', 'update', { employee_id: 'emp1' }, { employee_id: 'emp1' });
  checkWrite(as('hr'), 'adjustments', 'insert', { employee_id: 'emp1' }, null);
  throwsCode(() => checkWrite(as('sup1'), 'salary_structures', 'update', { employee_id: 'emp1' }, { employee_id: 'emp1' }), 'forbidden');
  throwsCode(() => checkWrite(as('emp1'), 'adjustments', 'insert', { employee_id: 'emp1' }, null), 'forbidden');
});

test('changing the matrix changes what a role can do', () => {
  const db = mkdb();
  eq(canAccess(as('sup1', db), 'leave_approvals', 'edit', 'emp1'), true);
  setAccess(db, 'supervisor', 'leave_approvals', 'none');
  eq(canAccess(as('sup1', db), 'leave_approvals', 'edit', 'emp1'), false);
  eq(readable('sup1', 'leave_requests', { employee_id: 'emp1' }, db), false);
  setAccess(db, 'supervisor', 'salaries', 'all_view');
  eq(readable('sup1', 'salary_structures', { employee_id: 'emp3' }, db), true);                      // "all" reaches other teams
  setAccess(db, 'supervisor', 'attendance', 'all_view');
  eq(readable('sup1', 'attendance', { employee_id: 'emp3' }, db), true);
  eq(readable('sup1', 'attendance_edits', {}, db), true);
  throwsCode(() => editAtt('sup1', 'emp1', {}, db), 'forbidden');                                    // view-only now
  setAccess(db, 'employee', 'attendance', 'team_view');
  eq(readable('emp1', 'attendance', { employee_id: 'emp2' }, db), true);                              // an employee can be given a team view
});

test('national ids: the owner and anyone granted the feature, nobody else', () => {
  eq(readable('emp1', 'profile_private', { id: 'emp1' }), true);
  eq(readable('emp1', 'profile_private', { id: 'emp2' }), false);        // same team, still private
  eq(readable('sup1', 'profile_private', { id: 'emp1' }), false);        // a supervisor never sees them by default
  eq(readable('hr', 'profile_private', { id: 'emp3' }), true);
  eq(readable('admin', 'profile_private', { id: 'emp3' }), true);
  checkWrite(as('hr'), 'profile_private', 'update', { id: 'emp1', national_id: '29912121234565' }, { id: 'emp1' });
  throwsCode(() => checkWrite(as('sup1'), 'profile_private', 'update', { id: 'emp1' }, { id: 'emp1' }), 'forbidden');
  throwsCode(() => checkWrite(as('emp1'), 'profile_private', 'update', { id: 'emp1' }, { id: 'emp1' }), 'forbidden');   // not even your own
  const db = mkdb();
  setAccess(db, 'assistant_manager', 'national_ids', 'none');
  eq(readable('hr', 'profile_private', { id: 'emp3' }, db), false);      // the admin can take it away from HR
  setAccess(db, 'supervisor', 'national_ids', 'all_view');
  eq(readable('sup1', 'profile_private', { id: 'emp3' }, db), true);     // or give it to supervisors
});

test('job titles are readable by everyone and changed only with the setup permission', () => {
  eq(readable('emp1', 'job_titles', { name: 'موظف' }), true);
  checkWrite(as('hr'), 'job_titles', 'insert', { name: 'كاشير' }, null);
  throwsCode(() => checkWrite(as('sup1'), 'job_titles', 'insert', { name: 'كاشير' }, null), 'forbidden');
  throwsCode(() => checkWrite(as('emp1'), 'job_titles', 'update', { name: 'x' }, { name: 'y' }), 'forbidden');
});

test('only the admin reads or writes the matrix', () => {
  eq(readable('hr', 'role_permissions', {}), false);
  throwsCode(() => checkWrite(as('hr'), 'role_permissions', 'update', {}, {}), 'forbidden');
  checkWrite(as('admin'), 'role_permissions', 'update', {}, {});
});

test('UI helpers: can(), scopeOf(), assignableRoles()', () => {
  const sup = { role: 'supervisor', access: { attendance: 'team_edit', leave_approvals: 'team_view', salaries: 'none' } };
  eq(can(sup, 'attendance', 'edit'), true);
  eq(can(sup, 'leave_approvals', 'view'), true);
  eq(can(sup, 'leave_approvals', 'edit'), false);
  eq(can(sup, 'salaries'), false);
  eq(can(sup, 'unknown'), false);
  eq(scopeOf(sup, 'attendance'), 'team');
  eq(scopeOf(sup, 'salaries'), 'none');
  eq(can({ role: 'admin', access: {} }, 'backup', 'edit'), true);
  eq(scopeOf({ role: 'admin', access: {} }, 'attendance'), 'all');
  eq(assignableRoles('admin'), ['employee', 'supervisor', 'assistant_manager', 'manager', 'admin']);
  eq(assignableRoles('assistant_manager'), ['employee', 'supervisor']);
  eq(assignableRoles('supervisor'), ['employee']);
});

// ---- supervisors are peers, managers own several teams -------------------------------
// Two supervisors share team A. A supervisor reviews the employees on the team; a peer
// supervisor is not part of their scope, otherwise two supervisors could edit each other.
test('a supervisor does not review another supervisor on the same team', () => {
  eq(readable('sup1', 'profiles', { id: 'asst1' }), false);
  eq(canAccess(as('sup1'), 'attendance', 'edit', 'asst1'), false);
  eq(canAccess(as('asst1'), 'attendance', 'edit', 'sup1'), false);
  eq(canAccess(as('sup1'), 'leave_approvals', 'edit', 'asst1'), false);
  // The employees of that team stay in scope for both of them.
  eq(canAccess(as('asst1'), 'attendance', 'edit', 'emp1'), true);
  // And each still sees themself.
  eq(canAccess(as('sup1'), 'attendance', 'view', 'sup1'), true);
});

// 4 managers, 12 teams with 2 supervisors each: a manager sees the 3 teams they own.
const OWNED_NAMES = ['A1', 'A2', 'A3'];
const ownedProfiles = [
  { id: 'admin', role: 'admin', team_id: null, active: true },
  { id: 'hr4', role: 'assistant_manager', team_id: null, active: true },
  { id: 'hr1', role: 'assistant_manager', team_id: null, active: true },
  ...OWNED_NAMES.flatMap((t) => [
    { id: `sup-${t}-1`, role: 'supervisor', team_id: t, active: true },
    { id: `sup-${t}-2`, role: 'supervisor', team_id: t, active: true },
    { id: `emp-${t}`, role: 'employee', team_id: t, active: true },
  ]),
  { id: 'sup-B1', role: 'supervisor', team_id: 'B1', active: true },
  { id: 'emp-B1', role: 'employee', team_id: 'B1', active: true },
];
const ownedTeams = [
  ...OWNED_NAMES.map((name) => ({ id: name, name, manager_id: 'hr4' })),
  { id: 'B1', name: 'B1', manager_id: 'hr1' },
];
const org = () => mkdb({ profiles: ownedProfiles, teams: ownedTeams });

test('a manager covers only the teams they own, supervisors and employees alike', () => {
  // 'employees' defaults to all_edit for HR, so switch it to a team scope to exercise the rule.
  const orgDb = setAccess(org(), 'assistant_manager', 'employees', 'team_view');
  const hr4 = { user: ownedProfiles.find((p) => p.id === 'hr4'), db: orgDb };
  eq(canAccess(hr4, 'employees', 'view', 'emp-A1'), true, 'own team employee:');
  eq(canAccess(hr4, 'employees', 'view', 'sup-A2-2'), true, 'own team supervisor:');
  eq(canAccess(hr4, 'employees', 'view', 'emp-A3'), true, 'third owned team:');
  eq(canAccess(hr4, 'employees', 'view', 'emp-B1'), false, 'other manager employee:');
  eq(canAccess(hr4, 'employees', 'view', 'sup-B1'), false, 'other manager supervisor:');
  const hr1 = { user: ownedProfiles.find((p) => p.id === 'hr1'), db: orgDb };
  eq(canAccess(hr1, 'employees', 'view', 'emp-B1'), true, 'hr1 own team:');
  eq(canAccess(hr1, 'employees', 'view', 'emp-A1'), false, 'hr1 other manager team:');
});

test('a manager who owns no team falls back to their own team, not to everyone', () => {
  // hr owns nothing and is on no team: "team" scope reaches nobody but themself.
  const noTeam = setAccess(mkdb({ teams: ownedTeams }), 'assistant_manager', 'employees', 'team_view');
  eq(canAccess(as('hr', noTeam), 'employees', 'view', 'emp1'), false, 'no team, no ownership:');
  eq(canAccess(as('hr', noTeam), 'employees', 'view', 'hr'), true, 'sees self:');
  // A manager on a team, owning none, still covers that team.
  const onTeam = setAccess(
    mkdb({ profiles: [...profiles, { id: 'hr2', role: 'assistant_manager', team_id: 'B', active: true }], teams: ownedTeams }),
    'assistant_manager', 'employees', 'team_view',
  );
  eq(canAccess({ user: onTeam.profiles.find((p) => p.id === 'hr2'), db: onTeam }, 'employees', 'view', 'emp3'), true, 'falls back to own team:');
  eq(canAccess({ user: onTeam.profiles.find((p) => p.id === 'hr2'), db: onTeam }, 'employees', 'view', 'emp1'), false, 'other team:');
  // The "all" scopes are unaffected.
  eq(canAccess(as('hr', setAccess(noTeam, 'assistant_manager', 'employees', 'all_view')), 'employees', 'view', 'emp3'), true, 'all scope:');
});

test('teamsOf lists the owned teams, or the single team someone belongs to', () => {
  const db = org();
  eq(teamsOf(ownedProfiles.find((p) => p.id === 'hr4'), ownedTeams), OWNED_NAMES);
  eq(teamsOf(ownedProfiles.find((p) => p.id === 'sup-A1-1'), ownedTeams), ['A1']);
  eq(teamsOf(null, ownedTeams), []);
});

// ---- the chain of responsibility: admin > manager > assistant_manager > supervisor > employee
test('the manager sees everything and edits nothing, whatever the matrix says', () => {
  const db = mkdb();
  // Every feature is visible...
  for (const feature of ['attendance', 'employees', 'salaries', 'payroll', 'national_ids', 'setup', 'rules']) {
    eq(canAccess(as('mgr', db), feature, 'view', 'emp3'), true, `view ${feature}:`);
  }
  // ...and none can be edited, even if someone writes an edit level into the matrix.
  for (const feature of ['attendance', 'employees', 'salaries', 'payroll', 'adjustments', 'setup']) {
    eq(canAccess(as('mgr', db), feature, 'edit', 'emp1'), false, `edit ${feature}:`);
  }
  const forced = mkdb();
  forced.role_permissions.find((p) => p.role === 'manager' && p.feature === 'employees').access = 'all_edit';
  eq(canAccess(as('mgr', forced), 'employees', 'edit', 'emp1'), false, 'forced all_edit:');
  eq(accessOf('manager', 'employees', forced.role_permissions), 'all_view', 'downgraded to view:');
});

test('the read-only manager is refused by every write path', () => {
  throwsCode(() => editAtt('mgr', 'emp1'), 'forbidden');
  throwsCode(() => addAtt('mgr', 'emp1'), 'forbidden');
  throwsCode(() => checkWrite(as('mgr'), 'profiles', 'update', { ...profiles[4], phone: '1' }, profiles[4]), 'forbidden');
  throwsCode(() => checkWrite(as('mgr'), 'leave_requests', 'update',
    { id: 'l1', employee_id: 'emp1', status: 'approved', decided_by: 'mgr' }, { id: 'l1', employee_id: 'emp1', status: 'pending' }), 'forbidden');
  throwsCode(() => checkWrite(as('mgr'), 'payroll_runs', 'insert', { status: 'draft' }, null), 'forbidden');
  throwsCode(() => checkWrite(as('mgr'), 'shifts', 'update', {}, {}), 'forbidden');
  throwsCode(() => checkWrite(as('mgr'), 'role_permissions', 'update', {}, {}), 'forbidden');
});

test('the manager reads every team, not just one', () => {
  eq(readable('mgr', 'attendance', { employee_id: 'emp1' }), true);
  eq(readable('mgr', 'attendance', { employee_id: 'emp3' }), true);
  eq(readable('mgr', 'salary_structures', { employee_id: 'emp3' }), true);
  eq(readable('mgr', 'attendance_edits', {}), true);
});

test('the manager never approves payroll, and the admin still outranks them', () => {
  const run = { id: 'r1', month: '2026-10-01', status: 'draft' };
  throwsCode(() => checkWrite(as('mgr'), 'payroll_runs', 'update', { ...run, status: 'approved' }, run), 'forbidden');
  eq(accessOf('manager', 'payroll_approve', mkdb().role_permissions), 'all_view');   // visible, not granted
  eq(canAccess(as('mgr'), 'payroll_approve', 'edit'), false);
  eq(accessOf('admin', 'payroll_approve', mkdb().role_permissions), 'all_edit');
});

test('the ranks follow admin > manager > assistant_manager > supervisor > employee', () => {
  eq(rankOf('admin') > rankOf('manager'), true);
  eq(rankOf('manager') > rankOf('assistant_manager'), true);
  eq(rankOf('assistant_manager') > rankOf('supervisor'), true);
  eq(rankOf('supervisor') > rankOf('employee'), true);
  eq(rankOf('nonsense'), -1);
});

test('the matrix has a column for every job title, and a default for each', () => {
  eq([...MATRIX_ROLES].sort(), ['assistant_manager', 'employee', 'manager', 'supervisor']);
  for (const role of MATRIX_ROLES) eq(DEFAULT_PERMISSIONS[role] !== undefined, true, `${role}:`);
  eq(DEFAULT_PERMISSIONS.manager.attendance, 'all_view');
  eq(DEFAULT_PERMISSIONS.supervisor.attendance, 'team_edit');
  eq(DEFAULT_PERMISSIONS.assistant_manager.attendance, 'all_edit');
  // The manager default never contains an edit level.
  eq(Object.values(DEFAULT_PERMISSIONS.manager).some((a) => a.endsWith('_edit')), false);
});

test('the assistant manager can staff someone as a supervisor but not as a peer or a manager', () => {
  const change = (id, changes) => {
    const old = profiles.find((p) => p.id === id);
    checkWrite(as('hr'), 'profiles', 'update', { ...old, ...changes }, old);
  };
  change('emp1', { role: 'supervisor' });
  throwsCode(() => change('emp1', { role: 'assistant_manager' }), 'role_forbidden');
  throwsCode(() => change('emp1', { role: 'manager' }), 'role_forbidden');
  throwsCode(() => change('emp1', { role: 'admin' }), 'role_forbidden');
});
