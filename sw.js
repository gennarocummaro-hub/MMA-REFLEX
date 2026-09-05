/* Service worker: cache-first sull'app shell, cosi' la sessione parte
   in palestra senza rete. Alzare VERSIONE a ogni rilascio: il vecchio
   cache viene buttato all'activate. */
const VERSIONE = 'mmarx-v1';
const RISORSE = [
  './',
  './index.html',
  './app.js',
  './style.css',
  './manifest.json'
];

self.addEventListener('install', evento => {
  evento.waitUntil(
    caches.open(VERSIONE)
      .then(cache => cache.addAll(RISORSE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', evento => {
  evento.waitUntil(
    caches.keys()
      .then(chiavi => Promise.all(chiavi.filter(k => k !== VERSIONE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', evento => {
  const richiesta = evento.request;
  if (richiesta.method !== 'GET') return;
  const url = new URL(richiesta.url);
  if (url.origin !== self.location.origin) return;   /* niente di esterno: non ce n'e' */

  evento.respondWith(
    caches.match(richiesta, { ignoreSearch: true }).then(risposta => {
      if (risposta) {
        /* aggiornamento in sottofondo: la copia in cache resta quella servita */
        fetch(richiesta).then(fresca => {
          if (fresca && fresca.ok) caches.open(VERSIONE).then(c => c.put(richiesta, fresca));
        }).catch(() => {});
        return risposta;
      }
      return fetch(richiesta)
        .then(fresca => {
          if (fresca && fresca.ok) {
            const copia = fresca.clone();
            caches.open(VERSIONE).then(c => c.put(richiesta, copia));
          }
          return fresca;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
