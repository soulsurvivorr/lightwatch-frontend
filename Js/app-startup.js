// ============================================================
//  APP-STARTUP.JS — LightWatch
//  Load this on EVERY page, near the top of <body> (or with
//  `defer` in <head>), on every platform: iOS Safari Home
//  Screen, Android Chrome/Samsung Internet, desktop browsers.
//
//  Responsibilities:
//   - register the service worker
//   - force a fresh update check on every app open/resume
//   - detect a newly installed worker and activate it immediately
//   - reload the page exactly once so the new version takes over
//
//  No UI prompt, no manual refresh — updates apply themselves.
// ============================================================

(function () {
    if (!('serviceWorker' in navigator)) return;

    const SW_URL = '/service-worker.js';
    // How often to re-check for an update while the app stays open.
    // Cheap: registration.update() only re-fetches service-worker.js
    // itself (bypassing HTTP cache) and compares it byte-for-byte.
    const UPDATE_CHECK_INTERVAL_MS = 60 * 1000;

    // How long after this script starts running a controllerchange is
    // still considered part of the initial load rather than a genuine
    // mid-session update. See the controllerchange listener below for
    // why this exists.
    const COLD_START_GRACE_MS = 2500;
    const scriptStartedAt = Date.now();

    let refreshing = false; // guards against a reload loop

    function activateWaitingWorker(registration) {
        if (!registration.waiting) return;
        // Tell the waiting worker to stop waiting and take over now.
        registration.waiting.postMessage('SKIP_WAITING');
    }

    function watchForUpdates(registration) {
        // Case 1: an update was already found before we attached this
        // listener (e.g. it finished installing while the tab was
        // backgrounded on iOS). Activate it right away.
        if (registration.waiting && registration.active) {
            activateWaitingWorker(registration);
        }

        // Case 2: a new worker starts installing during this session.
        registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (!newWorker) return;

            newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    // There's an existing controller, so this is a real
                    // update (not the very first install) — activate now.
                    activateWaitingWorker(registration);
                }
            });
        });
    }

    async function registerServiceWorker() {
        try {
            const registration = await navigator.serviceWorker.register(SW_URL, { scope: '/' });
            watchForUpdates(registration);

            // Force an immediate check every time the app starts, on
            // every platform — this is the piece iOS needs most, since
            // standalone Home Screen apps don't reliably background-check.
            registration.update().catch(() => {});

            // Re-check whenever the app is brought back to the foreground
            // (covers iOS home-screen resume, tab refocus, alt-tab, etc).
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    registration.update().catch(() => {});
                }
            });

            // Covers the iOS/Safari back-forward cache case, where the
            // page is restored without re-running from scratch.
            window.addEventListener('pageshow', (event) => {
                if (event.persisted) {
                    registration.update().catch(() => {});
                }
            });

            // Belt-and-suspenders periodic check for long-lived sessions.
            setInterval(() => {
                if (document.visibilityState === 'visible') {
                    registration.update().catch(() => {});
                }
            }, UPDATE_CHECK_INTERVAL_MS);

        } catch (err) {
            console.warn('[app-startup] service worker registration failed', err);
        }
    }

    // Once the new worker takes control, reload so every open tab/window
    // is running the new HTML + assets together. Guarded so a burst of
    // controllerchange events can't cause a reload loop.
    //
    // NOT guarded, until now, against controllerchange firing as part of
    // this very page's OWN initial load — watchForUpdates()'s "Case 1"
    // above can activate an already-waiting worker the instant
    // registration.update() resolves, which on a cold launch can be
    // within the same tick as this script running at all. The longer
    // the app had been closed, the more likely a new deploy was already
    // waiting, so window.location.reload() was firing while the page
    // was still mid-render — tearing it down and restarting it from
    // scratch a moment after first paint. That collision is what showed
    // up as a black flash + brief layout "shake" specifically on
    // long-closed reopens, and for the same reason on any fresh
    // navigation to a page that registers this script (e.g. right after
    // verification.html hands off to home.html).
    //
    // The new worker is still activated either way (see Case 1/2 above)
    // — this only skips the disruptive hard reload for a controllerchange
    // that lands inside this page's own startup window. The update takes
    // over cleanly on the next real navigation instead, or via the
    // periodic/visibilitychange checks below if the user stays on this
    // page a while.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;

        if (Date.now() - scriptStartedAt < COLD_START_GRACE_MS) {
            return;
        }

        refreshing = true;
        window.location.reload();
    });

    if (document.readyState === 'complete') {
        registerServiceWorker();
    } else {
        window.addEventListener('load', registerServiceWorker);
    }
})();