import { errorText } from '../api/errors.js';
import { cleanNationalId, nameToPseudoEmail, pseudoEmail, validNationalId } from '../lib/registration.js';
import { getLang, t } from '../lib/i18n.js';
import { btn, field, h, select, toast } from '../ui.js';

// Admin-created employee account (full form with national ID).
export async function renderSignup({ api, onDone, onBack, admin = false }) {
  let options;
  try {
    options = await api.signupOptions();
  } catch (err) {
    return h('div', {}, h('h2', {}, t('employees.createEmployeeTitle')), h('p', { class: 'muted' }, errorText(err)), btn(t('common.cancel'), onBack, 'ghost'));
  }
  const isAr = getLang() === 'ar';
  // Everyone who registers here is a regular employee, so there is no job-title question. The title is only sent
  // so an admin-created account shows it in the list; the database decides it for self sign-ups.
  const employeeTitles = options.jobTitles.filter((title) => title.kind === 'employee');
  const defaultTitle = (employeeTitles.find((title) => title.name === 'موظف') || employeeTitles[0])?.name || 'موظف';
  const { supervisors } = options;

  const fullName = h('input', { type: 'text', autocomplete: 'name', placeholder: isAr ? 'الاسم ثلاثي كما بالبطاقة' : 'Full name as on the ID (three names)' });
  const nationalId = h('input', { type: 'text', inputMode: 'numeric', maxLength: 14, autocomplete: 'off', dir: 'ltr', placeholder: '14 digits' });
  const manager = select([
    { value: '', label: isAr ? '— اختر المشرف المباشر —' : '— Select direct supervisor —' },
    ...supervisors.map((s) => ({ value: s.id, label: s.full_name })),
  ], '');
  const password = h('input', { type: 'password', autocomplete: 'new-password' });
  const confirm = h('input', { type: 'password', autocomplete: 'new-password' });

  const submit = btn(t('common.save'), async () => {
    const name = fullName.value.trim().replace(/\s+/g, ' ');
    const nid = cleanNationalId(nationalId.value);
    const pw = password.value;
    const cf = confirm.value;

    if (!name || name.split(/\s+/).length < 3) {
      toast(isAr ? 'يرجى إدخال الاسم ثلاثيًا كما في البطاقة (3 أسماء على الأقل).' : 'Enter the full name as on the ID (at least three names).', 'err');
      return;
    }
    if (!validNationalId(nid)) {
      toast(isAr ? 'يجب أن يتكون الرقم القومي من 14 رقمًا صحيحًا.' : 'The national ID must contain 14 valid digits.', 'err');
      return;
    }
    if (!manager.value) {
      toast(isAr ? 'اختر المشرف المباشر.' : 'Select the direct supervisor.', 'err');
      return;
    }
    if (pw.length < 6) {
      toast(getLang() === 'ar' ? 'يجب ألا تقل كلمة المرور عن 6 أحرف.' : 'The password must be at least 6 characters long.', 'err');
      return;
    }
    if (pw !== cf) {
      toast(getLang() === 'ar' ? 'كلمتا المرور غير متطابقتين.' : 'The passwords do not match.', 'err');
      return;
    }

    const payload = {
      email: pseudoEmail(nid),
      password: pw,
      profile: {
        full_name: name,
        national_id: nid,
        job_title: defaultTitle,
        manager_id: manager.value,
      },
    };

    if (admin) {
      await api.adminCreateUser(payload);
      onDone({ username: nid, password: pw, role: 'Employee', name });
      return;
    }

    const { needsConfirmation } = await api.signUp(payload);
    if (needsConfirmation) {
      toast(getLang() === 'ar' ? 'تم إنشاء الحساب وينتظر تفعيل الإدارة.' : 'Account registered and awaiting activation.', 'ok');
      onBack();
      return;
    }
    onDone({ username: nid, password: pw, role: 'Employee', name });
  }, 'primary', { style: { width: '100%' } });

  return h('div', {},
    h('h2', {}, t('employees.createEmployeeTitle')),
    h('p', { class: 'muted' }, t('employees.createEmployeeSubtitle')),
    field(t('common.name'), fullName),
    field(isAr ? 'الرقم القومي' : 'National ID', nationalId, isAr ? '14 رقمًا — يستخدمه الموظف لتسجيل الدخول.' : '14 digits, used to sign in.'),
    field(isAr ? 'المشرف المباشر' : 'Direct supervisor', manager,
      supervisors.length ? '' : (isAr ? 'لا يوجد مشرفون مسجلون حاليًا. تواصل مع الإدارة.' : 'No supervisors are registered yet. Contact the administration.')),
    field(t('common.password'), password),
    field(t('common.confirmPassword'), confirm),
    submit,
    h('button', { type: 'button', class: 'btn ghost', style: { width: '100%', marginTop: '8px' }, onClick: onBack }, t('common.cancel')),
  );
}

