import { daysSinceBackup, lastBackupAt, restoreBackup, runBackup, STALE_AFTER_DAYS, validateBackup } from '../components/backup.js';
import { buildForm } from '../components/form.js';
import { can } from '../lib/access.js';
import { AR_WEEKDAYS } from '../lib/dates.js';
import { getPosition } from '../lib/geo.js';
import { isOvernight } from '../lib/shifts.js';
import { getLang } from '../lib/i18n.js';
import { badge, btn, confirmBox, dataTable, fmtDate, h, modal, toast } from '../ui.js';

const SECTIONS = [
  {
    key: 'work_locations', label: 'الفروع', add: 'إضافة فرع', order: 'name',
    fields: [
      { key: 'name', label: 'اسم الفرع', required: true },
      { key: 'lat', label: 'خط العرض (Latitude)', type: 'number', step: 'any', required: true },
      { key: 'lng', label: 'خط الطول (Longitude)', type: 'number', step: 'any', required: true },
      { key: 'radius_m', label: 'النطاق المسموح (متر)', type: 'number', min: 10, required: true, default: 100 },
    ],
    columns: [
      { label: 'الفرع', render: (r) => r.name },
      { label: 'الإحداثيات', render: (r) => `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}` },
      { label: 'النطاق', render: (r) => `${r.radius_m} م` },
    ],
    hint: 'افتح خرائط Google، وانقر بزر الفأرة الأيمن على موقع الشركة لنسخ الإحداثيات. أو اضغط «استخدم موقعي الحالي» أثناء وجودك في الموقع.',
    extra: (form) => btn('استخدم موقعي الحالي', async () => {
      const p = await getPosition();
      form.set({ lat: p.lat.toFixed(6), lng: p.lng.toFixed(6) });
      toast(`تم تحديد الموقع (بدقة ${Math.round(p.accuracy)} م).`);
    }, 'small'),
  },
  {
    key: 'shifts', label: 'الورديات', add: 'إضافة وردية', order: 'name',
    fields: [
      { key: 'name', label: 'اسم الوردية', required: true },
      { key: 'start_time', label: 'بداية الدوام', type: 'time', required: true, default: '09:00' },
      { key: 'end_time', label: 'نهاية الدوام', type: 'time', required: true, default: '17:00' },
      { key: 'grace_minutes', label: 'فترة السماح (دقيقة)', type: 'number', min: 0, required: true, default: 10 },
      { key: 'working_days', label: 'أيام العمل في الأسبوع', type: 'weekdays', required: true, default: [0, 1, 2, 3, 4], hint: 'يُحتسب اليوم يوم عمل إذا كانت هناك وردية واحدة على الأقل تعمل فيه. وتُعد بقية الأيام أيام راحة.' },
    ],
    columns: [
      { label: 'الوردية', render: (r) => r.name },
      { label: 'وقت الوردية', render: (r) => h('span', {}, `${r.start_time.slice(0, 5)} - ${r.end_time.slice(0, 5)}`, isOvernight(r) && badge('تتجاوز منتصف الليل', 'warn')) },
      { label: 'فترة السماح', render: (r) => `${r.grace_minutes} دقيقة` },
      { label: 'الأيام', render: (r) => r.working_days.map((d) => AR_WEEKDAYS[d]).join('، ') },
    ],
    hint: 'يختار الموظف وردية عند تسجيل الحضور. تظهر له جميع الورديات، لكن يمكنه اختيار الورديات المفتوحة فقط. إذا كان وقت النهاية أسبق من وقت البداية (مثل 23:00–07:00)، تنتهي الوردية في اليوم التالي.',
    validate: (v) => {
      if (v.end_time === v.start_time) throw new Error('يجب أن يختلف وقتا بداية الوردية ونهايتها.');
    },
  },
  {
    key: 'holidays', label: 'العطلات الرسمية', add: 'إضافة عطلة', order: 'date',
    fields: [
      { key: 'name', label: 'الاسم', required: true },
      { key: 'date', label: 'التاريخ', type: 'date', required: true },
    ],
    columns: [
      { label: 'التاريخ', render: (r) => fmtDate(r.date) },
      { label: 'الاسم', render: (r) => r.name },
    ],
  },
  {
    key: 'job_titles', label: 'الوظائف', add: 'إضافة وظيفة', order: 'name',
    fields: [
      { key: 'name', label: 'اسم الوظيفة', required: true },
      {
        key: 'kind', label: 'النوع', type: 'select', default: 'employee',
        options: [{ value: 'employee', label: 'موظف' }, { value: 'supervision', label: 'إشراف أو إدارة' }],
      },
    ],
    columns: [
      { label: 'الوظيفة', render: (r) => r.name },
      { label: 'النوع', render: (r) => (r.kind === 'employee' ? badge('موظف', 'ok') : badge('إشراف أو إدارة', 'warn')) },
    ],
    hint: 'تظهر هذه القائمة عند إنشاء حساب جديد. في نوع «موظف»، يكون البريد الإلكتروني اختياريًا، ويُنشأ رقم الموظف تلقائيًا، ويكون اختيار المدير المباشر إلزاميًا. أما الأنواع الأخرى، فيلزم إدخال بريد إلكتروني ولا يُنشأ لها رقم موظف.',
  },
  {
    key: 'leave_types', label: 'أنواع الإجازات', add: 'إضافة نوع', order: 'name',
    fields: [
      { key: 'name', label: 'الاسم', required: true },
      {
        key: 'kind', label: 'تصنيف اليوم', type: 'select', default: 'paid_leave',
        options: [
          { value: 'paid_leave', label: getLang() === 'ar' ? 'إجازة مدفوعة الأجر' : 'Paid leave' },
          { value: 'unpaid_leave', label: getLang() === 'ar' ? 'إجازة غير مدفوعة الأجر' : 'Unpaid leave' },
          { value: 'day_off', label: getLang() === 'ar' ? 'يوم راحة' : 'Day off' },
          { value: 'public_holiday', label: getLang() === 'ar' ? 'عطلة رسمية' : 'Public holiday' },
          { value: 'absence', label: getLang() === 'ar' ? 'غياب' : 'Absence' },
          { value: 'excused_absence', label: getLang() === 'ar' ? 'غياب بعذر' : 'Excused absence' },
        ],
      },
      { key: 'annual_days', label: 'الرصيد السنوي (0 = بدون حد)', type: 'number', min: 0, required: true, default: 0 },
    ],
    columns: [
      { label: 'الاسم', render: (r) => r.name },
      { label: 'التصنيف', render: (r) => {
        const labels = {
          paid_leave: getLang() === 'ar' ? 'إجازة مدفوعة الأجر' : 'Paid leave',
          unpaid_leave: getLang() === 'ar' ? 'إجازة غير مدفوعة الأجر' : 'Unpaid leave',
          day_off: getLang() === 'ar' ? 'يوم راحة' : 'Day off',
          public_holiday: getLang() === 'ar' ? 'عطلة رسمية' : 'Public holiday',
          absence: getLang() === 'ar' ? 'غياب' : 'Absence',
          excused_absence: getLang() === 'ar' ? 'غياب بعذر' : 'Excused absence',
        };
        return badge(labels[r.kind] || labels.paid_leave, r.kind === 'unpaid_leave' || r.kind === 'absence' ? 'warn' : 'ok');
      } },
      { label: 'الرصيد السنوي', render: (r) => (r.annual_days || 'بدون حد') },
    ],
  },
];

