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
    function resolveFallbackImageUrl(fileName) {
        // Safe relative path for Capacitor and local dev
        return `./images/${fileName}`;
    }

    const FALLBACK_IMAGE_URLS = [
        resolveFallbackImageUrl('graphic.png'),
        resolveFallbackImageUrl('graphic2.png'),
        resolveFallbackImageUrl('graphic3.png'),
        resolveFallbackImageUrl('graphic4.png'),
        resolveFallbackImageUrl('graphic5.png'),
        resolveFallbackImageUrl('graphic6.jpg')
    ];

    // Deterministic pick instead of Math.random(): each article gets
    // whichever fallback graphic its own id/url hashes to, so the same
    // article always shows the same graphic — on this render, on a
    // re-render (e.g. the onerror swap below), and the next time the
    // user opens News and the feed re-fetches/re-renders from scratch.
    // Keyed on the article's own stable id (falls back to its URL, then
    // the array itself, if somehow neither is present) rather than
    // anything stored in localStorage — nothing to invalidate, nothing
    // that can drift if the fallback pool ever changes.
    function getFallbackImageUrlForArticle(article, index) {
        const key = (article && (
            article.id || article._id || article.eventId ||
            article.url || article.articleUrl || article.title
        )) || (index != null ? `idx-${index}` : 'lw-news-fallback');

        // Ensure index is stable by hashing the key
        const str = String(key);
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = (hash * 31 + str.charCodeAt(i)) | 0;
        }
        const idx = Math.abs(hash) % FALLBACK_IMAGE_URLS.length;
        return FALLBACK_IMAGE_URLS[idx];
    }

    function getFallbackMediaHtml(article, index) {
        const fallbackUrl = getFallbackImageUrlForArticle(article, index);
        return `<span class="news-item__media-fallback" aria-hidden="true" style="background-image:url('${fallbackUrl}')"><span class="news-item__media-fallback__glyph">📰</span></span>`;
    }

    function ensurePullRefreshHelpers() {
        if (window.LWPullRefresh && typeof window.LWPullRefresh.attach === 'function') {
            return window.LWPullRefresh;
        }

        function attach(opts) {
            const {
                id,
                container,
                shouldStart,
                onRefresh,
                trigger = 80,
                max = 116,
                spinnerClass = 'community-pull-refresh'
            } = opts || {};
            if (!id || !container || typeof shouldStart !== 'function' || typeof onRefresh !== 'function') return null;

            const refreshEl = document.createElement('div');
            refreshEl.className = spinnerClass;
            refreshEl.dataset.pullRefreshId = id;
            refreshEl.setAttribute('aria-hidden', 'true');
            refreshEl.innerHTML = '<div class="community-pull-refresh__orb"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.2-5.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 5v3.7h-3.7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>';
            container.insertAdjacentElement('afterend', refreshEl);

            let startY = 0;
            let dist = 0;
            let active = false;
            let lock = false;
            let refreshing = false;

            function paint(distance) {
                const clamped = Math.max(0, Math.min(max, distance));
                const progress = Math.max(0, Math.min(1, clamped / trigger));
                refreshEl.classList.add('is-pulling');
                refreshEl.style.setProperty('--pull-distance', `${clamped}px`);
                refreshEl.style.setProperty('--pull-progress', progress.toFixed(3));
                refreshEl.classList.toggle('is-ready', clamped >= trigger);
            }

            function clear() {
                refreshEl.classList.remove('is-pulling', 'is-ready');
                refreshEl.style.setProperty('--pull-distance', '0px');
                refreshEl.style.setProperty('--pull-progress', '0');
            }

            async function runRefresh() {
                if (refreshing) return;
                refreshing = true;
                refreshEl.classList.add('is-refreshing');
                try { await Promise.resolve(onRefresh()); } catch {}
                setTimeout(() => {
                    refreshEl.classList.remove('is-refreshing');
                    refreshing = false;
                }, 220);
            }

            window.addEventListener('touchstart', (e) => {
                if (!e.touches || e.touches.length !== 1) return;
                if (refreshing || !shouldStart(e.target)) {
                    clear();
                    return;
                }
                startY = e.touches[0].clientY;
                dist = 0;
                active = true;
                lock = false;
            }, { passive: true });

            window.addEventListener('touchmove', (e) => {
                if (!active || !e.touches || e.touches.length !== 1) return;
                const dy = e.touches[0].clientY - startY;
                if (dy <= 0) {
                    clear();
                    return;
                }
                dist = dy;
                if (dy > 8) lock = true;
                paint(dy);
                if (lock) e.preventDefault();
            }, { passive: false });

            window.addEventListener('touchend', async () => {
                if (!active) return;
                const should = dist >= trigger;
                clear();
                active = false;
                lock = false;
                if (should) await runRefresh();
            });

            window.addEventListener('touchcancel', () => {
                clear();
                active = false;
                lock = false;
            });

            return refreshEl;
        }

        window.LWPullRefresh = { attach };
        return window.LWPullRefresh;
    }

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
    // Small colored eyebrow above the headline — ECG OFFICIAL / OUTAGE
    // UPDATE / MEDIA REPORT, matching the source-tag styling in the
    // redesigned card. Official items always read "ECG OFFICIAL"
    // regardless of category (a maintenance notice from ECG itself is
    // still "official"); everything else falls back to category, then
    // to a generic media label.
    function sourceLabel(article) {
        if (article.isOfficial) return { label: 'ECG Official', cls: 'news-item__source-tag--official' };
        if (article.category === 'outage') return { label: 'Outage Update', cls: 'news-item__source-tag--outage' };
        if (article.category === 'maintenance') return { label: 'Maintenance', cls: 'news-item__source-tag--maintenance' };
        if (article.category === 'restoration') return { label: 'Power Restored', cls: 'news-item__source-tag--restoration' };
        if (article.category === 'tariff') return { label: 'Tariff Update', cls: 'news-item__source-tag--maintenance' };
        return { label: 'Media Report', cls: 'news-item__source-tag--media' };
    }

    // Best-effort location string for the small pin row under the
    // preview text. The backend field name for this has varied
    // (location / locations / mentionedLocations) across versions of
    // the news module, so this checks all of them rather than
    // assuming one shape — an article with none of these just skips
    // the location row entirely instead of showing something wrong.
    function articleLocationText(article) {
        const raw = article.location || article.locations || article.mentionedLocations || article.mentionedLocation;
        if (!raw) return null;
        if (Array.isArray(raw)) return raw.filter(Boolean).join(', ') || null;
        return String(raw).trim() || null;
    }

    // ---- Bookmarks (local only — no backend endpoint for this yet) --
    const BOOKMARKS_KEY = 'lw_news_bookmarks';

    function readBookmarks() {
        try { return JSON.parse(localStorage.getItem(BOOKMARKS_KEY) || '[]'); }
        catch { return []; }
    }

    function isBookmarked(articleId) {
        return readBookmarks().includes(String(articleId));
    }

    function toggleBookmark(articleId) {
        const id = String(articleId);
        const list = readBookmarks();
        const idx = list.indexOf(id);
        if (idx === -1) list.push(id); else list.splice(idx, 1);
        try { localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(list)); } catch {}
        return idx === -1;
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
        const tag = sourceLabel(article);
        const isAlert = article.category === 'outage' || article.category === 'maintenance';
        const sourceIconHtml = renderSourceIcon(article);
        const relativeLabel = article.timeAgo
            || (window.LWHelpers && typeof window.LWHelpers.formatRelativeTimeFromDate === 'function'
                ? window.LWHelpers.formatRelativeTimeFromDate(article.publishedAt)
                : '');
        const timeLabel = relativeLabel || (article.publishedAt ? new Date(article.publishedAt).toLocaleDateString() : '');
        const locationText = articleLocationText(article);
        const bookmarked = isBookmarked(article.id ?? index);
        const fallbackMediaHtml = getFallbackMediaHtml(article, index);
        const mediaHtml = article.image
            ? `<img class="news-item__image" src="${escapeHtml(article.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('.news-item__media')?.classList.add('news-item__media--placeholder'); this.closest('.news-item__media').innerHTML='${fallbackMediaHtml.replace(/'/g, '&#39;')}';">`
            : fallbackMediaHtml;

        // data-url carries the source article's real URL so the whole
        // card can act as a link (see bindCardInteractions below).
        return `
        <article class="news-item${isAlert ? ' news-item--alert' : ''}" data-article-id="${article.id}" data-url="${escapeHtml(article.url)}" data-category="${escapeHtml(article.category || '')}" data-official="${article.isOfficial ? '1' : '0'}" tabindex="0" role="link">
          <div class="news-item__media${article.image ? '' : ' news-item__media--placeholder'}">${mediaHtml}</div>
          <div class="news-item__body">
            <div class="news-item__source">
              <span class="news-item__source-tag ${tag.cls}">${tag.label}</span>
              <span class="news-item__time">${escapeHtml(timeLabel)}</span>
            </div>
            <h3 class="news-item__headline">${escapeHtml(article.title)}</h3>
            <p class="news-item__preview">${escapeHtml(article.summary)}</p>
            <div class="news-item__footer">
              ${locationText ? `
              <span class="news-item__location">
                <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 18s6-5.1 6-9.8A6 6 0 0 0 4 8.2C4 12.9 10 18 10 18Z"/><circle cx="10" cy="8.2" r="2"/></svg>
                ${escapeHtml(locationText)}
              </span>` : '<span></span>'}
              <button type="button" class="news-item__bookmark${bookmarked ? ' is-active' : ''}" data-action="toggle-bookmark" aria-label="${bookmarked ? 'Remove bookmark' : 'Save article'}" aria-pressed="${bookmarked ? 'true' : 'false'}">
                <svg viewBox="0 0 20 20" width="15" height="15" fill="${bookmarked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M5 3.5h10a1 1 0 0 1 1 1V17l-6-3.5L4 17V4.5a1 1 0 0 1 1-1Z"/></svg>
              </button>
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
    function renderCompactNewsCard(article, index) {
        const sourceIconHtml = renderSourceIcon(article);
        const dateLabel = article.publishedAt ? new Date(article.publishedAt).toLocaleDateString() : '';
        const relativeLabel = article.timeAgo
            || (window.LWHelpers && typeof window.LWHelpers.formatRelativeTimeFromDate === 'function'
                ? window.LWHelpers.formatRelativeTimeFromDate(article.publishedAt)
                : '');
        const timeLabel = [dateLabel, relativeLabel].filter(Boolean).join(' · ');
        const fallbackImageUrl = getFallbackImageUrlForArticle(article, index);
        const thumbHtml = article.image
            ? `<img class="lw-news-card__thumb" src="${escapeHtml(article.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('img'), {className:'lw-news-card__thumb lw-news-card__thumb--fallback', src:'${fallbackImageUrl}', alt:''}))">`
            : `<img class="lw-news-card__thumb lw-news-card__thumb--fallback" src="${fallbackImageUrl}" alt="" loading="lazy">`;

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

    // Last full, unfiltered article list — kept around so a tab click
    // can re-render instantly from memory instead of refetching.
    let latestArticles = [];
    let activeNewsFilter = 'all';
    let lwHomeNewsCarousel = null;

    // ------------------------------------------------------------
    // HOME NEWS CAROUSEL — #homeNewsFeed used to just render a single
    // static compact card (data-news-feed-limit was 1, and even at a
    // higher limit the container was a plain flex column with nothing
    // to advance between). Now backed by the same shared
    // createLoopCarousel() helper the Trending Stories / Did You Know
    // Home cards use, so it loops through the top few articles instead
    // of freezing on one.
    // ------------------------------------------------------------
    function initHomeNewsCarousel() {
        const host = document.getElementById('homeNewsFeed');
        const viewport = document.getElementById('homeNewsFeedViewport');
        const track = document.getElementById('homeNewsFeedTrack');
        const dotsHost = document.getElementById('homeNewsFeedDots');
        if (!host || !viewport || !track || typeof window.createLoopCarousel !== 'function') return null;

        function renderDots(count, activeIndex) {
            if (!dotsHost) return;
            if (count <= 1) { dotsHost.innerHTML = ''; return; }
            dotsHost.innerHTML = Array.from({ length: count }, (_, i) =>
                `<span class="lw-home-news-feed__dot${i === activeIndex ? ' lw-home-news-feed__dot--active' : ''}" data-dot-index="${i}"></span>`
            ).join('');
        }

        const carousel = window.createLoopCarousel({
            viewport,
            track,
            autoplayMs: 6500,
            onChange: renderDots
        });

        dotsHost?.addEventListener('click', (event) => {
            const dot = event.target.closest('[data-dot-index]');
            if (!dot) return;
            carousel.goTo(Number(dot.dataset.dotIndex));
            carousel.startAutoplay();
        });

        // Pause the auto-advance while a mouse user is reading; touch/
        // drag pausing is already handled inside createLoopCarousel.
        host.addEventListener('mouseenter', () => carousel.stopAutoplay());
        host.addEventListener('mouseleave', () => carousel.startAutoplay());

        return carousel;
    }

    function renderHomeNewsCarousel(articles) {
        if (!lwHomeNewsCarousel) return;
        if (!articles.length) {
            lwHomeNewsCarousel.render(['<div class="lw-home-news-feed__slide"><p class="lw-news-card__empty">No electricity-related news right now.</p></div>']);
            lwHomeNewsCarousel.stopAutoplay();
            return;
        }
        lwHomeNewsCarousel.render(articles.map((article, index) => `<div class="lw-home-news-feed__slide">${renderCompactNewsCard(article, index)}</div>`));
        lwHomeNewsCarousel.startAutoplay();
    }

    function filterArticlesByCategory(articles, filter) {
        if (filter === 'all') return articles;
        if (filter === 'official') return articles.filter(a => a.isOfficial);
        if (filter === 'outage') return articles.filter(a => a.category === 'outage');
        if (filter === 'maintenance') return articles.filter(a => a.category === 'maintenance');
        if (filter === 'alert') return articles.filter(a => a.category === 'outage' || a.category === 'maintenance');
        return articles;
    }

    function emptyStateHtml(filter) {
        const messages = {
            all: 'No electricity-related news right now. Check back soon.',
            official: 'No official ECG announcements right now.',
            outage: 'No outage reports in the news right now.',
            maintenance: 'No planned maintenance notices right now.',
            alert: 'No outage or maintenance alerts right now.'
        };
        return `<article class="news-item news-item--empty"><p class="news-item__preview">${messages[filter] || messages.all}</p></article>`;
    }

    function renderNews(articles) {
        const feeds = getFeedContainers();
        if (!feeds.length) return;

        latestArticles = sortNewsForDisplay(articles);
        renderFullFeeds();

        feeds.forEach((feed) => {
            feed.classList.remove('loading');
            const limit = parseInt(feed.dataset.newsFeedLimit, 10);
            if (!(limit > 0)) return; // full containers handled by renderFullFeeds()

            // Home's #homeNewsFeed is now a looping carousel (see
            // initHomeNewsCarousel()/renderHomeNewsCarousel() above) —
            // route it there instead of flat-rendering into the
            // container. Any other limited container without the
            // carousel wired up falls back to the old flat rendering.
            if (feed.id === 'homeNewsFeed' && lwHomeNewsCarousel) {
                renderHomeNewsCarousel(latestArticles.slice(0, limit));
                return;
            }

            // Limited container: just the newest article(s) as compact
            // cards, always unfiltered. The "View more news" doorway
            // into the full News tab lives once, in the section header
            // (.lw-section__viewall) — no longer duplicated here.
            if (!latestArticles.length) {
                feed.innerHTML = '<p class="lw-news-card__empty">No electricity-related news right now.</p>';
                return;
            }
            feed.innerHTML = latestArticles.slice(0, limit).map(renderCompactNewsCard).join('');
        });
    }

    // Re-renders only the full (unlimited) feed containers — e.g. the
    // Report page's #officialNewsFeed — using the current category
    // filter. Called both after a fresh fetch and after a tab click.
    function renderFullFeeds() {
        const filtered = filterArticlesByCategory(latestArticles, activeNewsFilter);
        const html = filtered.length ? filtered.map(renderNewsItem).join('') : emptyStateHtml(activeNewsFilter);

        getFeedContainers().forEach((feed) => {
            const limit = parseInt(feed.dataset.newsFeedLimit, 10);
            if (limit > 0) return; // compact containers handled in renderNews()
            feed.innerHTML = html;
        });
    }

    // ---- Category tabs ---------------------------------------------
    function bindCategoryTabs() {
        const tabsEl = document.getElementById('newsCategoryTabs');
        if (!tabsEl || tabsEl.dataset.tabsBound === '1') return;
        tabsEl.dataset.tabsBound = '1';

        tabsEl.addEventListener('click', (e) => {
            const btn = e.target.closest('.news-category-tab');
            if (!btn || !tabsEl.contains(btn)) return;

            activeNewsFilter = btn.dataset.newsFilter || 'all';
            tabsEl.querySelectorAll('.news-category-tab').forEach((tab) => {
                const isActive = tab === btn;
                tab.classList.toggle('is-active', isActive);
                tab.setAttribute('aria-selected', String(isActive));
            });
            renderFullFeeds();
        });
    }

    // Skeleton for the full-size Report-page card (media column + source
    // row + headline + preview + footer) — mirrors renderNewsItem()'s real
    // markup exactly (same classes) so the shimmer sits in precisely the
    // spots real content will land in, instead of one flat gray bar.
    function newsSkeletonFullHtml() {
        return `
        <article class="news-item news-item--skeleton" aria-hidden="true">
          <div class="news-item__media"><span class="skel skel-block" style="width:100%;height:100%;display:block;"></span></div>
          <div class="news-item__body">
            <div class="news-item__source">
              <span class="skel skel-line" style="width:64px;height:10px;"></span>
              <span class="skel skel-line" style="width:46px;height:10px;"></span>
            </div>
            <span class="skel skel-line" style="width:92%;height:15px;"></span>
            <span class="skel skel-line" style="width:65%;height:15px;"></span>
            <span class="skel skel-line" style="width:100%;height:11px;"></span>
            <span class="skel skel-line" style="width:78%;height:11px;"></span>
            <div class="news-item__footer">
              <span class="skel skel-line" style="width:74px;height:11px;"></span>
              <span class="skel skel-circle" style="width:30px;height:30px;"></span>
            </div>
          </div>
        </article>`;
    }

    // Skeleton for the compact Home-page teaser (renderCompactNewsCard) —
    // same 76x76 thumb + tag/headline/time stack.
    function newsSkeletonCompactHtml() {
        return `
        <span class="lw-news-card lw-news-card--skeleton" aria-hidden="true">
          <span class="lw-news-card__thumb" style="padding:0;"><span class="skel skel-block" style="width:100%;height:100%;display:block;"></span></span>
          <span class="lw-news-card__body">
            <span class="skel skel-line" style="width:55%;height:9px;"></span>
            <span class="skel skel-line" style="width:92%;height:14px;margin-top:8px;display:block;"></span>
            <span class="skel skel-line" style="width:60%;height:14px;margin-top:5px;display:block;"></span>
            <span class="skel skel-line" style="width:35%;height:10px;margin-top:8px;display:block;"></span>
          </span>
        </span>`;
    }

    function showNewsLoading() {
        const feeds = getFeedContainers();
        if (!feeds.length) return;
        feeds.forEach((feed) => {
            feed.classList.add('loading');
            const limit = parseInt(feed.dataset.newsFeedLimit, 10);

            // Home's #homeNewsFeed is a carousel now (see
            // initHomeNewsCarousel() above) — skeleton slides have to go
            // through the carousel's own render(), not a raw innerHTML
            // wipe, which would tear out the carousel's viewport/track/
            // dots nodes and leave it pointed at a detached element for
            // the rest of the session.
            if (feed.id === 'homeNewsFeed' && lwHomeNewsCarousel) {
                const count = limit > 0 ? limit : 4;
                lwHomeNewsCarousel.render(Array.from({ length: count }, () => `<div class="lw-home-news-feed__slide">${newsSkeletonCompactHtml()}</div>`));
                lwHomeNewsCarousel.stopAutoplay();
                return;
            }

            const count = limit > 0 ? limit : 4;
            const isCompact = limit > 0;
            feed.innerHTML = Array.from({ length: count })
                .map(() => (isCompact ? newsSkeletonCompactHtml() : newsSkeletonFullHtml()))
                .join('');
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
                const bookmarkBtn = e.target.closest('[data-action="toggle-bookmark"]');
                if (bookmarkBtn && feed.contains(bookmarkBtn)) {
                    e.preventDefault();
                    e.stopPropagation();
                    const item = bookmarkBtn.closest('.news-item[data-article-id]');
                    const nowBookmarked = toggleBookmark(item?.dataset.articleId);
                    bookmarkBtn.classList.toggle('is-active', nowBookmarked);
                    bookmarkBtn.setAttribute('aria-pressed', String(nowBookmarked));
                    bookmarkBtn.setAttribute('aria-label', nowBookmarked ? 'Remove bookmark' : 'Save article');
                    const svg = bookmarkBtn.querySelector('svg');
                    if (svg) svg.setAttribute('fill', nowBookmarked ? 'currentColor' : 'none');
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
        bindCategoryTabs();
        observeVisibility();

        if (isNewsPanelVisible()) {
            startNewsPolling();
            lwHomeNewsCarousel?.startAutoplay();
        } else {
            stopNewsPolling();
            lwHomeNewsCarousel?.stopAutoplay();
        }
    }

    function setupNewsPullRefresh() {
        const panel = document.getElementById('reportPanelNews');
        const header = panel?.querySelector('.news-page-header');
        if (!panel || !header || document.querySelector('[data-pull-refresh-id="news"]')) return;

        const pull = ensurePullRefreshHelpers();
        pull.attach({
            id: 'news',
            container: header,
            shouldStart: (target) => {
                const view = document.getElementById('view-chat');
                if (!view || view.hidden || panel.hidden) return false;
                if ((window.scrollY || window.pageYOffset || 0) > 2) return false;
                const t = target && target.nodeType === 1 ? target : null;
                return !(t && t.closest('button,a,input,textarea,[contenteditable="true"]'));
            },
            onRefresh: async () => {
                await Promise.resolve(loadNews(false));
                window.lwToast?.('Refreshing news...');
            }
        });
    }

    function setupHomePullRefresh() {
        const section = document.getElementById('view-home');
        const header = section?.querySelector('.lw-home-header');
        if (!section || !header || document.querySelector('[data-pull-refresh-id="home"]')) return;

        const pull = ensurePullRefreshHelpers();
        pull.attach({
            id: 'home',
            container: header,
            shouldStart: (target) => {
                if (section.hidden) return false;
                if ((window.scrollY || window.pageYOffset || 0) > 2) return false;
                const t = target && target.nodeType === 1 ? target : null;
                return !(t && t.closest('button,a,input,textarea,[contenteditable="true"]'));
            },
            onRefresh: async () => {
                if (window.LWLightStatus && typeof window.LWLightStatus.refreshNow === 'function') {
                    await Promise.resolve(window.LWLightStatus.refreshNow());
                }
                await Promise.resolve(loadNews(false));
                window.lwToast?.('Refreshing home updates...');
            }
        });
    }

    window.addEventListener('lw:route-changed', syncPollingToVisibility);

    document.addEventListener('DOMContentLoaded', () => {
        lwHomeNewsCarousel = initHomeNewsCarousel();
        bindCardInteractions();
        bindCategoryTabs();
        observeVisibility();
        setupNewsPullRefresh();
        setupHomePullRefresh();
        syncPollingToVisibility();
    });
})();