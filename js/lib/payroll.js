// Payroll engine: pure functions, no I/O. One payslip per employee per month.
import { daysInMonth, eachDate, monthRange, weekday } from './dates.js';
import { shiftLengthMin } from './shifts.js';

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function shiftHours(shift) {
  return shift ? shiftLengthMin(shift) / 60 : 8;
}

/**
 * month: 'YYYY-MM'
 * today: 'YYYY-MM-DD' - days after it are not judged yet, so a half-finished month
 *        never counts the future as absence.
 * shifts: every shift defined in the app. Employees pick their shift when they check in, so
 *        there is no personal schedule: a day is a working day when ANY shift runs on that weekday.
 * attendance / leaves / adjustments: only this employee's rows. Each attendance row says which
 *        shift was worked, and that shift's length prices the hour for that day.
 */
export function calcPayslip({
  month, today, employee, salary, shifts = [], settings,
  attendance, holidays, leaves, leaveTypes, adjustments,
}) {
  const { from, to } = monthRange(month);
  const [y, m] = month.split('-').map(Number);
  const lastDay = today && today < to ? today : to;
  const firstDay = employee.hire_date && employee.hire_date > from ? employee.hire_date : from;

  const holidaySet = new Set(holidays.map((h) => h.date));
  const workDays = new Set(shifts.flatMap((s) => s.working_days));
  const shiftById = new Map(shifts.map((s) => [s.id, s]));
  const attByDate = new Map(attendance.map((a) => [a.work_date, a]));
  const leaveKind = new Map(leaveTypes.map((t) => [
    t.id,
    t.kind || (t.paid === false ? 'unpaid_leave' : 'paid_leave'),
  ]));
  const leaveByDate = new Map();
  for (const l of leaves) {
    if (l.status !== 'approved') continue;
    for (const d of eachDate(l.from_date, l.to_date)) leaveByDate.set(d, l);
  }

  // The shift worked most this month stands in for rows that do not record one.
  const timesUsed = new Map();
  for (const a of attendance) if (a.check_in_at && a.shift_id) timesUsed.set(a.shift_id, (timesUsed.get(a.shift_id) || 0) + 1);
  const topShiftId = [...timesUsed.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const reference = shiftById.get(topShiftId) || shifts[0] || null;

  const base = Number(salary?.base_salary || 0);
  const allowances = (salary?.allowances || []).reduce((s, a) => s + Number(a.amount || 0), 0);
  const basis = settings.days_in_month_mode === 'actual' ? daysInMonth(y, m) : 30;
  const daily = base / basis;

  const totalDaysInMonth = daysInMonth(y, m);
  const isMidMonthHire = Boolean(employee.hire_date && employee.hire_date > from);
  const hireDay = isMidMonthHire ? parseInt(employee.hire_date.slice(8, 10), 10) : 1;
  const activeDaysInMonth = isMidMonthHire ? Math.max(0, totalDaysInMonth - hireDay + 1) : totalDaysInMonth;

  // Proration when enabled: applies to employee hired mid-month
  const shouldProrate = isMidMonthHire && Boolean(settings?.prorate_hire_month);
  const effectiveBase = shouldProrate ? round2(daily * activeDaysInMonth) : base;
  const dailyAllowance = allowances / basis;
  const effectiveAllowances = shouldProrate ? round2(dailyAllowance * activeDaysInMonth) : allowances;

  const days = {
    present: 0, absent: 0, paidLeave: 0, unpaidLeave: 0, excused: 0,
    dayOff: 0, publicHoliday: 0, pendingReview: 0,
  };
  let lateMin = 0;
  let earlyMin = 0;
  let overtimeMin = 0;
  let lateDeduction = 0;
  let overtimePay = 0;

  if (firstDay <= lastDay) {
    for (const d of eachDate(firstDay, lastDay)) {
      const att = attByDate.get(d);
      if (att?.verification_status === 'pending') {
        days.pendingReview++;
        continue;
      }
      if (att && att.check_in_at && att.verification_status !== 'rejected') {
        days.present++;
        lateMin += att.late_minutes || 0;
        earlyMin += att.early_leave_minutes || 0;
        overtimeMin += att.overtime_minutes || 0;
        // The hour is priced from the shift actually worked that day, so 8h and 10h shifts both come out right.
        const hourly = daily / shiftHours(shiftById.get(att.shift_id) || reference);
        lateDeduction += (((att.late_minutes || 0) + (att.early_leave_minutes || 0)) / 60) * hourly * settings.late_factor;
        overtimePay += ((att.overtime_minutes || 0) / 60) * hourly * settings.overtime_multiplier;
        continue;
      }
      const leave = leaveByDate.get(d);
      const kind = leave && leaveKind.get(leave.leave_type_id);
      if (kind === 'day_off') { days.dayOff++; continue; }
      if (kind === 'public_holiday') { days.publicHoliday++; continue; }
      if (!workDays.has(weekday(d)) || holidaySet.has(d)) continue;
      if (kind === 'excused_absence') { days.excused++; continue; }
      if (kind === 'absence') { days.absent++; continue; }
      if (kind === 'unpaid_leave') { days.unpaidLeave++; continue; }
      if (kind === 'paid_leave') { days.paidLeave++; continue; }
      if (att && att.status === 'excused') { days.excused++; continue; }
      days.absent++;
    }
  }

  const sumOf = (type) => adjustments
    .filter((a) => a.type === type && a.month.slice(0, 7) === month)
    .reduce((s, a) => s + Number(a.amount || 0), 0);

  const absenceDeduction = round2((days.absent + days.unpaidLeave) * daily * settings.absence_factor);
  lateDeduction = round2(lateDeduction);
  overtimePay = round2(overtimePay);
  const bonuses = round2(sumOf('bonus'));
  const otherDeductions = round2(sumOf('deduction'));
  const advances = round2(sumOf('advance'));

  const insurancePercent = Number(settings?.social_insurance_percent || 0);
  const taxPercent = Number(settings?.tax_percent || 0);
  const insuranceDeduction = round2((effectiveBase * insurancePercent) / 100);
  const taxDeduction = round2((effectiveBase * taxPercent) / 100);

  const net = round2(
    effectiveBase + effectiveAllowances + overtimePay + bonuses
    - absenceDeduction - lateDeduction - insuranceDeduction - taxDeduction - otherDeductions - advances,
  );

  return {
    employee_id: employee.id,
    month: `${month}-01`,
    base_salary: round2(effectiveBase),
    allowances_total: round2(effectiveAllowances),
    overtime_pay: overtimePay,
    bonuses,
    absence_deduction: absenceDeduction,
    late_deduction: lateDeduction,
    insurance_deduction: insuranceDeduction,
    tax_deduction: taxDeduction,
    other_deductions: otherDeductions,
    advances,
    net,
    details: {
      days,
      late_minutes: lateMin,
      early_leave_minutes: earlyMin,
      overtime_minutes: overtimeMin,
      daily_rate: round2(daily),
      hourly_rate: round2(daily / shiftHours(reference)),
      allowances: salary?.allowances || [],
      negative_net: net < 0,
      prorated: shouldProrate,
      active_days: isMidMonthHire ? activeDaysInMonth : basis,
      insurance_deduction: insuranceDeduction,
      tax_deduction: taxDeduction,
    },
  };
}
