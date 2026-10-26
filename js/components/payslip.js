import { h, hoursText, modal, money } from '../ui.js';
import { getLang } from '../lib/i18n.js';

function payslipNode(p, employeeName, settings) {
  const isAr = getLang() === 'ar';
  const d = p.details || {};
  const days = d.days || {};
  const cur = settings.currency;
  const line = (label, value, cls = '') => h('tr', { class: cls }, h('td', {}, label), h('td', {}, `${money(value)} ${cur}`));
  const section = (label) => h('tr', {}, h('th', { colSpan: 2 }, label));

  return h('div', { class: 'payslip' },
    h('h3', {}, `${settings.company_name} - ${isAr ? 'قسيمة راتب' : 'Payslip'}`),
    h('p', { class: 'muted', style: { textAlign: 'center' } }, `${employeeName}  ·  ${isAr ? 'شهر' : 'Month'} ${p.month.slice(0, 7)}`),
    h('div', { class: 'table-wrap' }, h('table', {},
      h('tbody', {},
        section(isAr ? 'الاستحقاقات' : 'Earnings'),
        line(d.prorated
          ? (isAr ? `الراتب الأساسي (نسبي عن ${d.active_days || 0} يوم)` : `Prorated Base Salary (${d.active_days || 0} days)`)
          : (isAr ? 'الراتب الأساسي' : 'Base Salary'), p.base_salary),
        ...(d.allowances || []).map((a) => line(a.name || (isAr ? 'بدل' : 'Allowance'), a.amount)),
        p.overtime_pay > 0 && line(`${isAr ? 'العمل الإضافي' : 'Overtime'} (${hoursText(d.overtime_minutes)})`, p.overtime_pay),
        p.bonuses > 0 && line(isAr ? 'مكافآت وحوافز' : 'Bonuses and Incentives', p.bonuses),
        section(isAr ? 'الخصومات' : 'Deductions'),
        line(`${isAr ? 'غياب' : 'Absence'} (${(days.absent || 0) + (days.unpaidLeave || 0)} ${isAr ? 'يوم' : 'days'})`, p.absence_deduction),
        line(`${isAr ? 'التأخير والانصراف المبكر' : 'Late Arrivals and Early Departures'} (${hoursText((d.late_minutes || 0) + (d.early_leave_minutes || 0))})`, p.late_deduction),
        p.insurance_deduction > 0 && line(isAr ? 'تأمينات اجتماعية' : 'Social Insurance', p.insurance_deduction),
        p.tax_deduction > 0 && line(isAr ? 'ضريبة دخل' : 'Income Tax', p.tax_deduction),
        p.other_deductions > 0 && line(isAr ? 'خصومات أخرى' : 'Other Deductions', p.other_deductions),
        p.advances > 0 && line(isAr ? 'سلف' : 'Advances', p.advances),
        line(isAr ? 'صافي الراتب' : 'Net Salary', p.net, 'net'),
      ))),
    h('p', { class: 'muted', style: { marginTop: '10px' } },
      isAr
        ? `أيام الحضور ${days.present || 0}  ·  غياب ${days.absent || 0}  ·  إجازات ${(days.paidLeave || 0) + (days.unpaidLeave || 0)}`
        : `Attendance days ${days.present || 0}  ·  Absence ${days.absent || 0}  ·  Leave ${(days.paidLeave || 0) + (days.unpaidLeave || 0)}`),
  );
}

export function showPayslip(p, employeeName, settings) {
  const isAr = getLang() === 'ar';
  modal({
    title: `${isAr ? 'قسيمة' : 'Payslip'} ${p.month.slice(0, 7)}`,
    body: payslipNode(p, employeeName, settings),
    buttons: [
      { label: isAr ? 'طباعة / حفظ PDF' : 'Print / Save PDF', kind: 'primary', onClick: () => { window.print(); return false; } },
      { label: isAr ? 'إغلاق' : 'Close', kind: 'ghost' },
    ],
  });
}
