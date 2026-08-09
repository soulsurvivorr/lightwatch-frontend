// ============================================================
//  APP.JS — SPA boot + router
//
//  This is the file that replaces "navigating to another .html
//  page" everywhere in the app. Responsibilities:
//   - Decide which view to show on cold boot (based on session).
//   - Show/hide view <section>s inside whichever shell owns them
//     (the authenticated app-shell with topbar/sidebar/bottom-nav,
//     or the public auth-shell used by login/signup/verification).
//   - Drive real browser history via pushState/popstate, so the
//     hardware/gesture back button and the browser's own Back
//     button both work the way they would on separate pages.
//   - Call each view module's mount() exactly once (first visit)
//     and show()/hide() on every visit after that, so a view's
//     polling/observers pause while it's not on screen instead of
//     running forever in the background, and its DOM listeners are
//     only ever wired once.
//
//  A view module is anything registered on window.LWViews, shaped:
//    { mount(root) {...}, show() {...}, hide() {...} }
//  mount/show/hide are all optional — a view with nothing to do on
//  one of those hooks can simply omit it.
//
//  DEPLOYMENT NOTE: this uses real pushState paths (/home, /location,
//  etc.), which means whatever serves this app needs to respond to
//  those paths with index.html too (the same fallback every
//  pushState SPA needs — e.g. a static host's "rewrite all routes
//  to index.html" option, or Capacitor's own local-file serving,
//  which already behaves this way). Opening index.html directly via
//  file:// still works for the default view; deep-linking to e.g.
//  /location over file:// won't resolve without that fallback.
// ============================================================

