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
//  DEPLOYMENT NOTE: this uses real pushState paths (/home, /areas,
//  etc.), which means whatever serves this app needs to respond to
//  those paths with index.html too (the same fallback every
//  pushState SPA needs — e.g. a static host's "rewrite all routes
//  to index.html" option, or Capacitor's own local-file serving,
//  which already behaves this way). Opening index.html directly via
//  file:// still works for the default view; deep-linking to e.g.
//  /areas over file:// won't resolve without that fallback.
// ============================================================

(function () {
    const VIEWS = {
        login:        { protected: false, publicOnly: true,  shell: 'auth', path: '/login',        title: 'LightWatch - Sign In' },
        signup:       { protected: false, publicOnly: true,  shell: 'auth', path: '/signup',       title: 'LightWatch - Sign Up' },
        verification: { protected: false, publicOnly: false, shell: 'auth', path: '/verification',  title: 'LightWatch GH' },
        home:         { protected: true,  publicOnly: false, shell: 'app',  path: '/home',          title: 'LightWatch — Home' },
        areas:        { protected: true,  publicOnly: false, shell: 'app',  path: '/areas',         title: 'LightWatch — Areas' },
        chat:         { protected: true,  publicOnly: false, shell: 'app',  path: '/chat',          title: 'Report — LightWatch' },
        reports:      { protected: true,  publicOnly: false, shell: 'app',  path: '/reports',       title: 'Notifications — LightWatch' },
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
            // deep link), but skip the hide/show/mount dance.
            syncHistory(name, push);
            return;
        }

        // ---- hide the outgoing view ----
        if (currentView) {
            const outgoingSection = viewSectionEl(currentView);
            if (outgoingSection) {
                scrollPositions[currentView] = outgoingSection.scrollTop ?? window.scrollY;
                outgoingSection.hidden = true;
            }
            callHook(currentView, 'hide');
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

        const restoreScroll = scrollPositions[name] || 0;
        if (incomingSection) incomingSection.scrollTop = restoreScroll;

        currentView = name;
        document.title = cfg.title;

        syncHistory(name, push, search);

        window.dispatchEvent(new CustomEvent('lw:route-changed', { detail: { view: name } }));
    }

    function syncHistory(name, push, search = '') {
        const cfg = VIEWS[name];
        const state = { view: name };
        const url = cfg.path + (search || '');
        if (push && window.history.state?.view !== name) {
            window.history.pushState(state, '', url);
        } else if (window.history.state?.view !== name || window.location.pathname !== cfg.path) {
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

        let initial;

        if (deepLinkView) {
            initial = deepLinkView;
        } else {
            initial = session ? "home" : "login";
        }

        activate(initial, { push: false });
        document.documentElement.classList.remove("lw-boot");
    } // end of boot function

    // Move the activation and class removal inside the boot function
    // by placing them at the end of the boot function itself.

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
