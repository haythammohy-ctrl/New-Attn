import { AR_WEEKDAYS, formatTime, monthRange, shiftMonth, todayIn, weekday } from '../lib/dates.js';
import { getLang, t } from '../lib/i18n.js';
import { badge, btn, dataTable, fmtDate, h, hoursText } from '../ui.js';

export function attendanceStatus(status) {
  const labels = getLang() === 'ar'
    ? { present: ['حاضر', 'ok'], absent: ['غياب', 'err'], excused: ['غياب بعذر', 'warn'] }
    : { present: ['Present', 'ok'], absent: ['Absent', 'err'], excused: ['Excused absence', 'warn'] };
  return labels[status] || ['—', ''];
}

// Shared with the HR records page. Extra columns appear after the date, with trailing columns at the end.
export function attendanceTable(rows, tz, extraColumns = [], trailing = []) {
  const isAr = getLang() === 'ar';
  const weekdays = isAr ? AR_WEEKDAYS : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const columns = [
    { label: isAr ? 'التاريخ' : 'Date', render: (r) => `${weekdays[weekday(r.work_date)]} ${fmtDate(r.work_date)}` },
    ...extraColumns,
    { label: isAr ? 'حضور' : 'Clock In', render: (r) => formatTime(r.check_in_at, tz) || '—' },
    { label: isAr ? 'انصراف' : 'Clock Out', render: (r) => formatTime(r.check_out_at, tz) || '—' },
    { label: isAr ? 'تأخير' : 'Late', render: (r) => (r.late_minutes ? hoursText(r.late_minutes) : '—') },
    { label: isAr ? 'الانصراف المبكر' : 'Early Departure', render: (r) => (r.early_leave_minutes ? hoursText(r.early_leave_minutes) : '—') },
    { label: isAr ? 'العمل الإضافي' : 'Overtime', render: (r) => (r.overtime_minutes ? hoursText(r.overtime_minutes) : '—') },
    {
      label: isAr ? 'الحالة' : 'Status',
      render: (r) => r.verification_status === 'rejected'
        ? badge(t('approvals.verificationRejected'), 'err')
        : badge(...attendanceStatus(r.status)),
    },
    {
      label: isAr ? 'مراجعة المشرف' : 'Supervisor Review',
      render: (r) => r.verification_status === 'pending'
        ? badge(t('approvals.verificationPending'), 'warn')
        : r.verification_status === 'rejected'
          ? badge(t('approvals.verificationRejected'), 'err')
          : badge(t('approvals.verificationApproved'), 'ok'),
    },
    ...trailing,
  ];
  return dataTable(columns, rows, isAr ? 'لا توجد سجلات لهذا الشهر.' : 'No records for this month.');
}

export function totals(rows) {
  const worked = rows.filter((r) => r.check_in_at
    && r.verification_status !== 'pending' && r.verification_status !== 'rejected');
  const sum = (key) => worked.reduce((s, r) => s + (r[key] || 0), 0);
  return {
    days: worked.length,
    late: sum('late_minutes'),
    early: sum('early_leave_minutes'),
    overtime: sum('overtime_minutes'),
  };
}

export default async function render({ api, profile, settings, perms }) {
  const isAr = getLang() === 'ar';
  let month = todayIn(settings.timezone).slice(0, 7);
  const body = h('div', {});
  const title = h('h3', {});

  const isAdmin = profile.role === 'admin';
  const isManager = profile.role === 'assistant_manager';
  const isSupervisor = profile.role === 'supervisor' || profile.role === 'manager';

  const [people, allShifts] = await Promise.all([
    api.list('profiles', { order: 'full_name' }),
    api.list('shifts'),
  ]);

  const accessibleStaff = people.filter((p) => {
    if (!p.active) return false;
    if (isAdmin || isManager) return true;
    if (isSupervisor) return p.team_id === profile.team_id || p.id === profile.id;
    return p.id === profile.id;
  });

  let selectedEmpId = accessibleStaff.some((p) => p.id === profile.id) ? profile.id : accessibleStaff[0]?.id;

  async function load() {
    const { from, to } = monthRange(month);
    const [rows] = await Promise.all([
      api.list('attendance', {
        eq: { employee_id: selectedEmpId }, gte: { work_date: from }, lte: { work_date: to }, order: '-work_date',
      }),
    ]);
    const t = totals(rows);
    title.textContent = month;
    body.replaceChildren(
      h('div', { class: 'grid', style: { marginBottom: '12px' } },
        stat(isAr ? 'أيام الحضور المؤكدة' : 'Confirmed Attendance Days', t.days), stat(isAr ? 'إجمالي مدة التأخير' : 'Total Late Time', hoursText(t.late)),
        stat(isAr ? 'مدة الانصراف المبكر' : 'Early Departure Time', hoursText(t.early)), stat(isAr ? 'مدة العمل الإضافي' : 'Overtime', hoursText(t.overtime))),
      attendanceTable(rows, settings.timezone, [
        { label: isAr ? 'الوردية' : 'Shift', render: (r) => allShifts.find((s) => s.id === r.shift_id)?.name || '—' },
      ]),
    );
  }

  const step = (delta) => () => { month = shiftMonth(month, delta); return load(); };
  await load();

  const empSelect = accessibleStaff.length > 1 && h('select', {
    onChange: (e) => {
      selectedEmpId = e.target.value;
      load();
    },
    style: { maxWidth: '220px' },
  }, accessibleStaff.map((p) => h('option', { value: p.id, selected: p.id === selectedEmpId }, p.full_name + (p.id === profile.id ? (isAr ? ' (حسابي)' : ' (Me)') : ''))));

  return h('div', { class: 'card' },
    h('div', { class: 'toolbar', style: { justifyContent: 'space-between', marginBottom: '12px' } },
      h('div', { class: 'row' }, btn(isAr ? 'الشهر السابق' : 'Previous month', step(-1), 'small'), title, btn(isAr ? 'الشهر التالي' : 'Next month', step(1), 'small')),
      empSelect && h('label', { class: 'field', style: { margin: 0 } }, h('span', { class: 'label' }, isAr ? 'الموظف' : 'Employee'), empSelect),
    ),
    body);
}

function stat(label, value) {
  return h('div', { class: 'stat' }, h('small', {}, label), h('b', {}, value));
}
