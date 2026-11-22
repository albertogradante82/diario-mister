// Service worker: rende l'app utilizzabile offline.
// Ad ogni rilascio aumenta VERSION per far scaricare i file aggiornati.
const VERSION = 'mister-v1.7.0';
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
  './js/admin.js',
  './js/views/calendar.js',
  './js/views/home.js',
  './js/clubdata.js',
  './js/roles.js',
  './js/views/player.js',
  './dati/pubblico.json',
  './dati/societa.enc.json',
  './js/views/matches.js',
  './js/views/players.js',
  './js/views/analysis.js',
  './js/views/more.js',
  './vendor/jspdf.umd.min.js',
  './esempi/tracking-esempio.json',
  './icons/icon-192.png',
  './icons/logo-palazzo.png',
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

// Rete prima di tutto (sempre la versione aggiornata, niente file vecchi mescolati ai nuovi);
// se non c'è connessione si usa la copia salvata, così l'app funziona offline.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // l'archivio condiviso va sempre letto dalla rete
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  e.respondWith((async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(req, { cache: 'no-cache', signal: ctrl.signal });
      clearTimeout(timer);
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
      }
      return res;
    } catch {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      if (req.mode === 'navigate') return caches.match('./index.html');
      throw new Error('offline');
    }
  })());
});