const SETTINGS_FIELDS = [
  { key: 'company_name', label: 'اسم الشركة', required: true },
  { key: 'timezone', label: 'المنطقة الزمنية', required: true, hint: 'مثال: Africa/Cairo' },
  { key: 'currency', label: 'العملة', required: true },
  {
    key: 'days_in_month_mode', label: 'أيام الشهر في حساب اليومية', type: 'select',
    options: [{ value: '30', label: '30 يومًا ثابتًا' }, { value: 'actual', label: 'عدد أيام الشهر الفعلي' }],
  },
  { key: 'prorate_hire_month', label: 'احتساب الراتب النسبي لشهر التعيين', type: 'checkbox', default: false, hint: 'عند التفعيل، يُحتسب للموظف الجديد راتب نسبي من تاريخ تعيينه حتى نهاية الشهر بدلًا من الراتب الكامل.' },
  { key: 'social_insurance_percent', label: 'نسبة التأمينات الاجتماعية (%)', type: 'number', step: 'any', min: 0, default: 0, hint: 'نسبة اختيارية تُخصم من الراتب الأساسي (0 = دون خصم).' },
  { key: 'tax_percent', label: 'نسبة ضريبة الدخل (%)', type: 'number', step: 'any', min: 0, default: 0, hint: 'نسبة اختيارية تُخصم من الراتب الأساسي (0 = دون خصم).' },
  { key: 'overtime_multiplier', label: 'معامل العمل الإضافي', type: 'number', step: 'any', min: 0, required: true },
  { key: 'overtime_threshold_min', label: 'الحد الأدنى لاحتساب العمل الإضافي (دقيقة)', type: 'number', min: 0, required: true },
  { key: 'late_factor', label: 'معامل خصم التأخير', type: 'number', step: 'any', min: 0, required: true, hint: '1 = خصم يعادل أجر ساعة' },
  { key: 'absence_factor', label: 'معامل خصم الغياب', type: 'number', step: 'any', min: 0, required: true, hint: '1 = خصم يوم كامل' },
  { key: 'max_accuracy_m', label: 'أقصى هامش خطأ لموقع GPS (متر)', type: 'number', min: 10, required: true },
  { key: 'checkin_window_min', label: 'فتح تسجيل الحضور قبل الوردية (دقيقة)', type: 'number', min: 0, required: true, hint: 'تكون الوردية متاحة للاختيار بدءًا من هذا الوقت وحتى موعد انتهائها.' },
  { key: 'employee_code_prefix', label: 'بادئة رقم الموظف', required: true, hint: 'مثلًا، تُنتج البادئة DC الرقم DC000001. وتُطبّق على الأرقام الجديدة فقط.' },
];

