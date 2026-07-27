// ============================================================
//  VIEWS/NEWS.JS
//  Populates the "Official News" tab on the Report page
//  (#view-chat -> #reportPanelNews -> #officialNewsFeed) with
//  real articles from GET /news, and owns the News/Community
//  tab switching for that page.
//
//  This intentionally does NOT register on window.LWViews.chat —
//  that key belongs to chat.js (the Community-report chat panel).
//  Instead it listens for the router's 'lw:route-changed' event
//  and reacts whenever the 'chat' view is the one on screen,
//  polling only while the News tab is actually visible (same
//  start/stop-on-visibility pattern as views/reports.js).
//
//  Tab-switching (News <-> Community) is bound defensively: if
//  chat.js already wires #reportTabNewsBtn/#reportTabCommunityBtn,
//  the data-tabs-bound guard below means this is a no-op; if it
//  doesn't, this is what makes the tabs work.
// ============================================================

(function () {
    const NEWS_CACHE_KEY = 'lw_cache_news_feed';
    const NEWS_CACHE_MAX_AGE_MS = 3 * 60 * 1000;   // 3 min — articles refresh server-side every 15-30 min anyway
    const NEWS_POLL_INTERVAL_MS = 5 * 60 * 1000;   // re-check while the tab is open

    // Categories that mean "the lights are off/on right now" — these
    // always float to the top of the feed regardless of source or date,
    // since they're the most actionable thing a user can see here.
    const PRIORITY_CATEGORIES = new Set(['outage', 'restoration']);

    let newsPollTimer = null;
    let newsLoadedOnce = false;

    // ---- Sorting ---------------------------------------------------
    // Server already sorts isOfficial-first, newest-first. On top of
    // that, always float outage/restoration ("light off"/"light on")
    // articles to the very top, official-first and newest-first within
    // that group, then everything else after in the order the server
    // gave it to us.
    function sortNewsForDisplay(articles) {
        return [...articles].sort((a, b) => {
            const aPriority = PRIORITY_CATEGORIES.has(a.category) ? 0 : 1;
            const bPriority = PRIORITY_CATEGORIES.has(b.category) ? 0 : 1;
            if (aPriority !== bPriority) return aPriority - bPriority;

            const aOfficial = a.isOfficial ? 0 : 1;
            const bOfficial = b.isOfficial ? 0 : 1;
            if (aOfficial !== bOfficial) return aOfficial - bOfficial;

            return new Date(b.publishedAt) - new Date(a.publishedAt);
        });
    }

    // ---- Rendering ----------------------------------------------
    function categoryTag(category) {
        if (category === 'maintenance') return { icon: '🟠', label: 'Planned Maintenance', cls: 'news-item__tag--maintenance' };
        if (category === 'outage')      return { icon: '🔧', label: 'Outage / Fault',        cls: 'news-item__tag--warning' };
        if (category === 'restoration') return { icon: '✅', label: 'Power Restored',         cls: 'news-item__tag--success' };
        if (category === 'tariff')      return { icon: '💰', label: 'Tariff Update',           cls: 'news-item__tag--maintenance' };
        return null;
    }

    // article.sourceIcon from the backend is usually a favicon URL (e.g.
    // Google's s2/favicons service) for third-party sources, but official
    // ECG-style items don't get one — those just use the ⚡ emoji. This
    // tells the two apart so a URL never gets dropped in as raw text.
    function renderSourceIcon(article) {
        if (article.isOfficial) return '⚡';
        const icon = article.sourceIcon;
        if (icon && /^https?:\/\//i.test(icon)) {
            return `<img class="news-item__source-icon-img" src="${escapeHtml(icon)}" alt="" width="16" height="16" loading="lazy" onerror="this.replaceWith(document.createTextNode('📰'))">`;
        }
        return icon || '📰';
    }

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function renderNewsItem(article, index) {
        const tag = categoryTag(article.category);
        const detailsId = `newsDetails-${article.id || index}`;
        const isAlert = article.category === 'outage' || article.category === 'maintenance';
        const sourceIconHtml = renderSourceIcon(article);
        const dateLabel = article.publishedAt ? new Date(article.publishedAt).toLocaleDateString() : '';
        const relativeLabel = article.timeAgo
            || (window.LWHelpers && typeof window.LWHelpers.formatRelativeTimeFromDate === 'function'
                ? window.LWHelpers.formatRelativeTimeFromDate(article.publishedAt)
                : '');
        const timeLabel = [dateLabel, relativeLabel].filter(Boolean).join(' · ');

        // data-url carries the source article's real URL so the whole
        // card can act as a link (see bindCardInteractions below) — not
        // just the small "Read full article" line inside the expanded
        // details.
        return `
        <article class="news-item${isAlert ? ' news-item--alert' : ''}" data-article-id="${article.id}" data-url="${escapeHtml(article.url)}" tabindex="0" role="link">
          <div class="news-item__source">
            <span class="news-item__source-icon" aria-hidden="true">${sourceIconHtml}</span>
            <span class="news-item__source-name">${escapeHtml(article.source)}${article.isOfficial ? ' · Official' : ''}</span>
            <span class="news-item__time">${timeLabel}</span>
          </div>
          ${tag ? `<span class="news-item__tag ${tag.cls}"><span aria-hidden="true">${tag.icon}</span> ${tag.label}</span>` : ''}
          ${article.image ? `<img class="news-item__image" src="${escapeHtml(article.image)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
          <div class="news-item__row">
            <h3 class="news-item__headline">${escapeHtml(article.title)}</h3>
            <button type="button" class="news-item__toggle" aria-expanded="false" aria-controls="${detailsId}" data-action="toggle-news">
              <span class="visually-hidden" data-toggle-label>Show more</span>
              <svg class="news-item__chevron" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7.5l5 5 5-5"/></svg>
            </button>
          </div>
          <p class="news-item__preview">${escapeHtml(article.summary)}</p>
          <div class="news-item__details-wrap">
            <div class="news-item__details" id="${detailsId}">
              <p>${escapeHtml(article.summary)}</p>
              <a class="news-item__link" href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer" data-action="read-article">Read full article <span aria-hidden="true">→</span></a>
            </div>
          </div>
        </article>`;
    }

    function renderNews(articles) {
        const feed = document.getElementById('officialNewsFeed');
        if (!feed) return;
        feed.classList.remove('loading');

        if (!articles || articles.length === 0) {
            feed.innerHTML = '<article class="news-item"><p class="news-item__preview">No electricity-related news right now. Check back soon.</p></article>';
            return;
        }

        feed.innerHTML = sortNewsForDisplay(articles).map(renderNewsItem).join('');
    }

    function showNewsLoading() {
        const feed = document.getElementById('officialNewsFeed');
        if (!feed) return;
        feed.classList.add('loading');
        feed.innerHTML = Array.from({ length: 4 }).map(() => `
        <article class="news-item news-item--skeleton">
          <div style="height: 72px;"></div>
        </article>
    `).join('');
    }

    function loadNews(isFirstLoad) {
        const cached = isFirstLoad ? LWCache.read(NEWS_CACHE_KEY, NEWS_CACHE_MAX_AGE_MS) : null;
        if (cached) {
            renderNews(cached);
        } else if (isFirstLoad) {
            showNewsLoading();
        }

        fetch(`${API_URL}/news?limit=30`)
            .then(r => r.json())
            .then(data => {
                const list = Array.isArray(data) ? data : [];
                renderNews(list);
                LWCache.write(NEWS_CACHE_KEY, list);
            })
            .catch(err => {
                console.error('Could not load news:', err);
                if (!cached) renderNews([]);
            });
    }

    function startNewsPolling() {
        loadNews(!newsLoadedOnce);
        newsLoadedOnce = true;
        clearInterval(newsPollTimer);
        newsPollTimer = setInterval(() => loadNews(false), NEWS_POLL_INTERVAL_MS);
    }

    function stopNewsPolling() {
        clearInterval(newsPollTimer);
        newsPollTimer = null;
    }

    // ---- Toggle (expand/collapse) + card-click-through ------------
    // Previously this was only ever called once, from the
    // DOMContentLoaded handler at the bottom of this file. If
    // #officialNewsFeed doesn't exist in the DOM yet at that point —
    // which it won't, on a fresh page load, until the router actually
    // swaps in the 'chat' view for the first time — this silently did
    // nothing and never got a second chance, so the toggle arrow (and
    // card-click-through) permanently never worked after a fresh load.
    // It's now also called from syncPollingToVisibility() on every
    // 'lw:route-changed' event; the dataset guard below makes repeat
    // calls a harmless no-op once binding actually succeeds.
    function bindCardInteractions() {
        const feed = document.getElementById('officialNewsFeed');
        if (!feed || feed.dataset.interactionsBound === '1') return;
        feed.dataset.interactionsBound = '1';

        feed.addEventListener('click', (e) => {
            // Toggle button (or its icon) — expand/collapse only, and
            // don't let this bubble into the card-open handler below.
            const toggleBtn = e.target.closest('[data-action="toggle-news"]');
            if (toggleBtn && feed.contains(toggleBtn)) {
                const item = toggleBtn.closest('.news-item');
                if (!item) return;
                const expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
                toggleBtn.setAttribute('aria-expanded', String(!expanded));
                item.classList.toggle('is-expanded', !expanded);
                const label = toggleBtn.querySelector('[data-toggle-label]');
                if (label) label.textContent = expanded ? 'Show more' : 'Show less';
                return;
            }

            // The "Read full article" link already has its own href +
            // target="_blank" — let the browser handle it natively,
            // don't also trigger the card-level open below (which would
            // otherwise fire twice / fight over which tab opens).
            if (e.target.closest('[data-action="read-article"]')) return;

            // Anywhere else on the card — open the source article.
            const card = e.target.closest('.news-item[data-url]');
            if (card && feed.contains(card) && card.dataset.url) {
                window.open(card.dataset.url, '_blank', 'noopener,noreferrer');
            }
        });

        // Keyboard access for the same card-open behavior (the card has
        // role="link" + tabindex="0" above).
        feed.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const card = e.target.closest('.news-item[data-url]');
            if (!card || !feed.contains(card)) return;
            // Don't hijack Enter/Space when focus is actually on the
            // toggle button or the link — let their own handlers run.
            if (e.target.closest('[data-action="toggle-news"], [data-action="read-article"]')) return;
            e.preventDefault();
            window.open(card.dataset.url, '_blank', 'noopener,noreferrer');
        });
    }

    // ---- Visibility ------------------------------------------------
    // Tab switching itself (News <-> Community) is already owned by
    // chat.js's activateReportTab(), which toggles #reportPanelNews's
    // `hidden` attribute. Rather than duplicating that logic (and
    // risking two handlers fighting over the same buttons), this just
    // *observes* whether the News panel ends up visible and starts/
    // stops polling accordingly — it works the same whether chat.js
    // toggles `hidden` directly, swaps a class, or something else,
    // as long as the panel's actual rendered visibility changes.
    function isNewsPanelVisible() {
        const panel = document.getElementById('reportPanelNews');
        const section = document.getElementById('view-chat');
        if (!panel || !section) return false;
        if (section.hidden || panel.hidden) return false;
        return panel.offsetParent !== null;
    }

    let visibilityObserverBound = false;

    function observeVisibility() {
        if (visibilityObserverBound) return;
        const panel = document.getElementById('reportPanelNews');
        const section = document.getElementById('view-chat');
        if (!panel || !section) return;
        visibilityObserverBound = true;

        const observer = new MutationObserver(syncPollingToVisibility);
        observer.observe(panel, { attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
        observer.observe(section, { attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
    }

    function syncPollingToVisibility() {
        // Re-attempt binding on every route change too — see the comment
        // on bindCardInteractions() above for why this can't just live
        // in the one-time DOMContentLoaded handler below.
        bindCardInteractions();
        observeVisibility();

        if (isNewsPanelVisible()) startNewsPolling();
        else stopNewsPolling();
    }

    window.addEventListener('lw:route-changed', syncPollingToVisibility);

    document.addEventListener('DOMContentLoaded', () => {
        bindCardInteractions();
        observeVisibility();
        syncPollingToVisibility();
    });
})();