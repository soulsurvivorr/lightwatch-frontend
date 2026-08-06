// ============================================================
//  VIEWS/NOTIFICATIONS.JS
//  Loads the latest notification events for the redesigned
//  Notifications page (header + All/Priority/Mentions/System tabs +
//  Priority preview + Earlier list — see index.html's #view-notifications).
//
//  Changed vs. the previous pass:
//   - fetch/merge pipeline (fetchCommunityNotifications, fetchMatchedNews,
//     notifyNewMatchedNews, getCurrentUserId/getCurrentLocation) is
//     UNCHANGED — still three sources merged and sorted by time.
//   - NEW: classifyNotification() maps each merged item's server `type`
//     (success/warning/chat/reply/news/admin/info) onto a display
//     "kind" (power_off/power_on/outage_alert/trending/mention/
//     community/report_update/system/news) plus a tab "bucket"
//     (priority/mentions/system/other), since the reference design
//     needs finer visual/labeling distinction than the server's flat
//     type field gives us. Where the server doesn't carry a subtype
//     (e.g. a generic "warning" event could be either a direct outage
//     on the user's own location or a nearby community-reported one),
//     this falls back to a title-text heuristic — flagged below.
//   - NEW: synthesizeTrendingNotification() builds a client-side-only
//     "High report activity in your area" priority card when enough
//     community messages have landed in the last hour, matching the
//     reference design's "Trending Report" card. Purely a UI nicety —
//     there's no server endpoint for this, so it never gets persisted
//     or pushed, and is recomputed fresh on every merge.
//   - NEW: local read/unread tracking (READ_IDS_KEY) since the server
//     data has no read flag; "Mark all as read" and opening a card
//     both write to it. Tab badge counts are unread tallies per bucket.
//   - NEW: renderNotifications() replaced by render(), which fills
//     either (a) the Priority preview + Earlier list (All tab) or
//     (b) a single flat list (Priority/Mentions/System tabs).
//   - NEW: mount()/show()/hide() now toggle body.lw-notif-view, which
//     css/views/notifications.css uses to hide the shared .topbar on
//     this view below the 1024px breakpoint (req: page gets its own
//     header instead of the shared brand bar).
// ============================================================

