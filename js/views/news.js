// ============================================================
//  VIEWS/NEWS.JS
//  Fetches real articles from GET /news and renders them into
//  every container marked [data-news-feed] on the page — currently
//  the "Official News" tab on the Report page
//  (#view-chat -> #reportPanelNews -> #officialNewsFeed) and the
//  Home page's "Latest power news" section (#homeNewsFeed). Same
//  fetch, same render, same articles in both places. Also owns the
//  News/Community tab switching on the Report page.
//
//  This intentionally does NOT register on window.LWViews.chat —
//  that key belongs to chat.js (the Community-report chat panel).
//  Instead it listens for the router's 'lw:route-changed' event
//  and reacts whenever the 'chat' view OR the 'home' view is the
//  one on screen, polling only while at least one feed container is
//  actually visible (same start/stop-on-visibility pattern as
//  views/reports.js).
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

    let newsPollTimer = null;
    let newsLoadedOnce = false;

    // ---- Sorting ---------------------------------------------------
    // Newest-first, full stop. This used to also float outage/
    // restoration articles to the very top regardless of age, which
    // meant a brand-new maintenance/general/tariff story got buried
    // under a two-day-old outage story — fighting with the "newly
    // fetched should be on top" real-time behavior this feed is meant
    // to have. Priority handling for outage/restoration still happens,
    // it's just via push/email alerts server-side, not by reordering
    // this list.
    function sortNewsForDisplay(articles) {
        return [...articles].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
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
          ${article.image ? `<img class="news-item__image" src="${escapeHtml(article.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="console.warn('[news.js] image failed to load:', this.src); this.remove()">` : ''}
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

    // Every container that should show the live news feed carries
    // [data-news-feed] — right now that's the Report page's News tab
    // (#officialNewsFeed) and the Home page's "Latest power news"
    // section (#homeNewsFeed). Both get the exact same rendered
    // articles; there's no per-container filtering.
    function getFeedContainers() {
        return document.querySelectorAll('[data-news-feed]');
    }

    // ---- Compact card (used by limited containers, e.g. Home) -----
    // A single small teaser card — thumbnail, source, headline, time —
    // rather than the full expandable .news-item used by the Report
    // page's News tab. This is real fetched article data, just a
    // smaller template, not a second data source.
    function renderCompactNewsCard(article) {
        const sourceIconHtml = renderSourceIcon(article);
        const dateLabel = article.publishedAt ? new Date(article.publishedAt).toLocaleDateString() : '';
        const relativeLabel = article.timeAgo
            || (window.LWHelpers && typeof window.LWHelpers.formatRelativeTimeFromDate === 'function'
                ? window.LWHelpers.formatRelativeTimeFromDate(article.publishedAt)
                : '');
        const timeLabel = [dateLabel, relativeLabel].filter(Boolean).join(' · ');
        const thumbHtml = article.image
            ? `<img class="lw-news-card__thumb" src="${escapeHtml(article.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
            : '';

        return `
        <a class="lw-news-card" href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer" data-article-id="${article.id}">
          ${thumbHtml}
          <span class="lw-news-card__body">
            <span class="lw-news-card__tag"><span aria-hidden="true">${sourceIconHtml}</span> ${escapeHtml(article.source)}${article.isOfficial ? ' · Official' : ''}</span>
            <span class="lw-news-card__headline">${escapeHtml(article.title)}</span>
            <span class="lw-news-card__time">${timeLabel}</span>
          </span>
        </a>`;
    }

    function renderNews(articles) {
        const feeds = getFeedContainers();
        if (!feeds.length) return;

        const sorted = sortNewsForDisplay(articles);
        const fullHtml = (!sorted.length)
            ? '<article class="news-item"><p class="news-item__preview">No electricity-related news right now. Check back soon.</p></article>'
            : sorted.map(renderNewsItem).join('');

        feeds.forEach((feed) => {
            feed.classList.remove('loading');
            const limit = parseInt(feed.dataset.newsFeedLimit, 10);

            if (!(limit > 0)) {
                feed.innerHTML = fullHtml;
                return;
            }

            // Limited container (Home): just the newest article(s) as
            // compact cards. The "View more news" doorway into the
            // full News tab lives once, in the section header
            // (.lw-section__viewall) — no longer duplicated here.
            if (!sorted.length) {
                feed.innerHTML = '<p class="lw-news-card__empty">No electricity-related news right now.</p>';
                return;
            }
            const cards = sorted.slice(0, limit).map(renderCompactNewsCard).join('');
            feed.innerHTML = cards;
        });
    }

    function showNewsLoading() {
        const feeds = getFeedContainers();
        if (!feeds.length) return;
        feeds.forEach((feed) => {
            feed.classList.add('loading');
            const limit = parseInt(feed.dataset.newsFeedLimit, 10);
            const count = limit > 0 ? limit : 4;
            feed.innerHTML = Array.from({ length: count }).map(() => `
        <article class="news-item news-item--skeleton">
          <div style="height: 72px;"></div>
        </article>
    `).join('');
        });
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
    function bindCardInteractions() {
        getFeedContainers().forEach((feed) => {
            if (feed.dataset.interactionsBound === '1') return;
            feed.dataset.interactionsBound = '1';

            feed.addEventListener('click', (e) => {
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

                if (e.target.closest('[data-action="read-article"]')) return;

                const card = e.target.closest('.news-item[data-url]');
                if (card && feed.contains(card) && card.dataset.url) {
                    window.open(card.dataset.url, '_blank', 'noopener,noreferrer');
                }
            });

            feed.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                const card = e.target.closest('.news-item[data-url]');
                if (!card || !feed.contains(card)) return;
                if (e.target.closest('[data-action="toggle-news"], [data-action="read-article"]')) return;
                e.preventDefault();
                window.open(card.dataset.url, '_blank', 'noopener,noreferrer');
            });
        });
    }

    // ---- Visibility ------------------------------------------------
    // Poll while EITHER the Report page's News tab is open OR the
    // Home page (which now embeds the same live feed) is on screen.
    function isNewsPanelVisible() {
        const panel = document.getElementById('reportPanelNews');
        const section = document.getElementById('view-chat');
        const reportTabVisible = !!(panel && section && !section.hidden && !panel.hidden && panel.offsetParent !== null);

        const homeSection = document.getElementById('view-home');
        const homeVisible = !!(homeSection && !homeSection.hidden && homeSection.offsetParent !== null);

        return reportTabVisible || homeVisible;
    }

    let visibilityObserverBound = false;

    function observeVisibility() {
        if (visibilityObserverBound) return;
        const panel = document.getElementById('reportPanelNews');
        const section = document.getElementById('view-chat');
        const homeSection = document.getElementById('view-home');
        if (!panel || !section || !homeSection) return;
        visibilityObserverBound = true;

        const observer = new MutationObserver(syncPollingToVisibility);
        observer.observe(panel, { attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
        observer.observe(section, { attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
        observer.observe(homeSection, { attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
    }

    function syncPollingToVisibility() {
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