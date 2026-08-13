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
        '.bottom-nav-link[data-nav], #primaryNav .nav__link[data-nav], .lw-icon-btn[data-nav], .notif-icon-btn[data-nav], .community-banner__icon-btn[data-nav], .lw-header-avatar-btn[data-nav], .lw-section__viewall[data-route], .topbar__hamburger-link[data-route], .topbar__hamburger-link[data-action], [data-route][data-map-mode]'
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

// ── Topbar: normal flow at the top of the page; becomes a floating
// hide-on-scroll-down/reveal-on-scroll-up header once you've
// scrolled past its own height ───────────────────────────────────
// FIX (history): this used to bail out below 1024px, then later
// switched .topbar straight to `position: fixed` from the very
// first pixel of scroll to work around a sticky+transform repaint
// bug (see navbar.css). That fixed the freeze but introduced a
// different problem: the header floated above content immediately,
// instead of behaving like a normal part of the page at the top.
//
// What this does now: .topbar's resting CSS position is `static`
// (navbar.css) — at the top of the page it's just ordinary content
// and scrolls away naturally like anything else, no special
// handling at all. Only once the page has scrolled past the
// topbar's own height does nav.js add `.is-pinned` (switches it to
// `position: fixed` — see navbar.css) and start applying the
// scroll-direction hide/reveal. Scrolling back up above that
// threshold unpins it and drops it right back into normal flow.
const topbarEl = document.querySelector('.topbar');
// FIX (missing padding compensation / "floating header, no reserved
// space"): this used to be `const appShellEl = document.getElementById
// ('appShell');`, resolved once, synchronously, the moment nav.js was
// parsed. If the <script> tag sits between the topbar markup and
// `<div id="appShell">` in the HTML — plausible, since the topbar is
// the page header and #appShell wraps everything after it — this read
// returns null before #appShell has been parsed yet, and being a
// const, that null was permanent for the rest of the session. `.topbar`
// itself still pinned/hid correctly (queried the same way, but it
// already existed by this point), so the pin/hide always looked right
// visually — but `if (appShellEl) appShellEl.classList.add(...)`
// silently no-opped forever, meaning the padding compensation
// (`#appShell.lw-topbar-pinned` in home.css) never applied on any pin,
// ever: exactly the "floating header sitting on top of content with
// nothing reserving its space" symptom, on every single pin, not just
// on load. `getAppShellEl()` re-queries lazily instead of trusting a
// single parse-time snapshot, so a late-parsed #appShell still gets
// found the first time it's actually needed.
let appShellEl = document.getElementById('appShell');
function getAppShellEl() {
    if (!appShellEl) appShellEl = document.getElementById('appShell');
    return appShellEl;
}
// FIX (topbar overlapping content on load): this used to read
// topbarEl.offsetHeight immediately, with no fallback for "not
// measured yet". If nav.js runs before the topbar has actually been
// laid out (stylesheet still applying, fonts/images not painted,
// during the .page-data-loading skeleton swap — see home.css),
// offsetHeight reads 0. currentY (also 0 at page load) >= a 0
// threshold is true, so updateTopbarVisibility's very first call
// pinned the topbar instantly, before any real scrolling — fixed
// positioning with a 0px --lw-topbar-h compensation, i.e. exactly a
// floating header with no reserved space, sitting on top of
// whatever's underneath it. `null` here (rather than 0) means
// "not measured yet", and the pin check below refuses to fire until
// a real (>0) measurement exists.
let topbarPinThreshold = null;
let topbarPinned = false;
let topbarJustPinned = false;
let topbarLastScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
let topbarScrollTicking = false;
const TOPBAR_REVEAL_DELTA = 2; // direction-change sensitivity once pinned

// Keeps topbarPinThreshold (and --lw-topbar-h, which home.css's
// padding compensation reads) in sync with the topbar's real
// height. Only trusted while unpinned: a fixed, possibly
// translateY-hidden topbar can report a misleading offsetHeight in
// some engines, which would corrupt both the threshold and the
// compensation if re-measured after pinning. A 0 reading here is
// left as "not measured yet" rather than accepted as real — a
// genuinely 0-height topbar isn't a real layout this app has.
function syncTopbarHeightVar() {
    if (!topbarEl || topbarPinned) return;
    const measured = topbarEl.offsetHeight;
    if (measured > 0) {
        topbarPinThreshold = measured;
        document.documentElement.style.setProperty('--lw-topbar-h', measured + 'px');
    }
}

function updateTopbarVisibility() {
    topbarScrollTicking = false;
    if (!topbarEl) return;

    const currentY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
    const delta = currentY - topbarLastScrollY;

    if (!topbarPinned) {
        // Nothing to do until we actually know the topbar's real
        // height — pinning off a guessed/zero threshold is what caused
        // the overlap-on-load bug (see comment above).
        if (topbarPinThreshold !== null && currentY >= topbarPinThreshold) {
            topbarPinned = true;
            topbarJustPinned = true;
            topbarEl.classList.add('is-pinned');
            const shellOnPin = getAppShellEl();
            if (shellOnPin) shellOnPin.classList.add('lw-topbar-pinned');
            // Always pin as VISIBLE first, even if we crossed the
            // threshold while actively scrolling down. Bundling
            // `.lw-topbar--hidden` with `.is-pinned` in the same tick
            // means `position` (static -> fixed) and `transform` (none
            // -> translateY(-100%)) change together in one style recalc
            // — browsers don't reliably animate a transform change that
            // lands in the same recalc as its containing block changing,
            // so no in-between frame gets painted and the header just
            // cuts out instantly instead of sliding away.
            topbarEl.classList.remove('lw-topbar--hidden');
        }
    } else if (topbarPinThreshold !== null && currentY < topbarPinThreshold) {
        // Scrolled back up past the threshold — unpin, return to normal
        // flow, fully visible (matches how it looked before pinning).
        topbarPinned = false;
        topbarEl.classList.remove('is-pinned', 'lw-topbar--hidden');
        const shellOnUnpin = getAppShellEl();
        if (shellOnUnpin) shellOnUnpin.classList.remove('lw-topbar-pinned');
    } else {
        const scrolledUp = delta <= -TOPBAR_REVEAL_DELTA;
        const scrolledDown = delta >= TOPBAR_REVEAL_DELTA;
        if (topbarJustPinned) {
            // Avoid hiding immediately on the very first pin transition.
            // Let the header settle into fixed position before a
            // transform-only hide happens on the next scroll tick.
            topbarJustPinned = false;
        } else if (scrolledUp) {
            topbarEl.classList.remove('lw-topbar--hidden');
        } else if (scrolledDown) {
            topbarEl.classList.add('lw-topbar--hidden');
        }

    }

    topbarLastScrollY = currentY;
}

