// ============================================================
//  VIEWS/NOTIFICATIONS.JS
//  Loads the latest notification events for the "All notifications"
//  page (#view-notifications .notification-list).
//
//  Changed vs. the original reports.js:
//   - wrapped into mount()/show()/hide(); polling starts/stops with
//     visibility; cache read/write goes through services/cache.js
//     (LWCache) instead of its own inline localStorage helpers.
//   - the feed is no longer just LightStatusEvent rows. Three more
//     kinds of activity are merged in, sorted together by time:
//       1. community-report messages posted in the user's OWN
//          location (server-side merge, GET /reports?includeCommunity=1)
//       2. replies to a message THIS user posted, from anywhere
//          (same server-side merge)
//       3. news articles that mention the user's location by name, or
//          that are flagged nationwide (services/news.js computes both
//          — mentionedLocations / isNationwide — at fetch time and
//          already pushes for them; this just also surfaces them here,
//          via GET /news?location=...&includeNationwide=1)
//     A new match under (3) also fires a one-time in-app toast via
//     components/notification.js's window.lwToast, as a same-session
//     nicety layered on top of the real push notification that already
//     went out when the article was stored — see the comment on
//     notifyNewMatchedNews() below.
// ============================================================

(function () {
    const NOTIFICATIONS_CACHE_KEY = 'lw_cache_notifications_list';
    const NOTIFICATIONS_NEWS_CACHE_KEY = 'lw_cache_notifications_matched_news';
    const SEEN_NOTIFICATION_NEWS_IDS_KEY = 'lw_seen_notification_news_ids';
    const MAX_SEEN_NEWS_IDS = 300; // cap so this never grows unbounded in localStorage
    let notificationsPollTimer = null;

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

    // ---- Rendering ----------------------------------------------------
    function notificationItemMeta(notification) {
        switch (notification.type) {
            case 'success': return { cls: 'notification-item--success', icon: '' };
            case 'warning': return { cls: 'notification-item--warning', icon: '' };
            case 'chat':    return { cls: 'notification-item--chat', icon: '💬 ' };
            case 'reply':   return { cls: 'notification-item--reply', icon: '↩️ ' };
            case 'news':    return { cls: 'notification-item--news', icon: '📰 ' };
            case 'admin':   return { cls: 'notification-item--admin', icon: '' }; // icon is already baked into notification.title server-side
            default:        return { cls: 'notification-item--info', icon: '' };
        }
    }

    function renderNotifications(notifications) {
        const notificationList = document.querySelector('#view-notifications .notification-list');
        if (!notificationList) return;
        notificationList.classList.remove('loading');

        if (!notifications || notifications.length === 0) {
            notificationList.innerHTML = '<article class="notification-item notification-item--info"><div><strong>No recent notifications yet</strong><p class="notification-item__text">Once users start sharing updates, they will appear here.</p></div><span class="notification-item__time">—</span></article>';
            return;
        }

        notificationList.innerHTML = notifications.map(notification => {
            const { cls, icon } = notificationItemMeta(notification);
            const isClickable = notification.type === 'chat' || notification.type === 'reply' || notification.type === 'news' || notification.type === 'admin';
            const dataAttrs = notification.type === 'news'
                ? `data-action="open-news" data-url="${escapeHtml(notification.url)}"`
                : (notification.type === 'chat' || notification.type === 'reply' || notification.type === 'admin')
                    ? `data-action="open-chat" data-chat-id="${escapeHtml(notification.chatId)}" data-chat-scope="${escapeHtml(notification.chatScope || 'local')}" data-chat-location="${escapeHtml(notification.chatLocation || '')}"`
                    : '';
            return `
            <article class="notification-item ${cls}"${isClickable ? ` tabindex="0" role="link" ${dataAttrs}` : ''}>
              <div>
                <strong>${icon}${escapeHtml(notification.title)}</strong>
                <p class="notification-item__text">${escapeHtml(notification.text)}</p>
              </div>
              <span class="notification-item__time">${LWHelpers.formatRelativeTimeFromDate(notification.reportedAt)}</span>
            </article>
        `;
        }).join('');
    }

    function showNotificationLoading() {
        const notificationList = document.querySelector('#view-notifications .notification-list');
        if (!notificationList) return;
        notificationList.classList.add('loading');
        notificationList.innerHTML = Array.from({ length: 4 }).map(() => `
        <article class="notification-item notification-skeleton">
          <div style="height: 60px;"></div>
        </article>
    `).join('');
    }

    // ---- Click-through: news opens the source article; chat/reply
    // items jump into the Community chat tab at that message, same
    // deep-link contract views/chat.js already reads off a route change
    // (chatId/chatScope/chatLocation) for tapped push notifications. ----
    let interactionsBound = false;
    function bindCardInteractions() {
        const notificationList = document.querySelector('#view-notifications .notification-list');
        if (!notificationList || interactionsBound) return;
        interactionsBound = true;

        const openNotification = (card) => {
            if (card.dataset.action === 'open-news' && card.dataset.url) {
                window.open(card.dataset.url, '_blank', 'noopener,noreferrer');
            } else if (card.dataset.action === 'open-chat' && card.dataset.chatId) {
                const params = new URLSearchParams({
                    chatId: card.dataset.chatId,
                    chatScope: card.dataset.chatScope || 'local',
                    chatLocation: card.dataset.chatLocation || ''
                });
                window.LWRouter?.navigate('chat', { search: `?${params.toString()}` });
            }
        };

        notificationList.addEventListener('click', (e) => {
            const card = e.target.closest('.notification-item[data-action]');
            if (card && notificationList.contains(card)) openNotification(card);
        });
        notificationList.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const card = e.target.closest('.notification-item[data-action]');
            if (!card || !notificationList.contains(card)) return;
            e.preventDefault();
            openNotification(card);
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

    function loadNotifications(isFirstLoad = false) {
        const cached = isFirstLoad ? LWCache.read(NOTIFICATIONS_CACHE_KEY, CACHE_MAX_AGE_SHORT_MS) : null;
        if (cached) {
            renderNotifications(cached);
        } else if (isFirstLoad) {
            showNotificationLoading();
        }

        Promise.all([fetchCommunityNotifications(), fetchMatchedNews()]).then(([notifications, newsItems]) => {
            if (notifications === null) {
                // Notifications fetch failed — still show whatever news matched,
                // rather than blanking the whole page over one bad call.
                if (!cached) renderNotifications(newsItems);
                return;
            }
            const merged = [...notifications, ...newsItems]
                .sort((a, b) => new Date(b.reportedAt) - new Date(a.reportedAt));
            renderNotifications(merged);
            LWCache.write(NOTIFICATIONS_CACHE_KEY, merged);
        });
    }

    function mount() {
        bindCardInteractions();
        loadNotifications(true);
    }

    function show() {
        bindCardInteractions();
        clearInterval(notificationsPollTimer);
        notificationsPollTimer = setInterval(() => loadNotifications(false), POLL_INTERVAL_FAST_MS);
    }

    function hide() {
        clearInterval(notificationsPollTimer);
        notificationsPollTimer = null;
    }

    window.LWViews = window.LWViews || {};
    window.LWViews.notifications = { mount, show, hide };
})();