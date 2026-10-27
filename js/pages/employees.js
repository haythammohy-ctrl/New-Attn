import { buildForm } from '../components/form.js';
import { renderAdminCreateStaff, renderSignup } from '../components/signup.js';
import { assignableRoles, can, roleLabel } from '../lib/access.js';
import { chainOf } from '../lib/hierarchy.js';
import { cleanNationalId, maskNationalId, validNationalId } from '../lib/registration.js';
import { getLang, t } from '../lib/i18n.js';
import { badge, btn, dataTable, h, modal, money, toast } from '../ui.js';

function allowancesEditor(initial) {
  const isAr = getLang() === 'ar';
  const rows = (initial || []).map((a) => ({ ...a }));
  const box = h('div', {});
  function paint() {
    box.replaceChildren(
      ...rows.map((r, i) => h('div', { class: 'allowance-row' },
        h('input', { placeholder: isAr ? 'اسم البدل' : 'Allowance Name', value: r.name, onInput: (e) => { r.name = e.target.value; } }),
        h('input', { type: 'number', min: 0, step: 'any', value: r.amount, onInput: (e) => { r.amount = e.target.value; } }),
        btn(t('common.delete'), () => { rows.splice(i, 1); paint(); }, 'small'))),
      btn(isAr ? '+ إضافة بدل' : '+ Add Allowance', () => { rows.push({ name: '', amount: 0 }); paint(); }, 'small'),
    );
  }
  paint();
  return {
    node: box,
    read: () => rows
      .filter((r) => r.name.trim() || Number(r.amount))
      .map((r) => ({ name: r.name.trim(), amount: Number(r.amount) || 0 })),
  };
}

const tolerant = (promise) => promise.catch((err) => (err.code === 'needs_migration' ? [] : Promise.reject(err)));

