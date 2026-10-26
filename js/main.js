import { api } from './api/index.js';
import { errorText } from './api/errors.js';
import { daysSinceBackup, STALE_AFTER_DAYS } from './components/backup.js';
import { DEFAULT_PERMISSIONS, can, scopeOf } from './lib/access.js';
import { getLang, setLang, t } from './lib/i18n.js';
import { btn, confirmBox, field, h, spinner, toast } from './ui.js';

function applyTheme(theme) {
  if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
}
applyTheme(localStorage.getItem('attn.theme') || 'auto');

const app = document.getElementById('app');

// Dynamic routes that adapt to selected language
function getRoutes() {
  return [
    { path: '', label: t('nav.home'), show: (p) => p.role !== 'manager' && p.role !== 'assistant_manager' && p.role !== 'supervisor', page: () => import('./pages/home.js') },
    { path: 'dashboard', label: t('nav.dashboard'), page: () => import('./pages/dashboard.js') },
    { path: 'history', label: t('nav.history'), page: () => import('./pages/history.js') },
    { path: 'leave', label: t('nav.leave'), page: () => import('./pages/leave.js') },
    { path: 'payslips', label: t('nav.payslips'), page: () => import('./pages/payslips.js') },
    { path: 'approvals', label: t('nav.approvals'), show: (p) => can(p, 'leave_approvals') || can(p, 'attendance'), page: () => import('./pages/approvals.js') },
    { path: 'records', label: t('nav.records'), show: (p) => can(p, 'attendance'), page: () => import('./pages/records.js') },
    { path: 'employees', label: t('nav.employees'), show: (p) => can(p, 'employees'), page: () => import('./pages/employees.js') },
    { path: 'teams', label: t('nav.teams'), show: (p) => p.role === 'admin', page: () => import('./pages/teams.js') },
    { path: 'payroll', label: t('nav.payroll'), show: (p) => (p.role === 'admin' || p.role === 'assistant_manager') && can(p, 'payroll'), page: () => import('./pages/payroll.js') },
    { path: 'setup', label: t('nav.setup'), show: (p) => can(p, 'setup') || can(p, 'rules') || can(p, 'backup'), page: () => import('./pages/setup.js') },
    { path: 'permissions', label: t('nav.permissions'), show: (p) => p.role === 'admin', page: () => import('./pages/permissions.js') },
    { path: 'me', label: t('nav.me'), page: () => import('./pages/me.js') },
  ];
}
const allowed = (route, perms) => !route.show || route.show(perms);

let session = null;     // { profile, settings, perms, needsMigration }
let cleanups = [];
let renderToken = 0;

function messageCard(title, text, ...actions) {
  return h('div', { class: 'center' },
    h('div', { class: 'card auth' }, h('h2', {}, title), h('p', { class: 'muted' }, text), h('div', { class: 'row' }, actions)));
}

// Show the details and next steps for a signed-up account that is not active yet.
async function pendingScreen(profile) {
  let managerName = '—';
  try {
    const { supervisors } = await api.signupOptions();
    managerName = supervisors.find((s) => s.id === profile.manager_id)?.full_name || '—';
  } catch {
    // These lists are optional on this screen.
  }
  return messageCard(
    getLang() === 'ar' ? 'طلبك قيد المراجعة' : 'Account Pending Review',
    getLang() === 'ar'
      ? `أهلًا بك، ${profile.full_name}. سُجّل حسابك بنجاح، وينتظر تفعيله من قِبل الإدارة.`
      : `Welcome ${profile.full_name}. Your account is registered and awaiting manager activation.`,
    h('div', { style: { width: '100%', margin: '12px 0' } },
      h('p', {}, h('b', {}, getLang() === 'ar' ? 'المشرف المباشر: ' : 'Direct supervisor: '), managerName)),
    btn(t('topbar.logout'), signOut, 'primary'),
  );
}

async function signOut() {
  await api.signOut();
  session = null;
  boot();
}

// A password an admin typed in for someone else (new account or reset) must be replaced before the
// account can be used for anything else.
function forcePasswordScreen(profile) {
  const isAr = getLang() === 'ar';
  const password = h('input', { type: 'password', autocomplete: 'new-password' });
  const confirm = h('input', { type: 'password', autocomplete: 'new-password' });
  const submit = btn(isAr ? 'تغيير الباسورد والدخول' : 'Change password and continue', async () => {
    if (password.value.length < 6) { toast(isAr ? 'لازم تكون 6 حروف على الأقل.' : 'Must be at least 6 characters.', 'err'); return; }
    if (password.value !== confirm.value) { toast(isAr ? 'كلمتين السر مش زي بعض.' : 'The passwords do not match.', 'err'); return; }
    await api.changeMyPassword(password.value);
    boot();
  }, 'primary', { style: { width: '100%' } });
  return messageCard(
    isAr ? 'لازم تغيّر الباسورد' : 'You must change your password',
    isAr
      ? `أهلًا ${profile.full_name}. عشان أمان حسابك، لازم تحط باسورد جديد بدل اللي اتبعتلك قبل ما تكمل.`
      : `Welcome ${profile.full_name}. For your account's security, set a new password before continuing.`,
    h('div', { style: { width: '100%' } },
      field(isAr ? 'الباسورد الجديد' : 'New password', password),
      field(isAr ? 'تأكيد الباسورد' : 'Confirm password', confirm),
      submit),
    btn(t('topbar.logout'), signOut, 'ghost'),
  );
}

