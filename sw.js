// Network-only / direct fetch to prevent stale JS module caches during development
const CACHE = 'attn-shell-v4';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  // Let network handle directly so browser modules stay always fresh
});
