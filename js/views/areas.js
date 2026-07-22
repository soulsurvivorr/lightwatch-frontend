// ============================================================
//  VIEWS/AREAS.JS
//  Dense, scannable list of Kumasi neighborhoods and their current
//  light status, with a confidence signal, search, and status
//  filtering.
//
//  Changed vs. the original areas.js:
//   - Wrapped into mount()/show()/hide() for the router. Polling
//     (POLL_INTERVAL_STANDARD_MS, from utils/constants.js) now
//     starts in show() and stops in hide() — no point fetching
//     Bantama's live status every 45s while someone's looking at
//     Reports or Account instead.
//   - The render-cache read/write now goes through services/cache.js
//     (LWCache) instead of its own inline localStorage helpers —
//     same behavior, one implementation.
// ============================================================

(function () {
    const DEMO_AREAS = [
        { name: 'Asokwa', status: 'on', minutesAgo: 12, confirmations: 5 },
        { name: 'Adum', status: 'off', minutesAgo: 244, confirmations: 2 },
        { name: 'Suame', status: 'on', minutesAgo: 18, confirmations: 6 },
        { name: 'Ahodwo', status: 'off', minutesAgo: 9, confirmations: 1 },
        { name: 'Nhyiaeso', status: 'on', minutesAgo: 1450, confirmations: 8 },
        { name: 'Tafo', status: 'unknown', minutesAgo: 7, confirmations: 0 },
        { name: 'KNUST', status: 'on', minutesAgo: 5, confirmations: 4 },
        { name: 'Ejisu', status: 'unknown', minutesAgo: 130, confirmations: 1 },
        { name: 'Kwadaso', status: 'off', minutesAgo: 11, confirmations: 3 }
    ];

    const AREAS_CACHE_KEY = 'lw_cache_areas_bantama';

    let areasPollTimer = null;
    let currentFilter = 'all';
    let currentSearch = '';
    let controlsBound = false;

    function confidenceInfo(confirmations) {
        if (confirmations === null || confirmations === undefined) {
            return { label: 'Unverified', cls: 'unverified', title: 'No community confirmations yet' };
        }
        if (confirmations >= 4) {
            return { label: 'High', cls: 'high', title: `High confidence — ${confirmations} matching reports` };
        }
        if (confirmations >= 2) {
            return { label: 'Medium', cls: 'medium', title: `Medium confidence — ${confirmations} matching reports` };
        }
        if (confirmations === 1) {
            return { label: 'Low', cls: 'low', title: '1 report — not yet confirmed by others' };
        }
        return { label: 'Unverified', cls: 'unverified', title: 'No community confirmations yet' };
    }

    function confidencePercent(confirmations) {
        if (confirmations === null || confirmations === undefined) return 20;
        if (confirmations <= 0) return 16;
        if (confirmations === 1) return 38;
        if (confirmations === 2) return 57;
        if (confirmations === 3) return 71;
        return Math.min(96, 78 + (confirmations - 4) * 4);
    }

    function areaRowTemplate({ name, status, minutesAgo, confirmations, live }) {
        const isOn = status === 'on';
        const isUnknown = status === 'unknown' || !status;
        const statusLabel = isUnknown ? 'Checking' : isOn ? 'On' : 'Off';
        const badgeClass = isUnknown ? 'badge--low' : isOn ? 'badge--on' : 'badge--off';
        const pulseClass = isUnknown ? 'pulse--low' : isOn ? 'pulse--on' : 'pulse--off';
        const timeText = LWHelpers.formatRelativeTimeFromMinutes(minutesAgo);
        const confidence = confidenceInfo(confirmations);
        const confidencePct = confidencePercent(confirmations);
        const confidenceCount = confirmations === null || confirmations === undefined ? 0 : confirmations;
        const statusInsight = isUnknown
            ? 'Signal is still settling. More reports will lock this in.'
            : isOn
                ? 'Power is stable in recent checks. Risk of disruption is currently low.'
                : 'Recent reports lean toward outage. Keep devices charged as a backup.';
        const detailsId = `area-details-${LWHelpers.safeId(name)}`;

        return `
      <div class="area-row" data-area="${name}" data-status="${status}" data-name="${name.toLowerCase()}" role="listitem">
        <div class="area-row__main">
          <span class="area-row__dot pulse ${pulseClass}"></span>
          <span class="area-row__name">${name}${live ? ' <span class="area-row__live">LIVE</span>' : ''}</span>
          <span class="area-row__confidence area-row__confidence--${confidence.cls}" title="${confidence.title}">${confidence.label}</span>
          <span class="area-row__time">${timeText}</span>
          <span class="badge ${badgeClass} area-row__badge">${statusLabel}</span>
          <span class="area-row__toggle" role="button" tabindex="0" aria-expanded="false" aria-controls="${detailsId}" aria-label="Show ${name} details"></span>
        </div>
        <div class="area-row__details" id="${detailsId}">
          <p class="area-details__summary">${statusInsight}</p>
          <div class="area-details__metric-row">
            <span class="area-details__label">Confidence</span>
            <span class="area-details__value">${confidencePct}% (${confidenceCount} reports)</span>
          </div>
          <div class="area-details__meter" role="presentation" aria-hidden="true">
            <span style="width:${confidencePct}%"></span>
          </div>
          <div class="area-details__meta">Community pulse updates: ${timeText}</div>
        </div>
      </div>
    `;
    }

    function renderSummary(areas) {
        const onCount = areas.filter(a => a.status === 'on').length;
        const offCount = areas.filter(a => a.status === 'off').length;
        const unknownCount = areas.filter(a => a.status === 'unknown' || !a.status).length;
        const summaryEl = document.getElementById('areasSummaryText');
        if (summaryEl) {
            summaryEl.textContent = `${onCount} on · ${offCount} off · ${unknownCount} checking`;
        }
    }

    function applyFilters() {
        const grid = document.getElementById('areaGrid');
        if (!grid) return;

        let visibleCount = 0;
        grid.querySelectorAll('.area-row').forEach(row => {
            const matchesFilter = currentFilter === 'all' || row.dataset.status === currentFilter;
            const matchesSearch = !currentSearch || row.dataset.name.includes(currentSearch);
            const show = matchesFilter && matchesSearch;
            row.style.display = show ? '' : 'none';
            if (show) visibleCount++;
        });

        const emptyState = document.getElementById('areasEmptyState');
        if (emptyState) {
            emptyState.style.display = visibleCount === 0 ? 'flex' : 'none';
        }
    }

    function renderAreas(areas) {
        const grid = document.getElementById('areaGrid');
        if (!grid) return;

        const prioritized = areas
            .map((area, index) => ({ area, index }))
            .sort((a, b) => {
                const aOn = a.area.status === 'on' ? 1 : 0;
                const bOn = b.area.status === 'on' ? 1 : 0;
                if (aOn !== bOn) return bOn - aOn;
                return a.index - b.index;
            })
            .map(entry => entry.area);

        renderSummary(prioritized);
        grid.innerHTML = prioritized.map(areaRowTemplate).join('');
        applyFilters();
    }

    async function fetchLiveTowns() {
        const name = 'Bantama';
        try {
            const res = await fetch(`${LWHelpers.apiBase()}/lightstatus?location=${encodeURIComponent(name)}`);
            if (!res.ok) throw new Error(`Bad response for ${name}`);
            const data = await res.json();
            const reportedAt = data.reportedAt ? new Date(data.reportedAt).getTime() : null;
            const minutesAgo = reportedAt ? Math.max(0, Math.round((Date.now() - reportedAt) / 60000)) : null;
            return {
                name,
                status: data.status || 'unknown',
                minutesAgo,
                confirmations: data.stats ? data.stats.uniqueContributors : null,
                live: true
            };
        } catch (err) {
            console.error(`Failed to load live status for ${name}:`, err.message);
            return { name, status: 'unknown', minutesAgo: null, confirmations: null, live: true };
        }
    }

    // Mirrors profile.js's hideProfileLoader() timing for Home: mark the
    // skeleton as fading (areas.css transitions its opacity to 0 while
    // .app-loading — and therefore display:block — is still in effect),
    // then once that's had a moment to actually paint, drop .app-loading
    // (snapping the now-invisible skeleton to display:none) and let
    // #areasRealContent play its entrance animation. Without this, the
    // skeleton used to just vanish and reappear instantly instead of
    // fading, and — before areas.css's display:none/block gate existed —
    // both elements were visible in normal flow at once, which is what
    // pushed the real content down beneath the skeleton.
    function hideAreasSkeleton() {
        if (!document.body.classList.contains('app-loading')) return;
        const skeleton = document.getElementById('areasSkeleton');
        if (skeleton) skeleton.classList.add('lw-skel-fading');
        setTimeout(() => {
            document.body.classList.remove('app-loading');
            const realContent = document.getElementById('areasRealContent');
            if (realContent) realContent.classList.add('lw-content-reveal');
        }, 180);
    }

    async function loadAreas(isFirstLoad = false) {
        if (isFirstLoad) {
            const cached = LWCache.read(AREAS_CACHE_KEY, CACHE_MAX_AGE_MEDIUM_MS);
            if (cached) {
                renderAreas([cached, ...DEMO_AREAS]);
                hideAreasSkeleton();
            }
        }
        const liveBantama = await fetchLiveTowns();
        renderAreas([liveBantama, ...DEMO_AREAS]);
        LWCache.write(AREAS_CACHE_KEY, liveBantama);
        hideAreasSkeleton();
    }

    function bindControls() {
        if (controlsBound) return;
        controlsBound = true;

        document.querySelectorAll('#view-areas .areas-filter-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('#view-areas .areas-filter-tab').forEach(t => t.classList.remove('is-active'));
                tab.classList.add('is-active');
                currentFilter = tab.dataset.filter;
                applyFilters();
            });
        });

        const searchInput = document.getElementById('areasSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                currentSearch = searchInput.value.trim().toLowerCase();
                applyFilters();
            });
        }

        const grid = document.getElementById('areaGrid');
        if (grid) {
            grid.addEventListener('click', (event) => {
                const toggle = event.target.closest('.area-row__toggle');
                if (!toggle) return;
                const row = toggle.closest('.area-row');
                if (!row) return;
                const willOpen = !row.classList.contains('is-open');
                row.classList.toggle('is-open', willOpen);
                toggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
            });

            grid.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                const toggle = event.target.closest('.area-row__toggle');
                if (!toggle) return;
                event.preventDefault();
                toggle.click();
            });
        }
    }

    function mount() {
        bindControls();
        loadAreas(true);
    }

    function show() {
        clearInterval(areasPollTimer);
        areasPollTimer = setInterval(() => loadAreas(false), POLL_INTERVAL_STANDARD_MS);
    }

    function hide() {
        clearInterval(areasPollTimer);
        areasPollTimer = null;
    }

    window.LWViews = window.LWViews || {};
    window.LWViews.areas = { mount, show, hide };
})();