async function boot() {
  app.replaceChildren(spinner());
  try {
    const profile = await api.currentProfile();
    if (!profile) {
      const { default: renderLogin } = await import('./pages/login.js');
      app.replaceChildren(renderLogin({ api, onDone: boot }));
      return;
    }
    if (!profile.active) {
      app.replaceChildren(await pendingScreen(profile));
      return;
    }
    if (profile.must_change_password) {
      app.replaceChildren(forcePasswordScreen(profile));
      return;
    }
    const settingsList = await api.list('settings');
    const settings = settingsList[0] || {
      company_name: 'talabat mart',
      timezone: 'Africa/Cairo',
      currency: 'EGP',
      checkin_window_min: 60,
      overtime_threshold_min: 15,
      max_accuracy_m: 100,
    };

    let access;
    let needsMigration = false;
    try {
      access = await api.myPermissions();
    } catch (err) {
      if (err.code !== 'needs_migration') throw err;
      access = DEFAULT_PERMISSIONS[profile.role] || {};
      needsMigration = true;
    }
    session = { profile, settings, perms: { role: profile.role, access }, needsMigration };
    buildShell();
    await route();
  } catch (err) {
    app.replaceChildren(messageCard(getLang() === 'ar' ? 'حدث خطأ غير متوقع' : 'An error occurred', errorText(err), btn(getLang() === 'ar' ? 'إعادة المحاولة' : 'Retry', boot, 'primary')));
  }
}

function buildShell() {
  const { profile, settings, perms } = session;
  const currentRoutes = getRoutes();
  const links = currentRoutes.filter((r) => allowed(r, perms))
    .map((r) => h('a', { href: `#/${r.path}`, 'data-path': r.path }, r.label));

  // In live mode, remind users with backup access to export data if this browser has no recent backup.
  const days = daysSinceBackup();
  const backupDue = api.mode !== 'local' && can(perms, 'backup') && (days === null || days > STALE_AFTER_DAYS);

  app.replaceChildren(...[
    session.needsMigration && h('div', { class: 'banner' }, t('topbar.migrationBanner')),
    backupDue && h('div', { class: 'banner', id: 'backup-banner' },
      days === null ? t('topbar.backupBannerNone') : t('topbar.backupBannerStale', { days }),
      h('a', { href: '#/setup' }, t('topbar.backupLink'))),
    api.mode === 'local' && h('div', { class: 'banner' },
      t('topbar.demoBanner'),
      btn(t('topbar.demoReset'), async () => { if (await confirmBox(t('topbar.demoWarning'), t('topbar.demoConfirmBtn'))) api.resetDemo(); }, 'small ghost')),
    h('header', { class: 'topbar' },
      h('span', { class: 'brand' },
        h('img', { src: 'img/logo.webp', alt: 'Talabat Mart', class: 'brand-logo-img', onerror: (e) => { e.target.src = 'img/logo.png'; } }),
        h('span', { style: { fontWeight: 800, letterSpacing: '0.4px' } }, settings.company_name || 'talabat mart')
      ),
      h('span', { class: 'who' },
        profile.full_name,
        // Language switcher pill button
        btn(getLang() === 'ar' ? 'EN' : 'عربي', () => {
          const next = getLang() === 'ar' ? 'en' : 'ar';
          setLang(next);
          buildShell();
          route();
        }, 'small', { title: t('topbar.toggleLang') }),
        // Dark / Light theme toggle button
        btn(document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙', (b) => {
          const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
          localStorage.setItem('attn.theme', next);
          applyTheme(next);
          b.textContent = next === 'dark' ? '☀️' : '🌙';
        }, 'small', { title: t('topbar.toggleTheme') }),
        btn(t('topbar.logout'), signOut, 'small')
      )
    ),
    h('nav', { class: 'nav', id: 'nav' }, links),
    h('main', { id: 'view' }),
  ].filter(Boolean));
}

async function route() {
  if (!session) return;
  cleanups.splice(0).forEach((fn) => fn());
  const path = location.hash.replace(/^#\/?/, '');
  const currentRoutes = getRoutes();
  if (path === '' && (['supervisor', 'assistant_manager', 'manager', 'admin'].includes(session.perms.role))) {
    location.hash = '#/dashboard';
    return;
  }
  const found = currentRoutes.find((r) => r.path === path);
  if (!found || !allowed(found, session.perms)) {
    if (path !== '') { location.hash = '#/'; return; }
  }
  const current = found || currentRoutes[0];
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.path === current.path));

  const view = document.getElementById('view');
  const token = ++renderToken;
  view.replaceChildren(spinner());
  try {
    const mod = await current.page();
    const node = await mod.default({
      api,
      profile: session.profile,
      settings: session.settings,
      perms: session.perms,
      onCleanup: (fn) => cleanups.push(fn),
      refresh: route,
    });
    if (token === renderToken) view.replaceChildren(node);
  } catch (err) {
    if (token === renderToken) view.replaceChildren(h('div', { class: 'card' }, h('h3', {}, getLang() === 'ar' ? 'حدث خطأ' : 'Error'), h('p', {}, errorText(err))));
  }
}

window.addEventListener('hashchange', route);

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();
