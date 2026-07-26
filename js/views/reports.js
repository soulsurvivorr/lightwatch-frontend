// ============================================================
//  VIEWS/REPORTS.JS
//  Loads the latest light status report events for the "All reports"
//  page (#view-reports .report-list).
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
    const REPORTS_CACHE_KEY = 'lw_cache_reports_list';
    const REPORTS_NEWS_CACHE_KEY = 'lw_cache_reports_matched_news';
    const SEEN_NEWS_IDS_KEY = 'lw_seen_report_news_ids';
    const MAX_SEEN_NEWS_IDS = 300; // cap so this never grows unbounded in localStorage
    let reportsPollTimer = null;

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
    function matchedNewsToReportItem(article) {
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
    function reportItemMeta(report) {
        switch (report.type) {
            case 'success': return { cls: 'report-item--success', icon: '' };
            case 'warning': return { cls: 'report-item--warning', icon: '' };
            case 'chat':    return { cls: 'report-item--chat', icon: '💬 ' };
            case 'reply':   return { cls: 'report-item--reply', icon: '↩️ ' };
            case 'news':    return { cls: 'report-item--news', icon: '📰 ' };
            case 'admin':   return { cls: 'report-item--admin', icon: '' }; // icon is already baked into report.title server-side
            default:        return { cls: 'report-item--info', icon: '' };
        }
    }

    function renderReports(reports) {
        const reportList = document.querySelector('#view-reports .report-list');
        if (!reportList) return;
        reportList.classList.remove('loading');

        if (!reports || reports.length === 0) {
            reportList.innerHTML = '<article class="report-item report-item--info"><div><strong>No recent reports yet</strong><p class="report-item__text">Once users start sharing light updates, they will appear here.</p></div><span class="report-item__time">—</span></article>';
            return;
        }

        reportList.innerHTML = reports.map(report => {
            const { cls, icon } = reportItemMeta(report);
            const isClickable = report.type === 'chat' || report.type === 'reply' || report.type === 'news' || report.type === 'admin';
            const dataAttrs = report.type === 'news'
                ? `data-action="open-news" data-url="${escapeHtml(report.url)}"`
                : (report.type === 'chat' || report.type === 'reply' || report.type === 'admin')
                    ? `data-action="open-chat" data-chat-id="${escapeHtml(report.chatId)}" data-chat-scope="${escapeHtml(report.chatScope || 'local')}" data-chat-location="${escapeHtml(report.chatLocation || '')}"`
                    : '';
            return `
            <article class="report-item ${cls}"${isClickable ? ` tabindex="0" role="link" ${dataAttrs}` : ''}>
              <div>
                <strong>${icon}${escapeHtml(report.title)}</strong>
                <p class="report-item__text">${escapeHtml(report.text)}</p>
              </div>
              <span class="report-item__time">${LWHelpers.formatRelativeTimeFromDate(report.reportedAt)}</span>
            </article>
        `;
        }).join('');
    }

    function showReportLoading() {
        const reportList = document.querySelector('#view-reports .report-list');
        if (!reportList) return;
        reportList.classList.add('loading');
        reportList.innerHTML = Array.from({ length: 4 }).map(() => `
        <article class="report-item report-skeleton">
          <div style="height: 60px;"></div>
        </article>
    `).join('');
    }

    // ---- Click-through: news opens the source article; chat/reply
    // items jump into the Community Report tab at that message, same
    // deep-link contract views/chat.js already reads off a route change
    // (chatId/chatScope/chatLocation) for tapped push notifications. ----
    let interactionsBound = false;
    function bindCardInteractions() {
        const reportList = document.querySelector('#view-reports .report-list');
        if (!reportList || interactionsBound) return;
        interactionsBound = true;

        const openReport = (card) => {
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

        reportList.addEventListener('click', (e) => {
            const card = e.target.closest('.report-item[data-action]');
            if (card && reportList.contains(card)) openReport(card);
        });
        reportList.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const card = e.target.closest('.report-item[data-action]');
            if (!card || !reportList.contains(card)) return;
            e.preventDefault();
            openReport(card);
        });
    }

    // ---- Fetch + merge --------------------------------------------
    function fetchCommunityReports() {
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
                console.error('Could not load reports:', err);
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
                LWCache.write(REPORTS_NEWS_CACHE_KEY, articles);
                notifyNewMatchedNews(articles);
                return articles.map(matchedNewsToReportItem);
            })
            .catch(err => {
                console.error('Could not load news for reports feed:', err);
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

        let seenIds = LWStorage?.getJSON(SEEN_NEWS_IDS_KEY) || [];
        const seenSet = new Set(seenIds);
        const freshlyMatched = matched.filter(a => !seenSet.has(a.id));

        if (freshlyMatched.length === 1) {
            window.lwToast(`New update: ${freshlyMatched[0].title}`);
        } else if (freshlyMatched.length > 1) {
            window.lwToast(`${freshlyMatched.length} new power updates near you`);
        }

        if (freshlyMatched.length) {
            seenIds = [...seenIds, ...freshlyMatched.map(a => a.id)].slice(-MAX_SEEN_NEWS_IDS);
            LWStorage?.setJSON(SEEN_NEWS_IDS_KEY, seenIds);
        }
    }

    function loadReports(isFirstLoad = false) {
        const cached = isFirstLoad ? LWCache.read(REPORTS_CACHE_KEY, CACHE_MAX_AGE_SHORT_MS) : null;
        if (cached) {
            renderReports(cached);
        } else if (isFirstLoad) {
            showReportLoading();
        }

        Promise.all([fetchCommunityReports(), fetchMatchedNews()]).then(([reports, newsItems]) => {
            if (reports === null) {
                // Reports fetch failed — still show whatever news matched,
                // rather than blanking the whole page over one bad call.
                if (!cached) renderReports(newsItems);
                return;
            }
            const merged = [...reports, ...newsItems]
                .sort((a, b) => new Date(b.reportedAt) - new Date(a.reportedAt));
            renderReports(merged);
            LWCache.write(REPORTS_CACHE_KEY, merged);
        });
    }

    function mount() {
        bindCardInteractions();
        loadReports(true);
    }

    function show() {
        bindCardInteractions();
        clearInterval(reportsPollTimer);
        reportsPollTimer = setInterval(() => loadReports(false), POLL_INTERVAL_FAST_MS);
    }

    function hide() {
        clearInterval(reportsPollTimer);
        reportsPollTimer = null;
    }

    window.LWViews = window.LWViews || {};
    window.LWViews.reports = { mount, show, hide };
})();