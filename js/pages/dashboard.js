import { formatTime, todayIn } from '../lib/dates.js';
import { getLang } from '../lib/i18n.js';
import { badge, btn, dataTable, h, hoursText, select } from '../ui.js';

export default async function render({ api, profile, settings, perms }) {
  const isAr = getLang() === 'ar';
  const tz = settings.timezone;
  const now = api.now();
  const today = todayIn(tz, now);
  const monthStart = `${today.slice(0, 7)}-01`;

  const isAdmin = profile.role === 'admin';
  const isManager = profile.role === 'assistant_manager';
  const isSupervisor = profile.role === 'supervisor' || profile.role === 'manager';
  const isEmployee = profile.role === 'employee';

  const [allProfiles, allAttendanceToday, allShifts, activeLeaves, pendingLeaves, monthAttendance, allTeams] = await Promise.all([
    api.list('profiles', { eq: { active: true } }),
    api.list('attendance', { eq: { work_date: today } }),
    api.list('shifts'),
    api.list('leave_requests', { eq: { status: 'approved' }, lte: { from_date: today }, gte: { to_date: today } }),
    api.list('leave_requests', { eq: { status: 'pending' } }),
    api.list('attendance', { gte: { work_date: monthStart }, lte: { work_date: today } }),
    api.list('teams'),
  ]);

  // Accessible employees based on scope
  let accessibleProfiles = allProfiles.filter((p) => {
    if (isAdmin || isManager) return true;
    if (isSupervisor) return p.team_id === profile.team_id || p.id === profile.id;
    return p.id === profile.id;
  });

  const accessibleTeamIds = new Set(accessibleProfiles.map((p) => p.team_id).filter(Boolean));
  const availableTeams = allTeams.filter((t) => isAdmin || isManager || accessibleTeamIds.has(t.id));

  let selectedTeamId = '';
  const container = h('div', {});

  function paint() {
    let profiles = accessibleProfiles;
    if (selectedTeamId) {
      profiles = profiles.filter((p) => p.team_id === selectedTeamId);
    }
    const empIds = new Set(profiles.map((p) => p.id));

    const todayAttendance = allAttendanceToday.filter((a) => empIds.has(a.employee_id));
    const currentLeaves = activeLeaves.filter((l) => empIds.has(l.employee_id));
    const currentPendingLeaves = pendingLeaves.filter((l) => empIds.has(l.employee_id));
    const curMonthAttendance = monthAttendance.filter((a) => empIds.has(a.employee_id));

    const profileMap = new Map(allProfiles.map((p) => [p.id, p]));
    const shiftMap = new Map(allShifts.map((s) => [s.id, s]));

    // Metrics for Today
    const checkedInList = todayAttendance.filter((a) => a.check_in_at);
    const presentCount = checkedInList.filter((a) => a.verification_status !== 'pending' && a.verification_status !== 'rejected').length;
    const pendingVerification = checkedInList.filter((a) => a.verification_status === 'pending').length;
    const lateCount = checkedInList.filter((a) => a.verification_status !== 'pending'
      && a.verification_status !== 'rejected' && (a.late_minutes || 0) > 0).length;
    const onLeaveCount = currentLeaves.length;
    const totalEmployees = profiles.length;
    const notPunchedYet = Math.max(0, totalEmployees - presentCount - onLeaveCount);

    // Month Metrics
    const confirmedMonthAttendance = curMonthAttendance.filter((a) => a.verification_status !== 'pending' && a.verification_status !== 'rejected');
    const monthLateMin = confirmedMonthAttendance.reduce((sum, a) => sum + (a.late_minutes || 0), 0);
    const monthOtMin = confirmedMonthAttendance.reduce((sum, a) => sum + (a.overtime_minutes || 0), 0);
    const monthPresentDays = curMonthAttendance.filter((a) => a.check_in_at
      && a.verification_status !== 'pending' && a.verification_status !== 'rejected').length;

    const statCard = (label, value, hint = '', badgeType = '') => h('div', { class: 'stat' },
      h('small', { class: 'muted' }, label),
      h('b', { style: { fontSize: '1.6rem', marginTop: '4px' } }, String(value)),
      hint && h('div', { style: { marginTop: '4px' } }, badgeType ? badge(hint, badgeType) : h('small', { class: 'muted' }, hint)),
    );

    // Visual distribution bar
    const pPct = totalEmployees ? Math.round((presentCount / totalEmployees) * 100) : 0;
    const lPct = totalEmployees ? Math.round((onLeaveCount / totalEmployees) * 100) : 0;
    const vPct = totalEmployees ? Math.round((pendingVerification / totalEmployees) * 100) : 0;
    const rPct = Math.max(0, 100 - pPct - lPct - vPct);

    const distributionBar = h('div', { style: { marginTop: '12px', marginBottom: '8px' } },
      h('div', {
        style: {
          display: 'flex', height: '14px', borderRadius: '7px', overflow: 'hidden',
          background: 'var(--line)', width: '100%',
        },
      },
        pPct > 0 && h('div', { style: { width: `${pPct}%`, background: 'var(--ok)' }, title: `${isAr ? 'حضور مؤكد' : 'Confirmed attendance'} ${pPct}%` }),
        lPct > 0 && h('div', { style: { width: `${lPct}%`, background: 'var(--primary)' }, title: `${isAr ? 'إجازات' : 'Leave'} ${lPct}%` }),
        vPct > 0 && h('div', { style: { width: `${vPct}%`, background: 'var(--warn)' }, title: `${isAr ? 'بانتظار التأكيد' : 'Awaiting confirmation'} ${vPct}%` }),
        rPct > 0 && h('div', { style: { width: `${rPct}%`, background: '#cbd5e1' }, title: `${isAr ? 'لم يسجلوا الحضور بعد' : 'Not clocked in'} ${rPct}%` }),
      ),
      h('div', { class: 'row', style: { justifyContent: 'space-between', fontSize: '0.85rem', marginTop: '6px' } },
        h('span', { style: { color: 'var(--ok)' } }, `● ${isAr ? 'حضور مؤكد' : 'Confirmed'}: ${presentCount} (${pPct}%)`),
        lateCount > 0 && h('span', { style: { color: 'var(--warn)' } }, `● ${isAr ? 'حالات التأخير' : 'Late arrivals'}: ${lateCount}`),
        h('span', { style: { color: 'var(--primary)' } }, `● ${isAr ? 'في إجازة' : 'On leave'}: ${onLeaveCount} (${lPct}%)`),
        pendingVerification > 0 && h('span', { style: { color: 'var(--warn)' } }, `● ${isAr ? 'بانتظار التأكيد' : 'Awaiting confirmation'}: ${pendingVerification} (${vPct}%)`),
        h('span', { class: 'muted' }, `● ${isAr ? 'لم يسجلوا الحضور بعد' : 'Not clocked in'}: ${notPunchedYet} (${rPct}%)`),
      ),
    );

    const columns = [
      { label: isAr ? 'الموظف' : 'Employee', render: (r) => profileMap.get(r.employee_id)?.full_name || '—' },
      { label: isAr ? 'الوردية' : 'Shift', render: (r) => shiftMap.get(r.shift_id)?.name || '—' },
      { label: isAr ? 'وقت الحضور' : 'Clock In', render: (r) => (r.check_in_at ? formatTime(r.check_in_at, tz) : '—') },
      {
        label: isAr ? 'الحالة' : 'Status',
        render: (r) => {
          if (!r.check_in_at) return badge(isAr ? 'لم يسجل الحضور' : 'Not clocked in', 'err');
          if (r.verification_status === 'pending') return badge(isAr ? 'بانتظار تأكيد المشرف' : 'Awaiting supervisor confirmation', 'warn');
          if (r.verification_status === 'rejected') return badge(isAr ? 'رُفض الحضور' : 'Attendance rejected', 'err');
          if (r.late_minutes > 0) return badge(isAr ? `متأخر ${r.late_minutes} دقيقة` : `${r.late_minutes} min late`, 'warn');
          return badge(isAr ? 'تم تأكيد الحضور' : 'Confirmed', 'ok');
        },
      },
      { label: isAr ? 'وقت الانصراف' : 'Clock Out', render: (r) => (r.check_out_at ? formatTime(r.check_out_at, tz) : badge(isAr ? 'قيد العمل' : 'In progress', 'ok')) },
      { label: isAr ? 'إضافي' : 'Overtime', render: (r) => (r.overtime_minutes > 0 ? hoursText(r.overtime_minutes) : '—') },
    ];

    const teamFilter = availableTeams.length > 1 && select(
      [{ value: '', label: isAr ? 'جميع الفرق التابعة' : 'All assigned teams' }, ...availableTeams.map((t) => ({ value: t.id, label: t.name }))],
      selectedTeamId,
    );
    if (teamFilter) {
      teamFilter.addEventListener('change', () => {
        selectedTeamId = teamFilter.value;
        paint();
      });
    }

    container.replaceChildren(
      h('div', { class: 'row spread', style: { marginBottom: '12px' } },
        h('div', {},
          h('h2', { style: { margin: 0 } }, isEmployee ? (isAr ? 'ملخص أدائي وحضوري' : 'My Attendance Dashboard') : (isAr ? 'لوحة معلومات الأداء' : 'Attendance Dashboard')),
          h('p', { class: 'muted', style: { margin: 0 } }, `${isAr ? 'تاريخ اليوم' : 'Today'}: ${today.split('-').reverse().join('/')}`),
        ),
        h('div', { class: 'row' },
          teamFilter && h('label', { class: 'field', style: { margin: 0 } }, teamFilter),
          btn(isAr ? 'طباعة سجل حضور اليوم' : "Print today's attendance", () => window.print(), 'primary small'),
        ),
      ),

      h('div', { class: 'card' },
        h('h3', {}, isEmployee ? (isAr ? 'حضوري اليوم' : "Today's Attendance") : (isAr ? 'ملخص حضور اليوم' : "Today's Attendance Summary")),
        distributionBar,
        h('div', { class: 'grid', style: { marginTop: '16px' } },
          statCard(isEmployee ? (isAr ? 'حالة اليوم' : 'Today') : (isAr ? 'الموظفون الحاضرون' : 'Confirmed Employees'), isEmployee ? (pendingVerification > 0 ? (isAr ? 'بانتظار تأكيد المشرف' : 'Awaiting supervisor confirmation') : presentCount > 0 ? (isAr ? 'تم تأكيد الحضور' : 'Attendance confirmed') : (isAr ? 'لم تسجّل حضورك بعد' : 'Not clocked in yet')) : `${presentCount} / ${totalEmployees}`, `${isAr ? 'نسبة الحضور' : 'Attendance rate'} ${pPct}%`, pPct >= 80 ? 'ok' : 'warn'),
          statCard(isAr ? 'حالات التأخير اليوم' : 'Late Arrivals Today', lateCount, lateCount === 0 ? (isAr ? 'لا توجد حالات تأخير' : 'No late arrivals') : `${lateCount} ${isAr ? 'حالة' : 'records'}`, lateCount === 0 ? 'ok' : 'warn'),
          statCard(isAr ? 'الموظفون في إجازة اليوم' : 'Employees on Leave Today', onLeaveCount, isAr ? 'إجازات معتمدة' : 'Approved leave'),
          pendingVerification > 0 && !isEmployee && statCard(isAr ? 'حضور بانتظار التأكيد' : 'Pending Attendance Reviews', pendingVerification, isAr ? 'تحتاج إلى مراجعة مشرف' : 'Awaiting supervisor review', 'warn'),
          !isEmployee && statCard(isAr ? 'طلبات الإجازة المعلّقة' : 'Pending Leave Requests', currentPendingLeaves.length, currentPendingLeaves.length > 0 ? (isAr ? 'تحتاج إلى مراجعة' : 'Needs review') : (isAr ? 'لا توجد طلبات' : 'No pending requests'), currentPendingLeaves.length > 0 ? 'warn' : 'ok'),
        ),
      ),

      h('div', { class: 'card' },
        h('h3', {}, isEmployee ? (isAr ? 'ملخص الشهر الخاص بي' : 'My Monthly Summary') : (isAr ? 'ملخص الشهر التراكمي' : 'Monthly Summary')),
        h('div', { class: 'grid' },
          statCard(isAr ? 'إجمالي أيام العمل' : 'Confirmed Workdays', monthPresentDays),
          statCard(isAr ? 'إجمالي مدة التأخير' : 'Total Late Time', hoursText(monthLateMin), isAr ? 'خلال الشهر الحالي' : 'This month'),
          statCard(isAr ? 'إجمالي مدة العمل الإضافي' : 'Total Overtime', hoursText(monthOtMin), isAr ? 'خلال الشهر الحالي' : 'This month'),
        ),
      ),

      h('div', { class: 'card' },
        h('h3', {}, isEmployee ? (isAr ? 'سجل حضوري وانصرافي اليوم' : "Today's Clock In/Out") : (isAr ? 'سجلات الحضور اليوم' : "Today's Attendance Records")),
        dataTable(columns, checkedInList, isAr ? 'لم يُسجّل أي حضور اليوم بعد.' : 'No attendance has been recorded today.'),
      ),
    );
  }

  paint();
  return container;
}