// Admin-created staff account (manager/supervisor): name and password only.
export function renderAdminCreateStaff({ api, role, roleLabel, onDone, onBack }) {
  const isAr = getLang() === 'ar';
  const fullName = h('input', { type: 'text', autocomplete: 'name', placeholder: isAr ? 'الاسم بالكامل (سيستخدم للدخول)' : 'Full Name (used for sign-in)' });
  const password = h('input', { type: 'password', autocomplete: 'new-password' });
  const confirm = h('input', { type: 'password', autocomplete: 'new-password' });
  const errMsg = h('p', { class: 'muted', style: { color: 'var(--danger)' } });
  errMsg.hidden = true;

  const submit = btn(isAr ? `حفظ وإنشاء ${roleLabel}` : `Create ${roleLabel}`, async () => {
    errMsg.hidden = true;
    const name = fullName.value.trim().replace(/\s+/g, ' ');
    const pw = password.value;
    const cf = confirm.value;

    if (!name) {
      errMsg.textContent = isAr ? 'الاسم مطلوب لتسجيل الدخول.' : 'Name is required for sign-in.';
      errMsg.hidden = false;
      return;
    }
    if (pw.length < 6) {
      errMsg.textContent = isAr ? 'يجب ألا تقل كلمة المرور عن 6 أحرف.' : 'The password must be at least 6 characters long.';
      errMsg.hidden = false;
      return;
    }
    if (pw !== cf) {
      errMsg.textContent = isAr ? 'كلمتا المرور غير متطابقتين.' : 'Passwords do not match.';
      errMsg.hidden = false;
      return;
    }

    // Deterministic internal email built from name or timestamp to avoid duplicate collisions
    const internalEmail = nameToPseudoEmail(name);

    try {
      await api.adminCreateUser({
        email: internalEmail,
        password: pw,
        profile: {
          full_name: name,
          role,
          job_title: role === 'assistant_manager' ? 'Assistant Manager' : 'Supervisor',
        },
      });

      onDone({ username: name, password: pw, role: roleLabel, name });
    } catch (err) {
      errMsg.textContent = err?.message || (isAr ? 'تعذر إنشاء الحساب، يرجى المحاولة مرة أخرى.' : 'Unable to create the account.');
      errMsg.hidden = false;
      throw err;
    }
  }, 'primary', { style: { width: '100%' } });

  return h('div', {},
    h('h2', {}, `${t('employees.createStaffTitle')}: ${roleLabel}`),
    h('p', { class: 'muted' }, t('employees.createStaffSubtitle')),
    h('div', { class: 'tag-badge', style: { marginBottom: '16px' } }, `Role: ${roleLabel}`),
    field(isAr ? 'الاسم (اسم المستخدم)' : 'Full name (username)', fullName, isAr ? 'يستخدم هذا الاسم لتسجيل الدخول.' : 'This name will be used to sign in.'),
    field(t('common.password'), password),
    field(t('common.confirmPassword'), confirm),
    errMsg,
    submit,
    h('button', { type: 'button', class: 'btn ghost', style: { width: '100%', marginTop: '8px' }, onClick: onBack }, t('common.cancel')),
  );
}
