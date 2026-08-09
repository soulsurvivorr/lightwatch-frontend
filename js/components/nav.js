// ============================================================
//  COMPONENTS/NAV.JS
//  Dropdown nav visibility (mobile hides Alerts/Account since the
//  bottom bar covers them) + active-link highlighting + bottom-nav
//  badges/dots (unread messages, "enable notifications" prompt,
//  nearby outage).
//
//  Changed vs. the original nav.js:
//   - The click-triggered boot-loader/"lightning transition" is
//     gone. That existed to paper over the blank gap while a real
//     new HTML document loaded. Switching views in the SPA is
//     synchronous DOM show/hide — there is no gap to paper over.
//   - Every nav link and bottom-nav link now carries
//     data-route="<view>" instead of href="somepage.html". Clicks
//     are handled here by calling window.LWRouter.navigate(); the
//     router itself fires the 'lw:route-changed' event this file
//     listens for to refresh which link is marked active (instead
//     of re-deriving it from location.pathname, which no longer
//     changes shape per page).
//   - New: bottom-nav badge + toast on "reports" (notification.png).
//       Both driven by the same GET /reports poll:
//       1. Numeric badge = count of unseen items since you last
//          opened that tab — replies to you, chat messages in your
//          own location, and light-status changes at your location
//          (the 'reply'/'chat'/'success'/'warning' types GET /reports
//          already returns).
//       2. A toast (window.lwToast) fires once per new item the
//          first time it's seen, phrased per type — e.g. "anon-
//          drift-453 replied to your message in Everyone" for a
//          reply, or the location's own status text for a light
//          change. Dedup is tracked separately from the "last seen"
//          timestamp (localStorage id list, same pattern reports.js
//          already uses for matched news) so a toast never repeats
//          across polls.
//       3. A dot on "reports" AND "account" ("Me") — shown while
//          push notifications haven't been enabled yet.
//     Dropped the earlier standalone "location" outage dot — it was a
//     stand-in (there's no real "nearby location" backend concept yet)
//     and duplicated what the reports badge/toast now covers for the
//     user's own location. A real "location near me" indicator can come
//     back once there's an endpoint for it.
//     Reads/writes only the data-nav-badge / data-nav-dot elements
//     already sitting in the bottom-nav markup — doesn't touch
//     applyActiveNav/bindRouteLinks' own logic above.
// ============================================================

const PHONE_NAV_MAX_WIDTH = 540;
const HAMBURGER_NAV_MAX_WIDTH = 1023;
const MOBILE_BREAKPOINT = PHONE_NAV_MAX_WIDTH;
let hamburgerMenuBound = false;

function isHamburgerViewport() {
    const width = window.innerWidth || 0;
    return width > PHONE_NAV_MAX_WIDTH && width <= HAMBURGER_NAV_MAX_WIDTH;
}

function closeTopbarHamburgerMenu() {
    const menu = document.getElementById('topbarHamburgerMenu');
    const btn = document.getElementById('topbarHamburgerBtn');
    if (!menu || !btn) return;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
}

function toggleTopbarHamburgerMenu() {
    const menu = document.getElementById('topbarHamburgerMenu');
    const btn = document.getElementById('topbarHamburgerBtn');
    if (!menu || !btn || !isHamburgerViewport()) {
        closeTopbarHamburgerMenu();
        return;
    }
    const nextOpen = menu.hidden;
    menu.hidden = !nextOpen;
    btn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
}

function applyNavVisibility() {
    const isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
    const navLinks = document.querySelectorAll('#primaryNav .nav__link');

    navLinks.forEach(link => {
        const section = link.dataset.nav;
        if (isMobile) {
            const allowedOnMobile = section === "home" || section === "location" || section === "reports" || section === "chat";
            link.style.display = allowedOnMobile ? "" : "none";
        } else {
            link.style.display = "";
        }
    });
}

function applyActiveNav(section) {
    document.querySelectorAll('#primaryNav .nav__link').forEach(link => {
        const isActive = link.dataset.nav === section;
        link.classList.toggle('nav__link--active', isActive);
        if (isActive) {
            link.setAttribute('aria-current', 'page');
        } else {
            link.removeAttribute('aria-current');
        }
    });
    document.querySelectorAll('.bottom-nav-link[data-nav]').forEach(link => {
        const isActive = link.dataset.nav === section;
        link.classList.toggle('bottom-nav-link--active', isActive);
        if (isActive) {
            link.setAttribute('aria-current', 'page');
        } else {
            link.removeAttribute('aria-current');
        }
    });
    document.querySelectorAll('.lw-icon-btn[data-nav], .community-banner__icon-btn[data-nav], .lw-header-avatar-btn[data-nav]').forEach(link => {
        const isActive = link.dataset.nav === section;
        link.classList.toggle('is-active', isActive);
        if (isActive) {
            link.setAttribute('aria-current', 'page');
        } else {
            link.removeAttribute('aria-current');
        }
    });
    document.querySelectorAll('.topbar__hamburger-link[data-nav]').forEach(link => {
        const isActive = link.dataset.nav === section;
        link.classList.toggle('is-active', isActive);
        if (isActive) {
            link.setAttribute('aria-current', 'page');
        } else {
            link.removeAttribute('aria-current');
        }
    });
}

