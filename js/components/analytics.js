// ============================================================
//  COMPONENTS/ANALYTICS.JS
//  NOTE ON NAMING: the requested folder structure calls for
//  js/components/analytics.js, so app-wide "keep the installed app
//  current" plumbing lives here — service worker registration/
//  update-checking, the Android hardware back button, and the
//  viewport-height fix. None of this is page-view analytics; it's
//  the same bucket of cross-cutting, always-on concerns
//  theme.js/nav.js live in, just under the name the spec asked for.
//
//  CONSOLIDATION: the original app loaded TWO nearly-identical
//  copies of this logic on every page — analytics.js (mislabeled;
//  its own header comment literally said "APP-STARTUP.JS") and
//  app-startup.js, the fuller, more current version. Loading both
//  registered two service-worker update listeners and two hardware
//  back-button handlers on the same page. This file is the single,
//  de-duplicated version, based on the more complete app-startup.js
//  implementation. If that duplication was intentional for some
//  reason not visible in the source, flag it — but it reads like an
//  accidental leftover consistent with this codebase's habit of
//  documenting bugs-found-and-fixed inline.
//
//  CHANGED FOR THE SPA:
//   - The back button no longer replaces location to a specific
//     .html file. It asks the router to go back one step in-app
//     history, falling back to the home view (or exiting the app,
//     on the root/home view) exactly like the original priority
//     order (close chat > exit on root/home > back to home).
//   - "pageSettled"/onboarding-blocking gating for the service-worker
//     reload is kept — a new build should still not yank the
//     onboarding walkthrough away mid-slide, same as before.
// ============================================================

function initAppBoot() {
    initServiceWorker();
    initViewportHeightFix();
    initBackButton();
    initKeyboardPlugin();
    initFirstLaunchNotificationPrompt();
}

// ---- Service worker registration + update handling ----
function initServiceWorker() {
    const isNative = Boolean(window.Capacitor?.isNativePlatform?.());

    if (!isNative && 'serviceWorker' in navigator) {
        registerServiceWorker();
    } else if (isNative && 'serviceWorker' in navigator) {
        // One-time cleanup for native installs that picked up a stale
        // Service Worker + Cache Storage from before this app became a
        // pure Capacitor shell (see original analytics.js history).
        navigator.serviceWorker.getRegistrations()
            .then(regs => Promise.all(regs.map(reg => reg.unregister())))
            .catch(() => {});
        if (window.caches?.keys) {
            caches.keys()
                .then(keys => Promise.all(keys.map(key => caches.delete(key))))
                .catch(() => {});
        }
    }
}

const SW_URL = '/service-worker.js';
const UPDATE_CHECK_INTERVAL_MS = 60 * 1000;
let refreshing = false;
let pageSettled = false;
let pendingReloadAfterSettle = false;

function isOnboardingBlocking() {
    const overlay = document.getElementById('onboardingOverlay');
    return !!(overlay && overlay.classList.contains('is-open'));
}

function attemptPendingReload() {
    if (!pendingReloadAfterSettle || refreshing) return;
    if (!pageSettled || isOnboardingBlocking()) return;
    refreshing = true;
    window.location.reload();
}

window.addEventListener('lw-onboarding-closed', attemptPendingReload);

function markPageSettled() {
    setTimeout(() => {
        pageSettled = true;
        attemptPendingReload();
    }, 600);
}

function activateWaitingWorker(registration) {
    if (!registration.waiting) return;
    registration.waiting.postMessage('SKIP_WAITING');
}

function watchForUpdates(registration) {
    if (registration.waiting && registration.active) {
        activateWaitingWorker(registration);
    }
    registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                activateWaitingWorker(registration);
            }
        });
    });
}

