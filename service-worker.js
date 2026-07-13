// ============================================================
//  SERVICE WORKER — LightWatch
//  Handles: push notifications, versioned offline cache,
//           fast automatic updates across iOS/Android/desktop
// ============================================================

// ── 1. VERSIONED CACHE ────────────────────────────────────────
// Bump this ONE string on every deploy. Everything else (cache
// names, asset URLs pulled in below) derives from it, and the
// activate handler wipes any cache that doesn't match it.
const APP_VERSION   = '1.0.16';
const STATIC_CACHE  = `lightwatch-static-v${APP_VERSION}`;
const HTML_CACHE     = `lightwatch-html-v${APP_VERSION}`;
const CURRENT_CACHES = [STATIC_CACHE, HTML_CACHE];

const APP_ICON  = new URL(`/images/dev-logo.png?v=${APP_VERSION}`, self.location.origin).href;
const APP_BADGE = new URL(`/images/notification-badge.png?v=${APP_VERSION}`, self.location.origin).href;

// Only truly static, rarely-changing shell assets belong here.
// HTML pages are deliberately NOT precached — they're handled by
// the network-first navigation strategy below, so users always
// get the latest markup instead of a frozen shell page.
const PRECACHE_ASSETS = [
    `/css/styles.css?v=${APP_VERSION}`,
    `/css/home.css?v=${APP_VERSION}`,
    `/css/areas.css?v=${APP_VERSION}`,
    `/Js/app-startup.js?v=${APP_VERSION}`,
    `/images/dev-logo.png?v=${APP_VERSION}`,
    `/images/areas.png?v=${APP_VERSION}`
];

// Used as the offline fallback when a page has never been visited
// (and therefore isn't in HTML_CACHE) and the network is down.
const OFFLINE_FALLBACK_PAGE = '/pages/home.html';

// API routes must never be served from cache — always hit the network.
const API_PATH_RE = /^\/(admin|reports|lightstatus|chat|subscribe|user|stats)(\/|$)/;

// Extensions handled with stale-while-revalidate.
const ASSET_DESTINATIONS = new Set(['style', 'script', 'font', 'image']);
const ASSET_EXT_RE = /\.(css|js|mjs|png|jpg|jpeg|svg|gif|webp|ico|woff2?|ttf)$/i;

// ── Install: pre-cache the shell, activate immediately ────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => cache.addAll(PRECACHE_ASSETS))
            .catch(err => console.warn('[SW] precache failed', err))
            .finally(() => self.skipWaiting()) // don't wait for old tabs to close
    );
});

// ── Activate: drop every cache that isn't the current version ─
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(key => !CURRENT_CACHES.includes(key))
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim()) // take control of open tabs now
    );
});

// ── Fetch: route by request type ──────────────────────────────
self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    // 6. API requests — network only, never cached, never stale.
    if (API_PATH_RE.test(url.pathname)) return;

    // 4. HTML navigations — network first, cache as a fallback.
    const isNavigation = req.mode === 'navigate' || req.destination === 'document';
    if (isNavigation) {
        event.respondWith(networkFirstHTML(req));
        return;
    }

    // 5. CSS/JS/images/fonts — stale while revalidate.
    const isAsset = ASSET_DESTINATIONS.has(req.destination) || ASSET_EXT_RE.test(url.pathname);
    if (isAsset) {
        event.respondWith(staleWhileRevalidate(req));
        return;
    }

    // Anything else: try network, fall back to cache.
    event.respondWith(
        fetch(req).catch(() => caches.match(req))
    );
});

async function networkFirstHTML(req) {
    const cache = await caches.open(HTML_CACHE);
    try {
        const fresh = await fetch(req, { cache: 'no-store' });
        cache.put(req, fresh.clone());
        return fresh;
    } catch {
        const cached = await cache.match(req);
        if (cached) return cached;
        const fallback = await cache.match(OFFLINE_FALLBACK_PAGE);
        return fallback || Response.error();
    }
}

async function staleWhileRevalidate(req) {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(req);

    const networkFetch = fetch(req)
        .then(fresh => {
            if (fresh && fresh.ok) cache.put(req, fresh.clone());
            return fresh;
        })
        .catch(() => null);

    // Serve cached copy instantly if we have one; otherwise wait on network.
    return cached || (await networkFetch) || Response.error();
}

// ── Message channel: let pages force this worker to activate now ──
self.addEventListener('message', event => {
    if (event.data === 'SKIP_WAITING' || event.data?.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
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
        // `silent` is the ONLY real lever the Notification API exposes for
        // sound — true/false, nothing in between. There has never been a
        // `sound` option in the spec (confirmed against Apple's own dev
        // forum: iOS 17 discussion thread, June 2026 recheck), on any
        // platform — Chrome, Firefox, and Safari all ignore it silently.
        // A `sound: 'default'` field here did nothing at all; it wasn't
        // "choosing" the default over something else, there was never a
        // choice to make. Removed rather than leave code that implies a
        // control that doesn't exist. When this fires while the page is
        // open, the actual audible cue is the Web Audio tone played by
        // notification.js's triggerForegroundSignal() — that's the only
        // sound we can genuinely author ourselves.
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
    const targetUrl = new URL(event.notification.data?.url || '/pages/home.html', self.location.origin).href;

    event.waitUntil((async () => {
        try {
            const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });

            for (const client of list) {
                try {
                    if ('navigate' in client) {
                        const navigated = await client.navigate(targetUrl);
                        return (navigated || client).focus();
                    }
                    if ('focus' in client) {
                        return client.focus();
                    }
                } catch (err) {
                    // This particular client couldn't be navigated/focused
                    // (e.g. it was closed mid-flight, or navigate() is
                    // restricted on it) — try the next matching client
                    // instead of giving up and opening nothing.
                }
            }

            // No existing window could be reused — open a fresh one.
            return clients.openWindow(targetUrl);
        } catch (err) {
            // Absolute last resort so a tap never does nothing.
            return clients.openWindow(targetUrl);
        }
    })());
});