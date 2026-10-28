import { test, eq } from './harness.js';
import { eachDate, weekday } from '../js/lib/dates.js';
import { calcPayslip, shiftHours } from '../js/lib/payroll.js';

// September 2026: Sun-Thu shift, Fri/Sat off, plus a public holiday on Thu 10th -> 21 working days.
const shift = { start_time: '09:00:00', end_time: '17:00:00', grace_minutes: 10, working_days: [0, 1, 2, 3, 4] };
const settings = {
  days_in_month_mode: '30', overtime_multiplier: 1.5, late_factor: 1, absence_factor: 1,
};
const holidays = [{ date: '2026-09-10' }];
const leaveTypes = [{ id: 'annual', paid: true }, { id: 'unpaid', paid: false }];
const employee = { id: 'e1', hire_date: '2020-01-01' };
const salary = { base_salary: 3000, allowances: [{ name: 'transport', amount: 500 }, { name: 'meal', amount: 200 }] };

const workDays = eachDate('2026-09-01', '2026-09-30')
  .filter((d) => shift.working_days.includes(weekday(d)) && d !== '2026-09-10');

// Present every working day except: 13th and 14th absent, 15th paid leave, 16th unpaid leave.
// Lateness on the 1st (30 min) and 2nd (15 min), early leave on the 3rd (15 min), overtime on the 6th (60 min).
function buildAttendance() {
  const missing = new Set(['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16']);
  const extra = {
    '2026-09-01': { late_minutes: 30 },
    '2026-09-02': { late_minutes: 15 },
    '2026-09-03': { early_leave_minutes: 15 },
    '2026-09-06': { overtime_minutes: 60 },
  };
  return workDays.filter((d) => !missing.has(d)).map((d) => ({
    work_date: d, check_in_at: `${d}T06:00:00Z`, status: 'present',
    late_minutes: 0, early_leave_minutes: 0, overtime_minutes: 0, ...(extra[d] || {}),
  }));
}

const leaves = [
  { status: 'approved', leave_type_id: 'annual', from_date: '2026-09-15', to_date: '2026-09-15' },
  { status: 'approved', leave_type_id: 'unpaid', from_date: '2026-09-16', to_date: '2026-09-16' },
  { status: 'pending', leave_type_id: 'annual', from_date: '2026-09-20', to_date: '2026-09-20' },
];
const adjustments = [
  { month: '2026-09-01', type: 'bonus', amount: 200 },
  { month: '2026-09-01', type: 'deduction', amount: 50 },
  { month: '2026-09-01', type: 'advance', amount: 300 },
  { month: '2026-08-01', type: 'bonus', amount: 999 },
];

const run = (overrides = {}) => calcPayslip({
  month: '2026-09', today: '2026-10-05', employee, salary, shifts: [shift], settings,
  attendance: buildAttendance(), holidays, leaves, leaveTypes, adjustments, ...overrides,
});

test('shiftHours: 09:00-17:00 is 8 hours', () => {
  eq(shiftHours(shift), 8);
});

test('full month: counts days per category', () => {
  const { details } = run();
  eq(details.days, {
    present: 17, absent: 2, paidLeave: 1, unpaidLeave: 1, excused: 0,
    dayOff: 0, publicHoliday: 0, pendingReview: 0,
  });
  eq(details.late_minutes, 45);
  eq(details.early_leave_minutes, 15);
  eq(details.overtime_minutes, 60);
  eq(details.daily_rate, 100);
  eq(details.hourly_rate, 12.5);
});

test('full month: every payslip line matches the hand calculation', () => {
  const p = run();
  eq(p.base_salary, 3000);
  eq(p.allowances_total, 700);
  eq(p.absence_deduction, 300);   // (2 absent + 1 unpaid leave) x 100
  eq(p.late_deduction, 12.5);     // (45 late + 15 early) min = 1h x 12.5
  eq(p.overtime_pay, 18.75);      // 1h x 12.5 x 1.5
  eq(p.bonuses, 200);             // the August bonus is ignored
  eq(p.other_deductions, 50);
  eq(p.advances, 300);
  eq(p.net, 3256.25);
  eq(p.month, '2026-09-01');
});

