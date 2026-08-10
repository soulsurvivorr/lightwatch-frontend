// ============================================================
//  VIEWS/NOTIFICATIONS.JS
//  Loads the latest notification events for the redesigned
//  Notifications page.
// ============================================================

(function () {
    const NOTIFICATIONS_CACHE_KEY = 'lw_cache_notifications_list';
    const NOTIFICATIONS_NEWS_CACHE_KEY = 'lw_cache_notifications_matched_news';
    const SEEN_NOTIFICATION_NEWS_IDS_KEY = 'lw_seen_notification_news_ids';
    const READ_IDS_KEY = 'lw_read_notification_ids';
    const DELETED_IDS_KEY = 'lw_deleted_notification_ids';
    const MAX_SEEN_NEWS_IDS = 300;
    const MAX_READ_IDS = 500;
    const MAX_DELETED_IDS = 500;
    const TRENDING_REPORT_THRESHOLD = 8;
    const NOTIFICATION_PAGE_SIZE = 10;
    let notificationsPollTimer = null;

    let activeFilter = 'all';
    let latestMergedNotifications = [];
    let searchQuery = '';
    let visibleLimit = NOTIFICATION_PAGE_SIZE;
    let openSwipeCard = null;
    let swipePointerState = null;
    const NOTIF_SWIPE_WIDTH = 84;
    const NOTIF_SWIPE_OPEN_THRESHOLD = 40;

    function applyNotificationFilter(notifications) {
        let list = notifications.filter(n => !getDeletedIds().has(n.id));
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
        visibleLimit = NOTIFICATION_PAGE_SIZE;
        document.querySelectorAll('.notif-tabs .notif-tab').forEach(t => {
            const isActive = t.dataset.filter === filter;
            t.classList.toggle('is-active', isActive);
            t.setAttribute('aria-selected', String(isActive));
        });
        render();
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

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

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

    const KIND_META = {
        power_off:    { label: 'Power Off',      chip: 'OUTAGE',      color: 'red',    bucket: 'priority', accent: true  },
        outage_alert: { label: 'Outage Alert',   chip: 'ALERT',   color: 'amber',  bucket: 'priority', accent: true  },
        trending:     { label: 'Trending Report',chip: 'TRENDING',color: 'blue',   bucket: 'priority', accent: true  },
        news:         { label: 'News',           chip: 'NEWS',           color: 'amber',  bucket: 'priority', accent: true  },
        power_on:     { label: 'Power On',       chip: 'RESTORED',       color: 'green',  bucket: 'other',    accent: false },
        mention:      { label: 'Mention',        chip: 'MENTION',        color: 'blue',   bucket: 'mentions', accent: false },
        like:         { label: 'Like',           chip: 'LIKE',           color: 'red',    bucket: 'mentions', accent: false },
        repost:       { label: 'Repost',         chip: 'REPOST',         color: 'green',  bucket: 'mentions', accent: false },
        community:    { label: 'Community',      chip: 'COMMUNITY',      color: 'teal',   bucket: 'mentions', accent: false },
        report_update:{ label: 'Report Update',  chip: 'UPDATE',  color: 'purple', bucket: 'system',   accent: false },
        system:       { label: 'System',         chip: 'SYSTEM',         color: 'blue',   bucket: 'system',   accent: false }
    };

    function classifyNotification(notification) {
        let kind;
        switch (notification.type) {
            case 'warning':
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

    function synthesizeTrendingNotification(notifications) {
        const location = getCurrentLocation();
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        const recentCommunityCount = notifications.filter(n =>
            n.type === 'chat' && new Date(n.reportedAt).getTime() >= oneHourAgo
        ).length;
        if (recentCommunityCount < TRENDING_REPORT_THRESHOLD) return null;
        return {
            id: `trending-${new Date().toISOString().slice(0, 13)}`,
            title: 'High report activity in your area',
            text: `More than ${recentCommunityCount} reports in the last hour.`,
            reportedAt: new Date().toISOString(),
            type: 'trending',
            location: location || undefined
        };
    }

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

    function getDeletedIds() {
        try { return new Set(JSON.parse(localStorage.getItem(DELETED_IDS_KEY) || '[]')); }
        catch { return new Set(); }
    }

    function markIdsDeleted(ids) {
        if (!ids.length) return;
        const set = getDeletedIds();
        ids.forEach(id => set.add(id));
        const trimmed = Array.from(set).slice(-MAX_DELETED_IDS);
        localStorage.setItem(DELETED_IDS_KEY, JSON.stringify(trimmed));
    }

    function kindIconSvg(kind) {
        switch (kind) {
            case 'power_on':
                return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
            case 'like':
                return '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
            case 'outage_alert':
                return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="12" cy="12" r="8.4" stroke="currentColor" stroke-width="1.6"/><path d="M12 7.8v5.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="16.4" r="1" fill="currentColor"/></svg>';
            case 'news':
                return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 5h10.8A2.2 2.2 0 0 1 19 7.2V17a2 2 0 0 1-2 2H8.8A2.8 2.8 0 0 1 6 16.2V5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M11.4 10h4.8M11.4 12.8h4.8M11.4 15.6H15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
            default:
                return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 3.5 19 6v5.4c0 4.4-3 7.9-7 9.1-4-1.2-7-4.7-7-9.1V6l7-2.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 12.1l2 2 4-4.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        }
    }

    function renderCard(notification, readIds) {
        const { _kind: kind, _meta: meta } = notification;
        const isUnread = !readIds.has(notification.id);
        const isClickable = kind === 'mention' || kind === 'like' || kind === 'repost' || kind === 'community' || kind === 'news' || kind === 'report_update';
        const dataAttrs = kind === 'news'
            ? `data-action="open-news" data-url="${escapeHtml(notification.url)}"`
            : (kind === 'mention' || kind || 'community' || kind === 'report_update')
                ? `data-action="open-chat" data-chat-id="${escapeHtml(notification.chatId)}" data-chat-scope="${escapeHtml(notification.chatScope || 'local')}" data-chat-location="${escapeHtml(notification.chatLocation || '')}"`
                : '';

        return `
            <article class="notif-card${meta.accent ? ` notif-card--accent notif-card--${meta.color}` : ''}${isUnread ? ' notif-card--unread' : ''}"${isClickable ? ` tabindex="0" role="link" ${dataAttrs}` : ''} data-id="${escapeHtml(notification.id)}">
              <div class="notif-card__action-panel">
                <button type="button" class="notif-card__action notif-card__action--delete" data-action="delete-notification" aria-label="Delete notification">
                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M4.5 7h15M9.5 7V5.2A1.7 1.7 0 0 1 11.2 3.5h1.6A1.7 1.7 0 0 1 14.5 5.2V7M6.7 7l.8 12a2 2 0 0 0 2 1.9h5a2 2 0 0 0 2-1.9l.8-12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M10.2 11v6M13.8 11v6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                  </svg>
                </button>
              </div>
              <div class="notif-card__surface">
                <div class="notif-card__icon notif-card__icon--${meta.color}">${kindIconSvg(kind)}</div>
                <div class="notif-card__body">
                  <div class="notif-card__head">
                      <span class="notif-card__title">${escapeHtml(notification.title)}</span>
                      <div class="notif-card__head-actions">
                          <span class="notif-card__time">${LWHelpers.formatRelativeTimeFromDate(notification.reportedAt)}</span>
                          <button type="button" class="notif-card__delete" data-action="delete-notification" aria-label="Delete notification">
                              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                          </button>
                      </div>
                  </div>
                  <p class="notif-card__text">${escapeHtml(notification.text)}</p>
                  <div class="notif-card__footer">
                      <span class="notif-card__label notif-card__label--${meta.color}">${meta.chip}</span>
                      ${notification.location ? `<span class="notif-card__meta-dot">•</span><span class="notif-card__location">${escapeHtml(notification.location)}</span>` : ''}
                  </div>
                </div>
              </div>
            </article>`;
    }

    function emptyStateHtml(message) {
        return `<div class="notif-empty"><p>${escapeHtml(message)}</p></div>`;
    }

    function updateTabBadges(notifications, readIds) {
        const deletedIds = getDeletedIds();
        const counts = { all: 0, priority: 0, mentions: 0, system: 0 };
        notifications.forEach(n => {
            if (readIds.has(n.id) || deletedIds.has(n.id)) return;
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
        const deletedIds = getDeletedIds();
        const unreadCount = latestMergedNotifications.filter(n => !getReadIds().has(n.id) && !deletedIds.has(n.id)).length;
        if (window.LWNavBadges?.setCount) {
            window.LWNavBadges.setCount('notifications', unreadCount);
        }
    }

    function getGroupTitle(dateStr) {
        const date = new Date(dateStr);
        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(today.getDate() - 1);

        if (date.toDateString() === today.toDateString()) return 'Today';
        if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
        return 'Earlier';
    }

    function render() {
        closeOpenSwipeCard();
        const classified = latestMergedNotifications;
        const readIds = getReadIds();
        updateTabBadges(classified, readIds);
        syncNavBadgeCountWithReadState();

        const groupedList = document.getElementById('notifGroupedList');
        const flatList = document.getElementById('notifFlatList');
        if (!groupedList || !flatList) return;

        const deletedIds = getDeletedIds();
        const activeNotifications = classified.filter(n => !deletedIds.has(n.id));
        const filtered = applyNotificationFilter(activeNotifications);
        const visibleNotifications = filtered.slice(0, visibleLimit);
        const hasMore = filtered.length > visibleLimit;

        if (activeFilter === 'all') {
            groupedList.hidden = false;
            flatList.hidden = true;

            const groups = {};
            visibleNotifications.forEach(n => {
                const title = getGroupTitle(n.reportedAt);
                if (!groups[title]) groups[title] = [];
                groups[title].push(n);
            });

            const groupOrder = ['Today', 'Yesterday', 'Earlier'];
            groupedList.innerHTML = groupOrder.map(title => {
                const items = groups[title];
                if (!items || !items.length) return '';
                return `
                    <div class="notif-group">
                        <h2 class="notif-group__title">${title}</h2>
                        <div class="notif-list">${items.map(n => renderCard(n, readIds)).join('')}</div>
                    </div>`;
            }).join('') || emptyStateHtml('No notifications yet');
        } else {
            groupedList.hidden = true;
            flatList.hidden = false;

            flatList.innerHTML = `
                <div class="notif-list">
                    ${visibleNotifications.length ? visibleNotifications.map(n => renderCard(n, readIds)).join('') : emptyStateHtml('No matching notifications')}
                </div>`;
        }

        const loadMoreContainer = document.getElementById('notifLoadMore');
        if (loadMoreContainer) {
            loadMoreContainer.innerHTML = hasMore ? `<button type="button" class="notif-load-more__btn" data-action="load-more-notifications">Load more</button>` : '';
            loadMoreContainer.hidden = !hasMore;
        }
    }

    function showNotificationLoading() {
        const groupedList = document.getElementById('notifGroupedList');
        if (!groupedList) return;
        groupedList.innerHTML = `
            <div class="notif-group">
                <div class="notif-list">
                    ${Array.from({ length: 3 }).map(() => `<article class="notif-card"><div class="skel skel-block" style="height:60px;width:100%;"></div></article>`).join('')}
                </div>
            </div>`;
    }

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

    let interactionsBound = false;
    function closeOpenSwipeCard() {
        if (!openSwipeCard) return;
        const surface = openSwipeCard.querySelector('.notif-card__surface');
        if (surface) {
            // Dragging is over (or was never active, e.g. closed via a
            // button click) — make sure the transition is on so this
            // snaps back smoothly instead of jumping to closed.
            surface.classList.remove('notif-card__surface--dragging');
            surface.style.transform = '';
        }
        openSwipeCard.classList.remove('is-swipe-open');
        openSwipeCard.dataset.swipePreventClick = '0';
        openSwipeCard = null;
    }

    function setSwipeTranslation(card, x) {
        const surface = card.querySelector('.notif-card__surface');
        if (!surface) return;
        surface.style.transform = `translateX(${x}px)`;
        if (x === 0) {
            card.classList.remove('is-swipe-open');
        } else {
            card.classList.add('is-swipe-open');
        }
    }

    // Toggles the "actively being dragged" state on a card's surface.
    // While true, the CSS transition is switched off so the card tracks
    // the pointer 1:1; once false, the transition is back on so the
    // snap-to-open or snap-to-closed motion on release is animated
    // instead of an instant jump.
    function setSwipeDragging(card, isDragging) {
        const surface = card && card.querySelector('.notif-card__surface');
        if (!surface) return;
        surface.classList.toggle('notif-card__surface--dragging', isDragging);
    }

    function bindCardInteractions() {
        const page = document.querySelector('#view-notifications');
        if (!page || interactionsBound) return;
        interactionsBound = true;

        const openNotification = (card) => {
            if (card.classList.contains('is-swipe-open')) {
                closeOpenSwipeCard();
                return;
            }
            markIdsRead([card.dataset.id]);
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
            render();
        };

        page.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            const card = e.target.closest('.notif-card');
            if (!card) return;
            if (e.target.closest('button')) return;

            if (openSwipeCard && openSwipeCard !== card) {
                closeOpenSwipeCard();
            }

            swipePointerState = {
                card,
                pointerId: e.pointerId,
                startX: e.clientX,
                startY: e.clientY,
                startTranslate: card.classList.contains('is-swipe-open') ? -NOTIF_SWIPE_WIDTH : 0,
                moved: false
            };
            card.setPointerCapture(e.pointerId);
        });

        page.addEventListener('pointermove', (e) => {
            if (!swipePointerState || e.pointerId !== swipePointerState.pointerId) return;
            const dx = e.clientX - swipePointerState.startX;
            const dy = e.clientY - swipePointerState.startY;
            if (!swipePointerState.moved) {
                if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
                if (Math.abs(dx) < Math.abs(dy)) return;
                swipePointerState.moved = true;
                if (swipePointerState.card) {
                    swipePointerState.card.dataset.swipePreventClick = '1';
                    // Live drag starting now — track the pointer with no
                    // transition lag until the finger/pointer lifts.
                    setSwipeDragging(swipePointerState.card, true);
                }
            }
            e.preventDefault();
            const targetX = Math.max(Math.min(swipePointerState.startTranslate + dx, 0), -NOTIF_SWIPE_WIDTH);
            setSwipeTranslation(swipePointerState.card, targetX);
        });

        const endSwipe = () => {
            if (!swipePointerState) return;
            const card = swipePointerState.card;
            const surface = card.querySelector('.notif-card__surface');
            // Re-enable the transition before setting the final position,
            // so the settle into fully-open or fully-closed is a smooth
            // animation rather than snapping instantly.
            setSwipeDragging(card, false);
            if (surface) {
                const currentX = Number(getComputedStyle(surface).transform.split(',')[4] || 0);
                if (currentX <= -NOTIF_SWIPE_OPEN_THRESHOLD) {
                    setSwipeTranslation(card, -NOTIF_SWIPE_WIDTH);
                    openSwipeCard = card;
                } else {
                    closeOpenSwipeCard();
                }
            } else {
                closeOpenSwipeCard();
            }
            swipePointerState = null;
        };

        page.addEventListener('pointerup', endSwipe);
        page.addEventListener('pointercancel', endSwipe);

        page.addEventListener('click', (e) => {
            if (e.target.closest('[data-action="load-more-notifications"]')) {
                visibleLimit += NOTIFICATION_PAGE_SIZE;
                render();
                return;
            }
            const deleteBtn = e.target.closest('[data-action="delete-notification"]');
            if (deleteBtn) {
                const card = deleteBtn.closest('.notif-card');
                if (!card) return;
                markIdsDeleted([card.dataset.id]);
                closeOpenSwipeCard();
                render();
                window.lwToast?.('Notification deleted');
                return;
            }
            const card = e.target.closest('.notif-card[data-action]');
            if (card) {
                if (card.dataset.swipePreventClick === '1') {
                    card.dataset.swipePreventClick = '0';
                    return;
                }
                openNotification(card);
            }
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
            toggle.classList.toggle('is-active', willShow);
            if (willShow) input.focus();
            else {
                input.value = '';
                searchQuery = '';
                visibleLimit = NOTIFICATION_PAGE_SIZE;
                render();
            }
        });
        input.addEventListener('input', () => {
            searchQuery = input.value.trim();
            visibleLimit = NOTIFICATION_PAGE_SIZE;
            render();
        });
    }

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
                return null;
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
                return articles.map(matchedNewsToNotificationItem);
            })
            .catch(err => {
                console.error('Could not load news for notifications feed:', err);
                return [];
            });
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
            showNotifSkeleton();
            showNotificationLoading();
        }

        Promise.all([fetchCommunityNotifications(), fetchMatchedNews()]).then(([notifications, newsItems]) => {
            if (notifications === null) {
                if (!cached) {
                    latestMergedNotifications = mergeAndClassify([], newsItems);
                    render();
                }
                hideNotifSkeleton();
                return;
            }
            latestMergedNotifications = mergeAndClassify(notifications, newsItems);
            render();
            LWCache.write(NOTIFICATIONS_CACHE_KEY, [...notifications, ...newsItems]
                .sort((a, b) => new Date(b.reportedAt) - new Date(a.reportedAt)));
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