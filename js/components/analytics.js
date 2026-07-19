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
