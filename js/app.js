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

    // Play a small enter animation for incoming views. For app-shell
    // views we use a horizontal swipe determined by a canonical
    // ordering (so nav feels like sliding between tabs). Non-app
    // transitions fall back to a subtle rise/fade.
    const APP_VIEW_ORDER = ['home', 'location', 'chat', 'notifications', 'account'];
    function playViewEnterAnimation(el, fromView, toView) {
        if (prefersReducedMotion() || typeof el.animate !== 'function') return;
        try {
            el.getAnimations().forEach((a) => a.cancel());
            // If both views are in our app order list we animate a
            // horizontal slide. Direction is based on their index.
            const fromIdx = APP_VIEW_ORDER.indexOf(fromView);
            const toIdx = APP_VIEW_ORDER.indexOf(toView);
            const bothInOrder = fromIdx >= 0 && toIdx >= 0 && fromView !== toView;

            if (bothInOrder) {
                const dir = toIdx >= fromIdx ? 1 : -1;
                el.animate(
                    [
                        { opacity: 0, transform: `translateX(${20 * dir}%)` },
                        { opacity: 1, transform: 'translateX(0)' }
                    ],
                    { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' }
                );
            } else {
                el.animate(
                    [
                        { opacity: 0, transform: 'translateY(14px) scale(0.985)' },
                        { opacity: 1, transform: 'translateY(0) scale(1)' }
                    ],
                    { duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' }
                );
            }
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

    // ---- Boot ----
    function boot() {
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