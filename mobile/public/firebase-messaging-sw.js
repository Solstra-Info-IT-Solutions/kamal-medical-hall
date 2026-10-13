/* Web push for the Kamal Medical Hall website (admin panel).
 * Firebase Cloud Messaging delivers the message here; this worker shows it and, when it is clicked, brings the site
 * to the front and opens the right page. While the site is open and in front, the in-app banner shows the
 * notification instead, so nothing is shown twice. Plain service worker: no Firebase code is needed here. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const windows = () => self.clients.matchAll({ type: 'window', includeUncontrolled: true });

self.addEventListener('push', (event) => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch (e) { msg = { notification: { title: 'Kamal Medical Hall', body: event.data ? event.data.text() : '' } }; }
  const n = msg.notification || {};
  const data = msg.data || {};
  event.waitUntil(windows().then((list) => {
    const inFront = list.some((c) => c.visibilityState === 'visible' && c.focused);
    if (inFront) return undefined; // the open site shows its own banner
    return self.registration.showNotification(n.title || data.title || 'Kamal Medical Hall', {
      body: n.body || data.body || '',
      icon: n.icon || '/notification-icon.png',
      badge: '/notification-icon.png',
      tag: msg.fcmMessageId || undefined,
      data,
    });
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil(windows().then((list) => {
    const site = list.find((c) => new URL(c.url).origin === self.location.origin);
    if (site) {
      site.postMessage({ kmh: 'open', data });
      return site.focus();
    }
    return self.clients.openWindow('/?kmhOpen=' + encodeURIComponent(JSON.stringify(data)));
  }));
});
