// ============================================================
//  SERVICE WORKER — LightWatch
//  Handles: push notifications, offline cache (basic)
// ============================================================

const CACHE_NAME = 'lightwatch-v3';
const APP_ICON = new URL('/images/dev-logo.png?v=20260708', self.location.origin).href;
const APP_BADGE = new URL('/images/notification-badge.png?v=20260708', self.location.origin).href;
const SHELL_ASSETS = [
    '/',
    '/index.html',
    '/pages/home.html',
    '/pages/areas.html',
    '/pages/reports.html',
    '/pages/account.html',
    '/css/styles.css',
    '/css/home.css',
    '/css/areas.css',
    '/images/dev-logo.png?v=20260707',
    '/images/areas.png'
];

// ── Install: cache core shell ─────────────────────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(SHELL_ASSETS))
            .catch(() => {})
            .finally(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys
                .filter(key => key !== CACHE_NAME)
                .map(key => caches.delete(key))
            ))
            .then(() => clients.claim())
    );
});

// ── Fetch: quick cache-first static assets + network-first HTML ──
self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    const isApiPath = /^\/(admin|reports|lightstatus|chat|subscribe|user|stats)(\/|$)/.test(url.pathname);
    if (isApiPath) return;

    if (req.mode === 'navigate') {
        event.respondWith((async () => {
            try {
                const fresh = await fetch(req);
                const cache = await caches.open(CACHE_NAME);
                cache.put(req, fresh.clone());
                return fresh;
            } catch {
                const cached = await caches.match(req);
                return cached || caches.match('/pages/home.html') || Response.error();
            }
        })());
        return;
    }

    event.respondWith((async () => {
        const cached = await caches.match(req);
        if (cached) {
            fetch(req)
                .then(async fresh => {
                    const cache = await caches.open(CACHE_NAME);
                    cache.put(req, fresh.clone());
                })
                .catch(() => {});
            return cached;
        }

        try {
            const fresh = await fetch(req);
            const cache = await caches.open(CACHE_NAME);
            cache.put(req, fresh.clone());
            return fresh;
        } catch {
            return Response.error();
        }
    })());
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
        badge: data.badge || APP_BADGE,
        tag: data.tag || 'light-status',
        renotify: true,
        vibrate: Array.isArray(data.vibrate) ? data.vibrate : [200, 100, 200],
        requireInteraction: data.requireInteraction !== false,
        silent: false,
        actions: [
            {
                action: "open",
                title: "Open"
            }
        ],
        timestamp: Date.now(),
        data: { url: data.url || '/pages/home.html' }
    };

    if (data.image) {
        options.image = data.image;
    }

    const notifyPromise = self.registration.showNotification(data.title, options);

    // Notify any open app window so it can play a foreground sound.
    // Background audio playback is not available in service workers.
    const broadcastPromise = clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then(list => {
            for (const client of list) {
                client.postMessage({
                    type: 'LW_PUSH_RECEIVED',
                    tone: data.tone || 'dew-drops'
                });
            }
        })
        .catch(() => {});

    event.waitUntil(Promise.all([notifyPromise, broadcastPromise]));
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