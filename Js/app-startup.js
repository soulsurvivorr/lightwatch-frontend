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

    let refreshing = false; // guards against a reload loop

    // Whether THIS page has finished its own first paint yet. A
    // controllerchange that lands before this is true is what caused
    // the black-flash + layout "shake" on cold launches (see the big
    // comment on the controllerchange listener below) — reloading here
    // isn't skipped forever, just deferred until it's safe.
    let pageSettled = false;
    let pendingReloadAfterSettle = false;

    function markPageSettled() {
        // A further beat after 'load' so images/fonts actually finish
        // painting, not just so the event has fired.
        setTimeout(() => {
            pageSettled = true;
            if (pendingReloadAfterSettle && !refreshing) {
                refreshing = true;
                window.location.reload();
            }
        }, 600);
    }

    if (document.readyState === 'complete') {
        markPageSettled();
    } else {
        window.addEventListener('load', markPageSettled, { once: true });
    }

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
    // — this only defers the disruptive hard reload while this page is
    // still doing its own first paint. Rather than a fixed timer (which
    // could still lose the race on a slow cold start), this waits for
    // an actual "this page has settled" signal and fires the reload the
    // moment that's true — so the update is never silently lost, just
    // never allowed to collide with the initial render.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;

        if (!pageSettled) {
            pendingReloadAfterSettle = true;
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

    // ── Reliable full-screen height for mobile ─────────────────
    // Android's `100vh` / `100dvh` are meant to already track the real,
    // current viewport, but in this app's WebView (decorFitsSystemWindows
    // = true, windowSoftInputMode = adjustResize — see MainActivity.java)
    // the on-screen keyboard opening resizes the actual window, and dvh
    // doesn't reliably re-resolve back to full height once the keyboard
    // closes again. The visible symptom: tap into a field, dismiss the
    // keyboard, and a full-height layout (e.g. index.html's sign-in
    // page) stays pinned at the shorter, keyboard-open height — leaving
    // a dead gap at the bottom and a page that's oddly scrollable when
    // it should be a single static screen.
    //
    // Fix: measure the real height ourselves via visualViewport, which
    // DOES fire a reliable 'resize' event on every keyboard open/close
    // on Android even when window's own resize doesn't, and publish it
    // as a CSS custom property. Full-screen layouts should size against
    // var(--app-vh, 100dvh) instead of 100vh/100dvh directly.
    (function () {
        function setAppVh() {
            const height = window.visualViewport ? window.visualViewport.height : window.innerHeight;
            document.documentElement.style.setProperty('--app-vh', `${height}px`);
        }

        setAppVh();

        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', setAppVh);
        } else {
            window.addEventListener('resize', setAppVh);
        }

        // Orientation changes settle a beat after the event fires — an
        // immediate read here can still catch the pre-rotation size.
        window.addEventListener('orientationchange', () => {
            setTimeout(setAppVh, 200);
        });
    })();

    // ── Hardware / gesture back button (Android) ──────────────────
    const AppPlugin = window.Capacitor?.Plugins?.App;
    if (AppPlugin?.addListener) {
        AppPlugin.addListener('backButton', () => {
            // Priority 1: Close Chat if open
            const card = document.querySelector('.chat-card--mobile-open');
            if (card && typeof window.setMobileChatOpen === 'function') {
                window.setMobileChatOpen(false);
                return;
            }

            const path = window.location.pathname.toLowerCase();
            const isRoot = path.endsWith('/index.html') || path === '/' || path === '';
            const isHome = path.endsWith('/home.html');

            // Priority 2: Exit App if on Index (Login) or Home
            if (isRoot || isHome) {
                AppPlugin.exitApp();
                return;
            }

            // Priority 3: Back to Home for everything else
            const depth = window.location.pathname.split('/').filter(Boolean).length;
            const prefix = depth > 1 ? '../'.repeat(depth - 1) : './';
            window.location.replace(prefix + 'pages/home.html');
        });
    }

    // ── First-run Notification Permission ─────────────────
    (function () {
        const NOTIF_PROMPTED_KEY = 'lw_notif_first_prompt';
        if (!localStorage.getItem(NOTIF_PROMPTED_KEY)) {
            // Wait for first interaction or a short delay to ask
            setTimeout(async () => {
                if (window.enableLightWatchPush) {
                    await window.enableLightWatchPush();
                    localStorage.setItem(NOTIF_PROMPTED_KEY, '1');
                }
            }, 3000);
        }
    })();
})();
