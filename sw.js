// Offline shell + runtime caching for the PWA.
//   - App files (same-origin, no /tests/): cache-first, refreshed in the background (stale-while-revalidate).
//   - Supabase REST/Auth calls: network only — never cached (they are live, personal data).
//   - Last screen seen: kept in the cache so a cold start with no network still shows the shell.
const SHELL = 'attn-shell-v5';

// Preloaded at install so the very first offline launch still renders.
const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/main.js',
  'icon.svg',
  'img/icons/icon-192.png',
  'img/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                       // writes go straight to the network
  const url = new URL(req.url);

  // Live data and auth: never serve from a cache.
  if (url.hostname.endsWith('supabase.co')) return;

  // Same-origin app files: stale-while-revalidate.
  if (url.origin === self.location.origin && !url.pathname.includes('/tests/')) {
    event.respondWith(
      caches.open(SHELL).then(async (cache) => {
        const cached = await cache.match(req, { ignoreSearch: true });
        const fresh = fetch(req).then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }).catch(() => null);
        return cached || (await fresh) || cache.match('./');
      }),
    );
  }
  // Everything else (fonts, CDN): leave to the browser.
});
