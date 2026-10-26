// Every manual change to attendance: who, when, what it was, what it became, and why.
import { formatTime, todayIn } from '../lib/dates.js';
import { getLang } from '../lib/i18n.js';
import { badge, dataTable, fmtDate, h } from '../ui.js';

export default async function render({ api, settings }) {
  const isAr = getLang() === 'ar';
  const actions = isAr
    ? { insert: ['إضافة', 'ok'], update: ['تعديل', 'warn'], delete: ['حذف', 'err'] }
    : { insert: ['Created', 'ok'], update: ['Updated', 'warn'], delete: ['Deleted', 'err'] };
  const statuses = isAr
    ? { present: 'حاضر', excused: 'غياب بعذر', absent: 'غياب' }
    : { present: 'Present', excused: 'Excused absence', absent: 'Absent' };
  const tz = settings.timezone;
  const [edits, people, shifts] = await Promise.all([
    api.list('attendance_edits', { order: '-at' }),
    api.list('profiles'),
    api.list('shifts'),
  ]);
  const nameOf = (id) => people.find((p) => p.id === id)?.full_name || '—';
  const shown = edits.slice(0, 300);

  const describe = (d) => {
    if (!d) return '—';
    const times = d.check_in_at
      ? ` · ${formatTime(d.check_in_at, tz)}${d.check_out_at ? ` - ${formatTime(d.check_out_at, tz)}` : ''}`
      : '';
    const shift = shifts.find((s) => s.id === d.shift_id)?.name;
    return `${statuses[d.status] || d.status}${times}${shift ? ` (${shift})` : ''}`;
  };

  return h('div', { class: 'card' },
    h('h3', {}, isAr ? 'سجل تعديلات الحضور' : 'Attendance Audit Log'),
    h('p', { class: 'muted' }, isAr
      ? `يعرض هذا السجل آخر ${shown.length} تعديلًا يدويًا. ولا تظهر فيه عمليات تسجيل الحضور والانصراف المعتادة.`
      : `Showing the latest ${shown.length} manual changes. Routine clock-ins and clock-outs are not listed.`),
    dataTable([
      { label: isAr ? 'وقت التعديل' : 'Changed At', render: (e) => `${fmtDate(todayIn(tz, new Date(e.at)))} ${formatTime(e.at, tz)}` },
      { label: isAr ? 'منفّذ التعديل' : 'Changed By', render: (e) => nameOf(e.actor_id) },
      { label: isAr ? 'الموظف' : 'Employee', render: (e) => nameOf(e.employee_id) },
      { label: isAr ? 'تاريخ العمل' : 'Work Date', render: (e) => fmtDate(e.work_date) },
      { label: isAr ? 'الإجراء' : 'Action', render: (e) => badge(...(actions[e.action] || [e.action, ''])) },
      { label: isAr ? 'قبل التعديل' : 'Before', render: (e) => describe(e.old_data) },
      { label: isAr ? 'بعد التعديل' : 'After', render: (e) => describe(e.new_data) },
      { label: isAr ? 'السبب' : 'Reason', render: (e) => e.reason || '—' },
    ], shown, isAr ? 'لا توجد تعديلات بعد.' : 'No changes have been recorded.'));
}
