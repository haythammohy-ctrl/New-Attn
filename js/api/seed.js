// Demo data: a small company with two teams, three shifts (one crosses midnight), and one completed
// month, so users can explore every role, check-in, reports, and payroll right away.
import { defaultRows } from '../lib/access.js';
import { addDays, daysBetween, eachDate, monthRange, shiftMonth, todayIn, weekday, weekStart } from '../lib/dates.js';
import { checkoutMinutesAt, lateMinutesAt, shiftInstance, sortedByStart } from '../lib/shifts.js';

// Deterministic pseudo-random numbers so every fresh demo looks the same.
function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const id = () => crypto.randomUUID();
const WEEK_ANCHOR = '2026-01-04';   // a Sunday

export function buildSeed() {
  const settings = {
    id: 1, company_name: 'talabat mart', timezone: 'Africa/Cairo', currency: 'EGP',
    days_in_month_mode: '30', overtime_multiplier: 1.5, overtime_threshold_min: 30,
    late_factor: 1, absence_factor: 1, max_accuracy_m: 100, checkin_window_min: 60, employee_code_prefix: 'DC',
  };
  const tz = settings.timezone;
  const today = todayIn(tz);
  const lastMonth = shiftMonth(today.slice(0, 7), -1);

  const location = { id: id(), name: 'Main Branch', lat: 30.0444, lng: 31.2357, radius_m: 150 };
  const mkShift = (name, start_time, end_time) => ({
    id: id(), name, start_time, end_time, grace_minutes: 10, working_days: [0, 1, 2, 3, 4],
  });
  const shifts = [mkShift('Morning', '07:00', '15:00'), mkShift('Evening', '15:00', '23:00'), mkShift('Night', '23:00', '07:00')];
  const order = sortedByStart(shifts);
  const leaveTypes = [
    { id: id(), name: 'Paid leave', paid: true, kind: 'paid_leave', annual_days: 21 },
    { id: id(), name: 'Unpaid leave', paid: false, kind: 'unpaid_leave', annual_days: 0 },
    { id: id(), name: 'Day off', paid: true, kind: 'day_off', annual_days: 0 },
    { id: id(), name: 'Public holiday', paid: true, kind: 'public_holiday', annual_days: 0 },
    { id: id(), name: 'Absence', paid: false, kind: 'absence', annual_days: 0 },
    { id: id(), name: 'Excused absence', paid: true, kind: 'excused_absence', annual_days: 0 },
  ];
  const teamA = { id: id(), name: 'Team A', manager_id: null };
  const teamB = { id: id(), name: 'Team B', manager_id: null };

  const jobTitles = [
    { id: id(), name: 'Employee', kind: 'employee' },
    { id: id(), name: 'Team Supervisor', kind: 'supervision' },
    { id: id(), name: 'Assistant Supervisor', kind: 'supervision' },
    { id: id(), name: 'Assistant Manager', kind: 'supervision' },
  ];

  const person = (full_name, email, role, extra = {}) => ({
    id: id(), full_name, email, phone: '', role, team_id: null, manager_id: null, job_title: null, employee_code: null,
    shift_id: null, location_id: location.id, hire_date: '2024-01-01', active: true, created_at: new Date().toISOString(),
    ...extra,
  });
  const admin = person('أحمد (مدير النظام)', 'admin@demo.test', 'admin');
  const hr = person('منى', 'hr@demo.test', 'assistant_manager', { job_title: 'Assistant Manager' });
  // منى is the manager in charge of both demo teams, so the team scope is visible in the demo.
  teamA.manager_id = hr.id;
  teamB.manager_id = hr.id;
  const khaled = person('خالد', 'manager@demo.test', 'supervisor', { team_id: teamA.id, job_title: 'Supervisor' });
  const nadine = person('نادين', 'asst@demo.test', 'supervisor', { team_id: teamA.id, manager_id: khaled.id, job_title: 'Supervisor' });
  const sara = person('سارة', 'sara@demo.test', 'employee', { team_id: teamA.id, manager_id: khaled.id, job_title: 'Employee', employee_code: 'DC000001' });
  const mahmoud = person('محمود', 'mahmoud@demo.test', 'employee', { team_id: teamA.id, manager_id: khaled.id, job_title: 'Employee', employee_code: 'DC000002' });
  const hisham = person('هشام', 'hisham@demo.test', 'supervisor', { team_id: teamB.id, job_title: 'Supervisor' });
  const yasmin = person('ياسمين', 'yasmin@demo.test', 'employee', { team_id: teamB.id, manager_id: hisham.id, job_title: 'Employee', employee_code: 'DC000003' });
  const profiles = [admin, hr, khaled, nadine, sara, mahmoud, hisham, yasmin];
  // Synthetic but valid national IDs (14 digits with real birth dates).
  const nationalIds = ['28001011234561', '28505051234562', '28203151234563', '29007201234564',
    '29912121234565', '29506061234566', '28110101234567', '30001151234568'];
  const profilePrivate = profiles.map((p, i) => ({ id: p.id, national_id: nationalIds[i] }));

  const salaries = [
    [admin, 15000, []], [hr, 9000, [{ name: 'Transport allowance', amount: 500 }]],
    [khaled, 12000, [{ name: 'Supervisor allowance', amount: 1000 }]], [nadine, 9500, [{ name: 'Supervisor allowance', amount: 600 }]],
    [sara, 6000, [{ name: 'Transport allowance', amount: 400 }]],
    [mahmoud, 8000, [{ name: 'Transport allowance', amount: 500 }, { name: 'Meal allowance', amount: 300 }]],
    [hisham, 11500, [{ name: 'Supervisor allowance', amount: 1000 }]], [yasmin, 10000, [{ name: 'Transport allowance', amount: 600 }]],
  ].map(([p, base_salary, allowances]) => ({ employee_id: p.id, base_salary, allowances }));

  // Past attendance only. The three shift workers move to a different shift every week (as if each
  // had picked it at check-in); everyone else always picks the morning shift.
  const rotating = new Map([[sara, 0], [mahmoud, 1], [yasmin, 2]]);
  const shiftPicked = (emp, date) => {
    if (!rotating.has(emp)) return order[0];
    const week = Math.round(daysBetween(WEEK_ANCHOR, weekStart(date)) / 7);
    return order[(rotating.get(emp) + week) % order.length];
  };

  const { from, to } = monthRange(lastMonth);
  const monthDays = eachDate(from, to);
  const workDays = monthDays.filter((d) => weekday(d) <= 4);
  const holiday = { id: id(), name: 'Demo public holiday', date: workDays[7] };
  const leaveDay = workDays[12];
  const leaveRequests = [
    {
      id: id(), employee_id: sara.id, leave_type_id: leaveTypes[0].id, from_date: leaveDay, to_date: leaveDay,
      reason: 'Family commitment', status: 'approved', decided_by: khaled.id, decided_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    },
    {
      id: id(), employee_id: mahmoud.id, leave_type_id: leaveTypes[0].id, from_date: today, to_date: addDays(today, 1),
      reason: 'Personal commitment', status: 'pending', decided_by: null, decided_at: null, created_at: new Date().toISOString(),
    },
    {
      id: id(), employee_id: yasmin.id, leave_type_id: leaveTypes[0].id, from_date: addDays(today, 3), to_date: addDays(today, 3),
      reason: 'Urgent matter', status: 'pending', decided_by: null, decided_at: null, created_at: new Date().toISOString(),
    },
  ];

  const rand = mulberry32(42);
  const attendance = [];
  for (const emp of profiles) {
    for (const d of workDays) {
      if (d === holiday.date) continue;
      if (emp === sara && d === leaveDay) continue;
      if (rand() < 0.05) continue;                       // absent: no row at all
      const shift = shiftPicked(emp, d);
      const inst = shiftInstance(d, shift, tz);
      const arriveMs = inst.start + (rand() < 0.15 ? 12 + Math.floor(rand() * 34) : Math.floor(rand() * 8)) * 60000;
      const leaveMs = inst.end + (rand() < 0.15 ? 30 + Math.floor(rand() * 60) : rand() < 0.05 ? -20 : 0) * 60000;
      attendance.push({
        id: id(), employee_id: emp.id, work_date: d, shift_id: shift.id,
        check_in_at: new Date(arriveMs).toISOString(), check_in_lat: location.lat, check_in_lng: location.lng,
        check_out_at: new Date(leaveMs).toISOString(), check_out_lat: location.lat, check_out_lng: location.lng,
        late_minutes: lateMinutesAt(inst, arriveMs),
        ...checkoutMinutesAt(inst, leaveMs, settings.overtime_threshold_min),
        status: 'present', verification_status: 'approved', source: 'gps', note: null, edited_by: null,
      });
    }
  }
  const reviewDate = addDays(today, -1);
  const reviewShift = shiftPicked(sara, reviewDate);
  attendance.push({
    id: id(), employee_id: sara.id, work_date: reviewDate, shift_id: reviewShift.id,
    check_in_at: new Date(`${reviewDate}T06:05:00Z`).toISOString(),
    check_in_lat: location.lat, check_in_lng: location.lng, check_out_at: null,
    late_minutes: 0, early_leave_minutes: 0, overtime_minutes: 0, status: 'present',
    verification_status: 'pending', verified_by: null, verified_at: null, verification_note: null,
    source: 'gps', note: null, edited_by: null,
  });

  const adjustments = [
    { id: id(), employee_id: sara.id, month: `${lastMonth}-01`, type: 'bonus', amount: 300, note: 'Performance bonus' },
    { id: id(), employee_id: mahmoud.id, month: `${lastMonth}-01`, type: 'advance', amount: 1000, note: 'Salary advance' },
  ];

  return {
    settings: [settings], work_locations: [location], shifts, teams: [teamA, teamB], job_titles: jobTitles, profiles,
    profile_private: profilePrivate, counters: { employee_code: 3 },
    salary_structures: salaries, attendance, attendance_edits: [],
    leave_types: leaveTypes, leave_requests: leaveRequests, role_permissions: defaultRows(),
    holidays: [holiday], adjustments, payroll_runs: [], payslips: [],
  };
}