const ENGLISH_LABELS = {
  'الفروع': 'Branches', 'إضافة فرع': 'Add Branch', 'اسم الفرع': 'Branch Name',
  'خط العرض (Latitude)': 'Latitude', 'خط الطول (Longitude)': 'Longitude',
  'النطاق المسموح (متر)': 'Allowed Radius (meters)', 'الفرع': 'Branch',
  'الإحداثيات': 'Coordinates', 'النطاق': 'Radius',
  'افتح خرائط Google، وانقر بزر الفأرة الأيمن على موقع الشركة لنسخ الإحداثيات. أو اضغط «استخدم موقعي الحالي» أثناء وجودك في الموقع.':
    'Open Google Maps and right-click the company location to copy its coordinates, or use your current location while on site.',
  'استخدم موقعي الحالي': 'Use My Current Location', 'تم تحديد الموقع (بدقة': 'Location detected (accuracy',
  'الورديات': 'Shifts', 'إضافة وردية': 'Add Shift', 'اسم الوردية': 'Shift Name',
  'بداية الدوام': 'Shift Start', 'نهاية الدوام': 'Shift End', 'فترة السماح (دقيقة)': 'Grace Period (minutes)',
  'أيام العمل في الأسبوع': 'Working Days', 'يُحتسب اليوم يوم عمل إذا كانت هناك وردية واحدة على الأقل تعمل فيه. وتُعد بقية الأيام أيام راحة.':
    'A day is a working day if at least one shift is scheduled. All other days are treated as days off.',
  'الوردية': 'Shift', 'وقت الوردية': 'Shift Hours', 'فترة السماح': 'Grace Period', 'الأيام': 'Days',
  'تتجاوز منتصف الليل': 'Overnight', 'يختار الموظف وردية عند تسجيل الحضور. تظهر له جميع الورديات، لكن يمكنه اختيار الورديات المفتوحة فقط. إذا كان وقت النهاية أسبق من وقت البداية (مثل 23:00–07:00)، تنتهي الوردية في اليوم التالي.':
    'Employees choose a shift when clocking in. All shifts are shown, but only open shifts can be selected. If the end time is earlier than the start time (for example, 23:00–07:00), the shift ends the next day.',
  'يجب أن يختلف وقتا بداية الوردية ونهايتها.': 'The shift start and end times must be different.',
  'العطلات الرسمية': 'Public Holidays', 'إضافة عطلة': 'Add Holiday', 'الاسم': 'Name', 'التاريخ': 'Date',
  'الوظائف': 'Job Titles', 'إضافة وظيفة': 'Add Job Title', 'اسم الوظيفة': 'Job Title',
  'النوع': 'Type', 'موظف': 'Employee', 'إشراف أو إدارة': 'Supervisory or Management',
  'الوظيفة': 'Job Title', 'تظهر هذه القائمة عند إنشاء حساب جديد. في نوع «موظف»، يكون البريد الإلكتروني اختياريًا، ويُنشأ رقم الموظف تلقائيًا، ويكون اختيار المدير المباشر إلزاميًا. أما الأنواع الأخرى، فيلزم إدخال بريد إلكتروني ولا يُنشأ لها رقم موظف.':
    'This list is used when creating accounts. For employees, email is optional, an employee ID is generated automatically, and a direct supervisor is required. Other job types require an email and do not receive an employee ID.',
  'أنواع الإجازات': 'Leave Types', 'إضافة نوع': 'Add Leave Type', 'تصنيف اليوم': 'Day Category',
  'الرصيد السنوي (0 = بدون حد)': 'Annual Allowance (0 = unlimited)', 'التصنيف': 'Category',
  'الرصيد السنوي': 'Annual Allowance', 'بدون حد': 'Unlimited',
  '30 يومًا ثابتًا': 'Fixed at 30 Days', 'عدد أيام الشهر الفعلي': 'Actual Days in Month',
  'اسم الشركة': 'Company Name', 'المنطقة الزمنية': 'Time Zone', 'مثال: Africa/Cairo': 'Example: Africa/Cairo',
  'العملة': 'Currency', 'أيام الشهر في حساب اليومية': 'Days per Month for Daily Rate',
  '30 يومًا ثابتًا': 'Fixed at 30 Days', 'عدد أيام الشهر الفعلي': 'Actual Days in Month',
  'احتساب الراتب النسبي لشهر التعيين': 'Prorate Salary in Hire Month',
  'عند التفعيل، يُحتسب للموظف الجديد راتب نسبي من تاريخ تعيينه حتى نهاية الشهر بدلًا من الراتب الكامل.':
    'When enabled, new employees receive prorated salary from their hire date through the end of the month.',
  'نسبة التأمينات الاجتماعية (%)': 'Social Insurance Rate (%)', 'نسبة ضريبة الدخل (%)': 'Income Tax Rate (%)',
  'نسبة اختيارية تُخصم من الراتب الأساسي (0 = دون خصم).': 'Optional percentage deducted from base salary (0 = no deduction).',
  'معامل العمل الإضافي': 'Overtime Multiplier', 'الحد الأدنى لاحتساب العمل الإضافي (دقيقة)': 'Minimum Overtime (minutes)',
  'معامل خصم التأخير': 'Late Deduction Multiplier', 'معامل خصم الغياب': 'Absence Deduction Multiplier',
  '1 = خصم يعادل أجر ساعة': '1 = deduct one hour of pay', '1 = خصم يوم كامل': '1 = deduct one full day',
  'أقصى هامش خطأ لموقع GPS (متر)': 'Maximum GPS Accuracy Error (meters)',
  'فتح تسجيل الحضور قبل الوردية (دقيقة)': 'Allow Clock-In Before Shift (minutes)',
  'تكون الوردية متاحة للاختيار بدءًا من هذا الوقت وحتى موعد انتهائها.': 'The shift can be selected starting at this time and until it ends.',
  'بادئة رقم الموظف': 'Employee ID Prefix',
  'مثلًا، تُنتج البادئة DC الرقم DC000001. وتُطبّق على الأرقام الجديدة فقط.': 'For example, prefix DC generates ID DC000001. This applies to new IDs only.',
};

