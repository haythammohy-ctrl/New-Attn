import { addDays, formatTime, todayIn, weekday } from '../lib/dates.js';
import { scopeOf } from '../lib/access.js';
import { getLang } from '../lib/i18n.js';
import { badge, dataTable, h, hoursText } from '../ui.js';

export default async function render({ api, profile, settings, perms }) {
  const isAr = getLang() === 'ar';
  const text = (ar, en) => isAr ? ar : en;
  const tz = settings.timezone;
  const nowMs = api.now().getTime();
  const date = todayIn(tz, new Date(nowMs));
  const yesterday = addDays(date, -1);
  const [people, shifts, attendance, leaves, holidays] = await Promise.all([
    api.list('profiles', { order: 'full_name' }),
    api.list('shifts'),
    api.list('attendance', { gte: { work_date: yesterday }, lte: { work_date: date } }),
    api.list('leave_requests', { eq: { status: 'approved' }, lte: { from_date: date }, gte: { to_date: date } }),
    api.list('holidays', { eq: { date } }),
  ]);

  const wholeCompany = scopeOf(perms, 'attendance') === 'all';
  // The database already limits who comes back; only the signed-in person is left out here.
  const team = people.filter((p) => p.active && p.id !== profile.id);
  const onLeave = new Set(leaves.map((l) => l.employee_id));
  const workingToday = shifts.some((s) => s.working_days.includes(weekday(date)));

  const rows = team.map((p) => {
    const mine = attendance.filter((a) => a.employee_id === p.id && a.check_in_at);
    // Today's row, or yesterday's if that night shift is still running.
    const a = mine.find((x) => x.work_date === date) || mine.find((x) => x.work_date === yesterday && !x.check_out_at);
    let state;
    if (a) state = a.check_out_at ? [text('انصرف', 'Clocked Out'), ''] : [text('حاضر', 'Present'), 'ok'];
    else if (onLeave.has(p.id)) state = [text('في إجازة', 'On Leave'), ''];
    else if (holidays.length) state = [text('عطلة رسمية', 'Public Holiday'), ''];
    else if (!workingToday) state = [text('يوم راحة', 'Day Off'), ''];
    else state = [text('لم يسجل بعد', 'Not Clocked In'), 'warn'];
    return { p, a, shift: shifts.find((s) => s.id === a?.shift_id), state };
  });

  const count = (...labels) => rows.filter((r) => labels.includes(r.state[0])).length;
  const noTeam = !wholeCompany && !profile.team_id;

  return h('div', {},
    noTeam && h('div', { class: 'card' }, badge(text('لست منتميًا إلى فريق', 'Not Assigned to a Team'), 'warn'), text(
      ' يُرجى التواصل مع مدير الموارد البشرية أو مدير النظام لإضافتك إلى فريق من صفحة «الفرق».',
      ' Contact HR or the system administrator to assign you to a team on the Teams page.',
    )),
    h('div', { class: 'grid', style: { marginBottom: '16px' } },
      stat(text('حاضر', 'Present'), count(text('حاضر', 'Present'))),
      stat(text('انصرف', 'Clocked Out'), count(text('انصرف', 'Clocked Out'))),
      stat(text('لم يسجل بعد', 'Not Clocked In'), count(text('لم يسجل بعد', 'Not Clocked In'))),
      stat(text('في إجازة', 'On Leave'), count(text('في إجازة', 'On Leave')))),
    h('div', { class: 'card' },
      h('h3', {}, wholeCompany ? text('حضور الموظفين اليوم', 'Company Attendance Today') : text('حضور فريقك اليوم', 'Your Team Today')),
      dataTable([
        { label: text('الموظف', 'Employee'), render: (r) => r.p.full_name },
        { label: text('المسمى', 'Job Title'), render: (r) => r.p.job_title || '—' },
        { label: text('الوردية', 'Shift'), render: (r) => r.shift?.name || '—' },
        { label: text('الحالة', 'Status'), render: (r) => badge(...r.state) },
        { label: text('حضور', 'Clock In'), render: (r) => formatTime(r.a?.check_in_at, tz) || '—' },
        { label: text('انصراف', 'Clock Out'), render: (r) => formatTime(r.a?.check_out_at, tz) || '—' },
        { label: text('تأخير', 'Late'), exportLabel: text('تأخير (دقيقة)', 'Late (minutes)'), value: (r) => r.a?.late_minutes || 0, render: (r) => (r.a?.late_minutes ? hoursText(r.a.late_minutes) : '—') },
      ], rows, text('لا يوجد موظفون ضمن نطاق إدارتك.', 'No employees in your management scope.'))),
  );
}

function stat(label, value) {
  return h('div', { class: 'stat' }, h('small', {}, label), h('b', {}, value));
}
