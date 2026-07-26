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
//   - New: bottom-nav badges/dots.
//       1. Numeric badge on "reports" (notification.png) — count of
//          unseen chat messages in your own location + replies to
//          you, since you last opened that tab.
//       2. Dot on "reports" AND "account" ("Me") — shown while push
//          notifications haven't been enabled yet.
//       3. Dot on "areas" (Locations) — shown while your own
//          tracked location's live status is "off". There's no real
//          "nearby areas" concept on the backend yet (areas.js's
//          list is hardcoded demo data + one live Bantama fetch) —
//          this uses the user's own tracked location as a stand-in
//          via the existing GET /lightstatus endpoint. Worth
//          revisiting with a real "areas near me" endpoint later.
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
            const allowedOnMobile = section === "home" || section === "areas" || section === "reports" || section === "chat";
            link.style.display = allowedOnMobile ? "" : "none";
        } else {
            link.style.display = "";
        }
    });
}

function applyActiveNav(section) {
    document.querySelectorAll('#primaryNav .nav__link').forEach(link => {
        link.classList.toggle('nav__link--active', link.dataset.nav === section);
    });
    document.querySelectorAll('.bottom-nav-link[data-nav]').forEach(link => {
        link.classList.toggle('bottom-nav-link--active', link.dataset.nav === section);
    });
}

function bindRouteLinks() {
    // '#primaryNav .nav__link' is the desktop topbar nav — it was never
    // being queried here, only the mobile '.bottom-nav-link' elements
    // were, so clicking Home/Areas/Report/Notifications/Account in the
    // desktop topbar had no listener attached and did nothing.
    document.querySelectorAll('.bottom-nav-link[data-nav], #primaryNav .nav__link[data-nav]').forEach(link => {
        if (link.dataset.navBound === '1') return;
        link.dataset.navBound = '1';
        link.addEventListener('click', (e) => {
            const view = link.dataset.route || link.dataset.nav;
            if (!view) return;

            applyActiveNav(link.dataset.nav || view);

            if (link.hasAttribute('data-route')) {
                e.preventDefault();
                if (typeof window.LWRouter?.navigate === 'function') {
                    window.LWRouter.navigate(view);
                }
            }
        });
    });
}

// ── Bottom-nav badges/dots ──────────────────────────────────────
const NAV_REPORTS_SEEN_KEY = 'lw_nav_reports_last_seen';
const NAV_BADGE_POLL_MS = (typeof POLL_INTERVAL_FAST_MS !== 'undefined') ? POLL_INTERVAL_FAST_MS : 20000;
const NAV_AREA_POLL_MS = (typeof POLL_INTERVAL_STANDARD_MS !== 'undefined') ? POLL_INTERVAL_STANDARD_MS : 45000;

let navReportsPollTimer = null;
let navAreaPollTimer = null;

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
        const lastSeen = getReportsLastSeen();
        const unread = items.filter(item =>
            (item.type === 'chat' || item.type === 'reply') &&
            new Date(item.reportedAt).getTime() > lastSeen
        ).length;
        setNavBadge('reports', unread);
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

async function refreshAreaOutageDot() {
    const location = getNavCurrentLocation();
    if (!location) { setNavDot('areas', false); return; }

    try {
        const res = await fetch(`${API_URL}/lightstatus?location=${encodeURIComponent(location)}`);
        if (!res.ok) throw new Error('Bad response');
        const data = await res.json();
        setNavDot('areas', data?.status === 'off');
    } catch (err) {
        console.error('Could not refresh areas nav dot:', err);
    }
}

function startNavBadgePolling() {
    stopNavBadgePolling();
    refreshReportsBadge();
    refreshAreaOutageDot();
    refreshPushPromptDot();
    navReportsPollTimer = setInterval(refreshReportsBadge, NAV_BADGE_POLL_MS);
    navAreaPollTimer = setInterval(refreshAreaOutageDot, NAV_AREA_POLL_MS);
}

function stopNavBadgePolling() {
    clearInterval(navReportsPollTimer);
    clearInterval(navAreaPollTimer);
    navReportsPollTimer = null;
    navAreaPollTimer = null;
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
        setNavDot('areas', false);
    }
}

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