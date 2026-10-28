import { can, scopeOf, teamsOf } from '../lib/access.js';
import { errorText } from '../api/errors.js';
import { addDays, formatTime, todayIn, zonedTimeToISO } from '../lib/dates.js';
import { countLeaveDays } from '../lib/rules.js';
import { checkoutMinutesAt, isOvernight, lateMinutesAt, shiftInstance } from '../lib/shifts.js';
import { getLang, t } from '../lib/i18n.js';
import { badge, btn, confirmBox, dataTable, fmtDate, h, modal, toast } from '../ui.js';

export default async function render({ api, profile, settings, perms, refresh }) {
  const isAr = getLang() === 'ar';
  const tz = settings?.timezone || 'Africa/Cairo';
  const isAdmin = profile.role === 'admin';
  const isGeneralManager = profile.role === 'manager';
  const isManager = profile.role === 'assistant_manager' || isGeneralManager;
  const isSupervisor = profile.role === 'supervisor';
  const isEmployee = profile.role === 'employee';

  const [leaveRequests, allAttendance, edits, people, types, shifts, holidays, teams] = await Promise.all([
    api.list('leave_requests', { order: '-from_date' }).catch(() => []),
    api.list('attendance', { order: '-work_date' }).catch(() => []),
    api.list('attendance_edits', { order: '-at' }).catch(() => []),
    api.list('profiles').catch(() => []),
    api.list('leave_types').catch(() => []),
    api.list('shifts').catch(() => []),
    api.list('holidays').catch(() => []),
    api.list('teams').catch(() => []),
  ]);

  const person = (id) => (people || []).find((p) => p.id === id);
  const shiftName = (id) => (shifts || []).find((s) => s.id === id)?.name || '—';
  const typeName = (id) => (types || []).find((lt) => lt.id === id)?.name || '—';

  // Scope filter: the same rule the demo backend and the database apply, so the list never shows a
  // row that deciding on would then reject. A supervisor reviews the employees of their own team; a
  // manager reviews the teams they own; the admin sees everything.
  const scopeTeams = teamsOf(profile, teams);
  const inTeamScope = (empId) => {
    const emp = person(empId);
    if (!emp || !scopeTeams.includes(emp.team_id)) return false;
    return profile.role === 'assistant_manager' || emp.role !== 'supervisor';   // co-supervisors are peers, not reports
  };
  const isAccessible = (empId) => {
    if (isAdmin || isGeneralManager || empId === profile.id) return true;
    const feature = can(perms, 'attendance') ? 'attendance' : 'leave_approvals';
    return scopeOf(perms, feature) === 'all' || inTeamScope(empId);
  };

  const canDecideLeaves = can(perms, 'leave_approvals', 'edit') && !isEmployee;
  const canEditAttendance = can(perms, 'attendance', 'edit') && !isEmployee;
  const canExcuse = can(perms, 'attendance_excuse', 'edit');

  const mayDecideLeave = (r) => canDecideLeaves && (r.employee_id !== profile.id || isAdmin) && isAccessible(r.employee_id);
  const mayEditAtt = (r) => canEditAttendance && (r.employee_id !== profile.id || isAdmin) && isAccessible(r.employee_id);
  const mayVerifyAtt = (r) => mayEditAtt(r) && r.verification_status === 'pending';

  let activeTab = 'leaves';
  const container = h('div', {});

  // 1. Leave requests
  const filteredLeaves = (leaveRequests || []).filter((r) => isAccessible(r.employee_id));
  const pendingLeaves = filteredLeaves.filter((r) => r.status === 'pending');
  const pastLeaves = filteredLeaves.filter((r) => r.status !== 'pending').slice(0, 50);

  async function decideLeave(r, status) {
    const empName = person(r.employee_id)?.full_name || '';
    const promptText = status === 'approved'
      ? t('approvals.confirmApprovePrompt', { name: empName })
      : t('approvals.confirmRejectPrompt', { name: empName });

    if (!await confirmBox(promptText, status === 'approved' ? t('approvals.approveBtn') : t('approvals.rejectBtn'), status === 'approved' ? 'primary' : 'danger')) return;

    try {
      await api.save('leave_requests', {
        ...r,
        status,
        decided_by: profile.id,
        decided_at: new Date().toISOString(),
      });
      toast(status === 'approved' ? t('approvals.approvedSuccess') : t('approvals.rejectedSuccess'));
      refresh();
    } catch (err) {
      toast(err.message || 'Unable to update the leave request.', 'err');
    }
  }

  // 2. Attendance & Forgotten Punches
  const filteredAttendance = (allAttendance || []).filter((a) => isAccessible(a.employee_id));
  // Forgotten punches: check-in without check-out, or records marked as absent/excused
  const pendingAttention = filteredAttendance.filter((a) => a.verification_status === 'pending'
    || (a.check_in_at && !a.check_out_at) || Number(a.late_minutes) > 0 || a.status === 'excused');
  const filteredEdits = (edits || []).filter((e) => isAccessible(e.employee_id)).slice(0, 100);

  function openAttendanceCorrection(existing) {
    const defaultDate = existing?.work_date || todayIn(tz);
    const dateInput = h('input', { type: 'date', value: defaultDate, disabled: Boolean(existing) });
    const inInput = h('input', { type: 'time', value: existing?.check_in_at ? formatTime(existing.check_in_at, tz) : '09:00' });
    const outInput = h('input', { type: 'time', value: existing?.check_out_at ? formatTime(existing.check_out_at, tz) : '17:00' });
    const reasonInput = h('textarea', { placeholder: isAr ? 'اكتب سبب التعديل بالتفصيل (مطلوب)...' : 'Enter the reason for this correction (required)...', rows: 3 });

    const shSelect = h('select', {},
      (shifts || []).map((s) => h('option', { value: s.id, selected: s.id === existing?.shift_id }, s.name)),
    );
    const statusSelect = h('select', {},
      h('option', { value: 'present', selected: existing?.status === 'present' }, isAr ? 'حاضر' : 'Present'),
      canExcuse && h('option', { value: 'excused', selected: existing?.status === 'excused' }, isAr ? 'غياب بعذر (بدون خصم)' : 'Excused Absence'),
      canExcuse && h('option', { value: 'absent', selected: existing?.status === 'absent' }, isAr ? 'غياب غير معتمد' : 'Unexcused Absence'),
    );

    const empName = person(existing?.employee_id)?.full_name || (isAr ? 'الموظف' : 'Employee');
    modal({
      title: t('approvals.modalCorrectTitle', { name: empName }),
      body: h('div', { class: 'grid' },
        h('label', { class: 'field' }, h('span', { class: 'label' }, isAr ? 'التاريخ' : 'Date'), dateInput),
        h('label', { class: 'field' }, h('span', { class: 'label' }, isAr ? 'الوردية' : 'Shift'), shSelect),
        h('label', { class: 'field' }, h('span', { class: 'label' }, t('common.status')), statusSelect),
        h('label', { class: 'field' }, h('span', { class: 'label' }, isAr ? 'وقت الحضور' : 'Clock In'), inInput),
        h('label', { class: 'field' }, h('span', { class: 'label' }, isAr ? 'وقت الانصراف' : 'Clock Out'), outInput),
        h('label', { class: 'field', style: { gridColumn: '1 / -1' } }, h('span', { class: 'label' }, t('approvals.correctionReasonRequired')), reasonInput),
      ),
      buttons: [
        {
          label: t('common.save'),
          kind: 'primary',
          onClick: async () => {
            const reason = reasonInput.value.trim();
            if (!reason) throw new Error(t('approvals.correctionReasonRequired'));
            const date = dateInput.value;
            const shift = (shifts || []).find((s) => s.id === shSelect.value) || shifts[0];
            const checkIn = inInput.value ? zonedTimeToISO(date, inInput.value, tz) : null;
            let checkOut = null;
            if (outInput.value) {
              const sameDay = zonedTimeToISO(date, outInput.value, tz);
              checkOut = (checkIn && sameDay < checkIn) ? zonedTimeToISO(addDays(date, 1), outInput.value, tz) : sameDay;
            }

            let lateMin = 0;
            let earlyMin = 0;
            let otMin = 0;
            if (shift) {
              const inst = shiftInstance(date, shift, tz);
              if (checkIn) lateMin = lateMinutesAt(inst, Date.parse(checkIn));
              if (checkOut) {
                const co = checkoutMinutesAt(inst, Date.parse(checkOut), settings?.overtime_threshold_min ?? 30);
                earlyMin = co.early_leave_minutes;
                otMin = co.overtime_minutes;
              }
            }

            const payload = {
              ...(existing || {}),
              employee_id: existing ? existing.employee_id : profile.id,
              work_date: date,
              shift_id: shift?.id || null,
              status: statusSelect.value,
              check_in_at: checkIn,
              check_out_at: checkOut,
              late_minutes: lateMin,
              early_leave_minutes: earlyMin,
              overtime_minutes: otMin,
              edited_by: profile.id,
              note: reason,
            };

            await api.save('attendance', payload);
            toast(t('approvals.correctionSaved'));
            refresh();
          },
        },
        { label: t('common.cancel'), kind: 'ghost' },
      ],
    });
  }

  async function confirmAttendance(row) {
    try {
      await api.verifyAttendance({ id: row.id, decision: 'approved' });
      toast(t('approvals.attendanceConfirmed'));
      refresh();
    } catch (err) {
      toast(errorText(err) || t('approvals.verificationFailed'), 'err');
    }
  }

  function rejectAttendance(row) {
    const reason = h('textarea', { rows: 3, placeholder: t('approvals.reviewNote') });
    modal({
      title: t('approvals.reviewTitle', { name: person(row.employee_id)?.full_name || t('common.name') }),
      body: h('label', { class: 'field' },
        h('span', { class: 'label' }, t('approvals.reviewNote')),
        reason,
      ),
      buttons: [
        {
          label: t('approvals.rejectBtn'),
          kind: 'danger',
          onClick: async () => {
            if (!reason.value.trim()) throw new Error(t('approvals.reviewNote'));
            await api.verifyAttendance({ id: row.id, decision: 'rejected', note: reason.value.trim() });
            toast(t('approvals.verificationSaved'));
            refresh();
          },
        },
        { label: t('common.cancel'), kind: 'ghost' },
      ],
    });
  }

  function paint() {
    const tabs = h('div', { class: 'tabs' },
      h('button', { class: activeTab === 'leaves' ? 'active' : '', onClick: () => { activeTab = 'leaves'; paint(); } },
        `${t('approvals.tabLeaves')} (${pendingLeaves.length})`),
      h('button', { class: activeTab === 'attendance' ? 'active' : '', onClick: () => { activeTab = 'attendance'; paint(); } },
        `${t('approvals.tabAttendance')} (${pendingAttention.length})`),
      h('button', { class: activeTab === 'audit' ? 'active' : '', onClick: () => { activeTab = 'audit'; paint(); } },
        t('approvals.tabAudit')),
    );

    let tabBody;
    if (activeTab === 'leaves') {
      tabBody = h('div', {},
        h('div', { class: 'card dotted-box' },
          h('h3', { style: { color: 'var(--brand-dark)' } }, t('approvals.pendingLeavesTitle')),
          dataTable([
            { label: t('common.name'), render: (r) => person(r.employee_id)?.full_name || '—' },
            { label: t('leave.type'), render: (r) => typeName(r.leave_type_id) },
            { label: t('leave.fromDate'), render: (r) => fmtDate(r.from_date) },
            { label: t('leave.toDate'), render: (r) => fmtDate(r.to_date) },
            { label: t('common.reason'), render: (r) => r.reason || '—' },
            {
              label: '',
              render: (r) => mayDecideLeave(r) ? h('div', { class: 'row' },
                btn(t('approvals.approveBtn'), () => decideLeave(r, 'approved'), 'small primary'),
                btn(t('approvals.rejectBtn'), () => decideLeave(r, 'rejected'), 'small danger'),
              ) : h('span', { class: 'muted' }, '—'),
            },
          ], pendingLeaves, isAr ? 'لا توجد طلبات إجازة معلقة للمراجعة' : 'No pending leave requests'),
        ),
        h('div', { class: 'card' },
          h('h3', {}, t('approvals.pastLeavesTitle')),
          dataTable([
            { label: t('common.name'), render: (r) => person(r.employee_id)?.full_name || '—' },
            { label: t('leave.type'), render: (r) => typeName(r.leave_type_id) },
            { label: t('leave.fromDate'), render: (r) => fmtDate(r.from_date) },
            { label: t('leave.toDate'), render: (r) => fmtDate(r.to_date) },
            { label: t('common.status'), render: (r) => badge(r.status === 'approved' ? (isAr ? 'مقبولة' : 'Approved') : (isAr ? 'مرفوضة' : 'Rejected'), r.status === 'approved' ? 'ok' : 'err') },
          ], pastLeaves, isAr ? 'لا توجد طلبات سابقة' : 'No past leave records'),
        ),
      );
    } else if (activeTab === 'attendance') {
      tabBody = h('div', {},
        h('div', { class: 'card dotted-box' },
          h('h3', { style: { color: 'var(--brand-dark)' } }, t('approvals.attentionRequiredTitle')),
          h('p', { class: 'muted' }, t('approvals.attentionSubtitle')),
          dataTable([
            { label: t('common.name'), render: (a) => person(a.employee_id)?.full_name || '—' },
            { label: isAr ? 'التاريخ' : 'Date', render: (a) => fmtDate(a.work_date) },
            { label: isAr ? 'حضور' : 'Clock In', render: (a) => (a.check_in_at ? formatTime(a.check_in_at, tz) : '—') },
            { label: isAr ? 'انصراف' : 'Clock Out', render: (a) => (a.check_out_at ? formatTime(a.check_out_at, tz) : badge(isAr ? 'نسي الانصراف' : 'Missed Clock Out', 'warn')) },
            { label: t('common.status'), render: (a) => badge(a.status === 'present' ? (isAr ? 'حاضر' : 'Present') : a.status === 'excused' ? (isAr ? 'غياب بعذر' : 'Excused') : (isAr ? 'غياب' : 'Absent'), a.status === 'present' ? 'ok' : 'warn') },
            { label: isAr ? 'تأكيد المشرف' : 'Supervisor review', render: (a) => a.verification_status === 'pending'
              ? badge(t('approvals.verificationPending'), 'warn')
              : a.verification_status === 'rejected'
                ? badge(t('approvals.verificationRejected'), 'err')
                : badge(t('approvals.verificationApproved'), 'ok') },
            {
              label: '',
              render: (a) => h('div', { class: 'row' },
                mayVerifyAtt(a) && btn(t('approvals.confirmAttendanceBtn'), () => confirmAttendance(a), 'small primary'),
                mayVerifyAtt(a) && btn(t('approvals.rejectBtn'), () => rejectAttendance(a), 'small danger'),
                mayEditAtt(a) && btn(t('approvals.correctBtn'), () => openAttendanceCorrection(a), 'small ghost'),
              ),
            },
          ], pendingAttention, t('approvals.noAttentionNeeded')),
        ),
      );
    } else {
      tabBody = h('div', {},
        h('div', { class: 'card' },
          h('h3', {}, t('approvals.auditTitle')),
          dataTable([
            { label: isAr ? 'التاريخ' : 'Date', render: (e) => fmtDate(e.at?.slice(0, 10)) },
            { label: t('common.name'), render: (e) => person(e.employee_id)?.full_name || '—' },
            { label: isAr ? 'تاريخ العمل' : 'Work Date', render: (e) => fmtDate(e.work_date) },
            { label: isAr ? 'منفّذ التعديل' : 'Changed by', render: (e) => person(e.actor_id)?.full_name || '—' },
            {
              label: t('approvals.auditAction'),
              render: (e) => e.new_data?.verification_status === 'approved' ? t('approvals.attendanceConfirmedAudit')
                : e.new_data?.verification_status === 'rejected' ? t('approvals.attendanceRejectedAudit')
                  : e.action,
            },
            { label: t('common.reason'), render: (e) => e.reason || '—' },
          ], filteredEdits, t('approvals.noAuditRecords')),
        ),
      );
    }

    container.replaceChildren(
      h('div', { class: 'row spread', style: { marginBottom: '14px' } },
        h('div', {},
          h('h2', { style: { color: 'var(--brand-dark)' } }, t('approvals.title')),
          h('p', { class: 'muted' }, t('approvals.subtitle')),
        ),
      ),
      tabs,
      tabBody,
    );
  }

  paint();
  return container;
}