async function registerServiceWorker() {
    try {
        const registration = await navigator.serviceWorker.register(SW_URL, { scope: '/' });
        watchForUpdates(registration);
        registration.update().catch(() => {});

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') registration.update().catch(() => {});
        });
        window.addEventListener('pageshow', (event) => {
            if (event.persisted) registration.update().catch(() => {});
        });
        setInterval(() => {
            if (document.visibilityState === 'visible') registration.update().catch(() => {});
        }, UPDATE_CHECK_INTERVAL_MS);
    } catch (err) {
        console.warn('[app boot] service worker registration failed', err);
    }
}

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        if (!pageSettled || isOnboardingBlocking()) {
            pendingReloadAfterSettle = true;
            return;
        }
        refreshing = true;
        window.location.reload();
    });
}

if (document.readyState === 'complete') {
    markPageSettled();
} else {
    window.addEventListener('load', markPageSettled, { once: true });
}

// ---- Reliable full-screen height for mobile (keyboard resize fix) ----
function initViewportHeightFix() {
    function setAppVh() {
        const height = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        document.documentElement.style.setProperty('--app-vh', `${height}px`);
    }

    setAppVh();
    setTimeout(setAppVh, 300);

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', setAppVh);
    } else {
        window.addEventListener('resize', setAppVh);
    }

    window.addEventListener('orientationchange', () => {
        setTimeout(setAppVh, 200);
    });
}

// ---- Capacitor keyboard support for native app inputs ----
let keyboardPluginInitialized = false;

async function initKeyboardPlugin() {
    if (keyboardPluginInitialized || !window.Capacitor?.isNativePlatform?.()) return;

    try {
        const { Keyboard } = window.Capacitor.Plugins || {};
        if (!Keyboard?.addListener) return;

        await Keyboard.setAccessoryBarVisible({ isVisible: false });
        Keyboard.addListener('keyboardWillShow', () => {
            document.documentElement.classList.add('lw-keyboard-visible');
            window.dispatchEvent(new Event('lw-keyboard-show'));
        });
        Keyboard.addListener('keyboardWillHide', () => {
            document.documentElement.classList.remove('lw-keyboard-visible');
            window.dispatchEvent(new Event('lw-keyboard-hide'));
        });
        keyboardPluginInitialized = true;
    } catch (err) {
        console.warn('[app boot] keyboard plugin init failed', err);
    }
}

// ---- Hardware / gesture back button (Android) ----
function initBackButton() {
    const AppPlugin = window.Capacitor?.Plugins?.App;
    if (!AppPlugin?.addListener) return;

    AppPlugin.addListener('backButton', () => {
        // Priority 1: close chat if it's open full-screen on mobile.
        const card = document.querySelector('.chat-card--mobile-open');
        if (card && typeof window.setMobileChatOpen === 'function') {
            window.setMobileChatOpen(false);
            return;
        }

        // Priority 2: let the router try to go back one step in-app
        // history. It exits the app itself if there's nowhere to go
        // and the current view is the root (login) or home.
        window.LWRouter.handleHardwareBack();
    });
}

// ---- First-run notification permission ----
function initFirstLaunchNotificationPrompt() {
    const NOTIF_PROMPTED_KEY = 'lw_notif_first_prompt';
    if (!localStorage.getItem(NOTIF_PROMPTED_KEY)) {
        setTimeout(async () => {
            if (window.enableLightWatchPush) {
                await window.enableLightWatchPush();
                localStorage.setItem(NOTIF_PROMPTED_KEY, '1');
            }
        }, 3000);
    }
}

// ============================================================
//  USAGE ANALYTICS TRACKING
//  Restores what this file's name always promised. The admin
//  dashboard's Analytics tab (GET /admin/analytics/overview) and the
//  "who's active" flag on the Users tab (GET /admin/users) both read
//  from the AnalyticsEvent collection, and the server already has a
//  working POST /analytics/track endpoint for it (see server.js) —
//  but nothing on the client ever called it. That endpoint call must
//  have lived here originally, given this file's name, and got lost
//  when this file was repurposed for app-boot plumbing during the
//  SPA rewrite. This adds it back, sending the same event shape the
//  server already expects: app_open, screen_view, exit.
// ============================================================

