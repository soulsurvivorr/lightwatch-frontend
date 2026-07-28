// ============================================================
//  COMPONENTS/NAV-BADGES.JS
//  Drives the monochrome "tooltip" badges on the Report and
//  Notifications bottom-nav links (.bottom-nav-badge--mono,
//  [data-nav-badge="chat"] / [data-nav-badge="notifications"]).
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
//  Counts persist in localStorage (survive reload) and are cleared
//  the moment the user actually visits the corresponding nav route
//  — at that point the page's own view script (news.js /
//  notifications.js) is what shows them the new items.
// ============================================================

(function () {
    const POLL_MS = (typeof POLL_INTERVAL_FAST_MS !== 'undefined') ? POLL_INTERVAL_FAST_MS : 60 * 1000;
    const SEEN_NEWS_KEY = 'lw_badge_seen_news_ids';
    const SEEN_REPORT_KEY = 'lw_badge_seen_report_ids';
    const COUNT_KEY_PREFIX = 'lw_badge_count_';
    const MAX_SEEN_IDS = 300;

    let pollTimer = null;
    let currentRoute = null;

    // ---- Seen-id bookkeeping (same pattern as notifications.js's
    // own SEEN_NOTIFICATION_NEWS_IDS_KEY) ----------------------------
    function getSeenIds(key) {
        try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); }
        catch { return new Set(); }
    }

    function saveSeenIds(key, idSet) {
        try {
            localStorage.setItem(key, JSON.stringify(Array.from(idSet).slice(-MAX_SEEN_IDS)));
        } catch { /* storage full/unavailable — badge just won't persist across reload */ }
    }

    // ---- Count persistence + rendering ------------------------------
    function getCount(navKey) {
        return Number(localStorage.getItem(COUNT_KEY_PREFIX + navKey) || '0') || 0;
    }

    function render(navKey, count) {
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

    function setCount(navKey, count) {
        const clamped = Math.max(0, count);
        try { localStorage.setItem(COUNT_KEY_PREFIX + navKey, String(clamped)); } catch {}
        render(navKey, clamped);
    }

    function increment(navKey, by = 1) {
        if (by <= 0) return;
        setCount(navKey, getCount(navKey) + by);
    }

    function clear(navKey) {
        setCount(navKey, 0);
    }

    function renderAll() {
        ['chat', 'notifications'].forEach(k => render(k, getCount(k)));
    }

    // ---- Whose activity is this? (duplicated small helpers, same
    // pattern views/news.js and views/notifications.js already use
    // independently rather than reaching into each other's IIFEs) ----
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

    // ---- Background checks ------------------------------------------
    function bumpBadges(count) {
        // The Report badge covers News + Community activity together;
        // Notifications mirrors it since that page shows the same
        // merged feed. Either badge is skipped while its own route is
        // the one on screen — that page is already showing the item.
        if (currentRoute !== 'chat') increment('chat', count);
        if (currentRoute !== 'notifications') increment('notifications', count);
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
                // Don't badge a brand-new browser/session for the entire
                // existing news backlog — only count items that show up
                // in a check AFTER we've already established a baseline.
                if (!isFirstRun) bumpBadges(fresh.length);
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

                // Relevant to this badge: a reply to something the user
                // posted, a new community message in the user's OWN
                // location ('chat' — already scoped by the `location`
                // query param above, same as notifications.js's own
                // merge), or an "Everyone"-audience message that
                // mentions the user's location by name in its text.
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
                if (!isFirstRun) bumpBadges(fresh.length);
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

    // ---- React to navigation: clear the badge for whatever route
    // just became active (that page shows the activity itself now). --
    function onRouteChanged() {
        const activeSection = document.querySelector('[data-view]:not([hidden])');
        currentRoute = activeSection ? activeSection.dataset.view : null;
        if (currentRoute === 'chat' || currentRoute === 'notifications') clear(currentRoute);
    }

    document.addEventListener('DOMContentLoaded', () => {
        renderAll();
        onRouteChanged();
        startPolling();
    });

    window.addEventListener('lw:route-changed', onRouteChanged);

    // A different user signing in shouldn't inherit the previous
    // user's unread counts or seen-id history.
    window.addEventListener('lw-session-changed', () => {
        try {
            localStorage.removeItem(SEEN_NEWS_KEY);
            localStorage.removeItem(SEEN_REPORT_KEY);
        } catch {}
        clear('chat');
        clear('notifications');
        startPolling();
    });

    window.LWNavBadges = { increment, clear, setCount, getCount };
})();