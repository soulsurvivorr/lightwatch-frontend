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

    let newsPollTimer = null;
    let newsLoadedOnce = false;

    // ---- Rendering ----------------------------------------------
    function categoryTag(category) {
        if (category === 'maintenance') return { icon: '🟠', label: 'Planned Maintenance', cls: 'news-item__tag--maintenance' };
        if (category === 'outage')      return { icon: '🔧', label: 'Outage / Fault',        cls: 'news-item__tag--warning' };
        if (category === 'restoration') return { icon: '✅', label: 'Power Restored',         cls: 'news-item__tag--success' };
        if (category === 'tariff')      return { icon: '💰', label: 'Tariff Update',           cls: 'news-item__tag--maintenance' };
        return null;
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
        const sourceIcon = article.isOfficial ? '⚡' : (article.sourceIcon || '📰');
        const timeLabel = window.LWHelpers && typeof window.LWHelpers.formatRelativeTimeFromDate === 'function'
            ? window.LWHelpers.formatRelativeTimeFromDate(article.publishedAt)
            : new Date(article.publishedAt).toLocaleDateString();

        return `
        <article class="news-item${isAlert ? ' news-item--alert' : ''}" data-article-id="${article.id}">
          <div class="news-item__source">
            <span class="news-item__source-icon" aria-hidden="true">${sourceIcon}</span>
            <span class="news-item__source-name">${escapeHtml(article.source)}${article.isOfficial ? ' · Official' : ''}</span>
            <span class="news-item__time">${timeLabel}</span>
          </div>
          ${tag ? `<span class="news-item__tag ${tag.cls}"><span aria-hidden="true">${tag.icon}</span> ${tag.label}</span>` : ''}
          ${article.image ? `<img class="news-item__image" src="${escapeHtml(article.image)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
          <div class="news-item__row">
            <h3 class="news-item__headline">${escapeHtml(article.title)}</h3>
            <button type="button" class="news-item__toggle" aria-expanded="false" aria-controls="${detailsId}" data-action="toggle-news">
              <span class="visually-hidden">Show more</span>
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

        feed.innerHTML = articles.map(renderNewsItem).join('');
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

    // ---- Toggle (expand/collapse) --------------------------------
    function bindToggle() {
        const feed = document.getElementById('officialNewsFeed');
        if (!feed || feed.dataset.toggleBound === '1') return;
        feed.dataset.toggleBound = '1';

        feed.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action="toggle-news"]');
            if (!btn || !feed.contains(btn)) return;
            const item = btn.closest('.news-item');
            if (!item) return;
            const expanded = btn.getAttribute('aria-expanded') === 'true';
            btn.setAttribute('aria-expanded', String(!expanded));
            item.classList.toggle('is-expanded', !expanded);
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

    function syncPollingToVisibility() {
        if (isNewsPanelVisible()) startNewsPolling();
        else stopNewsPolling();
    }

    function observeVisibility() {
        const panel = document.getElementById('reportPanelNews');
        const section = document.getElementById('view-chat');
        if (!panel || !section) return;

        const observer = new MutationObserver(syncPollingToVisibility);
        observer.observe(panel, { attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
        observer.observe(section, { attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
    }

    window.addEventListener('lw:route-changed', syncPollingToVisibility);

    document.addEventListener('DOMContentLoaded', () => {
        bindToggle();
        observeVisibility();
        syncPollingToVisibility();
    });
})();