(function () {
    const NOTIFICATIONS_CACHE_KEY = 'lw_cache_notifications_list';
    const NOTIFICATIONS_NEWS_CACHE_KEY = 'lw_cache_notifications_matched_news';
    const SEEN_NOTIFICATION_NEWS_IDS_KEY = 'lw_seen_notification_news_ids';
    const READ_IDS_KEY = 'lw_read_notification_ids';
    const MAX_SEEN_NEWS_IDS = 300; // cap so this never grows unbounded in localStorage
    const MAX_READ_IDS = 500;
    const TRENDING_REPORT_THRESHOLD = 8; // community messages in the last hour
    let notificationsPollTimer = null;

    // ---- All / Priority / Mentions / System tabs --------------------
    // Bucket assignment happens per-item in classifyNotification() below
    // (not by raw server `type` alone) so it can match the reference
    // design's grouping: e.g. a "power restored" event is NOT priority
    // there (only an active outage is), even though both come from the
    // same server type family.
    let activeFilter = 'all';
    let latestMergedNotifications = [];
    let searchQuery = '';

    function applyNotificationFilter(notifications) {
        let list = notifications;
        if (activeFilter !== 'all') {
            list = list.filter(n => n._bucket === activeFilter);
        }
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            list = list.filter(n =>
                (n.title || '').toLowerCase().includes(q) ||
                (n.text || '').toLowerCase().includes(q));
        }
        return list;
    }

    function bindFilterTabs() {
        const tabs = document.querySelectorAll('.notif-tabs .notif-tab');
        if (!tabs.length || tabs[0].dataset.bound === '1') return;
        tabs.forEach(tab => {
            tab.dataset.bound = '1';
            tab.addEventListener('click', () => setActiveFilter(tab.dataset.filter || 'all'));
        });
    }

    function setActiveFilter(filter) {
        if (filter === activeFilter) return;
        activeFilter = filter;
        document.querySelectorAll('.notif-tabs .notif-tab').forEach(t => {
            const isActive = t.dataset.filter === filter;
            t.classList.toggle('is-active', isActive);
            t.setAttribute('aria-selected', String(isActive));
        });
        render();
    }

    // ---- Whose feed is this? ---------------------------------------
    // Deliberately duplicated (rather than reaching into chat.js's
    // private IIFE, which doesn't expose these) — same small pattern
    // views/news.js and views/chat.js each already keep their own copy
    // of local helpers like this.
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

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function initials(name) {
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '?';
        return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
    }

    // News matching itself now happens server-side (GET /news?location=
    // &includeNationwide=1) against services/news.js's real computed
    // mentionedLocations/isNationwide fields — not a client-side keyword
    // guess. This just labels a nationwide story that didn't also match
    // the user's specific location, so it reads as more than just
    // another local headline.
    function matchedNewsToNotificationItem(article) {
        const isPurelyNationwide = article.isNationwide && !(article.locations || []).length;
        return {
            id: `news-${article.id}`,
            title: isPurelyNationwide ? `${article.title} — Nationwide` : article.title,
            text: article.summary,
            reportedAt: article.publishedAt,
            type: 'news',
            url: article.url
        };
    }

    // ---- Classification ---------------------------------------------
    // Maps a merged item's server `type` (plus a light title heuristic
    // where the server doesn't carry a finer subtype) onto:
    //   kind   — which visual template/icon/label to use
    //   bucket — which tab it counts toward ('priority' | 'mentions' |
    //            'system' | 'other'; 'other' only ever shows under the
    //            All tab's Earlier list, matching the reference design
    //            where a restored/"Power ON" event isn't urgent enough
    //            to be Priority but also isn't a Mention or a System
    //            message)
    //   accent — whether it gets the left accent-stripe treatment
    //            (reference design reserves that for Priority items)
    const KIND_META = {
        power_off:    { label: 'Power Off',      chip: 'POWER OFF',      color: 'red',    bucket: 'priority', accent: true  },
        outage_alert: { label: 'Outage Alert',   chip: 'OUTAGE ALERT',   color: 'amber',  bucket: 'priority', accent: true  },
        trending:     { label: 'Trending Report',chip: 'TRENDING REPORT',color: 'blue',   bucket: 'priority', accent: true  },
        news:         { label: 'News',           chip: 'NEWS',           color: 'amber',  bucket: 'priority', accent: true  },
        power_on:     { label: 'Power On',       chip: 'POWER ON',       color: 'green',  bucket: 'other',    accent: false },
        mention:      { label: 'Mention',        chip: 'MENTION',        color: 'blue',   bucket: 'mentions', accent: false },
        like:         { label: 'Like',           chip: 'LIKE',           color: 'red',    bucket: 'mentions', accent: false },
        repost:       { label: 'Repost',         chip: 'REPOST',         color: 'green',  bucket: 'mentions', accent: false },
        community:    { label: 'Community',      chip: 'COMMUNITY',      color: 'teal',   bucket: 'mentions', accent: false },
        report_update:{ label: 'Report Update',  chip: 'REPORT UPDATE',  color: 'purple', bucket: 'system',   accent: false },
        system:       { label: 'System',         chip: 'SYSTEM',         color: 'blue',   bucket: 'system',   accent: false }
    };

    function classifyNotification(notification) {
        let kind;
        switch (notification.type) {
            case 'warning':
                // Server "warning" covers both a direct outage on a
                // followed location and a nearby community-reported one;
                // it doesn't carry which. Titles written by the outage
                // pipeline start "Power is OFF ..." — anything else in
                // this type is treated as a nearby community alert.
                kind = /^power is off/i.test(notification.title || '') ? 'power_off' : 'outage_alert';
                break;
            case 'success':
                kind = 'power_on';
                break;
            case 'reply':
            case 'mention':
            case 'comment':
                kind = 'mention';
                break;
            case 'like':
                kind = 'like';
                break;
            case 'repost':
                kind = 'repost';
                break;
            case 'chat':
                kind = 'community';
                break;
            case 'admin':
                kind = 'report_update';
                break;
            case 'news':
                kind = 'news';
                break;
            case 'trending':
                kind = 'trending';
                break;
            default:
                kind = 'system';
        }
        const meta = KIND_META[kind];
        return {
            ...notification,
            handle: notification.actorHandle || notification.handle || notification.fromUser || '',
            _kind: kind,
            _bucket: meta.bucket,
            _meta: meta
        };
    }

    // A purely client-side insight, not a real server notification: if
    // enough community messages for the user's own location landed in
    // the last hour, surface a "High report activity" priority card,
    // matching the reference design's Trending Report item. Recomputed
    // on every merge; never cached/persisted on its own.
    function synthesizeTrendingNotification(notifications) {
        const location = getCurrentLocation();
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        const recentCommunityCount = notifications.filter(n =>
            n.type === 'chat' && new Date(n.reportedAt).getTime() >= oneHourAgo
        ).length;
        if (recentCommunityCount < TRENDING_REPORT_THRESHOLD) return null;
        return {
            id: `trending-${new Date().toISOString().slice(0, 13)}`, // stable per hour, so it doesn't re-"arrive" every poll
            title: 'High report activity in your area',
            text: `More than ${recentCommunityCount} reports in the last hour.`,
            reportedAt: new Date().toISOString(),
            type: 'trending',
            location: location || undefined
        };
    }

    // ---- Read/unread tracking ----------------------------------------
    // The server data has no read flag, so read state is tracked
    // locally per notification id. Anything not in this set counts as
    // unread for badge counts and the small side dot.
    function getReadIds() {
        try { return new Set(JSON.parse(localStorage.getItem(READ_IDS_KEY) || '[]')); }
        catch { return new Set(); }
    }

    function markIdsRead(ids) {
        if (!ids.length) return;
        const set = getReadIds();
        ids.forEach(id => set.add(id));
        const trimmed = Array.from(set).slice(-MAX_READ_IDS);
        localStorage.setItem(READ_IDS_KEY, JSON.stringify(trimmed));
    }

    // ---- Rendering ----------------------------------------------------
    function metaLine(notification) {
        const parts = [];
        if (notification.location) parts.push(escapeHtml(notification.location));
        parts.push(LWHelpers.formatRelativeTimeFromDate(notification.reportedAt));
        return parts.join(' <span class="notif-card__meta-dot">•</span> ');
    }

    function kindIconSvg(kind) {
        switch (kind) {
            case 'power_on':
                return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
            case 'like':
                return '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
            case 'repost':
                return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M17 1l4 4-4 4m0 0v-3h-10a4 4 0 0 0-4 4v1m0 7l-4-4 4-4m0 0v3h10a4 4 0 0 0 4-4v-1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            case 'outage_alert':
                return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="12" cy="12" r="8.4" stroke="currentColor" stroke-width="1.6"/><path d="M12 7.8v5.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="16.4" r="1" fill="currentColor"/></svg>';
            case 'trending':
            case 'community':
                return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M4.5 6.8c0-1.3 1-2.3 2.3-2.3h10.4c1.3 0 2.3 1 2.3 2.3v6.6c0 1.3-1 2.3-2.3 2.3H9.8L6 19v-3.3H6.8c-1.3 0-2.3-1-2.3-2.3V6.8Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 8.6h8M8 11.4h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
            case 'news':
                return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 5h10.8A2.2 2.2 0 0 1 19 7.2V17a2 2 0 0 1-2 2H8.8A2.8 2.8 0 0 1 6 16.2V5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M6 16a1.8 1.8 0 1 0 3.6 0V8.4h7.7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.4 10h4.8M11.4 12.8h4.8M11.4 15.6H15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
            case 'report_update':
                return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M7.5 4.2h9a1 1 0 0 1 1 1v14.3l-5.5-3.6-5.5 3.6V5.2a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
            case 'system':
            default:
                return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 3.5 19 6v5.4c0 4.4-3 7.9-7 9.1-4-1.2-7-4.7-7-9.1V6l7-2.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 12.1l2 2 4-4.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        }
    }

    const CHEVRON_SVG = '<svg class="notif-card__chevron" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    function renderCard(notification, readIds) {
        const { _kind: kind, _meta: meta } = notification;
        const isUnread = !readIds.has(notification.id);
        const isClickable = kind === 'mention' || kind === 'like' || kind === 'repost' || kind === 'community' || kind === 'news' || kind === 'report_update';
        const dataAttrs = kind === 'news'
            ? `data-action="open-news" data-url="${escapeHtml(notification.url)}"`
            : (kind === 'mention' || kind === 'like' || kind === 'repost' || kind === 'community' || kind === 'report_update')
                ? `data-action="open-chat" data-chat-id="${escapeHtml(notification.chatId)}" data-chat-scope="${escapeHtml(notification.chatScope || 'local')}" data-chat-location="${escapeHtml(notification.chatLocation || '')}"`
                : '';

        const iconOrAvatar = (kind === 'mention' || kind === 'like' || kind === 'repost')
            ? `<span class="notif-card__avatar" style="background:${avatarGradient(notification.fromUser || notification.title)}">${escapeHtml(initials(notification.fromUser))}<span class="notif-card__avatar-badge">${kind === 'like' ? '❤️' : kind === 'repost' ? '🔄' : '@'}</span></span>`
            : `<span class="notif-card__icon notif-card__icon--${meta.color}">${kindIconSvg(kind)}</span>`;

        const handleLine = (kind === 'mention' || kind === 'like' || kind === 'repost') && notification.handle
            ? `<p class="notif-card__text"><span class="notif-card__handle">@${escapeHtml(notification.handle)}</span> ${escapeHtml(notification.text)}</p>`
            : `<p class="notif-card__text">${escapeHtml(notification.text)}</p>`;

        return `
            <article class="notif-card${meta.accent ? ` notif-card--accent notif-card--${meta.color}` : ''}"${isClickable ? ` tabindex="0" role="link" ${dataAttrs}` : ''} data-id="${escapeHtml(notification.id)}">
              ${iconOrAvatar}
              <div class="notif-card__body">
                <span class="notif-card__label notif-card__label--${meta.color}">${meta.chip}</span>
                <strong class="notif-card__title">${escapeHtml(notification.title)}</strong>
                <p class="notif-card__meta">${metaLine(notification)}</p>
                ${handleLine}
              </div>
              <div class="notif-card__side">
                ${isUnread ? `<span class="notif-card__dot notif-card__dot--${meta.accent ? meta.color : 'gray'}" aria-hidden="true"></span>` : ''}
                ${CHEVRON_SVG}
              </div>
            </article>`;
    }

    // Deterministic-ish gradient per person so the same author always
    // gets the same avatar color within a session, without needing a
    // real per-user avatar image/URL from the server.
    const AVATAR_PALETTES = [
        'linear-gradient(135deg, var(--teal), var(--teal-dim))',
        'linear-gradient(135deg, #7c4dff, #4527a0)',
        'linear-gradient(135deg, var(--brand2), var(--brand2-dim))',
        'linear-gradient(135deg, var(--amber), var(--amber-dim))'
    ];
    function avatarGradient(seed) {
        const str = String(seed || '');
        let hash = 0;
        for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
        return AVATAR_PALETTES[hash % AVATAR_PALETTES.length];
    }

    function emptyStateHtml(message) {
        return `<article class="notif-card notif-card--empty"><div class="notif-card__body"><strong class="notif-card__title">${escapeHtml(message)}</strong></div></article>`;
    }

    function updateNotificationTooltips() {
        const count = Number(localStorage.getItem('lw_badge_count_notifications') || '0') || 0;
        document.querySelectorAll('.lw-icon-btn[data-nav="notifications"]').forEach((btn) => {
            const tooltip = btn.querySelector('.lw-icon-btn__tooltip');
            if (!tooltip) return;
            tooltip.textContent = 'Notifications';
            tooltip.classList.toggle('is-visible', true);
            tooltip.setAttribute('aria-hidden', 'false');
        });
    }

    function updateTabBadges(notifications, readIds) {
        const counts = { all: 0, priority: 0, mentions: 0, system: 0 };
        notifications.forEach(n => {
            if (readIds.has(n.id)) return;
            counts.all++;
            if (n._bucket === 'priority') counts.priority++;
            else if (n._bucket === 'mentions') counts.mentions++;
            else if (n._bucket === 'system') counts.system++;
        });
        Object.keys(counts).forEach(key => {
            const badge = document.querySelector(`.notif-tabs [data-tab-count="${key}"]`);
            if (!badge) return;
            badge.textContent = String(counts[key]);
            badge.hidden = counts[key] === 0;
        });
    }

    function syncNavBadgeCountWithReadState() {
        if (!latestMergedNotifications.length) return;
        const unreadCount = latestMergedNotifications.filter(n => !getReadIds().has(n.id)).length;
        if (window.LWNavBadges?.setCount) {
            window.LWNavBadges.setCount('notifications', unreadCount);
        }
    }

    const FILTER_TITLES = { priority: 'Priority', mentions: 'Mentions', system: 'System' };

    function render() {
        const classified = latestMergedNotifications;
        const readIds = getReadIds();
        updateTabBadges(classified, readIds);
        syncNavBadgeCountWithReadState();

        const prioritySection = document.getElementById('notifPrioritySection');
        const earlierSection = document.getElementById('notifEarlierSection');
        const flatSection = document.getElementById('notifFlatSection');
        if (!prioritySection || !earlierSection || !flatSection) return;

        const filtered = applyNotificationFilter(classified);

        if (activeFilter === 'all') {
            flatSection.hidden = true;
            prioritySection.hidden = false;
            earlierSection.hidden = false;

            const priorityItems = filtered.filter(n => n._bucket === 'priority');
            const earlierItems = filtered.filter(n => n._bucket !== 'priority');

            const priorityList = document.getElementById('notifPriorityList');
            const earlierList = document.getElementById('notifEarlierList');

            priorityList.innerHTML = priorityItems.length
                ? priorityItems.slice(0, 3).map(n => renderCard(n, readIds)).join('')
                : emptyStateHtml('No priority alerts right now');

            earlierList.innerHTML = earlierItems.length
                ? earlierItems.map(n => renderCard(n, readIds)).join('')
                : emptyStateHtml('Nothing else to catch up on');
        } else {
            prioritySection.hidden = true;
            earlierSection.hidden = true;
            flatSection.hidden = false;

            const flatTitleEl = document.getElementById('notifFlatTitle');
            const flatDotEl = document.getElementById('notifFlatDot');
            if (flatTitleEl) flatTitleEl.textContent = FILTER_TITLES[activeFilter] || 'Notifications';
            if (flatDotEl) {
                flatDotEl.hidden = activeFilter !== 'priority';
                flatDotEl.className = 'notif-dot notif-dot--red';
            }

            const flatList = document.getElementById('notifFlatList');
            flatList.innerHTML = filtered.length
                ? filtered.map(n => renderCard(n, readIds)).join('')
                : emptyStateHtml(`No ${(FILTER_TITLES[activeFilter] || 'matching').toLowerCase()} notifications yet`);
        }
    }

    function showNotificationLoading() {
        ['notifPriorityList', 'notifEarlierList', 'notifFlatList'].forEach(id => {
            const list = document.getElementById(id);
            if (!list) return;
            list.innerHTML = Array.from({ length: 3 }).map(() => `
              <article class="notif-card notif-card--skeleton"><div class="skel skel-block" style="height:76px;"></div></article>
            `).join('');
        });
        const prioritySection = document.getElementById('notifPrioritySection');
        const earlierSection = document.getElementById('notifEarlierSection');
        if (activeFilter === 'all' && prioritySection && earlierSection) {
            prioritySection.hidden = false;
            earlierSection.hidden = false;
        }
    }

    // FIX: this used to gate itself on `body.page-data-loading` — the
    // SAME class profile.js's showProfileLoader()/hideProfileLoader()
    // toggles for the completely separate Home/Account first-boot
    // skeleton. Sharing one flag across independent loaders meant
    // whichever finished first (usually Home, since it starts painting
    // from cache immediately) would rip `page-data-loading` off <body>
    // — flipping the CSS gate back to "hide skeleton" — while
    // notifications' own fetch was still in flight and had already set
    // notifSkeleton/notifRealContent to explicit inline display styles.
    // Once that happened, this function's early-return meant those
    // inline styles could never get cleared again: the skeleton was
    // stuck visible (inline display:block beats a class-based rule)
    // and the real content stuck hidden — permanently sitting on top
    // of each other the next time this view was opened. Notifications
    // now owns a dedicated `notif-data-loading` class (and its own
    // notifSkeletonVisible flag below) so its loading state can never
    // be touched by an unrelated view's loader, and pure class toggling
    // (no inline styles) means there's nothing left to get stuck.
    let notifSkeletonVisible = false;

    function showNotifSkeleton() {
        if (notifSkeletonVisible) return;
        notifSkeletonVisible = true;
        document.body.classList.add('notif-data-loading');
    }

    function hideNotifSkeleton() {
        if (!notifSkeletonVisible) return;
        notifSkeletonVisible = false;
        const skeleton = document.getElementById('notifSkeleton');
        if (skeleton) skeleton.classList.add('lw-skel-fading');
        setTimeout(() => {
            document.body.classList.remove('notif-data-loading');
            const realContent = document.getElementById('notifRealContent');
            if (realContent) realContent.classList.add('lw-content-reveal');
            if (skeleton) skeleton.classList.remove('lw-skel-fading');
        }, 180);
    }

    // ---- Click-through: news opens the source article; mention/
    // community/report-update items jump into the Community chat tab
    // at that message, same deep-link contract views/chat.js already
    // reads off a route change (chatId/chatScope/chatLocation) for
    // tapped push notifications. Opening any clickable card also marks
    // it read. ----
    let interactionsBound = false;
    function bindCardInteractions() {
        const page = document.querySelector('#view-notifications');
        if (!page || interactionsBound) return;
        interactionsBound = true;

        const openNotification = (card) => {
            markIdsRead([card.dataset.id]);
            card.querySelector('.notif-card__dot')?.remove();
            if (card.dataset.action === 'open-news') {
                window.__lwPendingReportPanel = 'news';
                window.LWRouter?.navigate('chat');
            } else if (card.dataset.action === 'open-chat' && card.dataset.chatId) {
                const params = new URLSearchParams({
                    chatId: card.dataset.chatId,
                    chatScope: card.dataset.chatScope || 'local',
                    chatLocation: card.dataset.chatLocation || ''
                });
                window.LWRouter?.navigate('chat', { search: `?${params.toString()}` });
            }
            updateNotificationTooltips();
            updateTabBadges(latestMergedNotifications, getReadIds());
            syncNavBadgeCountWithReadState();
        };

        page.addEventListener('click', (e) => {
            const actionBtn = e.target.closest('[data-action]');
            if (actionBtn?.dataset.action === 'view-all-priority') { setActiveFilter('priority'); return; }
            if (actionBtn?.dataset.action === 'mark-all-read') {
                const scope = actionBtn.dataset.markScope || (activeFilter === 'priority' ? 'priority' : (activeFilter === 'all' ? 'non-priority' : activeFilter));
                const idsToMark = latestMergedNotifications.filter((n) => {
                    if (scope === 'priority') return n._bucket === 'priority';
                    if (scope === 'non-priority') return n._bucket !== 'priority';
                    return n._bucket === scope;
                }).map(n => n.id);
                markIdsRead(idsToMark);
                render();
                return;
            }
            const card = e.target.closest('.notif-card[data-action]');
            if (card) openNotification(card);
        });
        page.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const card = e.target.closest('.notif-card[data-action]');
            if (!card) return;
            e.preventDefault();
            openNotification(card);
        });
    }

    function bindSearch() {
        const toggle = document.getElementById('notifSearchToggle');
        const bar = document.getElementById('notifSearchBar');
        const input = document.getElementById('notifSearchInput');
        if (!toggle || !bar || !input || toggle.dataset.bound === '1') return;
        toggle.dataset.bound = '1';

        toggle.addEventListener('click', () => {
            const willShow = bar.hidden;
            bar.hidden = !willShow;
            toggle.setAttribute('aria-expanded', String(willShow));
            if (willShow) input.focus();
            else { input.value = ''; searchQuery = ''; render(); }
        });
        input.addEventListener('input', () => {
            searchQuery = input.value.trim();
            render();
        });
    }

    // ---- Fetch + merge --------------------------------------------
    function fetchCommunityNotifications() {
        const userId = getCurrentUserId();
        const location = getCurrentLocation();
        const params = new URLSearchParams({ limit: '30' });
        if (userId) {
            params.set('userId', userId);
            params.set('includeCommunity', '1');
        }
        if (location) params.set('location', location);

        return fetch(`${API_URL}/reports?${params.toString()}`)
            .then(r => r.json())
            .then(data => Array.isArray(data) ? data : [])
            .catch(err => {
                console.error('Could not load notifications:', err);
                return null; // signals failure distinctly from "empty"
            });
    }

    function fetchMatchedNews() {
        const location = getCurrentLocation();
        const params = new URLSearchParams({ limit: '30', includeNationwide: '1' });
        if (location) params.set('location', location);

        return fetch(`${API_URL}/news?${params.toString()}`)
            .then(r => r.json())
            .then(data => {
                const articles = Array.isArray(data) ? data : [];
                LWCache.write(NOTIFICATIONS_NEWS_CACHE_KEY, articles);
                notifyNewMatchedNews(articles);
                return articles.map(matchedNewsToNotificationItem);
            })
            .catch(err => {
                console.error('Could not load news for notifications feed:', err);
                return [];
            });
    }

    // A real push already goes out server-side the moment a matching
    // article is stored (services/news.js's notifyLocationMentions /
    // notifyNationwideOutage, through the same sendPushToSubscribers
    // pipeline lightstatus/chat pushes use) — that fires even if this
    // page, or the app itself, isn't open. This toast is just a same-
    // session nicety on top of that: if the Reports page happens to be
    // open when a new match shows up in a poll, surface it immediately
    // instead of making the person notice it in the list.
    function notifyNewMatchedNews(matched) {
        if (!matched.length || typeof window.lwToast !== 'function') return;

        let seenIds = LWStorage?.getJSON(SEEN_NOTIFICATION_NEWS_IDS_KEY) || [];
        const seenSet = new Set(seenIds);
        const freshlyMatched = matched.filter(a => !seenSet.has(a.id));

        if (freshlyMatched.length === 1) {
            window.lwToast(`New update: ${freshlyMatched[0].title}`);
        } else if (freshlyMatched.length > 1) {
            window.lwToast(`${freshlyMatched.length} new power updates near you`);
        }

        if (freshlyMatched.length) {
            seenIds = [...seenIds, ...freshlyMatched.map(a => a.id)].slice(-MAX_SEEN_NEWS_IDS);
            LWStorage?.setJSON(SEEN_NOTIFICATION_NEWS_IDS_KEY, seenIds);
        }
    }

    function mergeAndClassify(notifications, newsItems) {
        const raw = [...notifications, ...newsItems];
        const trending = synthesizeTrendingNotification(notifications);
        if (trending) raw.push(trending);
        return raw
            .sort((a, b) => new Date(b.reportedAt) - new Date(a.reportedAt))
            .map(classifyNotification);
    }

    function loadNotifications(isFirstLoad = false) {
        const cached = isFirstLoad ? LWCache.read(NOTIFICATIONS_CACHE_KEY, CACHE_MAX_AGE_SHORT_MS) : null;
        if (cached) {
            latestMergedNotifications = cached.map(classifyNotification);
            render();
            hideNotifSkeleton();
        } else if (isFirstLoad) {
            // No cached data on first load (this device/browser's very
            // first open, or the cache has aged out): show the full-page
            // skeleton via the class gate only — no inline styles, so
            // there's nothing that can get left stuck once the fetch
            // below resolves.
            showNotifSkeleton();
            showNotificationLoading();
        }

        Promise.all([fetchCommunityNotifications(), fetchMatchedNews()]).then(([notifications, newsItems]) => {
            if (notifications === null) {
                // Notifications fetch failed — still show whatever news matched,
                // rather than blanking the whole page over one bad call.
                if (!cached) {
                    latestMergedNotifications = mergeAndClassify([], newsItems);
                    render();
                }
                // FIX: this branch used to return without ever calling
                // hideNotifSkeleton() — a failed first fetch with no
                // cache left the skeleton on screen forever, with no way
                // for real content (even the empty/news-only state just
                // rendered above) to ever be revealed.
                hideNotifSkeleton();
                return;
            }
            latestMergedNotifications = mergeAndClassify(notifications, newsItems);
            render();
            LWCache.write(NOTIFICATIONS_CACHE_KEY, [...notifications, ...newsItems]
                .sort((a, b) => new Date(b.reportedAt) - new Date(a.reportedAt)));
            // Data arrived — reveal the real content and hide skeleton
            hideNotifSkeleton();
        });
    }

    function mount() {
        bindCardInteractions();
        bindFilterTabs();
        bindSearch();
        loadNotifications(true);
    }

    function show() {
        bindCardInteractions();
        bindFilterTabs();
        bindSearch();
        document.body.classList.add('lw-notif-view');
        // FIX: this used to only arm the interval, so the very latest
        // news/activity wouldn't reach the list until the first tick of
        // POLL_INTERVAL_FAST_MS fired — up to a full poll interval after
        // the user actually opened the page. Fetching once immediately
        // (isFirstLoad:false, so it doesn't blow away a still-fresh
        // cached render, but does hit the network right away) closes
        // that gap; the interval below just keeps it current afterward.
        // Use isFirstLoad=true here so the loader logic can decide
        // whether to show a full-page skeleton based on cache presence.
        loadNotifications(true);
        clearInterval(notificationsPollTimer);
        notificationsPollTimer = setInterval(() => loadNotifications(false), POLL_INTERVAL_FAST_MS);
    }

    function hide() {
        document.body.classList.remove('lw-notif-view');
        clearInterval(notificationsPollTimer);
        notificationsPollTimer = null;
    }

    window.LWViews = window.LWViews || {};
    window.LWViews.notifications = { mount, show, hide };
})();