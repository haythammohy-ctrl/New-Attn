// "My account": what the system knows about you. The phone number is the one thing you may change yourself.
import { roleLabel } from '../lib/access.js';
import { maskNationalId } from '../lib/registration.js';
import { getLang } from '../lib/i18n.js';
import { btn, field, h, toast } from '../ui.js';

// Tables from later upgrades may not exist yet; the page still opens without them.
const tolerant = (promise, fallback) => promise.catch((err) => (err.code === 'needs_migration' ? fallback : Promise.reject(err)));

export default async function render({ api, profile }) {
  const isAr = getLang() === 'ar';
  const [teams, locations, options, privates] = await Promise.all([
    tolerant(api.list('teams'), []),
    api.list('work_locations'),
    tolerant(api.signupOptions(), { supervisors: [] }),
    tolerant(api.list('profile_private'), []),
  ]);
  const nameIn = (list, id) => list.find((x) => x.id === id)?.name || '—';
  const managerName = options.supervisors?.find((s) => s.id === profile.manager_id)?.full_name || '—';
  const mine = privates.find((r) => r.id === profile.id);
  const phone = h('input', { type: 'tel', value: profile.phone || '', autocomplete: 'tel' });
  const line = (label, value) => h('div', { class: 'stat' }, h('small', {}, label), h('b', {}, value));

  return h('div', { class: 'card' },
    h('h3', {}, isAr ? 'حسابي' : 'My Profile'),
    h('div', { class: 'grid', style: { marginBottom: '16px' } },
      line(isAr ? 'الاسم' : 'Name', profile.full_name || '—'),
      line(isAr ? 'رقم الموظف' : 'Employee ID', profile.employee_code || '—'),
      line(isAr ? 'البريد الإلكتروني' : 'Email', profile.email || (isAr ? 'تسجّل الدخول باستخدام الرقم القومي' : 'Sign in with your national ID')),
      line(isAr ? 'الرقم القومي' : 'National ID', h('span', { dir: 'ltr' }, maskNationalId(mine?.national_id))),
      line(isAr ? 'الصلاحية' : 'Role', roleLabel(profile.role)),
      line(isAr ? 'المسمى' : 'Job Title', profile.job_title || '—'),
      line(isAr ? 'المشرف المباشر' : 'Direct Supervisor', managerName),
      line(isAr ? 'الفريق' : 'Team', nameIn(teams, profile.team_id)),
      line(isAr ? 'الفرع' : 'Branch', nameIn(locations, profile.location_id))),
    field(isAr ? 'رقم الهاتف' : 'Phone Number', phone, isAr
      ? 'يمكنك تغيير رقم الهاتف فقط. ويستطيع مدير الموارد البشرية أو مدير النظام تعديل بقية البيانات.'
      : 'You can change only your phone number. HR or the system administrator can update the other profile details.'),
    btn(isAr ? 'حفظ رقم الهاتف' : 'Save Phone Number', async () => {
      await api.updateMyPhone(phone.value.trim());
      profile.phone = phone.value.trim();
      toast(isAr ? 'حُفظ رقم الهاتف.' : 'Phone number saved.');
    }, 'primary'));
}
