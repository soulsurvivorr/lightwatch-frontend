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
    const isNative = Boolean(window.Capacitor?.isNativePlatform?.());

    // Native app builds (Capacitor) already ship fully current HTML/CSS/JS
    // in every install — build.js copies the latest source into www/ right
    // before `npx cap sync android`, so the bundled assets are never stale.
    // The Service Worker below exists to solve a browser/PWA problem (how
    // does an already-open tab get new code without a reinstall) that
    // doesn't apply here, and registering one anyway is actively harmful:
    // once registered, its Cache Storage persists across app updates —
    // installing a new APK over an old one does NOT clear Cache Storage,
    // only a full uninstall does — so a page cached once, early on, can
    // keep being served on top of every later rebuild indefinitely. That's
    // what was causing signup.html's user-icon-container block (added
    // after the first native install) to be missing only in the app and
    // never on the website. Skip SW registration entirely on native —
    // everything below this block (back button handling) still runs
    // either way.
    if (!isNative && 'serviceWorker' in navigator) {
        setUpServiceWorker();
    } else if (isNative && 'serviceWorker' in navigator) {
        // One-time cleanup for devices that already installed a build
        // from before this fix and picked up a Service Worker + stale
        // Cache Storage. Unregistering it and clearing its caches here
        // means those devices self-heal on their next app open instead
        // of needing a full uninstall/reinstall to see current content.
        navigator.serviceWorker.getRegistrations()
            .then(regs => Promise.all(regs.map(reg => reg.unregister())))
            .catch(() => {});
        if (window.caches?.keys) {
            caches.keys()
                .then(keys => Promise.all(keys.map(key => caches.delete(key))))
                .catch(() => {});
        }
    }

    function setUpServiceWorker() {
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
    } // end setUpServiceWorker

    // ── Hardware / gesture back button (Android) ──────────────────
    // There was no listener for this anywhere in the app. Every page
    // here is a real, separate HTML file (not an SPA route), so the
    // default WebView back button just walks its own internal
    // navigation history — which is exactly what's unreliable for a
    // multi-page app like this: depending on how a page was reached
    // (replace() vs href, a bfcache restore, a forced reload), that
    // history stack doesn't always contain what you'd expect, so back
    // could land anywhere from "does nothing" to "exits the app" to
    // "goes to a stale page in a way that reopens things it shouldn't."
    //
    // This makes it explicit and deterministic instead: on any page
    // except the true entry point (index.html), back always takes you
    // to index.html. On index.html itself, back exits the app (the
    // normal, expected behavior for an app's home/root screen).
    //
    // This does NOT set lw_skip_onboarding_once — that flag is
    // reserved for the sign-out flow specifically. Landing on
    // index.html this way still goes through onboarding.js's normal
    // once-per-session gate (lw_onboarding_shown_session), so if
    // onboarding already ran earlier this session, it correctly won't
    // reopen; if this is the very first screen the person ever hit
    // (e.g. they backed out of signup before onboarding ever showed),
    // it correctly still will.
    const AppPlugin = window.Capacitor?.Plugins?.App;
    if (AppPlugin?.addListener) {
        AppPlugin.addListener('backButton', () => {
            const path = window.location.pathname.toLowerCase();
            const isRoot = path.endsWith('/index.html') || path === '/' || path === '';

            if (isRoot) {
                AppPlugin.exitApp();
                return;
            }

            const depth = window.location.pathname.split('/').filter(Boolean).length;
            const prefix = depth > 1 ? '../'.repeat(depth - 1) : './';
            window.location.replace(prefix + 'index.html');
        });
    }
})();