// ── Report page panel switching (News / Community) ──────────────
// The actual switching lives in chat.js's activateReportTab (it does
// more than a plain show/hide — scroll-to-bottom, live polling,
// nav-highlight sync). The bug was that chat.js's own
// 'lw:route-changed' listener unconditionally reset every fresh
// arrival at /chat back to 'news', with no way to know a specific
// panel had just been requested — so it always won the race against
// whatever this file tried to activate, regardless of order. Setting
// window.__lwPendingReportPanel right before navigate() lets that
// listener respect the actual request (see chat.js) instead of
// fighting it. This still calls activate() directly too, for instant
// feedback rather than waiting on the route-changed round trip.
function activateReportPanel(panel) {
    window.__lwPendingReportPanel = panel === 'community' ? 'community' : 'news';
    if (typeof window.LWReportTabs?.activate === 'function') {
        window.LWReportTabs.activate(panel);
    }
}

function bindRouteLinks() {
    // '#primaryNav .nav__link' is the desktop topbar nav — it was never
    // being queried here, only the mobile '.bottom-nav-link' elements
    // were, so clicking Home/Locations/Report/Reports/Account in the
    // desktop topbar had no listener attached and did nothing.
    //
    // '.lw-icon-btn' / '.lw-header-avatar-btn' (the header bell +
    // avatar added by the Home redesign) were never queried here
    // either — that's the actual reason tapping them didn't open
    // Notifications/Account, not their tag name. Added below.
    document.querySelectorAll(
        '.bottom-nav-link[data-nav], #primaryNav .nav__link[data-nav], .lw-icon-btn[data-nav], .community-banner__icon-btn[data-nav], .lw-header-avatar-btn[data-nav], .lw-section__viewall[data-route], .topbar__hamburger-link[data-route], .topbar__hamburger-link[data-action], [data-route][data-map-mode]'
    ).forEach(link => {
        if (link.dataset.navBound === '1') return;
        link.dataset.navBound = '1';
        link.addEventListener('click', (e) => {
            // If a specific panel is requested (data-panel) while
            // routing to the report view, allow the handler to open
            // that panel once navigation completes. Otherwise behave
            // as before.
            const view = link.dataset.route || link.dataset.nav;
            if (!view) return;

            applyActiveNav(link.dataset.nav || view);

            const panel = link.dataset.panel;

            if (link.hasAttribute('data-route')) {
                e.preventDefault();
                if (typeof window.LWRouter?.navigate === 'function') {
                    // Set before navigate() so listeners on the destination
                    // view can honor the requested sub-mode (e.g. open the
                    // Heat Map when navigating to Location).
                    if (panel && view === 'chat') {
                        window.__lwPendingReportPanel = panel;
                    }
                    // Same pattern as the report-panel one above: the
                    // Notifications view's settings-gear icon carries
                    // data-panel="notifications" so account.js's show()
                    // hook knows to scroll to and highlight the
                    // Notifications settings card instead of just landing
                    // at the top of the account page.
                    if (panel && view === 'account') {
                        window.__lwPendingAccountPanel = panel;
                    }
                    const mapMode = link.dataset.mapMode;
                    if (mapMode && view === 'location') {
                        window.__lwPendingMapMode = mapMode;
                    }
                    window.LWRouter.navigate(view);
                    // Also activate directly for instant feedback rather
                    // than waiting on the route-changed round trip.
                    if (panel && view === 'chat') {
                        activateReportPanel(panel);
                    }
                }
            } else if (link.dataset.action === 'report-elevated') {
                // Elevated CTA shouldn't auto-navigate; instead open the
                // community report compose flow. Let chat.js decide how to
                // handle a quick-report action by dispatching a custom event.
                e.preventDefault();
                window.dispatchEvent(new CustomEvent('lw:report-elevated-click'));
            }

            closeTopbarHamburgerMenu();
        });
    });
}

function bindTopbarHamburger() {
    if (hamburgerMenuBound) return;
    const btn = document.getElementById('topbarHamburgerBtn');
    const menu = document.getElementById('topbarHamburgerMenu');
    if (!btn || !menu) return;

    hamburgerMenuBound = true;

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleTopbarHamburgerMenu();
    });

    menu.addEventListener('click', (e) => {
        if (e.target && e.target.closest('.topbar__hamburger-link')) {
            closeTopbarHamburgerMenu();
        }
    });

    document.addEventListener('click', (e) => {
        if (!menu || menu.hidden) return;
        const inMenu = e.target && e.target.closest('#topbarHamburgerMenu');
        const inButton = e.target && e.target.closest('#topbarHamburgerBtn');
        if (!inMenu && !inButton) closeTopbarHamburgerMenu();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeTopbarHamburgerMenu();
    });

    window.addEventListener('resize', () => {
        if (!isHamburgerViewport()) closeTopbarHamburgerMenu();
    });
}

