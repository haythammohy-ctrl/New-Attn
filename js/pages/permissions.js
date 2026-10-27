// The permission matrix (admin only): for each feature and each role, who may see what and who may change it.
import { defaultRows, FEATURES, isReadOnlyRole, MATRIX_ROLES, optionLabel, roleLabel } from '../lib/access.js';
import { getLang } from '../lib/i18n.js';
import { btn, confirmBox, h, select, toast } from '../ui.js';

// One editable column per job title, in the order of the chain of responsibility (highest first).
// The admin column is fixed and shown last.
const ROLES_SHOWN = [...MATRIX_ROLES].reverse();
const keyOf = (role, feature) => `${role}:${feature}`;

export default async function render({ api, refresh }) {
  const isAr = getLang() === 'ar';
  const text = (ar, en) => isAr ? ar : en;
  const rows = await api.list('role_permissions');
  const saved = new Map(rows.map((r) => [keyOf(r.role, r.feature), r.access]));
  const working = new Map(saved);   // what the dropdowns show right now
  const dropdowns = new Map();
  const featureByKey = new Map(FEATURES.map((f) => [f.key, f]));

  // A manager reports only. Build the option list with that in mind for every feature kind:
  // scoped (none/team_*/all_*), levels (none/all_view/all_edit), excuse (none/team_edit/all_edit),
  // and allow (none/all_edit). Anything ending in _edit is out for this role.
  const optionsFor = (feature, role) => (isReadOnlyRole(role)
    ? feature.options.filter((value) => !value.endsWith('_edit'))
    : feature.options);
  const downgraded = (value, role) => (isReadOnlyRole(role) && value?.endsWith('_edit')
    ? value.replace('_edit', '_view')
    : value);

  const cell = (feature, role) => {
    const options = optionsFor(feature, role);
    const current = downgraded(working.get(keyOf(role, feature.key)) || 'none', role);
    const dd = select(
      options.map((value) => ({ value, label: optionLabel(feature, value) })),
      options.includes(current) ? current : options[0],
    );
    dd.addEventListener('change', () => {
      working.set(keyOf(role, feature.key), dd.value);
      dd.closest('td').classList.toggle('changed', dd.value !== (saved.get(keyOf(role, feature.key)) || 'none'));
    });
    dropdowns.set(keyOf(role, feature.key), dd);
    return h('td', {}, dd);
  };

  async function save() {
    const changes = [];
    for (const [key, access] of working) {
      if ((saved.get(key) || 'none') !== access) {
        const [role, feature] = key.split(':');
        changes.push({ role, feature, access });
      }
    }
    if (!changes.length) { toast(text('لا توجد تغييرات لحفظها.', 'There are no changes to save.')); return; }
    // Belt and braces: a read-only role must never leave this screen with an edit level.
    for (const c of changes) if (isReadOnlyRole(c.role) && c.access.endsWith('_edit')) c.access = c.access.replace('_edit', '_view');
    const risky = changes.filter((c) => featureByKey.get(c.feature)?.sensitive && c.access !== 'none');
    if (risky.length) {
      const lines = risky.map((c) => `${roleLabel(c.role)} ← ${featureByKey.get(c.feature).label}: ${optionLabel(featureByKey.get(c.feature), c.access)}`);
      const ok = await confirmBox(
        text(`أنت على وشك منح صلاحيات للاطلاع على بيانات مالية:\n${lines.join('\n')}\nهل تريد المتابعة؟`, `You are about to grant access to sensitive financial data:\n${lines.join('\n')}\nContinue?`),
        text('نعم، احفظ', 'Yes, Save'),
        'danger',
      );
      if (!ok) return;
    }
    await api.saveMany('role_permissions', changes);
    toast(text(
      `حُفظ ${changes.length} تغييرًا. ستظهر التغييرات للمستخدمين عند تسجيل الدخول مجددًا أو تحديث الصفحة.`,
      `Saved ${changes.length} change(s). Users will see them after signing in again or refreshing the page.`,
    ));
    refresh();
  }

  function restoreDefaults() {
    for (const { role, feature, access } of defaultRows()) {
      const fixed = downgraded(access, role);
      working.set(keyOf(role, feature), fixed);
      const dd = dropdowns.get(keyOf(role, feature));
      if (dd) {
        dd.value = fixed;
        dd.closest('td').classList.toggle('changed', fixed !== (saved.get(keyOf(role, feature)) || 'none'));
      }
    }
    toast(text('استُعيدت القيم الافتراضية. اضغط «حفظ» لتطبيقها.', 'Default values restored. Select Save to apply them.'));
  }

  const table = h('div', { class: 'table-wrap' }, h('table', { class: 'perm-grid' },
    h('thead', {}, h('tr', {},
      h('th', {}, text('الصلاحية', 'Permission')),
      ROLES_SHOWN.map((r) => h('th', {}, roleLabel(r))),
      h('th', {}, roleLabel('admin')))),
    h('tbody', {}, FEATURES.map((f) => h('tr', {},
      h('td', {}, f.label, f.sensitive && h('small', { class: 'muted' }, text(' (بيانات مالية حساسة)', ' (Sensitive financial data)'))),
      ROLES_SHOWN.map((role) => cell(f, role)),
      h('td', { class: 'muted' }, text('كامل الصلاحيات (ثابتة)', 'Full access (fixed)')))))));

  return h('div', {},
    h('div', { class: 'card' },
      h('h3', {}, text('الصلاحيات', 'Permissions')),
      h('p', { class: 'muted' }, text(
        'حدّد لكل دور مستوى الاطلاع (بياناته، أو بيانات فريقه، أو بيانات الجميع) وما إذا كان يمكنه العرض فقط أو التعديل. نطاق «الفريق» يعني كل الفرق التابعة للمدير، أو موظفي فريق المشرف دون المشرفين الآخرين معه. ويملك مدير النظام جميع الصلاحيات، ولا يمكن تغييرها.',
        'Choose each role’s data scope (own records, their team, or everyone) and whether access is view-only or editable. “Team” means every team a manager owns, or the employees of a supervisor\'s own team (not their co-supervisors). System administrators have full, fixed access.',
      )),
      table,
      h('div', { class: 'row', style: { marginTop: '12px' } },
        btn(text('حفظ', 'Save'), save, 'primary'),
        btn(text('استعادة القيم الافتراضية', 'Restore Defaults'), restoreDefaults, 'ghost'))),
    h('div', { class: 'card' },
      h('h3', {}, text('قواعد ثابتة (لا يمكن تغييرها من هنا)', 'Fixed Rules (Cannot Be Changed Here)')),
      h('ul', {}, (isAr ? [
        'يمكن لكل مستخدم تسجيل حضوره والاطلاع على سجله وطلباته للإجازة وقسائم راتبه.',
        'يقتصر الوصول إلى صفحة الصلاحيات، وتعيين الأدوار والتعديل فيها، وتعديل حسابات مديري النظام، وحذف الموظفين أو سجلات الحضور على مدير النظام.',
        'لا يمكن لأي مستخدم اعتماد طلب إجازته أو تعديل سجل حضوره، باستثناء مدير النظام.',
        'يتطلب تعديل سجل الحضور سببًا جديدًا في كل مرة، ويُسجّل في سجل التدقيق. وبعد اعتماد الرواتب، يقتصر تعديل سجلات الشهر على مساعد المدير أو مدير النظام.',
        'الدرج الوظيفي: مدير النظام ثم المدير (متابعة واطلاع فقط، دون تعديل) ثم مساعد المدير (عدة فرق) ثم المشرف (فريق واحد) ثم الموظف.',
        'يحتاج التطبيق إلى قراءة بعض البيانات كي يعمل (مثل الورديات والفروع والعطلات وإعدادات الوقت). لذلك لا تمنع خيارات «مخفي» و«عرض» الوصول إلى هذه البيانات، لكنها تتحكم في ظهور الصفحات. أما التعديل فتحميه صلاحيات قاعدة البيانات.',
      ] : [
        'Every user can clock in and view their attendance history, leave requests, and payslips.',
        'Only system administrators can access Permissions, change roles, edit system administrator accounts, and delete employees or attendance records.',
        'Users cannot approve their own leave requests or edit their attendance records. System administrators are exempt.',
        'Each attendance edit requires a new reason and is recorded in the audit log. After payroll is approved, only an assistant manager or a system administrator can edit records for that month.',
        'The chain of responsibility: system administrator, then manager (oversees and reports, no editing), then assistant manager (several teams), then supervisor (one team), then employee.',
        'The app must read some data to operate (such as shifts, branches, holidays, and time settings). “Hidden” and “View” control which pages are shown, not access to this required data. Database permissions control editing.',
      ]).map((item) => h('li', {}, item)))),
  );
}