function inEnglish(value) {
  if (typeof value === 'string') return ENGLISH_LABELS[value] || value;
  if (Array.isArray(value)) return value.map(inEnglish);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, inEnglish(item)]));
  }
  return value;
}

export default async function render({ api, settings, perms }) {
  const isAr = getLang() === 'ar';
  const text = (ar, en) => isAr ? ar : en;
  const sections = isAr ? SECTIONS : inEnglish(SECTIONS);
  const settingsFields = isAr ? SETTINGS_FIELDS : inEnglish(SETTINGS_FIELDS);
  const weekdays = isAr ? AR_WEEKDAYS : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  if (!isAr) {
    sections.find((s) => s.key === 'shifts').columns.find((c) => c.label === 'Days').render =
      (r) => r.working_days.map((d) => weekdays[d]).join(', ');
    sections.find((s) => s.key === 'shifts').columns.find((c) => c.label === 'Shift Hours').render =
      (r) => h('span', {}, `${r.start_time.slice(0, 5)} - ${r.end_time.slice(0, 5)}`, isOvernight(r) && badge('Overnight', 'warn'));
    sections.find((s) => s.key === 'shifts').columns.find((c) => c.label === 'Grace Period').render =
      (r) => `${r.grace_minutes} min`;
    sections.find((s) => s.key === 'work_locations').columns.find((c) => c.label === 'Radius').render =
      (r) => `${r.radius_m} m`;
    sections.find((s) => s.key === 'leave_types').columns.find((c) => c.label === 'Annual Allowance').render =
      (r) => r.annual_days || 'Unlimited';
    sections.find((s) => s.key === 'job_titles').columns.find((c) => c.label === 'Type').render =
      (r) => (r.kind === 'employee' ? badge('Employee', 'ok') : badge('Supervisory or Management', 'warn'));
    sections.find((s) => s.key === 'work_locations').extra = (form) => btn('Use My Current Location', async () => {
      const p = await getPosition();
      form.set({ lat: p.lat.toFixed(6), lng: p.lng.toFixed(6) });
      toast(`Location detected (accuracy: ${Math.round(p.accuracy)} m).`);
    }, 'small');
    sections.find((s) => s.key === 'shifts').validate = (v) => {
      if (v.end_time === v.start_time) throw new Error('The shift start and end times must be different.');
    };
  }
  const canEditRules = can(perms, 'rules', 'edit');
  const canEditSetup = can(perms, 'setup', 'edit');
  // Each tab shows up only for people whose permissions cover it.
  const entries = [
    ...(can(perms, 'rules') ? [{ key: 'settings', label: text('الإعدادات العامة', 'General Settings') }] : []),
    ...(can(perms, 'setup') ? sections : []),
    ...(can(perms, 'backup') ? [{ key: 'backup', label: text('نسخ احتياطي', 'Backup') }] : []),
  ];
  let active = entries[0].key;
  const body = h('div', {});
  const tabs = h('div', { class: 'tabs' });

  async function show(key) {
    active = key;
    tabs.replaceChildren(...entries.map((e) => h('button', { type: 'button', class: e.key === active ? 'active' : '', onClick: () => show(e.key) }, e.label)));
    body.replaceChildren(h('div', { class: 'spinner' }));
    if (key === 'settings') body.replaceChildren(await settingsCard());
    else if (key === 'backup') body.replaceChildren(backupCard());
    else body.replaceChildren(await crudCard(sections.find((s) => s.key === key)));
  }

  function backupCard() {
    const last = lastBackupAt();
    const days = daysSinceBackup();
    const status = h('p', { class: days === null || days > STALE_AFTER_DAYS ? '' : 'muted' },
      last
        ? text(`آخر نسخة احتياطية من هذا المتصفح: ${last.slice(0, 10)} (منذ ${days} يومًا).`, `Last backup from this browser: ${last.slice(0, 10)} (${days} days ago).`)
          : text('لم تُنشأ نسخة احتياطية من هذا المتصفح بعد.', 'No backup has been created from this browser yet.'));

    const fileInput = h('input', {
      type: 'file',
      accept: '.json,application/json',
      style: { display: 'none' },
      onChange: async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          const val = validateBackup(parsed);
          if (!val.valid) {
            toast(val.error, 'danger');
            return;
          }
          const summaryText = Object.entries(val.summary)
            .filter(([, count]) => count > 0)
            .map(([tbl, count]) => `${tbl}: ${count}`)
            .join(isAr ? '، ' : ', ');
          const ok = await confirmBox(
            text('تأكيد استرجاع النسخة الاحتياطية', 'Confirm Backup Restore'),
            text(
              `الملف مؤرخ في ${val.exported_at ? val.exported_at.slice(0, 10) : '—'}.\nالبيانات التي سيتم استرجاعها:\n${summaryText}\n\nهل أنت متأكد من المتابعة واستبدال البيانات الحالية؟`,
              `Backup date: ${val.exported_at ? val.exported_at.slice(0, 10) : '—'}.\nData to restore:\n${summaryText}\n\nRestore and replace the current data?`,
            ),
          );
          if (!ok) return;
          const restored = await restoreBackup(api, parsed);
          toast(text(
            `تم استرجاع البيانات بنجاح: ${restored.profiles || 0} موظف، ${restored.attendance || 0} سجل حضور`,
            `Backup restored: ${restored.profiles || 0} employees and ${restored.attendance || 0} attendance records.`,
          ), 'ok');
          await show('backup');
        } catch (err) {
          toast(err.message || text('حدث خطأ أثناء قراءة أو استرجاع الملف', 'An error occurred while reading or restoring the file.'), 'danger');
        } finally {
          fileInput.value = '';
        }
      },
    });

    return h('div', { class: 'card' },
      h('h3', {}, text('نسخة احتياطية كاملة', 'Full Backup')),
      h('p', { class: 'muted' }, text(
        'ينزّل هذا الخيار ملفًا واحدًا يتضمن جميع البيانات (الموظفين والرواتب والحضور والإجازات). لا توفر خطة Supabase المجانية نسخًا احتياطيًا تلقائيًا؛ لذا أنشئ نسخة احتياطية أسبوعيًا.',
        'Download one file containing all data (employees, payroll, attendance, and leave). Supabase Free does not provide automatic backups, so create a backup weekly.',
      )),
      h('p', {}, badge(text('بيانات حساسة', 'Sensitive Data'), 'warn'), text(
        ' يتضمن الملف بيانات الرواتب. احفظه في مكان آمن، ولا ترسله عبر تطبيقات المراسلة أو البريد الإلكتروني.',
        ' This file contains payroll data. Store it securely and do not share it through messaging apps or email.',
      )),
      status,
      h('div', { class: 'row', style: { gap: '10px' } },
        btn(text('تنزيل نسخة احتياطية كاملة', 'Download Full Backup'), async () => {
          const counts = await runBackup(api);
          toast(text(
            `تم تنزيل النسخة الاحتياطية: ${counts.profiles} موظفًا و${counts.attendance} سجل حضور.`,
            `Backup downloaded: ${counts.profiles} employees and ${counts.attendance} attendance records.`,
          ));
          await show('backup');
        }, 'primary'),
        btn(text('استعادة نسخة احتياطية من ملف', 'Restore from Backup File'), () => fileInput.click(), 'ghost'),
        fileInput,
      ));
  }

  async function settingsCard() {
    const locations = await api.list('work_locations', { order: 'name' });
    const defaultBranch = {
      key: 'default_location_id', type: 'select', nullable: true,
      label: text('الفرع الأساسي للموظفين الجدد', 'Default branch for new employees'),
      hint: text('يُسجَّل كل موظف جديد على هذا الفرع تلقائيًا. ويمكن تغيير فرع أي موظف من شاشة تعديله.', 'Every new employee is placed on this branch automatically. You can change any employee\'s branch from their edit screen.'),
      options: [{ value: '', label: text('— بدون —', '— None —') }, ...locations.map((l) => ({ value: l.id, label: l.name }))],
    };
    // Before the 20261102000000_default_branch.sql upgrade the column is missing, and saving it would fail.
    const form = buildForm('default_location_id' in settings ? [...settingsFields, defaultBranch] : settingsFields, settings);
    if (!canEditRules) form.nodes.forEach((n) => n.querySelectorAll('input, select, textarea').forEach((el) => { el.disabled = true; }));
    return h('div', { class: 'card' },
      !canEditRules && h('p', { class: 'muted' }, text('للعرض فقط. يقتصر التعديل على مدير النظام أو من مُنح هذه الصلاحية.', 'View only. Editing is limited to the system administrator or users granted this permission.')),
      h('div', { class: 'grid' }, form.nodes),
      canEditRules && btn(text('حفظ الإعدادات', 'Save Settings'), async () => {
        const values = form.read();
        try {
          new Intl.DateTimeFormat('en', { timeZone: values.timezone });
        } catch {
          throw new Error(text('المنطقة الزمنية غير صالحة.', 'Invalid time zone.'));
        }
        if (!/^[A-Za-z0-9]{1,8}$/.test(values.employee_code_prefix)) {
          throw new Error(text('يجب أن تتكون البادئة من أحرف لاتينية وأرقام، وألا يتجاوز طولها 8 محارف.', 'The prefix must use only Latin letters and digits and be no longer than 8 characters.'));
        }
        await api.save('settings', { id: 1, ...values });
        toast(text('حُفظت الإعدادات.', 'Settings saved.'));
        location.reload();
      }, 'primary'));
  }

  async function crudCard(section) {
    const rows = await api.list(section.key, { order: section.order });

    function openForm(row) {
      const form = buildForm(section.fields, row || {});
      const content = h('div', {}, form.nodes, section.hint && h('p', { class: 'muted' }, section.hint), section.extra?.(form));
      modal({
        title: row ? text('تعديل البيانات', 'Edit Details') : section.add,
        body: content,
        buttons: [
          {
            label: text('حفظ', 'Save'), kind: 'primary',
            onClick: async () => {
              const values = form.read();
              section.validate?.(values);
              if (section.key === 'leave_types') {
                values.paid = !['unpaid_leave', 'absence'].includes(values.kind);
              }
              await api.save(section.key, { ...(row || {}), ...values });
              toast(text('تم الحفظ.', 'Saved.'));
              await show(active);
            },
          },
          { label: text('إلغاء', 'Cancel'), kind: 'ghost' },
        ],
      });
    }

    return h('div', { class: 'card' },
      canEditSetup && h('div', { class: 'toolbar' }, btn(section.add, () => openForm(null), 'primary')),
      dataTable([
        ...section.columns,
        ...(canEditSetup ? [{
          label: '',
          render: (r) => h('div', { class: 'row' },
            btn(text('تعديل', 'Edit'), () => openForm(r), 'small'),
            btn(text('حذف', 'Delete'), async () => {
              if (!await confirmBox(text('هل تريد حذف هذا العنصر؟', 'Delete this item?'), text('حذف', 'Delete'))) return;
              await api.remove(section.key, r.id);
              await show(active);
            }, 'small')),
        }] : []),
      ], rows, text('لا توجد بيانات بعد.', 'No data yet.'), { name: `setup-${section.key}` }));
  }

  await show(active);
  return h('div', {}, tabs, body);
}
