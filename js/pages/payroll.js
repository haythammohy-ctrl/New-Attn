import { showPayslip } from '../components/payslip.js';
import { can } from '../lib/access.js';
import { monthRange, shiftMonth, todayIn } from '../lib/dates.js';
import { calcPayslip } from '../lib/payroll.js';
import { getLang } from '../lib/i18n.js';
import {
  badge, btn, confirmBox, dataTable, field, h, money, select, toast,
} from '../ui.js';

export default async function render({ api, profile, settings, perms }) {
  const isAr = getLang() === 'ar';
  const text = (ar, en) => isAr ? ar : en;
  const runStatus = {
    draft: [text('مسودة', 'Draft'), 'warn'],
    approved: [text('معتمد ومُقفل', 'Approved and Locked'), 'ok'],
    paid: [text('تم الصرف', 'Paid'), 'ok'],
  };
  const adjustmentTypes = [
    { value: 'bonus', label: text('مكافأة / حافز', 'Bonus / Incentive') },
    { value: 'deduction', label: text('استقطاع', 'Deduction') },
    { value: 'advance', label: text('سلفة', 'Advance') },
  ];
  const adjLabel = (type) => adjustmentTypes.find((a) => a.value === type)?.label || type;
  const tz = settings.timezone;
  const today = todayIn(tz);
  const canEdit = can(perms, 'payroll', 'edit');
  const canApprove = can(perms, 'payroll_approve', 'edit');   // approving, locking and marking paid
  const canSeeAdj = can(perms, 'adjustments', 'view');
  const canEditAdj = can(perms, 'adjustments', 'edit');
  let month = shiftMonth(today.slice(0, 7), -1);

  const [people, shifts, leaveTypes, holidays, salaries] = await Promise.all([
    api.list('profiles', { order: 'full_name' }),
    api.list('shifts'),
    api.list('leave_types'),
    api.list('holidays'),
    api.list('salary_structures'),
  ]);
  const staff = people.filter((p) => p.active);
  const noShifts = shifts.length === 0;
  const nameOf = (id) => people.find((p) => p.id === id)?.full_name || '—';

  const root = h('div', {});
  let state = null;   // { run, slips, warnings, adjustments }

  async function load() {
    const { from, to } = monthRange(month);
    const monthDate = `${month}-01`;
    const [attendance, leaves, adjustments, runs] = await Promise.all([
      api.list('attendance', { gte: { work_date: from }, lte: { work_date: to } }),
      api.list('leave_requests', { eq: { status: 'approved' }, lte: { from_date: to }, gte: { to_date: from } }),
      api.list('adjustments', { eq: { month: monthDate }, order: 'employee_id' }),
      api.list('payroll_runs', { eq: { month: monthDate } }),
    ]);
    const run = runs[0];
    const locked = Boolean(run && run.status !== 'draft');
    const warnings = [];
    let slips;

    if (locked) {
      slips = await api.list('payslips', { eq: { run_id: run.id } });
    } else {
      slips = [];
      if (noShifts) warnings.push(text('لا توجد ورديات معرّفة في الإعدادات؛ لذلك لن يُحتسب الغياب.', 'No shifts are configured; absences will not be calculated.'));
      for (const p of staff) {
        const salary = salaries.find((s) => s.employee_id === p.id);
        if (!salary || !Number(salary.base_salary)) { warnings.push(`${p.full_name}: ${text('لا يوجد راتب أساسي.', 'No base salary is set.')}`); continue; }
        slips.push(calcPayslip({
          month, today, employee: p, salary, shifts, settings, leaveTypes, holidays,
          attendance: attendance.filter((a) => a.employee_id === p.id),
          leaves: leaves.filter((l) => l.employee_id === p.id),
          adjustments: adjustments.filter((a) => a.employee_id === p.id),
        }));
      }
    }
    state = { run, locked, slips, warnings, adjustments };
    paint();
  }

  const reload = () => load();

  async function saveDraft() {
    await api.savePayrollDraft(month, state.slips, profile.id);
    toast(text('حُفظت مسودة الرواتب.', 'Payroll draft saved.'));
    await load();
  }

  async function approve() {
    const ok = await confirmBox(
      text(`سيُعتمد مسير الرواتب لشهر ${month} ويُقفل. ولا يمكن تعديله بعد ذلك، وسيتمكن الموظفون من الاطلاع على قسائمهم. هل تريد المتابعة؟`,
        `The payroll for ${month} will be approved and locked. It cannot be changed afterward, and employees will be able to view their payslips. Continue?`),
      text('اعتماد وإقفال', 'Approve and Lock'), 'primary');
    if (!ok) return;
    const run = await api.savePayrollDraft(month, state.slips, profile.id);
    await api.setRunStatus(run, 'approved');
    toast(text('اعتُمد مسير الرواتب.', 'Payroll approved.'));
    await load();
  }

  async function markPaid() {
    if (!await confirmBox(text('تأكد من صرف الرواتب لجميع الموظفين قبل المتابعة.', 'Confirm that all employees have been paid before continuing.'), text('تأكيد الصرف', 'Confirm Payment'), 'primary')) return;
    await api.setRunStatus(state.run, 'paid');
    await load();
  }

  function adjustmentsCard() {
    const emp = select(staff.map((p) => ({ value: p.id, label: p.full_name })), staff[0]?.id);
    const type = select(adjustmentTypes, 'bonus');
    const amount = h('input', { type: 'number', min: 0, step: 'any' });
    const note = h('input', { type: 'text' });
    const add = btn(text('إضافة', 'Add'), async () => {
      if (!(Number(amount.value) > 0)) { toast(text('أدخل مبلغًا صحيحًا أكبر من صفر.', 'Enter an amount greater than zero.'), 'err'); return; }
      await api.save('adjustments', {
        employee_id: emp.value, month: `${month}-01`, type: type.value, amount: Number(amount.value), note: note.value.trim() || null,
      });
      await reload();
    }, 'primary');

    return h('div', { class: 'card' },
      h('h3', {}, text('مكافآت واستقطاعات وسلف الشهر', 'Monthly Bonuses, Deductions, and Advances')),
      !state.locked && canEditAdj && h('div', { class: 'toolbar' }, field(text('الموظف', 'Employee'), emp), field(text('النوع', 'Type'), type), field(text('المبلغ', 'Amount'), amount), field(text('ملاحظة', 'Note'), note), add),
      dataTable([
        { label: text('الموظف', 'Employee'), render: (a) => nameOf(a.employee_id) },
        { label: text('النوع', 'Type'), render: (a) => adjLabel(a.type) },
        { label: text('المبلغ', 'Amount'), class: 'num', value: (a) => Number(a.amount), render: (a) => money(a.amount) },
        { label: text('ملاحظة', 'Note'), render: (a) => a.note || '—' },
        {
          label: '',
          render: (a) => !state.locked && canEditAdj && btn(text('حذف', 'Delete'), async () => { await api.remove('adjustments', a.id); await reload(); }, 'small'),
        },
      ], state.adjustments, text('لا توجد تسويات لهذا الشهر.', 'No adjustments for this month.'), { name: `adjustments-${month}` }));
  }

  function paint() {
    const { run, locked, slips, warnings } = state;
    const total = slips.reduce((s, p) => s + Number(p.net), 0);
    const status = run ? runStatus[run.status] : [text('لم تُحفظ بعد', 'Not Saved'), ''];

    root.replaceChildren(
      h('div', { class: 'card' },
        h('div', { class: 'toolbar' },
          btn(text('الشهر السابق', 'Previous Month'), () => { month = shiftMonth(month, -1); return load(); }, 'small'),
          h('strong', {}, month),
          btn(text('الشهر التالي', 'Next Month'), () => { month = shiftMonth(month, 1); return load(); }, 'small'),
          badge(...status),
          !locked && canEdit && btn(text('حفظ كمسودة', 'Save Draft'), saveDraft, '', { disabled: !slips.length }),
          !locked && canApprove && btn(text('اعتماد وإقفال', 'Approve and Lock'), approve, 'primary', { disabled: !slips.length }),
          run?.status === 'approved' && canApprove && btn(text('تم الصرف', 'Mark as Paid'), markPaid, 'primary')),
        !locked && !canApprove && h('p', { class: 'muted' }, text('يمكنك إعداد مسودة الرواتب. ويتطلب اعتمادها وإقفالها صلاحية مدير النظام، أو مستخدمًا مُنح هذه الصلاحية.', 'You can prepare a payroll draft. Approval and locking require system administrator permission or an explicitly granted approval permission.')),
        h('div', { class: 'grid' },
          h('div', { class: 'stat' }, h('small', {}, text('عدد الموظفين', 'Employees')), h('b', {}, slips.length)),
          h('div', { class: 'stat' }, h('small', {}, text('إجمالي الصافي', 'Net Total')), h('b', {}, `${money(total)} ${settings.currency}`))),
        warnings.length > 0 && h('div', { style: { marginTop: '12px' } }, warnings.map((w) => h('p', {}, badge(text('تنبيه', 'Warning'), 'warn'), ` ${w}`)))),
      h('div', { class: 'card' },
        locked && h('p', { class: 'muted' }, text('أُقفل هذا الشهر؛ والأرقام المعروضة مأخوذة من قسائم الرواتب المعتمدة.', 'This month is locked. The figures shown are from the approved payslips.')),
        !locked && h('p', { class: 'muted' }, text('تُحتسب المبالغ وفق سجلات الحضور والإجازات والمكافآت الحالية. ولا تُعتمد إلا بعد حفظ المسودة أو اعتماد مسير الرواتب.', 'Amounts are calculated from current attendance, leave, and bonus records. They are not final until the draft is saved or payroll is approved.')),
        dataTable([
          { label: text('الموظف', 'Employee'), render: (p) => nameOf(p.employee_id) },
          { label: text('الأساسي', 'Base Salary'), class: 'num', value: (p) => Number(p.base_salary), render: (p) => money(p.base_salary) },
          { label: text('بدلات', 'Allowances'), class: 'num', value: (p) => Number(p.allowances_total), render: (p) => money(p.allowances_total) },
          { label: text('العمل الإضافي', 'Overtime'), class: 'num', value: (p) => Number(p.overtime_pay), render: (p) => money(p.overtime_pay) },
          { label: text('مكافآت', 'Bonuses'), class: 'num', value: (p) => Number(p.bonuses), render: (p) => money(p.bonuses) },
          { label: text('خصم غياب', 'Absence Deduction'), class: 'num', value: (p) => Number(p.absence_deduction), render: (p) => money(p.absence_deduction) },
          { label: text('خصم تأخير', 'Late Deduction'), class: 'num', value: (p) => Number(p.late_deduction), render: (p) => money(p.late_deduction) },
          { label: text('خصومات', 'Deductions'), class: 'num', value: (p) => Number(p.other_deductions), render: (p) => money(p.other_deductions) },
          { label: text('سلف', 'Advances'), class: 'num', value: (p) => Number(p.advances), render: (p) => money(p.advances) },
          { label: text('الصافي', 'Net Pay'), class: 'num', value: (p) => Number(p.net), render: (p) => h('b', {}, money(p.net), p.details?.negative_net && badge(text('سالب', 'Negative'), 'err')) },
          { label: '', render: (p) => btn(text('قسيمة', 'Payslip'), () => showPayslip(p, nameOf(p.employee_id), settings), 'small') },
        ], slips, text('لا توجد بيانات رواتب لهذا الشهر.', 'No payroll data for this month.'), { name: `payroll-${month}` })),
      canSeeAdj && adjustmentsCard(),
    );
  }

  await load();
  return root;
}
