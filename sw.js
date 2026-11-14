/* פיט — service worker */
const CACHE = 'fit-tracker-v17';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './js/config.js',
  './js/engine.js',
  './js/demo.js',
  './js/store.js',
  './js/live.js',
  './js/bodymap.js',
  './js/charts.js',
  './js/notify.js',
  './js/summary.js',
  './js/photos.js',
  './js/cloud-config.js',
  './js/sync.js',
  './js/planparse.js',
  './js/ui.js',
  './js/app.js',
  './version.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Network-first so updates show immediately; fall back to cache offline.
  event.respondWith(
    fetch(request, { cache: 'no-store' })
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((c) => c || caches.match('./index.html')))
  );
});


self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'show-notification') return;
  event.waitUntil(
    self.registration.showNotification(data.title || 'פיט', {
      body: data.body || '',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: data.tag,
      renotify: false,
      dir: 'rtl',
      lang: 'he',
      data: data.data || { url: './' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

/* Future Web Push: the server will send a push payload {title, body, tag, data}. */
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (err) { payload = {}; }
  const title = payload.title || 'פיט';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: payload.tag || 'fit-push',
      dir: 'rtl',
      lang: 'he',
      data: payload.data || { url: './' }
    })
  );
});
