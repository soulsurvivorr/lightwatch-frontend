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
    // FIX: this used to be a fixed list of 9 Kumasi neighborhoods, so no
    // matter what city/town a user actually signed up with, the "Nearby
    // Locations" panel and the map pins always showed the same hardcoded
    // set. KNOWN_AREAS_FALLBACK now only exists as a last resort if
    // GET /areas/known can't be reached at all; real areas are fetched
    // from the server (every city anyone signed up with, plus every
    // location a light status has ever been reported for) in
    // fetchKnownAreaNames() below.
    //
    // NOTE: distanceKm is intentionally left out. There's no backend
    // support today for per-user or per-area coordinates (signup's
    // reverse-geocode only turns lat/lng into a text address — it isn't
    // persisted anywhere), so a real "distance from me" figure isn't
    // available yet. nearbyRowTemplate already renders an empty distance
    // string when distanceKm isn't a number, so this doesn't break
    // display — but the "Nearby" filter's sort has nothing real to sort
    // by until that data exists.
    const KNOWN_AREAS_FALLBACK = [
        'Asokwa', 'Adum', 'Suame', 'Ahodwo', 'Nhyiaeso',
        'Tafo', 'KNUST', 'Ejisu', 'Kwadaso'
    ];

    // Percent-based positions on the static map image, keyed by
    // location name (case-insensitive). Purely presentational — this
    // is an illustrative map, not a real geocoded one. Any area that
    // isn't one of these hand-placed Kumasi spots (e.g. a newly added
    // town from a real signup) falls back to fallbackPosition() below
    // instead of every unknown area stacking on the exact same 50/50
    // center point.
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

    // Deterministic (same name -> same spot every render) stand-in
    // position for any area with no hand-placed entry in MAP_POSITIONS,
    // spread across a middle band of the map instead of all landing on
    // one point.
    function fallbackPosition(name) {
        let hash = 0;
        const str = String(name || '');
        for (let i = 0; i < str.length; i++) {
            hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
        }
        return {
            left: 15 + (hash % 70),
            top: 20 + ((hash >> 8) % 60)
        };
    }

    function normalizeAreaName(name) {
        return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    const LOCATION_CACHE_KEY = 'lw_cache_location_bantama';
    const LOCATION_LIST_CACHE_KEY = 'lw_cache_location_list';
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
        const pos = MAP_POSITIONS[normalized] || fallbackPosition(normalized);
        const meta = statusMeta(area.status);
        const labelText = area.name || getRegisteredLocationName() || 'Location';
        // FIX: the city/town label used to only render when the light was
        // ON (`meta.isOn ? ... : ''`), so every OFF/unknown pin on the map
        // was an unlabeled dot with no name — now every pin always carries
        // its name.
        return `
      <div class="loc-map__pin loc-map__pin--${meta.cls}" style="left:${pos.left}%;top:${pos.top}%" data-area="${area.name}" title="${labelText} — ${meta.label}">
        <span class="loc-map__pin__label">${labelText}</span>
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
        <span class="loc-row__icon loc-row__icon--${meta.cls}" data-action="toggle-area-status" role="button" tabindex="0" style="cursor:pointer" aria-label="Tap to report the light status for ${area.name}">
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

    // Shared by fetchLiveTowns() (the user's own registered location) and
    // fetchKnownAreas() (every other neighborhood in KNOWN_AREAS) — both
    // just hit GET /lightstatus for a given name and shape the response
    // into the same row object nearbyRowTemplate/renderMapPins expect.
    async function fetchAreaStatus(name, extra = {}) {
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
                ...extra
            };
        } catch (err) {
            console.error(`Failed to load live status for ${name}:`, err.message);
            return { name, status: 'unknown', minutesAgo: null, confirmations: null, ...extra };
        }
    }

    async function fetchLiveTowns() {
        const registeredName = getRegisteredLocationName();
        const name = registeredName || 'Bantama';
        return fetchAreaStatus(name, { live: true });
    }

    // FIX: names used to always come from the hardcoded KNOWN_AREAS
    // list, so a town someone actually signed up with never showed up
    // here unless it happened to already be in that list. This now asks
    // the server for every city anyone has registered with plus every
    // location a light status has ever been reported for
    // (GET /areas/known), falling back to the old hardcoded list only if
    // that request fails (e.g. offline).
    async function fetchKnownAreaNames() {
        try {
            const res = await fetch(`${LWHelpers.apiBase()}/areas/known`);
            if (!res.ok) throw new Error('Bad response for /areas/known');
            const data = await res.json();
            if (Array.isArray(data.areas) && data.areas.length) return data.areas;
            return KNOWN_AREAS_FALLBACK;
        } catch (err) {
            console.error('Failed to load known areas, using fallback list:', err.message);
            return KNOWN_AREAS_FALLBACK;
        }
    }

    // Fetches real status for every other known area in parallel
    // (skipping whichever one is the user's own registered location, so
    // it isn't shown twice — once as the live row, once again in the list).
    async function fetchKnownAreas(ownName) {
        const ownNormalized = normalizeAreaName(ownName);
        const allNames = await fetchKnownAreaNames();
        const names = allNames.filter(n => normalizeAreaName(n) !== ownNormalized);
        return Promise.all(names.map(n => fetchAreaStatus(n)));
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
            const cached = LWCache.read(LOCATION_LIST_CACHE_KEY, CACHE_MAX_AGE_MEDIUM_MS);
            if (cached && Array.isArray(cached)) {
                renderLocations(cached);
                hideLocationSkeleton();
            }
        }
        const liveOwn = await fetchLiveTowns();
        const others = await fetchKnownAreas(liveOwn.name);
        const locations = [liveOwn, ...others];
        renderLocations(locations);
        LWCache.write(LOCATION_LIST_CACHE_KEY, locations);
        // Kept alongside the new list-level cache key for anything else in
        // the codebase still reading LOCATION_CACHE_KEY for just the user's
        // own location (e.g. Home's secondary-location panel).
        LWCache.write(LOCATION_CACHE_KEY, liveOwn);
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

        // Star / favorite toggle, and per-row tap-to-report status icon
        const list = document.getElementById('locNearbyList');
        if (list) {
            list.addEventListener('click', (event) => {
                const star = event.target.closest('.loc-row__star');
                if (star) {
                    event.preventDefault();
                    event.stopPropagation();
                    const row = star.closest('.loc-row');
                    if (!row) return;
                    toggleFavorite(row.dataset.area);
                    renderLocations(latestLocations);
                    return;
                }

                const icon = event.target.closest('[data-action="toggle-area-status"]');
                if (icon) {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleAreaStatus(icon.closest('.loc-row'));
                }
            });

            list.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                const icon = event.target.closest('[data-action="toggle-area-status"]');
                if (!icon) return;
                event.preventDefault();
                toggleAreaStatus(icon.closest('.loc-row'));
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

    let areaToggleInFlight = false;

    // Same POST /lightstatus contract as the primary status-hero__icon
    // and the secondary-location panel (see window.LWLightStatus,
    // exposed by lightstatus.js) — a tap on any row here shows up
    // identically wherever else that area's status is read.
    async function toggleAreaStatus(row) {
        if (!row || areaToggleInFlight || !window.LWLightStatus) return;
        areaToggleInFlight = true;

        const areaName = row.dataset.area;
        const icon = row.querySelector('[data-action="toggle-area-status"]');
        const statusEl = row.querySelector('.loc-row__status');
        const currentlyOn = row.dataset.status === 'on';
        const nextStatus = currentlyOn ? 'off' : 'on';

        icon?.setAttribute('aria-busy', 'true');
        window.LWLightStatus.animateIcon(icon, nextStatus);
        if (statusEl) statusEl.textContent = nextStatus === 'on' ? 'Reporting…' : 'Reporting…';

        const userId = (typeof getSession === 'function' && getSession()?.user?.id)
            || localStorage.getItem('currentUserId')
            || getCurrentUserData().id
            || null;

        try {
            const record = await window.LWLightStatus.report(areaName, nextStatus, userId);
            const entry = latestLocations.find(a => a.name === areaName);
            if (entry) {
                entry.status = record.status;
                entry.minutesAgo = 0;
            }
            renderLocations(latestLocations);
        } catch (err) {
            // Revert the label back to whatever the row's data-status
            // already says rather than leave "Reporting…" stuck.
            if (statusEl) statusEl.textContent = statusMeta(row.dataset.status).label;
        } finally {
            icon?.removeAttribute('aria-busy');
            areaToggleInFlight = false;
        }
    }

    // A report made anywhere else (Home's primary card or its secondary-
    // location panel) fires this — refresh so this list doesn't sit on a
    // status that just went stale.
    window.addEventListener('lw:lightstatus-changed', () => {
        if (document.body.classList.contains('view-location-active')) {
            loadLocations(false);
        }
    });

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