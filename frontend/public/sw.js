/* AURA Faculty service worker.
 * Kept passive so it never interferes with the kiosk (/display, /face): no fetch interception.
 * It exists to (a) make /faculty installable as a PWA and (b) deliver Web Push notifications when
 * the site is served over HTTPS. On plain http the page falls back to in-app notifications.
 */
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'New meeting request';
  const options = {
    body: data.body || 'A student requested a meeting.',
    icon: '/logos/aura-robot.png',
    badge: '/logos/aura-robot.png',
    data: { url: '/faculty', ...(data.data || {}) },
    tag: 'aura-appointment',
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/faculty';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) { if (w.url.includes('/faculty') && 'focus' in w) return w.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
