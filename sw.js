// Service worker: rende l'app utilizzabile offline.
// Ad ogni rilascio aumenta VERSION per far scaricare i file aggiornati.
const VERSION = 'mister-v1.2.0';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/util.js',
  './js/stats.js',
  './js/charts.js',
  './js/tracking.js',
  './js/pdf.js',
  './js/sync.js',
  './js/views/matches.js',
  './js/views/players.js',
  './js/views/analysis.js',
  './js/views/more.js',
  './vendor/jspdf.umd.min.js',
  './esempi/tracking-esempio.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Cache-first per i file dell'app (funziona senza rete), aggiornamento in background.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // l'archivio condiviso va sempre letto dalla rete
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached || (req.mode === 'navigate' ? caches.match('./index.html') : undefined));
      return cached || network;
    }),
  );
});