function onTopbarScroll() {
    if (topbarScrollTicking) return;
    topbarScrollTicking = true;
    requestAnimationFrame(updateTopbarVisibility);
}

if (typeof ResizeObserver !== 'undefined' && topbarEl) {
    // ResizeObserver's first callback fires once real layout is
    // available (asynchronously, after the 0px read at parse-time
    // above), which is what actually supplies the real threshold in
    // practice — this is the primary fix for the overlap-on-load bug,
    // not just a nice-to-have.
    new ResizeObserver(() => {
        syncTopbarHeightVar();
        updateTopbarVisibility();
    }).observe(topbarEl);
} else {
    // Fallback for engines without ResizeObserver: re-measure once
    // everything (styles, fonts, images) has definitely finished
    // loading.
    window.addEventListener('load', () => {
        syncTopbarHeightVar();
        updateTopbarVisibility();
    });
}
window.addEventListener('orientationchange', syncTopbarHeightVar);
syncTopbarHeightVar();

window.addEventListener('scroll', onTopbarScroll, { passive: true });
window.addEventListener('resize', () => {
    syncTopbarHeightVar();
    updateTopbarVisibility();
});
updateTopbarVisibility();

// ── Map tooltip: show alert when there are nearby outages ──────────
// Periodically checks /locations/map for any "off" status locations
// near the user's city and shows a red badge on the Map nav icon
// to alert them to check the map view.

(function() {
    const POLL_MS = (typeof POLL_INTERVAL_FAST_MS !== 'undefined') ? POLL_INTERVAL_FAST_MS : 60 * 1000;
    const NEARBY_RADIUS_KM = 60;
    const MAX_OUTAGE_COUNT = 9;
    let pollTimer = null;
    let lastSeenOutages = 0;

    function haversineDistance(lat1, lng1, lat2, lng2) {
        const R = 6371; // Earth radius in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = 
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    function getUserLocation() {
        // Try to get user's location from session or localStorage
        const session = typeof getSession === 'function' ? getSession() : null;
        if (session?.user?.lat && session.user.lng) {
            return { lat: session.user.lat, lng: session.user.lng };
        }
        
        const stored = localStorage.getItem('currentUserData');
        if (stored) {
            try {
                const user = JSON.parse(stored);
                if (user.lat && user.lng) return { lat: user.lat, lng: user.lng };
            } catch {}
        }
        return null;
    }

    function renderMapBadge(count) {
        document.querySelectorAll('[data-nav-badge="location"]').forEach(el => {
            if (count > 0) {
                el.textContent = count > MAX_OUTAGE_COUNT ? `${MAX_OUTAGE_COUNT}+` : String(count);
                el.hidden = false;
                el.setAttribute('aria-hidden', 'false');
            } else {
                el.textContent = '';
                el.hidden = true;
                el.setAttribute('aria-hidden', 'true');
            }
        });
    }

    async function checkNearbyOutages() {
        try {
            const userLoc = getUserLocation();
            if (!userLoc) {
                renderMapBadge(0);
                return;
            }

            const response = await fetch('/locations/map');
            if (!response.ok) {
                renderMapBadge(0);
                return;
            }

            const data = await response.json();
            const locations = Array.isArray(data.locations) ? data.locations : [];

            // Count nearby locations with "off" status
            let outageCount = 0;
            for (const loc of locations) {
                if (loc.status === 'off') {
                    const distance = haversineDistance(
                        userLoc.lat, userLoc.lng,
                        loc.lat, loc.lng
                    );
                    if (distance <= NEARBY_RADIUS_KM) {
                        outageCount++;
                        if (outageCount >= MAX_OUTAGE_COUNT) break;
                    }
                }
            }

            renderMapBadge(outageCount);
            lastSeenOutages = outageCount;
        } catch (err) {
            console.error('Nearby outage check error:', err.message);
        }
    }

    // Start polling when nav loads
    function startOutagePoller() {
        if (pollTimer) return; // Already running
        checkNearbyOutages();
        pollTimer = setInterval(checkNearbyOutages, POLL_MS);
    }

    function stopOutagePoller() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    // Expose methods
    window.LWMapBadge = { startOutagePoller, stopOutagePoller, checkNearbyOutages };

    // Start polling when user is signed in
    window.addEventListener('lw-session-changed', (e) => {
        if (e.detail?.isSignedIn) {
            startOutagePoller();
        } else {
            stopOutagePoller();
        }
    });

    // Initial check if already signed in
    const session = typeof getSession === 'function' ? getSession() : null;
    if (session?.user?.id) {
        startOutagePoller();
    }
})();

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