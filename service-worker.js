// ============================================================
//  SERVICE WORKER — LightWatch
//  Handles: push notifications, versioned offline cache,
//           fast automatic updates across iOS/Android/desktop
//
//  UPDATED for the SPA rewrite:
//   - APP_VERSION bumped — this alone forces every existing
//     installed worker to see this as a new version, install it,
//     and (via the existing skipWaiting/clients.claim flow) wipe
//     every old-named cache on activate. This is the single most
//     important line in this file for getting unstuck right now.
//   - PRECACHE_ASSETS rewritten to match the new css/js folder
//     layout. The old list (/css/styles.css, /css/home.css,
//     /css/areas.css, /Js/app-startup.js) 404s under the new
//     structure, and cache.addAll() fails ENTIRELY if even one URL
//     in the list 404s — so the old list wasn't precaching
//     anything at all, silently (caught by the .catch() below).
//   - OFFLINE_FALLBACK_PAGE now points at '/index.html' (the only
//     HTML document that exists now) instead of '/pages/home.html'.
//   - Push notification click-through now opens '/home' (a real
//     pushState route the SPA's router understands on cold boot)
//     instead of '/pages/home.html'.
// ============================================================

// ── 1. VERSIONED CACHE ────────────────────────────────────────
const APP_VERSION   = '2.0.0';
const STATIC_CACHE  = `lightwatch-static-v${APP_VERSION}`;
const HTML_CACHE     = `lightwatch-html-v${APP_VERSION}`;
const CURRENT_CACHES = [STATIC_CACHE, HTML_CACHE];

const APP_ICON  = new URL(`/images/dev-logo.png?v=${APP_VERSION}`, self.location.origin).href;
const APP_BADGE = new URL(`/images/notification-badge.png?v=${APP_VERSION}`, self.location.origin).href;

// Only truly static, rarely-changing shell assets belong here.
// HTML pages are deliberately NOT precached — they're handled by
// the network-first navigation strategy below, so users always
// get the latest markup instead of a frozen shell page.
//
// NOTE: verify these exact paths exist in your deployed repo before
// relying on this list — if your build ever adds cache-busting
// query strings (the old app used ?v=1.0.20-style suffixes on
// every <link>/<script> tag), these plain paths will just get
// re-fetched and cached under a slightly different URL each time,
// which is harmless but means the entries below are mostly here to
// warm the cache for the first offline visit, not to matter long-term.
const PRECACHE_ASSETS = [
    '/index.html',
    '/css/base/reset.css',
    '/css/base/variables.css',
    '/css/base/typography.css',
    '/css/base/global.css',
    '/css/layouts/app-shell.css',
    '/css/components/buttons.css',
    '/css/components/cards.css',
    '/css/components/navbar.css',
    '/js/config.js',
    '/js/app.js',
    '/js/services/auth.js',
    '/images/dev-logo.png',
    // Status icons profile.js swaps in on every light-status render
    // (setLightStatus) and the push-notification badge — small, never
    // change, and used constantly, so they're worth having in the
    // static cache from install rather than waiting on their first
    // successful online fetch to warm staleWhileRevalidate() below.
    '/images/light-on.png',
    '/images/light-off.png',
    '/images/notification-badge.png'
];

// Used as the offline fallback when a route has never been visited
// (and therefore isn't in HTML_CACHE) and the network is down. This
// is now the SPA's single document — the router figures out which
// view to show once it loads, same as any other cold boot.
const OFFLINE_FALLBACK_PAGE = '/index.html';

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
    // This now also covers the SPA's pushState routes (/home, /areas,
    // /reports, /account, /login, /signup, /verification) — a browser
    // treats a hard reload or deep link to any of those as a real
    // navigation request, and Netlify needs its own rewrite rule
    // (_redirects: "/* /index.html 200") to answer them with
    // index.html in the first place, before this ever gets involved.
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
        silent: false,
        actions: [
            {
                action: "open",
                title: "Open"
            }
        ],
        timestamp: Date.now(),
        data: { url: data.url || '/home' }
    };

    if (data.image) {
        options.image = data.image;
    }

    const notifyPromise = self.registration.showNotification(data.title, options);

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
    const targetUrl = new URL(event.notification.data?.url || '/home', self.location.origin).href;

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
                    // try the next matching client instead of giving up
                }
            }

            return clients.openWindow(targetUrl);
        } catch (err) {
            return clients.openWindow(targetUrl);
        }
    })());
});