test('mid-month run does not treat future days as absent', () => {
  const p = run({ today: '2026-09-15' });
  eq(p.details.days.absent, 2);
  eq(p.details.days.paidLeave, 1);
  eq(p.details.days.unpaidLeave, 0);   // the 16th has not happened yet
  eq(p.absence_deduction, 200);
});

test('days before the hire date are never absences', () => {
  const p = run({ employee: { id: 'e1', hire_date: '2026-09-20' }, attendance: [] });
  eq(p.details.days.absent, 9);        // Sun-Thu on 20-24 and 27-30
});

test('an excused day carries no deduction', () => {
  const attendance = [...buildAttendance(), { work_date: '2026-09-13', check_in_at: null, status: 'excused' }];
  const p = run({ attendance });
  eq(p.details.days.excused, 1);
  eq(p.details.days.absent, 1);
  eq(p.absence_deduction, 200);
});

test('calendar-day mode divides by the real month length', () => {
  const p = run({ settings: { ...settings, days_in_month_mode: 'actual' } });
  eq(p.details.daily_rate, 100);       // Sept has 30 days, same as the fixed basis
  const feb = calcPayslip({
    month: '2026-02', today: '2026-03-05', employee, salary: { base_salary: 2800, allowances: [] },
    shifts: [shift], settings: { ...settings, days_in_month_mode: 'actual' },
    attendance: [], holidays: [], leaves: [], leaveTypes, adjustments: [],
  });
  eq(feb.details.daily_rate, 100);     // 2800 / 28
});

test('missing salary gives zero base without crashing', () => {
  const p = run({ salary: null, attendance: buildAttendance() });
  eq(p.base_salary, 0);
  eq(p.net, p.overtime_pay + p.bonuses - p.other_deductions - p.advances);
});

// ---- employees pick their own shift at check-in ----
const morning = { id: 'morning', name: 'صباحي', start_time: '09:00:00', end_time: '17:00:00', grace_minutes: 10, working_days: [0, 1, 2, 3, 4] };
const night = { id: 'night', name: 'ليلي', start_time: '23:00:00', end_time: '07:00:00', grace_minutes: 10, working_days: [0, 1, 2, 3, 4] };
const night10 = { id: 'night10', name: 'ليلي طويل', start_time: '23:00:00', end_time: '09:00:00', grace_minutes: 10, working_days: [0, 1, 2, 3, 4] };
const row = (date, shift_id, extra = {}) => ({
  work_date: date, shift_id, check_in_at: `${date}T20:00:00Z`, late_minutes: 0, early_leave_minutes: 0, overtime_minutes: 0, ...extra,
});

// September 2026: Tue 1st .. Sat 5th. Sun-Thu shifts -> the 1st, 2nd and 3rd are working days.
const pick = (overrides) => calcPayslip({
  month: '2026-09', today: '2026-09-05', employee, salary: { base_salary: 3000, allowances: [] },
  shifts: [morning, night, night10], settings, leaveTypes, holidays: [], leaves: [], adjustments: [], attendance: [],
  ...overrides,
});

test('shift choice: a missed day is absent only when some shift runs that weekday', () => {
  const p = pick({ attendance: [row('2026-09-01', 'night', { late_minutes: 20 })] });
  eq(p.details.days, {
    present: 1, absent: 2, paidLeave: 0, unpaidLeave: 0, excused: 0,
    dayOff: 0, publicHoliday: 0, pendingReview: 0,
  });   // the 2nd and 3rd; Fri and Sat are free
  eq(p.absence_deduction, 200);
  eq(p.late_deduction, 4.17);        // 20 min x 12.5/h
  eq(p.net, 2795.83);
});

test('shift choice: a weekday that only another shift covers still counts as a working day', () => {
  const weekend = { id: 'we', name: 'ويك إند', start_time: '09:00:00', end_time: '17:00:00', grace_minutes: 10, working_days: [5, 6] };
  const p = pick({ shifts: [morning, weekend] });
  eq(p.details.days.absent, 5);      // the 1st, 2nd, 3rd (Sun-Thu shift) plus Fri 4th and Sat 5th (weekend shift)
});

