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

const MOBILE_BREAKPOINT = 720;

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
        '.bottom-nav-link[data-nav], #primaryNav .nav__link[data-nav], .lw-icon-btn[data-nav], .community-banner__icon-btn[data-nav], .lw-header-avatar-btn[data-nav], .lw-section__viewall[data-route]'
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
                    // Set before navigate() so chat.js's 'lw:route-changed'
                    // listener — fired from inside navigate(), timing
                    // unknown from here — sees the pending panel no matter
                    // when it actually runs.
                    if (panel && view === 'chat') {
                        window.__lwPendingReportPanel = panel;
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
        });
    });
}

// ── Bottom-nav badge + toast (Reports tab) ────────────────
const NAV_REPORTS_SEEN_KEY = 'lw_nav_reports_last_seen';
const NAV_TOASTED_IDS_KEY = 'lw_nav_reports_toasted_ids';
const MAX_TOASTED_IDS = 300; // cap so this never grows unbounded in localStorage
const NAV_BADGE_POLL_MS = (typeof POLL_INTERVAL_FAST_MS !== 'undefined') ? POLL_INTERVAL_FAST_MS : 20000;
const NAV_BADGE_TYPES = new Set(['chat', 'reply', 'success', 'warning']);

let navReportsPollTimer = null;
let navBadgeLoadedOnce = false;

// Mirrors the small getCurrentUserId/getCurrentLocation pattern
// already duplicated per-file in reports.js/news.js.
function getNavCurrentUserId() {
    const session = typeof getSession === 'function' ? getSession() : null;
    if (session?.user?.id) return session.user.id;
    return localStorage.getItem('currentUserId') || sessionStorage.getItem('currentUserId');
}

function getNavCurrentLocation() {
    if (window.currentChatLocation) return window.currentChatLocation;
    const raw = localStorage.getItem('currentUserData') || localStorage.getItem('signupUser');
    if (!raw) return null;
    try {
        const user = JSON.parse(raw);
        return user.city ? `${user.city}, ${user.region || ''}`.trim() : (user.region || null);
    } catch { return null; }
}

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

function getReportsLastSeen() {
    return Number(localStorage.getItem(NAV_REPORTS_SEEN_KEY) || '0');
}

function markReportsSeen() {
    localStorage.setItem(NAV_REPORTS_SEEN_KEY, String(Date.now()));
    setNavBadge('reports', 0);
}

// ── Toast phrasing per item type ─────────────────────────────────
// 'reply'/'chat' items carry chatScope/chatLocation from GET
// /reports but not a separate handle field — the handle is embedded
// in title (reply: "{handle} replied to your message") or text
// (chat: "{handle}: {message}"), since that's what server.js emits.
function scopeLabel(item) {
    return item.chatScope === 'global' ? 'Everyone' : (item.chatLocation || 'your area');
}

function toastTextForItem(item) {
    if (item.type === 'reply') {
        const handle = (item.title || '').replace(/ replied to your message$/, '').trim() || 'Someone';
        return `${handle} replied to your message in ${scopeLabel(item)}`;
    }
    if (item.type === 'chat') {
        const handle = (item.text || '').split(':')[0].trim() || 'Someone';
        return `${handle} posted in ${scopeLabel(item)}`;
    }
    // 'success' / 'warning' — light status change; item.text is
    // already a complete human-readable sentence from server.js
    // (e.g. "A volunteer reported the light is off in Bantama.").
    return item.text || item.title;
}

function getToastedIds() {
    return (typeof LWStorage !== 'undefined' ? LWStorage.getJSON(NAV_TOASTED_IDS_KEY) : null) || [];
}