(function initUsageTracking() {
    const DEVICE_ID_KEY = 'lw_device_id';
    const SESSION_ID_KEY = 'lw_session_id';

    function uuid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }

    function getDeviceId() {
        try {
            let id = localStorage.getItem(DEVICE_ID_KEY);
            if (!id) {
                id = uuid();
                localStorage.setItem(DEVICE_ID_KEY, id);
            }
            return id;
        } catch (err) {
            return null;
        }
    }

    function getSessionId() {
        try {
            let id = sessionStorage.getItem(SESSION_ID_KEY);
            if (!id) {
                id = uuid();
                sessionStorage.setItem(SESSION_ID_KEY, id);
            }
            return id;
        } catch (err) {
            return null;
        }
    }

    // Same lookup order home.js's currentUserIdForReports() uses, so a
    // signed-in user's events line up with their account either way.
    function getUserId() {
        try {
            return (typeof getSession === 'function' && getSession()?.user?.id)
                || localStorage.getItem('currentUserId')
                || null;
        } catch (err) {
            return null;
        }
    }

    function apiBase() {
        if (typeof API_URL !== 'undefined' && API_URL) return API_URL;
        if (window.API_URL) return window.API_URL;
        return '';
    }

    // Best-effort, fire-and-forget — a dropped analytics call should
    // never affect the actual product experience (matches the server
    // comment on /analytics/track).
    function send(payload, useBeacon) {
        const url = `${apiBase()}/analytics/track`;
        const body = JSON.stringify(payload);
        try {
            if (useBeacon && navigator.sendBeacon) {
                navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
                return;
            }
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                keepalive: true
            }).catch(() => {});
        } catch (err) {
            // swallow — see comment above
        }
    }

    function track(type, extra, useBeacon) {
        send(Object.assign({
            type,
            userId: getUserId(),
            deviceId: getDeviceId(),
            sessionId: getSessionId()
        }, extra || {}), !!useBeacon);
    }

    // The router (app.js) shows/hides <section data-view="..."> and
    // toggles the `hidden` attribute — reading the DOM directly here
    // avoids depending on any router internals. Used as a fallback for
    // the very first paint, before the router has fired its own event.
    function currentScreen() {
        const el = document.querySelector('section[data-view]:not([hidden])');
        return el ? el.dataset.view : null;
    }

    let activeScreen = null;
    let screenStartedAt = 0;

    function enterScreen(screen) {
        if (!screen || screen === activeScreen) return;
        activeScreen = screen;
        screenStartedAt = Date.now();
        track('screen_view', { screen });
    }

    function sendExit() {
        if (!activeScreen) return;
        const durationMs = Date.now() - screenStartedAt;
        track('exit', { screen: activeScreen, durationMs }, true);
    }

    function boot() {
        track('app_open');
        enterScreen(currentScreen());
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        boot();
    } else {
        window.addEventListener('DOMContentLoaded', boot, { once: true });
    }

    // Fired by the router (app.js's activate()) on every real view
    // change, with the new view name right on the event — no DOM
    // re-query needed. NOTE: this is 'lw:route-changed', not
    // 'lw-page-revealed' — home.js listens for the latter but app.js
    // never actually dispatches it, so that particular listener is
    // dead code today. Using the event the router really fires here so
    // screen_view tracking works on every navigation, not just boot.
    window.addEventListener('lw:route-changed', (e) => {
        enterScreen(e.detail?.view || currentScreen());
    });

    // "exit" per the server's screen-time/drop-off model: tab hidden or
    // page actually unloading, whichever comes first, via sendBeacon so
    // it still reaches the server as the page is torn down.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') sendExit();
    });
    window.addEventListener('pagehide', sendExit);

    // Exposed so other view scripts (e.g. wherever the real location
    // search lives) can fire a 'search' event the same way — see
    // getTopSearchedAreas() in server.js, which already expects it:
    //   window.LWAnalytics.track('search', { locationKey: '...' })
    window.LWAnalytics = { track };
})();