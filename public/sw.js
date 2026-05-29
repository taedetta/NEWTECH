'use strict';

const CACHE = 'nta-portal-v6';
const OFFLINE_API_CACHE = 'nta-offline-api-v1';

const OFFLINE_URLS = [
  '/manifest.webmanifest',
  '/app',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(OFFLINE_URLS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE && k !== OFFLINE_API_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'New Tech Aviation', body: '', link: '/app' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (_) { /* use defaults */ }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: 'https://pub-629428d185ca4960a0a73c850d32294b.r2.dev/company_96457/images/6131da51-11d1-4327-8e6f-470c3e242f0b.png',
      badge: 'https://pub-629428d185ca4960a0a73c850d32294b.r2.dev/company_96457/images/6131da51-11d1-4327-8e6f-470c3e242f0b.png',
      tag: data.tag || 'nta-notification',
      data: { link: data.link || '/app' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || '/app';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(link);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(link);
    })
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.pathname.startsWith('/api/auth/me') || url.pathname.startsWith('/api/bookings')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(OFFLINE_API_CACHE).then((c) => c.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || Response.error()))
    );
    return;
  }

  if (url.pathname.startsWith('/api/')) return;

  // Always fetch /app HTML from network so nav/role changes deploy immediately
  if (url.pathname === '/app' || url.pathname === '/app/') {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && url.origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || Response.error()))
  );
});