export default async function render({ api, profile, settings, perms, refresh }) {
  const isAr = getLang() === 'ar';
  const none = { value: '', label: t('common.none') };
  const isAdmin = profile.role === 'admin';
  const canEditPeople = can(perms, 'employees', 'edit');
  const canSeeSalary = can(perms, 'salaries', 'view');
  const canEditSalary = can(perms, 'salaries', 'edit');
  const canSeeNid = can(perms, 'national_ids', 'view');
  const canEditNid = can(perms, 'national_ids', 'edit');

  const [people, teams, locations, jobTitles, salaries, privates] = await Promise.all([
    api.list('profiles', { order: 'full_name' }),
    tolerant(api.list('teams', { order: 'name' })),
    api.list('work_locations', { order: 'name' }),
    tolerant(api.list('job_titles', { order: 'name' })),
    canSeeSalary ? api.list('salary_structures') : Promise.resolve([]),
    canSeeNid ? tolerant(api.list('profile_private')) : Promise.resolve([]),
  ]);
  const nameIn = (list, id) => list.find((x) => x.id === id)?.name || '—';
  const salaryOf = (id) => salaries.find((s) => s.employee_id === id);
  const nidOf = (id) => privates.find((r) => r.id === id)?.national_id || '';
  const managerName = (id) => people.find((x) => x.id === id)?.full_name || '—';
  const supervisors = people.filter((p) => p.role === 'supervisor' && p.active);
  const managersAbove = people.filter((p) => p.role === 'manager' && p.active);
  // Employees report to a supervisor; an assistant manager reports to a manager. A supervisor reports to the assistant
  // manager in charge of their team (set once per team on the Teams page, see lib/hierarchy.js), so supervisors,
  // managers and admins get no "reports to" field here.
  const reportsTo = (role) => {
    if (role === 'assistant_manager') return { shown: true, label: isAr ? 'المدير المسؤول' : `${roleLabel('manager')} in charge`, candidates: managersAbove };
    return { shown: role === 'employee', label: isAr ? 'المشرف المباشر' : 'Direct supervisor', candidates: supervisors };
  };
  const reportsToOptions = (role, selfId) => [none, ...reportsTo(role).candidates.filter((c) => c.id !== selfId).map((c) => ({ value: c.id, label: c.full_name }))];
  const editable = (p) => canEditPeople && (isAdmin || p.role !== 'admin');

  function showCredentialsModal({ username, password, role, name }) {
    modal({
      title: t('employees.credentialsTitle', { label: role }),
      body: h('div', {},
        h('p', { class: 'muted' }, t('employees.credentialsNotice')),
        h('p', { class: 'muted' }, isAr
          ? 'الباسورد ده مؤقت: هيتطلب من الشخص يغيّره بنفسه أول ما يسجّل دخول.'
          : 'This password is temporary: the person will be asked to set their own on first sign-in.'),
        h('div', { class: 'stat', style: { margin: '14px 0', border: '2px dashed var(--primary)' } },
          h('div', { style: { marginBottom: '8px' } },
            h('small', { class: 'muted' }, t('employees.usernameIs')),
            h('b', { style: { fontSize: '1.2rem', color: 'var(--brand-dark)', display: 'block', direction: 'ltr', textAlign: 'start' } }, username),
          ),
          h('div', {},
            h('small', { class: 'muted' }, t('employees.passwordIs')),
            h('b', { style: { fontSize: '1.2rem', color: 'var(--primary)', display: 'block', direction: 'ltr', textAlign: 'start' } }, password),
          ),
        ),
        btn(t('common.copy'), async () => {
          try {
            await navigator.clipboard.writeText(`Username: ${username}\nPassword: ${password}`);
            toast(t('common.copied'));
          } catch {
            toast(isAr ? 'يرجى نسخ البيانات يدوياً' : 'Please copy manually', 'err');
          }
        }, 'primary', { style: { width: '100%' } }),
      ),
      buttons: [{ label: t('common.done'), kind: 'ghost' }],
    });
  }

  function edit(p, activate = false) {
    const salary = salaryOf(p.id);
    const roles = assignableRoles(profile.role);
    const titles = [...new Set([...jobTitles.map((jt) => jt.name), ...(p.job_title ? [p.job_title] : [])])];
    const form = buildForm([
      { key: 'full_name', label: isAr ? 'الاسم' : 'Name', required: true },
      { key: 'phone', label: isAr ? 'رقم الهاتف' : 'Phone number' },
      { key: 'job_title', label: isAr ? 'المسمى الوظيفي' : 'Job title', type: 'select', nullable: true, options: [none, ...titles.map((title) => ({ value: title, label: title }))] },
      { key: 'role', label: isAr ? 'الدور' : 'Role', type: 'select', options: [...new Set([...roles, p.role])].map((r) => ({ value: r, label: roleLabel(r) })) },
      { key: 'manager_id', label: reportsTo(p.role).label, type: 'select', nullable: true, options: reportsToOptions(p.role, p.id) },
      { key: 'team_id', label: t('common.team'), type: 'select', nullable: true, options: [none, ...teams.map((tm) => ({ value: tm.id, label: tm.name }))] },
      { key: 'location_id', label: t('common.branch'), type: 'select', nullable: true, options: [none, ...locations.map((l) => ({ value: l.id, label: l.name }))] },
      { key: 'hire_date', label: isAr ? 'تاريخ التعيين' : 'Hire date', type: 'date', nullable: true },
      { key: 'active', label: isAr ? 'الحساب مفعّل' : 'Active account', type: 'checkbox' },
    ], { ...p, active: activate ? true : p.active });

    const roleSelect = form.nodes[3].querySelector('select');
    if (!roles.includes(p.role) || (p.id === profile.id && !isAdmin)) roleSelect.disabled = true;
    if (p.id === profile.id && !isAdmin) form.nodes[8].querySelector('input').disabled = true;

    const managerSelect = form.nodes[4].querySelector('select');
    const teamSelect = form.nodes[5].querySelector('select');
    managerSelect.addEventListener('change', () => {
      // An employee joins their supervisor's team. An assistant manager's team is the one the Teams page puts them in
      // charge of, so picking their manager must not change it.
      if (roleSelect.value === 'assistant_manager') return;
      const team = people.find((x) => x.id === managerSelect.value)?.team_id;
      if (team) teamSelect.value = team;
    });
    // Whom a person reports to follows their role: employee -> supervisor, assistant manager -> manager, and a
    // supervisor's assistant manager is read-only because it comes from their team.
    const managerField = form.nodes[4];
    const assistantLine = h('b', {});
    const assistantNote = h('div', { class: 'field' }, h('span', { class: 'label' }, roleLabel('assistant_manager')), assistantLine);
    function refreshReporting() {
      const role = roleSelect.value;
      const info = reportsTo(role);
      managerField.style.display = info.shown ? '' : 'none';
      managerField.querySelector('.label').textContent = info.label;
      assistantNote.style.display = role === 'supervisor' ? '' : 'none';
      const assistant = teamSelect.value
        ? chainOf({ role: 'supervisor', team_id: teamSelect.value, active: true }, people, teams).find((c) => c.relation === 'assistant_manager')
        : null;
      assistantLine.textContent = assistant ? assistant.full_name
        : (teamSelect.value
          ? (isAr ? 'لا يوجد مسؤول عن هذا الفريق. حدده من صفحة الفرق.' : 'Nobody is in charge of this team. Set one on the Teams page.')
          : (isAr ? 'اختر فريقًا لمعرفة المسؤول عنه.' : 'Pick a team to see who is in charge of it.'));
    }
    roleSelect.addEventListener('change', () => {
      managerSelect.replaceChildren(...reportsToOptions(roleSelect.value, p.id).map((o) => h('option', { value: o.value }, o.label)));
      managerSelect.value = '';
      refreshReporting();
    });
    teamSelect.addEventListener('change', refreshReporting);
    refreshReporting();

    const nidInput = h('input', { type: 'text', inputMode: 'numeric', maxLength: 14, dir: 'ltr', value: nidOf(p.id), disabled: !canEditNid });
    let dialog;
    const identity = h('div', { style: { marginTop: '12px' } },
      h('div', { class: 'row' },
        h('span', {}, isAr ? 'الكود التعريفي: ' : 'Employee Code: ', h('b', {}, p.employee_code || '—')),
        !p.employee_code && canEditPeople && btn(isAr ? 'توليد كود تلقائي' : 'Generate Code', async () => {
          const code = await api.assignEmployeeCode(p.id);
          toast(isAr ? `عُيّن رقم الموظف ${code}.` : `Employee number ${code} was assigned.`);
          dialog.close();
          refresh();
        }, 'small')),
      canSeeNid && h('div', { style: { marginTop: '10px' } },
        h('h3', {}, isAr ? 'الرقم القومي' : 'National ID'), nidInput, !canEditNid && h('small', { class: 'muted' }, isAr ? 'للقراءة فقط' : 'Read only')));

    const pay = buildForm([{ key: 'base_salary', label: isAr ? `الراتب الأساسي (${settings.currency})` : `Base Salary (${settings.currency})`, type: 'number', min: 0, step: 'any', required: true, default: 0 }], salary || {});
    const allowances = allowancesEditor(salary?.allowances);

    const salaryPart = !canSeeSalary
      ? []
      : canEditSalary
        ? [h('h3', {}, isAr ? 'الراتب' : 'Salary'), pay.nodes, h('h3', {}, isAr ? 'البدلات' : 'Allowances'), allowances.node]
        : [h('h3', {}, isAr ? 'الراتب' : 'Salary'), h('p', {}, `${money(salary?.base_salary)} ${settings.currency}`),
          h('p', { class: 'muted' }, (salary?.allowances || []).map((a) => `${a.name}: ${money(a.amount)}`).join(' · ') || (isAr ? 'لا توجد بدلات' : 'No allowances'))];

    dialog = modal({
      title: p.full_name || p.email || p.employee_code,
      body: h('div', {}, h('div', { class: 'grid' }, form.nodes, assistantNote), identity, ...salaryPart),
      buttons: [
        {
          label: t('common.save'), kind: 'primary',
          onClick: async () => {
            const v = form.read();
            if (p.id === profile.id && isAdmin && (!v.active || v.role !== 'admin')) {
              throw new Error(isAr ? 'لا يمكنك تعطيل حسابك بوصفك مدير النظام.' : 'You cannot deactivate your own system administrator account.');
            }
            const nid = canEditNid ? cleanNationalId(nidInput.value) : '';
            if (nid && !validNationalId(nid)) throw new Error(isAr ? 'يجب أن يتكون الرقم القومي من 14 رقمًا صحيحًا.' : 'The national ID must contain 14 valid digits.');
            await api.save('profiles', { id: p.id, ...v });
            if (nid && nid !== nidOf(p.id)) await api.save('profile_private', { id: p.id, national_id: nid });
            if (canEditSalary) {
              const base = pay.read();
              await api.save('salary_structures', { employee_id: p.id, base_salary: base.base_salary, allowances: allowances.read() });
            }
            toast(isAr ? 'حُفظت التعديلات.' : 'Changes saved successfully.');
            refresh();
          },
        },
        { label: t('common.cancel'), kind: 'ghost' },
      ],
    });
  }

  function resetPassword(p) {
    const pw = h('input', { type: 'text', minLength: 6, dir: 'ltr', placeholder: isAr ? 'كلمة المرور الجديدة (6 أحرف على الأقل)' : 'New password (at least 6 characters)' });
    modal({
      title: `${t('employees.resetPassword')}: ${p.full_name || p.employee_code}`,
      body: h('div', {}, h('p', { class: 'muted' }, isAr ? 'سيتم تعيين كلمة مرور جديدة للمستخدم فورًا.' : 'A new password will be set for this user immediately.'), pw),
      buttons: [
        {
          label: isAr ? 'تعيين' : 'Set', kind: 'primary',
          onClick: async () => {
            if (pw.value.length < 6) throw new Error(isAr ? 'يجب ألا تقل كلمة المرور عن 6 أحرف.' : 'The password must be at least 6 characters.');
            await api.adminResetPassword({ id: p.id, password: pw.value });
            showCredentialsModal({
              username: p.role === 'employee' ? (nidOf(p.id) || p.employee_code) : p.full_name,
              password: pw.value,
              role: roleLabel(p.role),
              name: p.full_name,
            });
          },
        },
        { label: t('common.cancel'), kind: 'ghost' },
      ],
    });
  }

  function createUser() {
    const roleOptions = [
      { role: 'supervisor', label: roleLabel('supervisor'), note: isAr ? 'يشرف على فريق واحد: الحضور واعتماد طلبات الإجازة (دخول بالاسم وكلمة المرور).' : 'Runs one team: attendance and leave approvals. Sign in with a name and password.' },
      { role: 'assistant_manager', label: roleLabel('assistant_manager'), note: isAr ? 'يشرف على عدة فرق: الموظفون والرواتب والعمليات (دخول بالاسم وكلمة المرور).' : 'Runs several teams: staff, payroll, and operations. Sign in with a name and password.' },
      { role: 'manager', label: roleLabel('manager'), note: isAr ? 'أعلى من مساعد المدير: يتابع ويطلع على كل شيء دون تعديل (دخول بالاسم وكلمة المرور).' : 'Above the assistant manager: oversees and reports without editing. Sign in with a name and password.' },
      { role: 'employee', label: roleLabel('employee'), note: isAr ? 'تسجيل الدخول بالرقم القومي وكلمة المرور.' : 'Sign in with a national ID and password.' },
    ];
    let selDialog;
    const roleButtons = roleOptions.map(({ role, label, note }) =>
      h('button', {
        type: 'button',
        class: 'btn',
        style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px',
                 padding: '14px 16px', border: '1.5px solid var(--line)', borderRadius: '12px', cursor: 'pointer', width: '100%', textAlign: 'start' },
        onClick: () => {
          selDialog.close();
          if (role === 'employee') {
            openEmployeeForm();
          } else {
            openStaffForm(role, label);
          }
        },
      },
        h('span', { style: { fontWeight: 800, fontSize: '1.05rem', color: 'var(--brand-dark)' } }, label),
        h('span', { style: { fontSize: '.84rem', color: 'var(--muted)' } }, note),
      )
    );

    selDialog = modal({
      title: t('employees.selectRolePrompt'),
      body: h('div', {},
        h('p', { class: 'muted', style: { marginBottom: '14px' } }, isAr ? 'اختر دور الحساب الذي تريد إنشاءه:' : 'Select a role for the new account:'),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, ...roleButtons),
      ),
      buttons: [{ label: t('common.cancel'), kind: 'ghost' }],
    });
  }

  function openStaffForm(role, label) {
    let dialog;
    const node = renderAdminCreateStaff({
      api, role, roleLabel: label,
      onDone: (creds) => { dialog.close(); refresh(); showCredentialsModal(creds); },
      onBack: () => { dialog.close(); createUser(); },
    });
    dialog = modal({ title: '', body: node, buttons: [] });
  }

  async function openEmployeeForm() {
    let dialog;
    const node = await renderSignup({
      api,
      admin: true,
      onDone: (creds) => { dialog.close(); refresh(); showCredentialsModal(creds); },
      onBack: () => { dialog.close(); createUser(); },
    });
    dialog = modal({ title: '', body: node, buttons: [] });
  }

  const pending = people.filter((p) => !p.active);
  const columns = [
    { label: t('common.name'), render: (p) => p.full_name || p.email || '—' },
    { label: isAr ? 'الكود' : 'Code', render: (p) => p.employee_code || '—' },
    { label: t('common.jobTitle'), render: (p) => p.job_title || '—' },
    { label: isAr ? 'الدور' : 'Role', render: (p) => h('span', { class: 'tag-badge' }, roleLabel(p.role)) },
    { label: isAr ? 'يتبع' : 'Reports to', render: (p) => (p.manager_id ? managerName(p.manager_id) : '—') },
    { label: t('common.team'), render: (p) => nameIn(teams, p.team_id) },
    { label: t('common.branch'), render: (p) => nameIn(locations, p.location_id) },
    ...(canSeeSalary ? [{ label: isAr ? 'الراتب' : 'Salary', class: 'num', render: (p) => (salaryOf(p.id) ? money(salaryOf(p.id).base_salary) : '—') }] : []),
    ...(canSeeNid ? [{ label: isAr ? 'الرقم القومي' : 'National ID', render: (p) => h('span', { dir: 'ltr' }, maskNationalId(nidOf(p.id))) }] : []),
    { label: t('common.status'), render: (p) => (p.active ? badge(t('common.active'), 'ok') : badge(isAr ? 'قيد الانتظار' : 'Pending', 'warn')) },
    {
      label: '',
      render: (p) => h('div', { class: 'row' },
        editable(p) && btn(t('common.edit'), () => edit(p), 'small'),
        isAdmin && p.id !== profile.id && btn(t('employees.resetPassword'), () => resetPassword(p), 'small ghost')),
    },
  ];

  return h('div', {},
    isAdmin && h('div', { class: 'card dotted-box' },
      h('h3', { style: { color: 'var(--brand-dark)' } }, t('employees.title')),
      h('p', { class: 'muted' }, isAr
        ? 'أنشئ حسابًا لمدير الموارد البشرية أو مشرف الفريق باستخدام الاسم وكلمة المرور، أو حسابًا لموظف باستخدام الرقم القومي.'
        : 'Create a manager or supervisor account with a name and password, or an employee account with a national ID.'),
      btn(t('employees.createUserBtn'), createUser, 'primary')),
    pending.length > 0 && h('div', { class: 'card' },
      h('h3', {}, `${t('employees.pendingTitle')} (${pending.length})`),
      h('p', { class: 'muted' }, t('employees.pendingSubtitle')),
      dataTable([
        { label: t('common.name'), render: (p) => p.full_name || p.email || '—' },
        { label: t('common.jobTitle'), render: (p) => p.job_title || '—' },
        { label: isAr ? 'يتبع' : 'Reports to', render: (p) => (p.manager_id ? managerName(p.manager_id) : '—') },
        { label: isAr ? 'الكود' : 'Code', render: (p) => p.employee_code || '—' },
        ...(canSeeNid ? [{ label: isAr ? 'الرقم القومي' : 'National ID', render: (p) => h('span', { dir: 'ltr' }, maskNationalId(nidOf(p.id))) }] : []),
        { label: '', render: (p) => editable(p) && btn(t('employees.reviewAndActivate'), () => edit(p, true), 'small primary') },
      ], pending)),
    h('div', { class: 'card' }, dataTable(columns, people, t('employees.empty'))),
  );
}