// ── Bottom-nav badge (Reports tab) ────────────────
// NOTE: this used to run its own full reports-badge poll+toast
// subsystem (refreshReportsBadge / startNavBadgePolling), on the
// same POLL_INTERVAL_FAST_MS cadence as components/nav-badges.js's
// checkCommunity(). Both hit GET /reports?includeCommunity=1 — the
// most expensive report endpoint on the backend (fans out into 4
// concurrent Mongo queries) — every 30s, independently, for as long
// as the app was open, on every signed-in device. On top of that,
// this file's target element (`[data-nav="reports"]` /
// `[data-nav-badge="reports"]`) doesn't exist anywhere in index.html
// — there's no bottom-nav item named "reports" — so this whole poll
// loop was firing a real network request every 30s purely to render
// into elements that were never on the page. nav-badges.js is the
// one actually wired to something real (the notifications badge —
// [data-nav-badge="notifications"] does exist), so that one stays
// as the single source of truth for this data. setNavBadge/setNavDot
// below are kept — they're small, reusable, and setNavDot('account', …)
// via refreshPushPromptDot is still real — just the reports-specific
// polling/toast machinery that duplicated nav-badges.js is gone.
function setNavBadge(name, count) {
    const link = document.querySelector(`.bottom-nav-link[data-nav="${name}"]`);
    const badge = link?.querySelector(`.bottom-nav-badge[data-nav-badge="${name}"]`);
    if (!badge) return;
    if (count > 0) {
        badge.textContent = count > 9 ? '9+' : String(count);
        badge.hidden = false;
    } else {
        badge.hidden = true;
    }
}

function setNavDot(name, show) {
    const link = document.querySelector(`.bottom-nav-link[data-nav="${name}"]`);
    const dot = link?.querySelector(`.bottom-nav-dot[data-nav-dot="${name}"]`);
    if (!dot) return;
    dot.hidden = !show;
}

function refreshPushPromptDot() {
    const enabled = typeof window.isLightWatchPushEnabled === 'function'
        ? window.isLightWatchPushEnabled()
        : false;
    setNavDot('reports', !enabled);
    setNavDot('account', !enabled);
}

// Kept as a thin wrapper (rather than wiring refreshPushPromptDot
// straight to the event below) so any future signed-in/out nav-state
// sync has one obvious place to live, same as before.
function syncNavBadgesToSession() {
    refreshPushPromptDot();
}

// ── Topbar: hide on scroll down, reveal on scroll up ────────────
// FIX: this used to bail out below 1024px (`if (window.innerWidth <
// 1024) { ...; return; }`), on the assumption that this behavior was
// desktop-only — .topbar is display:none below home.css's mobile
// breakpoint, and the bottom nav takes over. That's exactly why this
// never did anything on the native app: at phone widths the class
// toggling below still ran (or, in the old code, was skipped and
// forced-visible before returning), but had nothing to act on.
// Removed the width branch — the same scroll-direction math now runs
// at every width, and just toggles `lw-topbar--hidden` unconditionally.
//
// NOTE: this only produces a visible effect once `.topbar` (or
// whatever header markup you're using at phone widths) is actually
// shown and positioned `fixed`/`sticky` there, with
// `.lw-topbar--hidden { transform: translateY(-100%); }` (or similar)
// defined for that breakpoint too. That CSS lives in home.css/
// header.css, which weren't available here to check/edit — if
// `.topbar` is still `display: none` on mobile, send those over and
// I'll wire the mobile-breakpoint styles up to match this exactly.
const TOPBAR_REVEAL_MIN_SCROLL = 72; // stay put near the very top instead of hiding immediately
let topbarLastScrollY = window.scrollY;
let topbarScrollTicking = false;

function updateTopbarVisibility() {
    topbarScrollTicking = false;
    const topbar = document.querySelector('.topbar');
    if (!topbar) return;

    const currentY = window.scrollY;
    if (currentY <= TOPBAR_REVEAL_MIN_SCROLL || currentY < topbarLastScrollY) {
        topbar.classList.remove('lw-topbar--hidden'); // scrolling up (or near top) -> show
    } else if (currentY > topbarLastScrollY) {
        topbar.classList.add('lw-topbar--hidden'); // scrolling down -> hide
    }
    topbarLastScrollY = currentY;
}

function onTopbarScroll() {
    if (topbarScrollTicking) return;
    topbarScrollTicking = true;
    requestAnimationFrame(updateTopbarVisibility);
}

window.addEventListener('scroll', onTopbarScroll, { passive: true });
window.addEventListener('resize', updateTopbarVisibility);

function initNav() {
    applyNavVisibility();
    bindRouteLinks();
    bindTopbarHamburger();
    window.addEventListener('resize', applyNavVisibility);
    window.addEventListener('lw:route-changed', (e) => {
        applyActiveNav(e.detail.view);
        bindRouteLinks(); // covers any nav links a newly-mounted view added
        closeTopbarHamburgerMenu();
    });
    window.addEventListener('lw:push-state-changed', refreshPushPromptDot);
    window.addEventListener('lw-session-changed', syncNavBadgesToSession);
    syncNavBadgesToSession();
}

window.LWNav = { initNav, applyActiveNav, bindRouteLinks };