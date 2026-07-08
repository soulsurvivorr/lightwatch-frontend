// ============================================================
//  SERVICE WORKER — LightWatch
//  Handles: push notifications, offline cache (basic)
// ============================================================

const CACHE_NAME = 'lightwatch-v1';
const APP_ICON = new URL('/images/dev-logo.png?v=20260708', self.location.origin).href;

// ── Install: cache core shell ─────────────────────────────────
self.addEventListener('install', event => {
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(clients.claim());
});

// ── Push: show notification when server sends a push ─────────
self.addEventListener('push', event => {
    let data = { title: 'LightWatch', body: 'Light status has changed.' };

    if (event.data) {
        try { data = event.data.json(); }
        catch { data.body = event.data.text(); }
    }

    const options = {
        body: data.body,
        icon: data.icon || APP_ICON,
        tag: data.tag || 'light-status',
        renotify: true,
        data: { url: data.url || '/pages/home.html' }
    };

    if (data.badge) {
        options.badge = data.badge;
    }

    if (data.image) {
        options.image = data.image;
    }

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// ── Notification click: open the app ─────────────────────────
self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
            // If app already open, focus it
            for (const client of list) {
                if (client.url.includes('/pages/home') && 'focus' in client) {
                    return client.focus();
                }
            }
            // Otherwise open a new window
            return clients.openWindow(event.notification.data?.url || '/pages/home.html');
        })
    );
});