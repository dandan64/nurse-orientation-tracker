// sw.js - keeps a copy of the page's own files so the tracker opens even when the internet is down.
// Only the app files are cached. Data never passes through here: it is read/written in the local folder.
const CACHE = 'nurse-tracker-v2';
const FILES = ['./', 'index.html', 'app.js', 'store.js', 'charts.js', 'style.css',
  'vendor/html2canvas.min.js', 'vendor/jspdf.umd.min.js'];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Network first (so updates arrive at once), cached copy when offline.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request)
    .then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
