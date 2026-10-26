import { renderSignup } from '../components/signup.js';
import { roleLabel } from '../lib/access.js';
import { getLang, setLang, t } from '../lib/i18n.js';
import { btn, field, h, spinner, toast } from '../ui.js';

export default function renderLogin({ api, onDone }) {
  const card = h('div', { class: 'card auth' });
  const wrap = h('div', { class: 'center' }, card);
  const setView = (...nodes) => card.replaceChildren(...nodes);

  function brandHeader() {
    const isAr = getLang() === 'ar';
    return h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
        h('img', {
          src: 'img/logo.webp',
          alt: 'talabat mart',
          class: 'brand-logo-img',
          style: { height: '36px' },
          onerror: (e) => { e.target.src = 'img/logo.png'; },
        }),
      ),
      btn(isAr ? 'EN' : 'عربي', () => {
        setLang(isAr ? 'en' : 'ar');
        showStart();
      }, 'small ghost', { style: { fontWeight: 700, border: '1.5px solid var(--line)' } }),
    );
  }

  async function showSignup() {
    setView(brandHeader(), h('h2', {}, t('common.add')), spinner());
    setView(brandHeader(), await renderSignup({ api, onDone, onBack: showStart }));
  }

  // Demo: pick one of the ready-made accounts (no password), or try the sign-up questions.
  function showDemoPicker() {
    setView(
      brandHeader(),
      h('h2', {}, t('login.demoTitle')),
      h('p', { class: 'muted' }, t('login.demoSubtitle')),
      ...api.demoAccounts().map((a) => btn(
        `${a.full_name}  ·  ${roleLabel(a.role)}${a.job_title && !roleLabel(a.role).includes(a.job_title) ? ` — ${a.job_title}` : ''}`,
        async () => {
          await api.signIn({ email: a.email, identifier: a.full_name });
          onDone();
        }, 'ghost', { style: { display: 'block', width: '100%', marginBottom: '8px', textAlign: 'start' } })),
      btn(t('login.createDemoAccount'), showSignup, 'primary', { style: { display: 'block', width: '100%', marginTop: '12px' } }),
    );
  }

  // Live Login Screen
  function showLogin() {
    const identifier = h('input', {
      type: 'text',
      autocomplete: 'username',
      dir: 'auto',
      placeholder: t('login.usernamePlaceholder'),
    });
    const password = h('input', {
      type: 'password',
      autocomplete: 'current-password',
      placeholder: t('login.passwordPlaceholder'),
    });

    const submit = btn(t('login.submitBtn'), async () => {
      if (!identifier.value.trim() || !password.value) {
        toast(t('login.fillAllFields'), 'err');
        return;
      }
      try {
        await api.signIn({ identifier: identifier.value.trim(), password: password.value });
        onDone();
      } catch (err) {
        toast(getLang() === 'ar' ? 'بيانات الدخول غير صحيحة' : 'Invalid login credentials', 'err');
      }
    }, 'primary', { style: { width: '100%' } });

    [identifier, password].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit.click(); }));

    setView(
      brandHeader(),
      h('h2', {}, t('login.title')),
      field(t('login.usernameLabel'), identifier, t('login.usernameHint')),
      field(t('login.passwordLabel'), password),
      submit,
      h('button', {
        type: 'button',
        class: 'btn ghost',
        style: { width: '100%', marginTop: '12px' },
        onClick: showSignup,
      }, t('login.newUserBtn')),
    );
  }

  function showStart() {
    if (api.mode === 'local') showDemoPicker();
    else showLogin();
  }

  showStart();
  return wrap;
}
