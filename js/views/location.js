// ============================================================
//  VIEWS/LOCATION.JS
//  Map + "Nearby Locations" view of Kumasi neighborhoods and their
//  current light status, with search, category filters, favorites,
//  and a collapsible nearby-locations list.
//
//  Changed vs. the previous list-only implementation:
//   - Rendering now targets the new map (#locMapPins / #locMapUser)
//     and the redesigned #locNearbyList row layout instead of the
//     old #areaGrid liveboard.
//   - Still wrapped into mount()/show()/hide() for the router. Polling
//     (POLL_INTERVAL_STANDARD_MS, from utils/constants.js) starts in
//     show() and stops in hide(), same as before.
//   - The render-cache read/write still goes through services/cache.js
//     (LWCache) — unchanged.
//   - New: favorites persist in localStorage and drive the
//     "Favorites" filter pill + each row's star toggle.
// ============================================================

(function () {
    const DEMO_LOCATIONS = [
        { name: 'Asokwa', status: 'on', minutesAgo: 12, confirmations: 5, distanceKm: 0.6 },
        { name: 'Adum', status: 'off', minutesAgo: 244, confirmations: 2, distanceKm: 2.0 },
        { name: 'Suame', status: 'on', minutesAgo: 18, confirmations: 6, distanceKm: 3.1 },
        { name: 'Ahodwo', status: 'off', minutesAgo: 9, confirmations: 1, distanceKm: 2.6 },
        { name: 'Nhyiaeso', status: 'on', minutesAgo: 1450, confirmations: 8, distanceKm: 3.8 },
        { name: 'Tafo', status: 'unknown', minutesAgo: 7, confirmations: 0, distanceKm: 2.3 },
        { name: 'KNUST', status: 'on', minutesAgo: 5, confirmations: 4, distanceKm: 4.2 },
        { name: 'Ejisu', status: 'unknown', minutesAgo: 130, confirmations: 1, distanceKm: 5.4 },
        { name: 'Kwadaso', status: 'off', minutesAgo: 11, confirmations: 3, distanceKm: 1.8 }
    ];

    // Percent-based positions on the static map image, keyed by
    // location name (case-insensitive). Purely presentational — this
    // is an illustrative map, not a real geocoded one.
    const MAP_POSITIONS = {
        'bantama': { left: 20, top: 52 },
        'asokwa': { left: 78, top: 40 },
        'adum': { left: 60, top: 70 },
        'suame': { left: 22, top: 24 },
        'ahodwo': { left: 34, top: 82 },
        'nhyiaeso': { left: 74, top: 78 },
        'tafo': { left: 68, top: 20 },
        'knust': { left: 46, top: 14 },
        'ejisu': { left: 88, top: 58 },
        'kwadaso': { left: 12, top: 78 }
    };

    function normalizeAreaName(name) {
        return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    const LOCATION_CACHE_KEY = 'lw_cache_location_bantama';
    const FAVORITES_KEY = 'lw_location_favorites';

    let locationPollTimer = null;
    let currentFilter = 'all';
    let currentSearch = '';
    let controlsBound = false;
    let latestLocations = [];
    let nearbyCollapsed = false;

    function readFavorites() {
        try {
            const raw = localStorage.getItem(FAVORITES_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (err) {
            return [];
        }
    }

    function writeFavorites(list) {
        try {
            localStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
        } catch (err) {
            // Storage unavailable — favorites just won't persist this session.
        }
    }

    function isFavorited(name) {
        return readFavorites().includes(name);
    }

    function toggleFavorite(name) {
        const list = readFavorites();
        const idx = list.indexOf(name);
        if (idx === -1) {
            list.push(name);
        } else {
            list.splice(idx, 1);
        }
        writeFavorites(list);
    }

    function statusMeta(status) {
        const isOn = status === 'on';
        const isUnknown = status === 'unknown' || !status;
        return {
            isOn,
            isUnknown,
            label: isUnknown ? 'Checking' : isOn ? 'Power is ON' : 'Power is OFF',
            cls: isUnknown ? 'checking' : isOn ? 'on' : 'off'
        };
    }

    function getCurrentUserData() {
        try {
            const raw = localStorage.getItem('currentUserData') || sessionStorage.getItem('currentUserData');
            return JSON.parse(raw || '{}');
        } catch (err) {
            return {};
        }
    }

    function getRegisteredLocationName() {
        const user = getCurrentUserData();
        if (user.city && String(user.city).trim()) {
            return String(user.city).trim();
        }
        return user.region ? String(user.region).trim() : null;
    }

    // ---- Map pins ----

    function pinTemplate(area) {
        const normalized = normalizeAreaName(area.name);
        const pos = MAP_POSITIONS[normalized] || { left: 50, top: 50 };
        const meta = statusMeta(area.status);
        const labelText = area.name || getRegisteredLocationName() || 'Location';
        return `
      <div class="loc-map__pin loc-map__pin--${meta.cls}" style="left:${pos.left}%;top:${pos.top}%" data-area="${area.name}" title="${labelText} — ${meta.label}">
        ${meta.isOn ? `<span class="loc-map__pin__label">${labelText}</span>` : ''}
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" fill="currentColor"/></svg>
      </div>
    `;
    }

    function renderMapPins(locations) {
        const pinsEl = document.getElementById('locMapPins');
        if (!pinsEl) return;
        pinsEl.innerHTML = locations.map(pinTemplate).join('');
    }

    // ---- Nearby locations list ----

    function nearbyRowTemplate(area) {
        const meta = statusMeta(area.status);
        const timeText = LWHelpers.formatRelativeTimeFromMinutes(area.minutesAgo);
        const favorited = isFavorited(area.name);
        const distanceText = typeof area.distanceKm === 'number' ? `${area.distanceKm.toFixed(1)} km` : '';

        return `
      <div class="loc-row" data-area="${area.name}" data-status="${area.status}" data-favorite="${favorited ? '1' : '0'}" data-name="${area.name.toLowerCase()}" role="listitem">
        <span class="loc-row__icon loc-row__icon--${meta.cls}">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" fill="currentColor"/></svg>
        </span>
        <div class="loc-row__body">
          <div class="loc-row__name-line">
            <span class="loc-row__name">${area.name}</span>
            ${area.live ? '<span class="loc-row__badge">Your Area</span>' : ''}
          </div>
          <p class="loc-row__status loc-row__status--${meta.cls}">${meta.label}</p>
          <p class="loc-row__meta">Updated ${timeText} · ${area.confirmations || 0} reports</p>
        </div>
        <div class="loc-row__aside">
          <button type="button" class="loc-row__star ${favorited ? 'is-active' : ''}" aria-label="${favorited ? 'Remove from favorites' : 'Add to favorites'}" aria-pressed="${favorited ? 'true' : 'false'}">
            <svg viewBox="0 0 24 24" fill="${favorited ? 'currentColor' : 'none'}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8L12 3.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
          </button>
          ${distanceText ? `<span class="loc-row__distance">${distanceText}</span>` : ''}
          <svg class="loc-row__chevron" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="m9 6 6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
      </div>
    `;
    }

    function applyFilters() {
        const list = document.getElementById('locNearbyList');
        if (!list) return;

        let visibleCount = 0;
        list.querySelectorAll('.loc-row').forEach(row => {
            let matchesFilter = true;
            if (currentFilter === 'favorites') {
                matchesFilter = row.dataset.favorite === '1';
            } else if (currentFilter === 'myareas') {
                matchesFilter = row.dataset.area === 'Bantama';
            }
            const matchesSearch = !currentSearch || row.dataset.name.includes(currentSearch);
            const show = matchesFilter && matchesSearch;
            row.style.display = show ? '' : 'none';
            if (show) visibleCount++;
        });

        const emptyState = document.getElementById('locationEmptyState');
        if (emptyState) {
            emptyState.style.display = visibleCount === 0 ? 'flex' : 'none';
        }
    }

    function renderLocations(locations) {
        latestLocations = locations;

        const list = document.getElementById('locNearbyList');
        if (list) {
            // User's own (live) location always sits first; the rest keep
            // their existing order. If "Nearby" is the active filter, sort
            // everyone else by distance ascending.
            const own = locations.filter(a => a.live);
            let rest = locations.filter(a => !a.live);
            if (currentFilter === 'nearby') {
                rest = rest.slice().sort((a, b) => (a.distanceKm || 0) - (b.distanceKm || 0));
            }
            list.innerHTML = own.concat(rest).map(nearbyRowTemplate).join('');
        }

        renderMapPins(locations);
        applyFilters();
    }

    async function fetchLiveTowns() {
        const registeredName = getRegisteredLocationName();
        const name = registeredName || 'Bantama';
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
                distanceKm: 0,
                live: true
            };
        } catch (err) {
            console.error(`Failed to load live status for ${name}:`, err.message);
            return { name, status: 'unknown', minutesAgo: null, confirmations: null, distanceKm: 0, live: true };
        }
    }

    // Mirrors profile.js's hideProfileLoader() timing for Home: mark the
    // skeleton as fading (location.css transitions its opacity to 0 while
    // .app-loading — and therefore display:block — is still in effect),
    // then once that's had a moment to actually paint, drop .app-loading
    // (snapping the now-invisible skeleton to display:none) and let
    // #locationRealContent play its entrance animation.
    function hideLocationSkeleton() {
        if (!document.body.classList.contains('app-loading')) return;
        const skeleton = document.getElementById('locationSkeleton');
        if (skeleton) skeleton.classList.add('lw-skel-fading');
        setTimeout(() => {
            document.body.classList.remove('app-loading');
            const realContent = document.getElementById('locationRealContent');
            if (realContent) realContent.classList.add('lw-content-reveal');
        }, 180);
    }

    async function loadLocations(isFirstLoad = false) {
        if (isFirstLoad) {
            const cached = LWCache.read(LOCATION_CACHE_KEY, CACHE_MAX_AGE_MEDIUM_MS);
            if (cached) {
                renderLocations([{ ...cached, live: true }, ...DEMO_LOCATIONS]);
                hideLocationSkeleton();
            }
        }
        const liveBantama = await fetchLiveTowns();
        renderLocations([liveBantama, ...DEMO_LOCATIONS]);
        LWCache.write(LOCATION_CACHE_KEY, liveBantama);
        hideLocationSkeleton();
    }

    function bindControls() {
        if (controlsBound) return;
        controlsBound = true;

        // Category filter pills (All Locations / Favorites / Nearby / My Areas)
        document.querySelectorAll('#locFilters .loc-filter').forEach(pill => {
            pill.addEventListener('click', () => {
                document.querySelectorAll('#locFilters .loc-filter').forEach(p => {
                    p.classList.remove('is-active');
                    p.setAttribute('aria-selected', 'false');
                });
                pill.classList.add('is-active');
                pill.setAttribute('aria-selected', 'true');
                currentFilter = pill.dataset.filter;
                renderLocations(latestLocations);
            });
        });

        const searchInput = document.getElementById('locationSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                currentSearch = searchInput.value.trim().toLowerCase();
                applyFilters();
            });
        }

        // Star / favorite toggle
        const list = document.getElementById('locNearbyList');
        if (list) {
            list.addEventListener('click', (event) => {
                const star = event.target.closest('.loc-row__star');
                if (!star) return;
                event.preventDefault();
                event.stopPropagation();
                const row = star.closest('.loc-row');
                if (!row) return;
                toggleFavorite(row.dataset.area);
                renderLocations(latestLocations);
            });
        }

        // Collapsible nearby-locations panel
        const handle = document.getElementById('locNearbyHandle');
        const nearby = document.getElementById('locNearby');
        if (handle && nearby) {
            handle.addEventListener('click', () => {
                nearbyCollapsed = !nearbyCollapsed;
                nearby.classList.toggle('loc-nearby--collapsed', nearbyCollapsed);
                handle.setAttribute('aria-expanded', nearbyCollapsed ? 'false' : 'true');
                handle.setAttribute('aria-label', nearbyCollapsed ? 'Expand nearby locations' : 'Collapse nearby locations');
            });
        }

        // Re-center / re-ping the user's pin
        const locateBtn = document.getElementById('locMapLocateBtn');
        const userMarker = document.getElementById('locMapUser');
        if (locateBtn && userMarker) {
            locateBtn.addEventListener('click', () => {
                userMarker.classList.remove('loc-map__user--ping');
                // Force reflow so the animation can restart on repeated clicks.
                void userMarker.offsetWidth;
                userMarker.classList.add('loc-map__user--ping');
            });
        }
    }

    function mount() {
        bindControls();
        loadLocations(true);
    }

    function show() {
        document.body.classList.add('view-location-active');
        clearInterval(locationPollTimer);
        locationPollTimer = setInterval(() => loadLocations(false), POLL_INTERVAL_STANDARD_MS);
    }

    function hide() {
        document.body.classList.remove('view-location-active');
        clearInterval(locationPollTimer);
        locationPollTimer = null;
    }

    window.LWViews = window.LWViews || {};
    window.LWViews.location = { mount, show, hide };
})();