(function () {
    const VIEWS = {
        login:        { protected: false, publicOnly: true,  shell: 'auth', path: '/login',        title: 'LightWatch - Sign In' },
        signup:       { protected: false, publicOnly: true,  shell: 'auth', path: '/signup',       title: 'LightWatch - Sign Up' },
        verification: { protected: false, publicOnly: false, shell: 'auth', path: '/verification',  title: 'LightWatch GH' },
        home:         { protected: true,  publicOnly: false, shell: 'app',  path: '/home',          title: 'LightWatch — Home' },
        location:     { protected: true,  publicOnly: false, shell: 'app',  path: '/location',      title: 'LightWatch — Locations' },
        chat:         { protected: true,  publicOnly: false, shell: 'app',  path: '/chat',          title: 'Report — LightWatch' },
        notifications: { protected: true,  publicOnly: false, shell: 'app',  path: '/notifications', title: 'Notifications — LightWatch' },
        account:      { protected: true,  publicOnly: false, shell: 'app',  path: '/account',       title: 'Account — LightWatch' }
    };

    const PATH_TO_VIEW = Object.fromEntries(
        Object.entries(VIEWS).map(([name, cfg]) => [cfg.path, name])
    );

    window.LWViews = window.LWViews || {};

    let currentView = null;
    let appShellInitialized = false;
    const mountedViews = new Set();
    const scrollPositions = {};

    // ---- Page-switch animation (see activate()) ----
    function prefersReducedMotion() {
        return typeof window.matchMedia === 'function' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    // Play a small enter animation for incoming views.
    //
    // FIX (scroll breaks on re-entering a view, worst on Home/native
    // Android): this used to animate `transform` (translateX slide for
    // app-shell views, translateY+scale for others) on `el`, which is
    // the view <section> itself — i.e. the element that directly
    // contains the app's real scrollable content (html is the scroll
    // owner; this section is what html's scrollHeight is built from).
    // Starting a transform animation on that element promotes it to
    // its own compositor layer right as the view reappears; on Android
    // WebView, beginning (or resuming) a touch-scroll gesture while
    // that promotion/sync is happening is a known trigger for scroll
    // going sticky/non-momentum/janky — which matched the report
    // exactly: fine on cold boot (this animation is skipped then, see
    // callers), broken specifically after switching away and back,
    // and never an issue on desktop/browser testing where DevTools
    // device emulation doesn't reproduce the WebView-specific stutter.
    //
    // Animating opacity alone avoids ever touching layout/paint
    // geometry of the scroll container, so it can't interfere with
    // the scroll gesture no matter when the user starts scrolling.
    function playViewEnterAnimation(el, fromView, toView) {
        if (prefersReducedMotion() || typeof el.animate !== 'function') return;
        if (fromView === toView) return;
        try {
            el.getAnimations().forEach((a) => a.cancel());
            el.animate(
                [{ opacity: 0 }, { opacity: 1 }],
                { duration: 200, easing: 'ease-out', fill: 'both' }
            );
        } catch (err) { /* Web Animations unsupported — view just appears instantly */ }
    }

    function viewSectionEl(name) {
        return document.getElementById(`view-${name}`);
    }

    function shellEl(kind) {
        return document.getElementById(kind === 'app' ? 'appShell' : 'authShell');
    }

    function resolveViewFromLocation() {
        const path = window.location.pathname.replace(/\/index\.html$/, '/');
        return PATH_TO_VIEW[path] || null;
    }

    function setShellVisible(kind) {
        const app = shellEl('app');
        const auth = shellEl('auth');
        if (app) app.hidden = kind !== 'app';
        if (auth) auth.hidden = kind !== 'auth';
    }

    function callHook(name, hook, ...args) {
        const view = window.LWViews[name];
        if (view && typeof view[hook] === 'function') {
            try { view[hook](...args); } catch (err) { console.error(`[router] ${name}.${hook}() failed`, err); }
        }
    }

    function setupConnectionGuard() {
        const overlay = document.getElementById('lwOfflineLock');
        const retryButton = document.getElementById('lwOfflineRetryBtn');
        const status = document.getElementById('lwOfflineStatus');
        if (!overlay || !retryButton || overlay.dataset.bound === '1') return;
        overlay.dataset.bound = '1';

        let checkInFlight = false;
        let retryTimer = null;

        function setLocked(locked, message = '') {
            overlay.hidden = !locked;
            document.documentElement.classList.toggle('lw-offline-locked', locked);
            document.body.classList.toggle('lw-offline-locked', locked);
            if (message && status) status.textContent = message;
        }

        async function checkConnection() {
            if (checkInFlight) return;
            checkInFlight = true;
            if (status) status.textContent = 'Checking connection…';
            try {
                if (!navigator.onLine) throw new Error('offline');
                const response = await fetch(`${window.API_URL || ''}/`, {
                    cache: 'no-store',
                    headers: { Accept: 'application/json' }
                });
                if (!response.ok) throw new Error('backend unavailable');
                setLocked(false);
                if (retryTimer) clearInterval(retryTimer);
                retryTimer = null;
            } catch {
                setLocked(true, 'Waiting for internet access…');
                if (!retryTimer) retryTimer = setInterval(checkConnection, 15000);
            } finally {
                checkInFlight = false;
            }
        }

        window.addEventListener('offline', () => setLocked(true, 'Waiting for internet access…'));
        window.addEventListener('online', checkConnection);
        retryButton.addEventListener('click', checkConnection);
        checkConnection();
    }

    // The actual work of switching views. `push` controls whether we
    // add a new history entry (normal navigation) or just replace the
    // current one (boot, and redirects like "no session -> login").
    function activate(name, { push = true, search = '' } = {}) {
        const cfg = VIEWS[name];
        if (!cfg) { activate('home', { push }); return; }

        const session = typeof getSession === 'function' ? getSession() : null;
        const isLocal =
            location.hostname === "localhost" ||
            location.hostname === "127.0.0.1";

        if (cfg.protected && !session && !isLocal) {
            activate('login', { push: false });
            return;
        }
        if (cfg.publicOnly && session) {
            activate('home', { push: false });
            return;
        }

        if (currentView === name) {
            // Already here — still make sure history/shell state is
            // consistent (covers a hard reload landing directly on a
            // deep link), and update the URL if parameters changed.
            syncHistory(name, push, search);
            window.dispatchEvent(new CustomEvent('lw:route-changed', { detail: { view: name, search } }));
            return;
        }

        // ---- hide the outgoing view ----
        // BUGFIX: the app's real scrolling element is <html> (see
        // global.css — overflow-y:auto lives on html at every
        // breakpoint), not the individual view <section>s. Those
        // sections never scroll on their own, so reading/writing their
        // .scrollTop was always a no-op (it's a number, never null/
        // undefined, so the old `?? window.scrollY` fallback never
        // actually ran). Net effect: the saved position was always 0,
        // and — worse — the real window scroll position was never
        // reset on navigation, so switching views kept whatever
        // scrollY the previous view was left at, making every other
        // view open "pre-scrolled". Read/restore window scroll instead.
        const scrollEl = document.scrollingElement || document.documentElement;
        const cameFromAppShell = !!(currentView && VIEWS[currentView] && VIEWS[currentView].shell === 'app');
        if (currentView) {
            const outgoingSection = viewSectionEl(currentView);
            if (outgoingSection) {
                // FIX: only the incoming section's animations were ever
                // canceled. If you navigate away again while this
                // section's own 200ms enter-fade was still running, the
                // animation kept running (fill:'both') on a now-hidden
                // element instead of being torn down — harmless to look
                // at, but it's an animation that outlives its section
                // and could still be "finished-but-attached" the next
                // time this section becomes the incoming one, ahead of
                // the fresh cancel() in playViewEnterAnimation. Cancel
                // here too so hiding a view always leaves it clean.
                if (typeof outgoingSection.getAnimations === 'function') {
                    outgoingSection.getAnimations().forEach((a) => a.cancel());
                }
                scrollPositions[currentView] = scrollEl.scrollTop || window.scrollY || 0;
                outgoingSection.hidden = true;
            }
            callHook(currentView, 'hide');
        } else {
            // First activation this page-load (cold boot / hard refresh).
            // The raw HTML leaves some sections without a `hidden`
            // attribute by default (e.g. #view-login, #view-home) so
            // whichever one JS decides to show first appears without a
            // flash. That means every *other* section needs to be hidden
            // explicitly here, or a stray "visible" section lingers in
            // the DOM — invisible on screen (its parent shell may be
            // hidden), but still matched by CSS like
            // html:has(#view-login:not([hidden])), which doesn't care
            // about ancestor visibility. Left unhandled, that either
            // locks page scroll forever (the login case) or lets a
            // leftover view's content/skeleton render underneath the
            // view a deep link/refresh actually landed on.
            Object.keys(VIEWS).forEach((viewName) => {
                if (viewName === name) return;
                const section = viewSectionEl(viewName);
                if (section) section.hidden = true;
            });
        }

        // ---- switch shells if needed ----
        const enteringAppShellFirstTime = cfg.shell === 'app' && !appShellInitialized;
        setShellVisible(cfg.shell);
        if (enteringAppShellFirstTime) {
            appShellInitialized = true;
            if (typeof window.LWProfile?.init === 'function') window.LWProfile.init();
        }

        // ---- show the incoming view ----
        const incomingSection = viewSectionEl(name);
        if (incomingSection) incomingSection.hidden = false;

        if (!mountedViews.has(name)) {
            mountedViews.add(name);
            callHook(name, 'mount', incomingSection);
        }
        callHook(name, 'show');

        if (typeof bindSignOutButtons === 'function') bindSignOutButtons(incomingSection || document);

        // BUGFIX (see note above): restore the real window scroll
        // position instead of the section's own (always-0) scrollTop.
        const restoreScroll = scrollPositions[name] || 0;
        window.scrollTo(0, restoreScroll);
        if (scrollEl) scrollEl.scrollTop = restoreScroll;

        // Nice-to-have page-switch animation: a quick fade + rise on
        // the incoming view, tab-bar style (subtle, not a full slide —
        // the outgoing view is already unmounted by the time this
        // runs, since it shares the same scroll-locking machinery
        // several views rely on, so a true two-panel overlap slide
        // isn't safe to add here without touching that). Only between
        // app-shell views (not the auth flow), never on cold boot, and
        // never if the OS/browser asks for reduced motion.
        if (incomingSection && cameFromAppShell && cfg.shell === 'app') {
            playViewEnterAnimation(incomingSection, currentView, name);
        }

        currentView = name;
        document.title = cfg.title;

        syncHistory(name, push, search);

        window.dispatchEvent(new CustomEvent('lw:route-changed', { detail: { view: name } }));
    }

    function syncHistory(name, push, search = '') {
        const cfg = VIEWS[name];
        const state = { view: name, search };
        const url = cfg.path + (search || '');
        const currentUrl = window.location.pathname + window.location.search;
        const canUseHistory = window.location.protocol !== 'file:' && window.location.origin && window.location.origin !== 'null';

        if (!canUseHistory) {
            return;
        }

        if (push && currentUrl !== url) {
            window.history.pushState(state, '', url);
        } else if (currentUrl !== url) {
            window.history.replaceState(state, '', url);
        }
    }

    // `search` (e.g. "?chatId=abc&chatScope=global") is optional and is
    // used for deep links (a push notification opening a specific
    // chat thread on the home view) — the target view's own mount()
    // reads it back via new URLSearchParams(window.location.search).
    function navigate(name, { replace = false, search = '' } = {}) {
        activate(name, { push: !replace, search });
    }

    window.addEventListener('popstate', (e) => {
        const name = e.state?.view || resolveViewFromLocation() || 'home';
        activate(name, { push: false });
    });

    // Hardware/gesture back: go to the browser's real previous entry
    // when there is one (so it lines up with what the on-screen Back
    // gesture would do); otherwise fall back to exiting on root/home
    // or landing on home from anywhere else — same priority order the
    // original per-page back-button handler used.
    function handleHardwareBack() {
        if (currentView === 'login' || currentView === 'home') {
            window.Capacitor?.Plugins?.App?.exitApp?.();
            return;
        }
        if (window.history.length > 1) {
            window.history.back();
        } else {
            navigate('home');
        }
    }

    window.LWRouter = { navigate, handleHardwareBack, get currentView() { return currentView; } };

    // ---- Pull-to-refresh ----
    // FIX: there was no pull-to-refresh anywhere — what people felt as
    // "pull to refresh" was just the OS/webview's native overscroll
    // bounce, which doesn't run any app code at all. This wires up a
    // real one, scoped to the app shell's protected views (not the
    // auth flow), that on release:
    //   1. asks push.js's checkForAppUpdate() to check for (and, if
    //      found, activate) a new service worker — if one activates,
    //      push.js's controllerchange listener reloads the tab once,
    //      so a pull-to-refresh is now also how someone can manually
    //      pull the latest deployed app code instead of waiting on a
    //      relaunch;
    //   2. calls the current view's own refresh() hook if it has one
    //      (falling back to show(), which most views already use to
    //      re-fetch on becoming visible), so pulling down also refetches
    //      this screen's live data, not just app code;
    //   3. dispatches 'lw:pull-refresh' so any view/module can hook in
    //      without needing a formal refresh() method.
    // `html` is the real scroll owner (see playViewEnterAnimation's
    // comment above) so "at the top" is checked against
    // documentElement.scrollTop, same as the scroll-restore code above.
    (function setupPullToRefresh() {
        const THRESHOLD = 72;   // px of pull before release triggers a refresh
        const MAX_PULL = 120;   // px, with resistance past this point
        const MIN_VISIBLE_MS = 450; // keep the indicator up briefly so a fast refresh doesn't just flash

        let indicatorEl = null;
        let startY = null;
        let pulling = false;
        let currentPull = 0;
        let refreshInFlight = false;

        function ensureIndicator() {
            if (indicatorEl) return indicatorEl;
            if (!document.getElementById('lwPullToRefreshStyles')) {
                const style = document.createElement('style');
                style.id = 'lwPullToRefreshStyles';
                style.textContent = `
                    #lwPullToRefresh {
                        position: fixed; top: 0; left: 50%;
                        width: 34px; height: 34px; margin-left: -17px;
                        display: flex; align-items: center; justify-content: center;
                        border-radius: 50%;
                        background: var(--surface, #1C1F26);
                        box-shadow: 0 2px 10px rgba(0,0,0,0.25);
                        transform: translateY(-48px);
                        transition: transform 0.15s ease-out, opacity 0.15s ease-out;
                        opacity: 0;
                        z-index: 9998;
                        pointer-events: none;
                    }
                    #lwPullToRefresh svg { animation: lwPullSpin 0.8s linear infinite; }
                    #lwPullToRefresh.lw-ptr--ready svg { animation-play-state: paused; }
                    @keyframes lwPullSpin { to { transform: rotate(360deg); } }
                `;
                document.head.appendChild(style);
            }
            const el = document.createElement('div');
            el.id = 'lwPullToRefresh';
            el.innerHTML = `<svg viewBox="0 0 20 20" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <circle cx="10" cy="10" r="7.5" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>
                <path d="M10 2.5a7.5 7.5 0 0 1 7.5 7.5" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
            </svg>`;
            document.body.appendChild(el);
            indicatorEl = el;
            return el;
        }

        function isEligible() {
            const appShell = shellEl('app');
            if (!appShell || appShell.hidden) return false; // auth views (login/signup/etc.) are excluded
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;
            return scrollTop <= 0;
        }

        function setPull(distance) {
            currentPull = distance;
            const el = ensureIndicator();
            const eased = Math.min(distance, MAX_PULL);
            el.style.opacity = String(Math.min(eased / THRESHOLD, 1));
            el.style.transform = `translateY(${-48 + eased}px)`;
            el.classList.toggle('lw-ptr--ready', distance >= THRESHOLD);
        }

        function resetPull() {
            pulling = false;
            startY = null;
            currentPull = 0;
            if (indicatorEl) {
                indicatorEl.style.opacity = '0';
                indicatorEl.style.transform = 'translateY(-48px)';
                indicatorEl.classList.remove('lw-ptr--ready');
            }
        }

        async function runRefresh() {
            refreshInFlight = true;
            const el = ensureIndicator();
            el.classList.remove('lw-ptr--ready'); // resume spin to show work happening
            el.style.opacity = '1';
            el.style.transform = 'translateY(16px)';

            const started = Date.now();
            try {
                const updateFound = typeof window.checkForAppUpdate === 'function'
                    ? await window.checkForAppUpdate().catch(() => false)
                    : false;

                // If an update was found, push.js's controllerchange listener
                // will reload this tab shortly on its own — no need to also
                // refetch view data that's about to be thrown away.
                if (!updateFound) {
                    callHook(currentView, 'refresh');
                    if (!(window.LWViews[currentView] && typeof window.LWViews[currentView].refresh === 'function')) {
                        callHook(currentView, 'show');
                    }
                    window.dispatchEvent(new CustomEvent('lw:pull-refresh', { detail: { view: currentView } }));
                }
            } finally {
                const elapsed = Date.now() - started;
                const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);
                setTimeout(() => {
                    refreshInFlight = false;
                    resetPull();
                }, wait);
            }
        }

        window.addEventListener('touchstart', (e) => {
            if (refreshInFlight) return;
            if (!isEligible()) return;
            if (e.touches.length !== 1) return;
            startY = e.touches[0].clientY;
            pulling = true;
        }, { passive: true });

        window.addEventListener('touchmove', (e) => {
            if (!pulling || startY == null || refreshInFlight) return;
            if (!isEligible()) { resetPull(); return; }
            const delta = e.touches[0].clientY - startY;
            if (delta <= 0) { setPull(0); return; }
            // Prevent the native overscroll bounce from fighting the
            // custom indicator once an actual pull is in progress.
            if (delta > 8 && e.cancelable) e.preventDefault();
            // Resistance past MAX_PULL so it doesn't feel infinite.
            const eased = delta <= MAX_PULL ? delta : MAX_PULL + (delta - MAX_PULL) * 0.15;
            setPull(eased);
        }, { passive: false });

        window.addEventListener('touchend', () => {
            if (!pulling || refreshInFlight) return;
            pulling = false;
            if (currentPull >= THRESHOLD) {
                runRefresh();
            } else {
                resetPull();
            }
        }, { passive: true });

        window.addEventListener('touchcancel', () => {
            if (!refreshInFlight) resetPull();
        }, { passive: true });
    })();

    // ---- Boot ----
    function boot() {
        setupConnectionGuard();
        if (typeof LWNav !== 'undefined') LWNav.initNav();
        if (typeof initToastComponent === 'function') initToastComponent();
        if (typeof initAppBoot === 'function') initAppBoot();

        const session = typeof getSession === 'function' ? getSession() : null;
        const deepLinkView = resolveViewFromLocation();
        const initialSearch = window.location.search;

        let initial;

        if (deepLinkView) {
            initial = deepLinkView;
        } else {
            initial = session ? "home" : "login";
        }

        activate(initial, { push: false, search: initialSearch });

        const shouldWaitForOnboarding = initial === 'login' && typeof window.LWOnboarding?.init === 'function';

        // NOTE: no loading class gets added here. activate() above already
        // ran synchronously — if it entered the app shell for the first
        // time this page-load, that call chain (LWProfile.init() ->
        // loadCurrentUserProfile() -> showProfileLoader(), all synchronous
        // up to their first await) has already decided whether the
        // full-page skeleton belongs on screen, based on whether there's
        // real cached data ready to paint right now (see profile.js's
        // hasReadyToPaintData()) — not a one-time "has this device ever
        // booted" flag, so the skeleton correctly comes back on a reload
        // once the cache has actually gone stale. Keeping the decision in
        // one place avoids the two ever disagreeing about which class
        // name to use.

        if (shouldWaitForOnboarding) {
            window.LWOnboarding.init();
        } else {
            requestAnimationFrame(() => {
                document.documentElement.classList.remove("lw-boot");
            });
        }
    } // end of boot function

    // ---- Topbar hide/show on scroll ----
    // Hide topbar when scrolling down, show when scrolling up
    let lastScrollTop = 0;
    let scrollTimeout;
    const topbar = document.querySelector('.topbar');

    function handleHeaderScroll() {
        if (!topbar) return;

        const currentScroll = window.pageYOffset || document.documentElement.scrollTop;

        if (currentScroll > lastScrollTop && currentScroll > 80) {
            // Scrolling DOWN - hide header
            topbar.style.transform = 'translateY(-100%)';
            topbar.style.opacity = '0';
        } else {
            // Scrolling UP or at top - show header
            topbar.style.transform = 'translateY(0)';
            topbar.style.opacity = '1';
            topbar.style.boxShadow = currentScroll > 20 ? '0 4px 20px rgba(0,0,0,0.15)' : 'none';
        }

        lastScrollTop = currentScroll <= 0 ? 0 : currentScroll;
    }

    // Enable on desktop and tablet (min-width: 769px)
    function enableHeaderScroll() {
        if (window.innerWidth >= 769) {
            window.addEventListener('scroll', handleHeaderScroll, { passive: true });
        } else {
            topbar.style.transform = 'translateY(0)';
            topbar.style.opacity = '1';
            window.removeEventListener('scroll', handleHeaderScroll);
        }
    }

    window.addEventListener('resize', enableHeaderScroll);

    // Move the activation and class removal inside the boot function
    // by placing them at the end of the boot function itself.

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            boot();
            enableHeaderScroll();
        });
    } else {
        boot();
        enableHeaderScroll();
    }
})();