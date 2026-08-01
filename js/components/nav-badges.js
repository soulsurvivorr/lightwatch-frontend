// ============================================================
//  COMPONENTS/NAV-BADGES.JS
//  Drives the monochrome "tooltip" badges on the Report and
//  Notifications bottom-nav links (.bottom-nav-badge--mono,
//  [data-nav-badge="chat"] / [data-nav-badge="notifications"]),
//  plus the small unread dots on the Report page's own News /
//  Community sub-tabs.
//
//  Why this is its own poller rather than piggybacking on
//  views/news.js or views/notifications.js: both of those only
//  fetch while their own page is actually on screen (see the
//  start/stop-on-visibility comments in each file) — by design,
//  to avoid polling a panel nobody is looking at. But a nav badge
//  has the opposite requirement: it specifically needs to know
//  about new activity while the user is NOT on that page. So this
//  runs its own lightweight background check, independent of which
//  view is mounted, for as long as the app is open.
//
//  Counts persist in localStorage (survive reload). The Report nav
//  badge covers News + Community together, but is tracked as two
//  SEPARATE counts under the hood ('news' / 'community') instead of
//  one merged 'chat' count. That split is what fixes the bug where
//  simply clicking into the Report page (which defaults to the News
//  tab) wiped out a badge that was actually about a new Community
//  reply the user hadn't looked at yet — now each sub-count only
//  clears when the user is actually looking at THAT tab (tracked via
//  chat.js's 'lw:report-tab-changed' event), and a small dot on the
//  still-unread tab's own button keeps that visible until they do.
// ============================================================

