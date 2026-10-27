import { buildForm } from '../components/form.js';
import { can, scopeOf, teamsOf } from '../lib/access.js';
import { addDays, formatTime, monthRange, shiftMonth, todayIn, zonedTimeToISO } from '../lib/dates.js';
import { getLang } from '../lib/i18n.js';
import { checkoutMinutesAt, isOvernight, lateMinutesAt, shiftInstance } from '../lib/shifts.js';
import { btn, confirmBox, field, fmtDate, h, modal, select, toast } from '../ui.js';
import { attendanceTable, totals } from './history.js';

export default async function render({ api, profile, settings, perms }) {
  const isAr = getLang() === 'ar';
  const text = (ar, en) => isAr ? ar : en;
  const statusLabels = isAr
    ? { present: 'حاضر', excused: 'غياب بعذر (دون خصم)', absent: 'غياب' }
    : { present: 'Present', excused: 'Excused absence (no deduction)', absent: 'Absent' };
  const tz = settings.timezone;
  const isAdmin = profile.role === 'admin';
  const canEdit = can(perms, 'attendance', 'edit');
  const canExcuse = can(perms, 'attendance_excuse', 'edit');
  // Nobody edits their own attendance except the admin (the database refuses it too).
  const editable = (r) => canEdit && (r.employee_id !== profile.id || isAdmin);
  let month = todayIn(tz).slice(0, 7);
  let employeeId = '';
  let teamId = '';
  let specificDate = '';
  let searchName = '';

  const [people, shifts, teams] = await Promise.all([
    api.list('profiles', { order: 'full_name' }),
    api.list('shifts', { order: 'name' }),
    api.list('teams', { order: 'name' }),
  ]);

  // Scope comes from the permission library (the same rule the database applies), not from
  // hardcoded role checks: an assistant manager sees their teams, a supervisor their team's
  // employees, and a "team"-scoped manager the teams they own.
  const scopedTeams = teamsOf(profile, teams);
  const scopedAll = ['attendance'].some((f) => scopeOf(perms, f) === 'all');
  const accessibleStaff = people.filter((p) => {
    if (!p.active) return false;
    if (scopedAll) return true;
    if (p.id === profile.id) return true;
    if (!scopedTeams.includes(p.team_id)) return false;
    return profile.role !== 'supervisor' || p.role !== 'supervisor';   // co-supervisors are peers
  });

  const availableTeams = teams.filter((t) => scopedAll || scopedTeams.includes(t.id));

  const addable = accessibleStaff.filter((p) => p.id !== profile.id || isAdmin);
  const nameOf = (id) => people.find((p) => p.id === id)?.full_name || '—';
  const shiftName = (id) => shifts.find((s) => s.id === id)?.name || '—';
  const teamOf = (empId) => {
    const tId = people.find((p) => p.id === empId)?.team_id;
    return teams.find((t) => t.id === tId)?.name || '—';
  };

  const monthLabel = h('strong', {});
  const summary = h('p', { class: 'muted' });
  const tableBox = h('div', {});
  let rows = [];

  const employeeSelect = select([{ value: '', label: text('جميع الموظفين', 'All Employees') }, ...accessibleStaff.map((p) => ({ value: p.id, label: p.full_name }))], '');
  employeeSelect.addEventListener('change', () => { employeeId = employeeSelect.value; load(); });

  const teamSelect = select([{ value: '', label: text('جميع الفرق', 'All Teams') }, ...availableTeams.map((t) => ({ value: t.id, label: t.name }))], '');
  teamSelect.addEventListener('change', () => { teamId = teamSelect.value; load(); });

  const dateInput = h('input', { type: 'date', value: '', onChange: (e) => { specificDate = e.target.value; load(); } });
  const searchInput = h('input', { type: 'search', placeholder: text('ابحث بالاسم...', 'Search by name...'), value: '', onInput: (e) => { searchName = e.target.value.trim().toLowerCase(); filterAndRender(); } });

  let fetchedRows = [];

  async function load() {
    const { from, to } = monthRange(month);
    const dateQuery = specificDate
      ? { eq: { work_date: specificDate } }
      : { gte: { work_date: from }, lte: { work_date: to } };

    const eqFilters = {
      ...(dateQuery.eq || {}),
      ...(employeeId ? { employee_id: employeeId } : {}),
    };

    fetchedRows = await api.list('attendance', {
      eq: eqFilters,
      ...(dateQuery.gte ? { gte: dateQuery.gte } : {}),
      ...(dateQuery.lte ? { lte: dateQuery.lte } : {}),
      order: '-work_date',
    });

    monthLabel.textContent = specificDate ? `${text('يوم', 'Day')} ${specificDate}` : month;
    filterAndRender();
  }

  function filterAndRender() {
    const accessibleIds = new Set(accessibleStaff.map((p) => p.id));
    rows = fetchedRows.filter((r) => accessibleIds.has(r.employee_id));

    if (teamId) {
      rows = rows.filter((r) => people.find((p) => p.id === r.employee_id)?.team_id === teamId);
    }

    if (searchName) {
      rows = rows.filter((r) => nameOf(r.employee_id).toLowerCase().includes(searchName));
    }

    const t = totals(rows);
    summary.textContent = text(
      `${rows.length} سجلًا · أيام الحضور: ${t.days} · دقائق التأخير: ${t.late} · دقائق العمل الإضافي: ${t.overtime}`,
      `${rows.length} records · Attendance days: ${t.days} · Late minutes: ${t.late} · Overtime minutes: ${t.overtime}`,
    );
    tableBox.replaceChildren(attendanceTable(
      rows, tz,
      [
        { label: text('الموظف', 'Employee'), render: (r) => nameOf(r.employee_id) },
        { label: text('الفريق', 'Team'), render: (r) => teamOf(r.employee_id) },
        { label: text('الوردية', 'Shift'), render: (r) => shiftName(r.shift_id) },
      ],
      [{
        label: '',
        render: (r) => h('div', { class: 'row' },
          editable(r) && btn(text('تعديل', 'Edit'), () => openForm(r), 'small'),
          isAdmin && btn(text('حذف', 'Delete'), async () => {
            if (!await confirmBox(text('هل تريد حذف سجل الحضور هذا؟', 'Delete this attendance record?'), text('حذف', 'Delete'))) return;
            await api.remove('attendance', r.id);
            await load();
          }, 'small')),
      }],
      { name: `attendance-${specificDate || month}` },
    ));
  }

  function openForm(existing) {
    // Excused / absent changes the deduction, so only people with that permission may choose them.
    const statuses = ['present', ...(canExcuse ? ['excused', 'absent'] : [])];
    if (existing && !statuses.includes(existing.status)) statuses.push(existing.status);
    const fields = [
      ...(existing ? [] : [
        { key: 'employee_id', label: text('الموظف', 'Employee'), type: 'select', required: true, options: addable.map((p) => ({ value: p.id, label: p.full_name })) },
        { key: 'work_date', label: text('التاريخ', 'Date'), type: 'date', required: true, default: todayIn(tz), hint: text('في الورديات الليلية، أدخل تاريخ بدء الوردية.', 'For overnight shifts, enter the date when the shift starts.') },
      ]),
      { key: 'status', label: isAr ? 'الحالة' : 'Status', type: 'select', options: statuses.map((s) => ({ value: s, label: statusLabels[s] })), default: 'present' },
      {
        key: 'shift_id', label: text('الوردية (إذا كان الموظف حاضرًا)', 'Shift (if the employee was present)'), type: 'select', nullable: true,
        options: [{ value: '', label: text('— اختر —', '— Select —') }, ...shifts.map((s) => ({ value: s.id, label: s.name }))],
      },
      { key: 'in_time', label: text('وقت الحضور', 'Clock-In Time'), type: 'time', nullable: true },
      { key: 'out_time', label: text('وقت الانصراف', 'Clock-Out Time'), type: 'time', nullable: true, hint: text('إذا تجاوزت الوردية منتصف الليل، أدخل وقت الانصراف في اليوم التالي.', 'For overnight shifts, enter the clock-out time on the following day.') },
      {
        key: 'note', label: text('السبب (إجباري)', 'Reason (required)'), type: 'textarea', required: true,
        hint: existing?.note
          ? text(`السبب السابق: ${existing.note}. أدخل سببًا جديدًا لهذا التعديل.`, `Previous reason: ${existing.note}. Enter a new reason for this change.`)
          : text('ما سبب إضافة هذا السجل أو تعديله؟', 'Why are you adding or editing this record?'),
      },
    ];
    const form = buildForm(fields, existing ? {
      status: existing.status, shift_id: existing.shift_id,
      in_time: formatTime(existing.check_in_at, tz), out_time: formatTime(existing.check_out_at, tz),
    } : {});

    modal({
      title: existing
        ? text(`تعديل: ${nameOf(existing.employee_id)} - ${fmtDate(existing.work_date)}`, `Edit: ${nameOf(existing.employee_id)} - ${fmtDate(existing.work_date)}`)
        : text('إضافة سجل حضور', 'Add Attendance Record'),
      body: h('div', {}, form.nodes, h('p', { class: 'muted' }, text(
        'يُحتسب التأخير والعمل الإضافي تلقائيًا وفق الوردية. وتُسجّل جميع التعديلات في «سجل التدقيق».',
        'Late arrival and overtime are calculated automatically from the shift. All changes are recorded in the Audit Log.',
      ))),
      buttons: [
        {
          label: text('حفظ', 'Save'), kind: 'primary',
          onClick: async () => {
            const v = form.read();
            if (existing && v.note === existing.note) throw new Error(text('أدخل سببًا جديدًا لهذا التعديل.', 'Enter a new reason for this edit.'));
            const employee = existing ? existing.employee_id : v.employee_id;
            const date = existing ? existing.work_date : v.work_date;
            const row = {
              ...(existing || {}), employee_id: employee, work_date: date,
              status: v.status, note: v.note, edited_by: profile.id,
            };
            if (v.status === 'present') {
              if (!v.in_time) throw new Error(text('وقت الحضور مطلوب', 'Clock-in time is required.'));
              const shift = shifts.find((s) => s.id === v.shift_id);
              if (!shift) throw new Error(text('اختر الوردية التي عمل فيها الموظف.', 'Select the employee’s shift.'));
              const inISO = zonedTimeToISO(date, v.in_time, tz);
              let outISO = null;
              if (v.out_time) {
                const sameDay = zonedTimeToISO(date, v.out_time, tz);
                outISO = sameDay > inISO ? sameDay : zonedTimeToISO(addDays(date, 1), v.out_time, tz);   // not after check-in = after midnight
                if (outISO !== sameDay && !isOvernight(shift)) {
                  throw new Error(text('يجب أن يكون وقت الانصراف بعد وقت الحضور في هذه الوردية.', 'Clock-out must be later than clock-in for this shift.'));
                }
              }
              const inst = shiftInstance(date, shift, tz);
              Object.assign(row, {
                shift_id: shift.id,
                check_in_at: inISO,
                check_out_at: outISO,
                late_minutes: lateMinutesAt(inst, Date.parse(inISO)),
                early_leave_minutes: 0,
                overtime_minutes: 0,
                ...(outISO ? checkoutMinutesAt(inst, Date.parse(outISO), settings.overtime_threshold_min) : {}),
              });
            } else {
              Object.assign(row, { shift_id: null, check_in_at: null, check_out_at: null, late_minutes: 0, early_leave_minutes: 0, overtime_minutes: 0 });
            }
            // A day may already have a record: edit that one instead of adding a second.
            const [same] = existing ? [existing] : await api.list('attendance', { eq: { employee_id: employee, work_date: date } });
            await api.save('attendance', same ? { ...same, ...row, id: same.id } : row);
            toast(text('حُفظ سجل الحضور.', 'Attendance record saved.'));
            await load();
          },
        },
        { label: text('إلغاء', 'Cancel'), kind: 'ghost' },
      ],
    });
  }

  const step = (delta) => () => { month = shiftMonth(month, delta); return load(); };
  await load();

  const clearDateBtn = btn(text('الشهر كاملاً', 'Full Month'), () => {
    dateInput.value = '';
    specificDate = '';
    load();
  }, 'small ghost');

  return h('div', { class: 'card' },
    h('div', { class: 'toolbar', style: { gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' } },
      h('div', { class: 'row' }, btn(text('الشهر السابق', 'Previous Month'), step(-1), 'small'), monthLabel, btn(text('الشهر التالي', 'Next Month'), step(1), 'small')),
      field(text('تاريخ محدد', 'Specific Date'), dateInput),
      specificDate && clearDateBtn,
      availableTeams.length > 0 && field(text('الفريق', 'Team'), teamSelect),
      field(text('الموظف', 'Employee'), employeeSelect),
      field(text('بحث سريع', 'Search'), searchInput),
      canEdit && btn(text('إضافة سجل', 'Add Record'), () => openForm(null), 'primary'),
    ),
    summary,
    tableBox);
}
