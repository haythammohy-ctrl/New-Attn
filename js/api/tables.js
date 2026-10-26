// How save() decides "update or insert" per table. Shared by both backends so they behave alike.
// Tables listed here are upserted on these columns; every other table is keyed by `id`.
// Attendance is deliberately not listed: manual edits must be a real insert or update, because the
// database guards (reason, audit log) look at which one it is. check_in() handles its own upsert.
export const UNIQUE = {
  settings: 'id',
  salary_structures: 'employee_id',
  role_permissions: 'role,feature',
  profile_private: 'id',
  payroll_runs: 'month',
  payslips: 'run_id,employee_id',
};

// Primary key used by remove() and as the default ordering.
export const PK = { salary_structures: 'employee_id', role_permissions: 'feature' };

// Ordered by foreign-key dependencies so export/restore maintains referential integrity.
export const TABLES_ORDER = [
  'settings', 'work_locations', 'shifts', 'teams', 'job_titles', 'profiles', 'profile_private',
  'salary_structures', 'role_permissions', 'leave_types', 'holidays', 'leave_requests',
  'attendance', 'attendance_edits', 'adjustments', 'payroll_runs', 'payslips',
];