(function () {
    const POLL_MS = (typeof POLL_INTERVAL_FAST_MS !== 'undefined') ? POLL_INTERVAL_FAST_MS : 60 * 1000;
    const SEEN_NEWS_KEY = 'lw_badge_seen_news_ids';
    const SEEN_REPORT_KEY = 'lw_badge_seen_report_ids';
    const COUNT_KEY_PREFIX = 'lw_badge_count_';
    const MAX_SEEN_IDS = 300;

    let pollTimer = null;
    let currentRoute = null;
    let currentReportTab = 'news'; // 'news' | 'community' — which Report sub-tab is on screen right now

    function getSeenIds(key) {
        try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); }
        catch { return new Set(); }
    }

    function saveSeenIds(key, idSet) {
        try {
            localStorage.setItem(key, JSON.stringify(Array.from(idSet).slice(-MAX_SEEN_IDS)));
        } catch { /* storage full/unavailable — badge just won't persist across reload */ }
    }

    function getCount(key) {
        return Number(localStorage.getItem(COUNT_KEY_PREFIX + key) || '0') || 0;
    }

    function setCountRaw(key, count) {
        const clamped = Math.max(0, count);
        try { localStorage.setItem(COUNT_KEY_PREFIX + key, String(clamped)); } catch {}
        return clamped;
    }

    function renderBadgeEl(navKey, count) {
        document.querySelectorAll(`[data-nav-badge="${navKey}"]`).forEach(el => {
            if (count > 0) {
                el.textContent = count > 9 ? '9+' : String(count);
                el.hidden = false;
            } else {
                el.textContent = '';
                el.hidden = true;
            }
        });
    }

    // The single Report/Chat nav badge is the SUM of the two sub-tabs
    // — so it only fully disappears once both have actually been seen.
    function renderChatBadge() {
        renderBadgeEl('chat', getCount('news') + getCount('community'));
    }

    function renderNotificationsBadge() {
        renderBadgeEl('notifications', getCount('notifications'));
    }

    // Small dot on each Report sub-tab button itself (#reportTabNewsBtn
    // / #reportTabCommunityBtn) — this is what keeps the "you have
    // something unread here" signal alive on the Community tab even
    // after the main nav badge has been partly cleared by opening the
    // Report page onto its default News tab. Injected once, then just
    // toggled — no HTML changes needed elsewhere.
    function toggleTabDot(btnId, show) {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        let dot = btn.querySelector('.report-tab__dot');
        if (!dot) {
            dot = document.createElement('span');
            dot.className = 'report-tab__dot';
            dot.setAttribute('aria-hidden', 'true');
            btn.appendChild(dot);
        }
        dot.hidden = !show;
    }

    function renderReportTabDots() {
        toggleTabDot('reportTabNewsBtn', getCount('news') > 0);
        toggleTabDot('reportTabCommunityBtn', getCount('community') > 0);
    }

    function renderAll() {
        renderChatBadge();
        renderNotificationsBadge();
        renderReportTabDots();
    }

    function setCount(key, count) {
        setCountRaw(key, count);
        renderAll();
    }

    function increment(key, by = 1) {
        if (by <= 0) return;
        setCount(key, getCount(key) + by);
    }

    function clear(key) {
        setCount(key, 0);
    }

    function getCurrentUserId() {
        const session = typeof getSession === 'function' ? getSession() : null;
        if (session?.user?.id) return session.user.id;
        return localStorage.getItem('currentUserId') || sessionStorage.getItem('currentUserId');
    }

    function getCurrentLocation() {
        if (window.currentChatLocation) return window.currentChatLocation;
        const raw = localStorage.getItem('currentUserData') || localStorage.getItem('signupUser');
        if (!raw) return null;
        try {
            const user = JSON.parse(raw);
            return user.city ? `${user.city}, ${user.region || ''}`.trim() : (user.region || null);
        } catch { return null; }
    }

    function bumpNotifications(count) {
        if (currentRoute !== 'notifications') increment('notifications', count);
    }

    // Skip incrementing a Report sub-count while the user is right now
    // looking at that exact tab — same "already showing it" principle
    // the old single bumpBadges() used, just applied per-tab instead of
    // per-route.
    function bumpReportTab(tab, count) {
        if (currentRoute === 'chat' && currentReportTab === tab) return;
        increment(tab, count);
    }

    function checkNews() {
        if (typeof API_URL === 'undefined') return;
        fetch(`${API_URL}/news?limit=15`)
            .then(r => r.json())
            .then(data => {
                const articles = Array.isArray(data) ? data : [];
                const seen = getSeenIds(SEEN_NEWS_KEY);
                const isFirstRun = seen.size === 0;
                const fresh = articles.filter(a => a.id != null && !seen.has(a.id));
                if (!fresh.length) return;
                fresh.forEach(a => seen.add(a.id));
                saveSeenIds(SEEN_NEWS_KEY, seen);
                if (!isFirstRun) {
                    bumpReportTab('news', fresh.length);
                    bumpNotifications(fresh.length);
                }
            })
            .catch(() => {});
    }

    function checkCommunity() {
        if (typeof API_URL === 'undefined') return;
        const userId = getCurrentUserId();
        if (!userId) return;
        const location = getCurrentLocation();
        const params = new URLSearchParams({ limit: '20', userId, includeCommunity: '1' });
        if (location) params.set('location', location);

        fetch(`${API_URL}/reports?${params.toString()}`)
            .then(r => r.json())
            .then(data => {
                const items = Array.isArray(data) ? data : [];
                const localityName = location ? String(location).split(',')[0].trim().toLowerCase() : '';

                const relevant = items.filter(item => {
                    if (item.type === 'reply' || item.type === 'chat') return true;
                    if (localityName && item.audience === 'everyone' &&
                        typeof item.text === 'string' &&
                        item.text.toLowerCase().includes(localityName)) {
                        return true;
                    }
                    return false;
                });

                const seen = getSeenIds(SEEN_REPORT_KEY);
                const isFirstRun = seen.size === 0;
                const fresh = relevant.filter(a => a.id != null && !seen.has(a.id));
                if (!fresh.length) return;
                fresh.forEach(a => seen.add(a.id));
                saveSeenIds(SEEN_REPORT_KEY, seen);
                if (!isFirstRun) {
                    bumpReportTab('community', fresh.length);
                    bumpNotifications(fresh.length);
                }
            })
            .catch(() => {});
    }

    function runChecks() {
        checkNews();
        checkCommunity();
    }

    function startPolling() {
        runChecks();
        clearInterval(pollTimer);
        pollTimer = setInterval(runChecks, POLL_MS);
    }

    function getActiveReportTabFromDom() {
        const communityPanel = document.getElementById('reportPanelCommunity');
        return (communityPanel && !communityPanel.hidden) ? 'community' : 'news';
    }

    // Arriving on /chat only marks whichever sub-tab is actually on
    // screen as read (defaults to News) — the other tab's count and
    // dot are left alone until the user switches to it themselves (see
    // onReportTabChanged below, fired by chat.js).
    function onRouteChanged() {
        const activeSection = document.querySelector('[data-view]:not([hidden])');
        currentRoute = activeSection ? activeSection.dataset.view : null;
        if (currentRoute === 'chat') {
            currentReportTab = getActiveReportTabFromDom();
            clear(currentReportTab);
        }
    }

    function onReportTabChanged(e) {
        currentReportTab = e?.detail?.tab === 'community' ? 'community' : 'news';
        clear(currentReportTab);
    }

    document.addEventListener('DOMContentLoaded', () => {
        renderAll();
        onRouteChanged();
        startPolling();
    });

    window.addEventListener('lw:route-changed', onRouteChanged);
    window.addEventListener('lw:report-tab-changed', onReportTabChanged);

    window.addEventListener('lw-session-changed', () => {
        try {
            localStorage.removeItem(SEEN_NEWS_KEY);
            localStorage.removeItem(SEEN_REPORT_KEY);
        } catch {}
        clear('news');
        clear('community');
        clear('notifications');
        startPolling();
    });

    window.LWNavBadges = { increment, clear, setCount, getCount };
})();