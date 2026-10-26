import { test, eq } from './harness.js';
import { validateBackup, TABLES } from '../js/components/backup.js';

test('validateBackup: rejects null or non-object', () => {
  eq(validateBackup(null).valid, false);
  eq(validateBackup('string').valid, false);
});

test('validateBackup: rejects invalid app identifier', () => {
  eq(validateBackup({ app: 'wrong-app', tables: {} }).valid, false);
});

test('validateBackup: rejects missing tables', () => {
  eq(validateBackup({ app: 'attendance-payroll' }).valid, false);
});

test('validateBackup: accepts valid backup structure and counts rows', () => {
  const dummy = {
    app: 'attendance-payroll',
    exported_at: '2026-10-20T22:00:00Z',
    tables: {
      settings: [{ id: 's1' }],
      profiles: [{ id: 'p1' }, { id: 'p2' }],
      attendance: [],
    },
  };
  const res = validateBackup(dummy);
  eq(res.valid, true);
  eq(res.summary.settings, 1);
  eq(res.summary.profiles, 2);
  eq(res.summary.attendance, 0);
  eq(res.exported_at, '2026-10-20T22:00:00Z');
});

test('TABLES list contains core schema tables in dependency order', () => {
  eq(TABLES.includes('settings'), true);
  eq(TABLES.includes('profiles'), true);
  eq(TABLES.includes('attendance'), true);
  eq(TABLES.includes('payslips'), true);
  // Settings and locations should come before profiles and attendance
  eq(TABLES.indexOf('settings') < TABLES.indexOf('profiles'), true);
  eq(TABLES.indexOf('profiles') < TABLES.indexOf('attendance'), true);
});

