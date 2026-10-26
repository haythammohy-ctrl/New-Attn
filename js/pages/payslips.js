import { showPayslip } from '../components/payslip.js';
import { can } from '../lib/access.js';
import { todayIn } from '../lib/dates.js';
import { calcPayslip } from '../lib/payroll.js';
import { getLang, t } from '../lib/i18n.js';
import { badge, btn, dataTable, h, hoursText, money, select } from '../ui.js';

export default async function render({ api, profile, settings, perms }) {
  const isAr = getLang() === 'ar';
  const tz = settings?.timezone || 'Africa/Cairo';
  const today = todayIn(tz);
  const currentMonth = today.slice(0, 7);

  const isAdmin = profile.role === 'admin';
  const isManager = profile.role === 'assistant_manager';
  const isSupervisor = profile.role === 'supervisor' || profile.role === 'manager';
  const canSeeSalaries = isAdmin || isManager || can(perms, 'salaries');

  const [
    people,
    shifts,
    holidays,
    leaveTypes,
    salaryStructures,
    allLeaves,
    allAdjustments,
    allAttendance,
    closedSlips,
  ] = await Promise.all([
    api.list('profiles', { order: 'full_name' }).catch(() => []),
    api.list('shifts').catch(() => []),
    api.list('holidays').catch(() => []),
    api.list('leave_types').catch(() => []),
    api.list('salary_structures').catch(() => []),
    api.list('leave_requests', { eq: { status: 'approved' } }).catch(() => []),
    api.list('adjustments').catch(() => []),
    api.list('attendance', { gte: { work_date: `${currentMonth}-01` }, lte: { work_date: today } }).catch(() => []),
    api.list('payslips', { order: '-month' }).catch(() => []),
  ]);

  const accessibleStaff = (people || []).filter((p) => {
    if (!p.active) return false;
    if (isAdmin || isManager) return true;
    if (isSupervisor) return p.team_id === profile.team_id || p.id === profile.id;
    return p.id === profile.id;
  });

  let selectedEmpId = accessibleStaff.some((p) => p.id === profile.id)
    ? profile.id
    : accessibleStaff[0]?.id || profile.id;

  const content = h('div', {});

  function computeRunningPayslip(emp) {
    if (!emp) return null;
    const salary = (salaryStructures || []).find((s) => s.employee_id === emp.id) || { base_salary: 0, allowances: [] };
    const empAtt = (allAttendance || []).filter((a) => a.employee_id === emp.id);
    const empLeaves = (allLeaves || []).filter((l) => l.employee_id === emp.id);
    const empAdj = (allAdjustments || []).filter((a) => a.employee_id === emp.id);

    try {
      return calcPayslip({
        month: currentMonth,
        today,
        employee: emp,
        salary,
        shifts: shifts || [],
        settings: settings || {},
        attendance: empAtt,
        holidays: holidays || [],
        leaves: empLeaves,
        leaveTypes: leaveTypes || [],
        adjustments: empAdj,
      });
    } catch (err) {
      console.warn('Error calculating live running payslip:', err);
      return null;
    }
  }

  function paint() {
    const selectedEmp = (people || []).find((p) => p.id === selectedEmpId) || profile;
    const running = computeRunningPayslip(selectedEmp);
    const empClosedSlips = (closedSlips || []).filter((s) => s.employee_id === selectedEmpId);

    const empSelect = select(
      accessibleStaff.map((p) => ({
        value: p.id,
        label: p.full_name + (p.id === profile.id ? ` (${isAr ? 'أنا' : 'Me'})` : ''),
      })),
      selectedEmpId,
    );
    empSelect.addEventListener('change', () => {
      selectedEmpId = empSelect.value;
      paint();
    });

    const d = running?.details || {};
    const days = d.days || {};

    const runningCard = h('div', { class: 'card', style: { borderTop: '4px solid var(--primary)' } },
      h('div', { class: 'row spread', style: { marginBottom: '10px' } },
        h('h3', { style: { margin: 0, color: 'var(--brand-dark)' } }, t('payslips.currentMonthTitle', { month: currentMonth })),
        badge(t('payslips.updatedBadge'), 'ok'),
      ),
      h('p', { class: 'muted' }, t('payslips.runningNotice')),

      h('div', { class: 'grid', style: { marginBottom: '14px' } },
        h('div', { class: 'stat' },
          h('small', { class: 'muted' }, t('payslips.completedDays')),
          h('b', { style: { fontSize: '1.25rem' } }, `${days.present || 0} ${isAr ? 'يوم' : 'days'}`),
          h('small', { class: 'muted' }, `${t('payslips.absenceDays')}: ${days.absent || 0}`),
          (days.pendingReview || 0) > 0 && h('small', { class: 'muted' }, `${t('payslips.pendingReviews')}: ${days.pendingReview}`),
        ),
        h('div', { class: 'stat' },
          h('small', { class: 'muted' }, t('payslips.overtime')),
          h('b', { style: { color: 'var(--ok)', fontSize: '1.25rem' } }, hoursText(d.overtime_minutes || 0)),
          h('small', { class: 'muted' }, canSeeSalaries && running ? `+${money(running.overtime_pay)} ${settings.currency}` : ''),
        ),
        h('div', { class: 'stat' },
          h('small', { class: 'muted' }, t('payslips.delaysAndEarly')),
          h('b', { style: { color: (d.late_minutes || 0) > 0 ? 'var(--warn)' : 'var(--muted)', fontSize: '1.25rem' } },
            hoursText((d.late_minutes || 0) + (d.early_leave_minutes || 0))),
          h('small', { class: 'muted' }, canSeeSalaries && running ? `-${money((running.late_deduction || 0) + (running.early_leave_deduction || 0))} ${settings.currency}` : ''),
        ),
        canSeeSalaries && h('div', { class: 'stat', style: { border: '2px solid var(--primary)', background: 'var(--primary-light)' } },
          h('small', { style: { color: 'var(--brand-dark)', fontWeight: 700 } }, t('payslips.estimatedNet')),
          h('b', { style: { fontSize: '1.4rem', color: 'var(--primary-dark)' } }, `${money(running?.net_salary || 0)} ${settings.currency}`),
          h('small', { class: 'muted' }, t('payslips.finalNotice')),
        ),
      ),

      canSeeSalaries && running && btn(t('payslips.viewDetails'), () => showPayslip(running, settings), 'small ghost', { style: { marginTop: '4px' } }),
    );

    const closedCard = h('div', { class: 'card' },
      h('h3', {}, t('payslips.archivedSlips')),
      h('p', { class: 'muted' }, t('payslips.archivedDesc')),
      dataTable([
        { label: t('payslips.month'), render: (s) => s.month.slice(0, 7) },
        ...(canSeeSalaries ? [
          { label: t('payslips.baseSalary'), class: 'num', render: (s) => `${money(s.base_salary)} ${settings.currency}` },
          { label: t('payslips.netSalary'), class: 'num', render: (s) => `${money(s.net_salary)} ${settings.currency}` },
        ] : []),
        {
          label: '',
          render: (s) => btn(t('payslips.viewOfficialSlip'), () => showPayslip(s, settings), 'small primary'),
        },
      ], empClosedSlips, t('payslips.noArchivedSlips')),
    );

    content.replaceChildren(
      accessibleStaff.length > 1
        ? h('div', { class: 'toolbar' }, h('label', { class: 'field', style: { minWidth: '240px' } }, h('span', { class: 'label' }, t('common.name')), empSelect))
        : h('div', {}),
      runningCard,
      closedCard,
    );
  }

  paint();
  return content;
}