test('shift choice: each day is priced by the shift actually worked (a 10h shift has a cheaper hour)', () => {
  const p = pick({
    today: '2026-09-01',
    attendance: [row('2026-09-01', 'night10', { late_minutes: 30 })],
  });
  eq(p.late_deduction, 5);           // 0.5 h x (100 / 10 h)
  eq(p.net, 2995);
});

test('shift choice: a row without a recorded shift is priced like the shift worked most that month', () => {
  const p = pick({
    today: '2026-09-03',
    attendance: [row('2026-09-01', 'night10'), row('2026-09-02', 'night10'), row('2026-09-03', null, { late_minutes: 60 })],
  });
  eq(p.late_deduction, 10);          // 1 h x (100 / 10 h); an 8h shift would have cost 12.5
});

test('shift choice: with no shifts defined nobody is absent', () => {
  const p = pick({ shifts: [], today: '2026-09-30' });
  eq(p.details.days.absent, 0);
  eq(p.net, 3000);
});

test('negative net is flagged', () => {
  const p = run({ adjustments: [{ month: '2026-09-01', type: 'advance', amount: 99999 }] });
  eq(p.details.negative_net, true);
});

test('day-off and public-holiday leave types exempt scheduled workdays', () => {
  const p = run({
    attendance: [],
    leaves: [
      { status: 'approved', leave_type_id: 'day-off', from_date: '2026-09-01', to_date: '2026-09-01' },
      { status: 'approved', leave_type_id: 'public-holiday', from_date: '2026-09-02', to_date: '2026-09-02' },
    ],
    leaveTypes: [
      ...leaveTypes,
      { id: 'day-off', kind: 'day_off', paid: true },
      { id: 'public-holiday', kind: 'public_holiday', paid: true },
    ],
  });
  eq(p.details.days.dayOff, 1);
  eq(p.details.days.publicHoliday, 1);
  eq(p.absence_deduction, 1900);
});

test('pending attendance is excluded from presence and absence deductions', () => {
  const p = run({
    today: '2026-09-01',
    attendance: [{
      work_date: '2026-09-01', check_in_at: '2026-09-01T06:00:00Z',
      status: 'present', verification_status: 'pending',
    }],
  });
  eq(p.details.days.pendingReview, 1);
  eq(p.details.days.present, 0);
  eq(p.details.days.absent, 0);
  eq(p.absence_deduction, 0);
});

test('rejected attendance is not counted as presence', () => {
  const p = run({
    today: '2026-09-01',
    attendance: [{
      work_date: '2026-09-01', check_in_at: '2026-09-01T06:00:00Z',
      status: 'present', verification_status: 'rejected',
    }],
  });
  eq(p.details.days.present, 0);
  eq(p.details.days.absent, 1);
  eq(p.absence_deduction, 100);
});

test('absence leave on a scheduled rest day does not create a deduction', () => {
  const p = run({
    today: '2026-09-04',
    attendance: [],
    leaves: [{
      status: 'approved', leave_type_id: 'absence', from_date: '2026-09-04', to_date: '2026-09-04',
    }],
    leaveTypes: [...leaveTypes, { id: 'absence', kind: 'absence', paid: false }],
  });
  eq(p.details.days.absent, 3);
  eq(p.absence_deduction, 300);
});

test('proration: mid-month hire gets prorated base and allowances when enabled', () => {
  const p = run({
    employee: { id: 'e1', hire_date: '2026-09-20' },
    settings: { ...settings, prorate_hire_month: true },
    attendance: [],
  });
  // Hired on 20th in 30-day month -> 11 active days
  eq(p.details.prorated, true);
  eq(p.details.active_days, 11);
  eq(p.base_salary, 1100);             // 11 days x 100
  eq(p.allowances_total, 256.67);      // (700 / 30) x 11
});

test('insurance and taxes: deducted correctly when configured', () => {
  const p = run({
    settings: { ...settings, social_insurance_percent: 10, tax_percent: 5 },
    adjustments: [],
  });
  // base_salary is 3000. 10% insurance = 300, 5% tax = 150
  eq(p.insurance_deduction, 300);
  eq(p.tax_deduction, 150);
  eq(p.net, 3000 + 700 + 18.75 - 300 - 12.5 - 300 - 150); // net includes insurance & tax deductions
});