function toastNewItems(items) {
    if (!items.length || typeof window.lwToast !== 'function') return;

    const toastedIds = getToastedIds();
    const toastedSet = new Set(toastedIds);
    const fresh = items.filter(item => !toastedSet.has(item.id));
    if (!fresh.length) return;

    fresh
        .sort((a, b) => new Date(a.reportedAt) - new Date(b.reportedAt))
        .forEach(item => window.lwToast(toastTextForItem(item)));

    const updated = [...toastedIds, ...fresh.map(item => item.id)].slice(-MAX_TOASTED_IDS);
    if (typeof LWStorage !== 'undefined') LWStorage.setJSON(NAV_TOASTED_IDS_KEY, updated);
}

async function refreshReportsBadge() {
    const userId = getNavCurrentUserId();
    if (!userId) { setNavBadge('reports', 0); return; }

    const location = getNavCurrentLocation();
    const params = new URLSearchParams({ limit: '30', userId, includeCommunity: '1' });
    if (location) params.set('location', location);

    try {
        const res = await fetch(`${API_URL}/reports?${params.toString()}`);
        const data = await res.json();
        const items = Array.isArray(data) ? data : [];
        const relevant = items.filter(item => NAV_BADGE_TYPES.has(item.type));

        const lastSeen = getReportsLastSeen();
        const unread = relevant.filter(item => new Date(item.reportedAt).getTime() > lastSeen).length;
        setNavBadge('reports', unread);

        // Only toast for items newer than lastSeen too — on the very
        // first load after sign-in this also prevents a backlog of
        // toasts firing all at once for things from before this device
        // ever polled.
        if (navBadgeLoadedOnce) {
            toastNewItems(relevant.filter(item => new Date(item.reportedAt).getTime() > lastSeen));
        }
        navBadgeLoadedOnce = true;
    } catch (err) {
        console.error('Could not refresh reports nav badge:', err);
    }
}

function refreshPushPromptDot() {
    const enabled = typeof window.isLightWatchPushEnabled === 'function'
        ? window.isLightWatchPushEnabled()
        : false;
    setNavDot('reports', !enabled);
    setNavDot('account', !enabled);
}

function startNavBadgePolling() {
    stopNavBadgePolling();
    navBadgeLoadedOnce = false;
    refreshReportsBadge();
    refreshPushPromptDot();
    navReportsPollTimer = setInterval(refreshReportsBadge, NAV_BADGE_POLL_MS);
}

function stopNavBadgePolling() {
    clearInterval(navReportsPollTimer);
    navReportsPollTimer = null;
}

function syncNavBadgesToSession() {
    const session = typeof getSession === 'function' ? getSession() : null;
    if (session) {
        startNavBadgePolling();
    } else {
        stopNavBadgePolling();
        setNavBadge('reports', 0);
        setNavDot('reports', false);
        setNavDot('account', false);
    }
}

// ── Desktop topbar: hide on scroll down, reveal on scroll up ────
// Only meaningful at >=1024px — that's the same tier the rest of
// this file treats as "desktop" (bottom nav is display:none there,
// see home.css). Below that the topbar is display:none anyway (see
// the 768px tier in home.css), so this is a no-op on phones.
const TOPBAR_REVEAL_MIN_SCROLL = 72; // stay put near the very top instead of hiding immediately
let topbarLastScrollY = window.scrollY;
let topbarScrollTicking = false;

function updateTopbarVisibility() {
    topbarScrollTicking = false;
    const topbar = document.querySelector('.topbar');
    if (!topbar) return;

    if (window.innerWidth < 1024) {
        topbar.classList.remove('lw-topbar--hidden');
        topbarLastScrollY = window.scrollY;
        return;
    }

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
    window.addEventListener('resize', applyNavVisibility);
    window.addEventListener('lw:route-changed', (e) => {
        applyActiveNav(e.detail.view);
        bindRouteLinks(); // covers any nav links a newly-mounted view added
        if (e.detail.view === 'reports') markReportsSeen();
    });
    window.addEventListener('lw:push-state-changed', refreshPushPromptDot);
    window.addEventListener('lw-session-changed', syncNavBadgesToSession);
    syncNavBadgesToSession();
}

window.LWNav = { initNav, applyActiveNav, bindRouteLinks };