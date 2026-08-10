// ============================================================
//  VIEWS/LOCATION.JS
//  MapLibre GL JS "Locations" map: every monitored Ghanaian town/area
//  plotted with custom lightning-bolt markers, client-side clustering,
//  live status polling, search (backend + Nominatim/OSM geocoder),
//  favorites, filters, and a collapsible nearby-locations list.
//
//  Changed vs. the previous static-image implementation:
//   - The old <img src="./images/map.png"> + percent-positioned
//     <div> pins are gone. #locMapCanvas is now a real interactive
//     MapLibre GL map — pan/zoom/rotate all work, and every monitored
//     location in the database is plotted at a real (or best-effort
//     approximate — see coordsApproximate below) coordinate instead of
//     a hand-placed illustrative spot.
//   - Pins are still custom SVG (same lightning-bolt glyph as before)
//     but are now real maplibregl.Marker DOM elements, positioned by
//     MapLibre itself rather than left/top percentages.
//   - Clustering is computed client-side with Supercluster and
//     re-rendered as our own .loc-marker/.loc-cluster elements on every
//     moveend/zoomend — MapLibre's built-in layer-based clustering
//     can't drive custom HTML/SVG markers, so this view does that step
//     itself (see renderVisibleMarkers()).
//   - New: GET /locations/map (server.js) replaces the old
//     GET /areas/known + N parallel GET /lightstatus calls — one
//     request now returns every monitored area with status, stats,
//     and resolved coordinates.
//   - New: "Nearby" now sorts/filters by a real haversine distance from
//     the user's GPS position instead of having no distance data at all.
//   - Still wrapped into mount()/show()/hide() for the router, and
//     polling (POLL_INTERVAL_STANDARD_MS) still starts in show() /
//     stops in hide(), same contract as before.
//   - Favorites still persist in localStorage under the same key.
//
//  Map provider: MapLibre GL JS (open-source Mapbox GL JS fork, same
//  `maplibregl.Map`/`Marker`/`Popup`/`NavigationControl`/
//  `GeolocateControl` API almost 1:1) + OpenFreeMap vector tiles —
//  no account, no access token, no card required for either. Satellite
//  view uses Esri World Imagery raster tiles, also free/keyless.
//  Search uses OpenStreetMap's Nominatim geocoder instead of Mapbox's.
// ============================================================

(function () {
    // ── Map provider setup ────────────────────────────────────
    // No token needed — OpenFreeMap (https://openfreemap.org) serves
    // its vector styles/tiles for free with no signup or key. Swap
    // these URLs for a MapTiler style (https://api.maptiler.com/...
    // ?key=YOUR_KEY, free tier, no card) if you outgrow OpenFreeMap's
    // fair-use limits — the rest of this file doesn't change either way.
    function getStreetMapStyle() {
        return 'https://tiles.openfreemap.org/styles/dark';
    }

    const STYLE_STREET = getStreetMapStyle();
    const STYLE_SATELLITE = {
        version: 8,
        sources: {
            'esri-satellite': {
                type: 'raster',
                tiles: [
                    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
                ],
                tileSize: 256,
                attribution: 'Imagery &copy; Esri'
            }
        },
        layers: [
            { id: 'esri-satellite', type: 'raster', source: 'esri-satellite' }
        ]
    };

    // Kumasi — used only as the last-resort fallback center when
    // geolocation is denied/unavailable AND no saved location exists.
    const DEFAULT_CENTER = { lat: 6.6885, lng: -1.6244 };
    const DEFAULT_ZOOM = 12;
    const COUNTRY_ZOOM = 6.4;

    const LOCATION_CACHE_KEY = 'lw_cache_location_bantama';
    const LOCATION_LIST_CACHE_KEY = 'lw_cache_location_list';
    const FAVORITES_KEY = 'lw_location_favorites';
    const NEARBY_RADIUS_KM = 60;

    // Last-resort fallback if GET /locations/map can't be reached at
    // all (e.g. offline) — mirrors the old KNOWN_AREAS_FALLBACK list,
    // with the same hand-placed Kumasi-area coordinates server.js now
    // also knows about.
    const OFFLINE_FALLBACK_LOCATIONS = [
        { name: 'Asokwa', locationKey: 'asokwa', lat: 6.6650, lng: -1.6100 },
        { name: 'Adum', locationKey: 'adum', lat: 6.6926, lng: -1.6244 },
        { name: 'Suame', locationKey: 'suame', lat: 6.7239, lng: -1.6367 },
        { name: 'Ahodwo', locationKey: 'ahodwo', lat: 6.6650, lng: -1.6350 },
        { name: 'Nhyiaeso', locationKey: 'nhyiaeso', lat: 6.6733, lng: -1.6067 },
        { name: 'Tafo', locationKey: 'tafo', lat: 6.7264, lng: -1.5850 },
        { name: 'KNUST', locationKey: 'knust', lat: 6.6745, lng: -1.5716 },
        { name: 'Ejisu', locationKey: 'ejisu', lat: 6.7333, lng: -1.3667 },
        { name: 'Kwadaso', locationKey: 'kwadaso', lat: 6.6975, lng: -1.6600 }
    ].map(a => ({ ...a, status: 'unknown', minutesAgo: null, confirmations: null, confidence: null, coordsApproximate: true }));

    // ── State ──────────────────────────────────────────────────
    let map = null;
    let mapReady = false;
    let clusterIndex = null;
    let markerEls = new Map();          // cluster/point id -> maplibregl.Marker
    let openPopup = null;
    let openPopupKey = null;
    let userCoords = null;              // { lat, lng } once we have a GPS fix
    let latestLocations = [];           // raw dataset from the server
    let previousStatusByKey = new Map(); // for flash-on-change diffing
    let locationPollTimer = null;
    let currentFilter = 'all';
    let currentSearch = '';
    let controlsBound = false;
    let mapInitStarted = false;
    let nearbyCollapsed = false;
    let currentMapStyle = 'street';
    let geocoderDebounceTimer = null;
    let liveHeatMap = null;
    const locationHistoryCache = new Map();
    const locationHistoryLoading = new Set();

    // ── Favorites (unchanged localStorage contract) ───────────
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

    function ensureLiveHeatMap() {
        if (liveHeatMap) return liveHeatMap;
        const host = document.getElementById('locMapHeatPanel');
        if (!host || !window.LWLiveHeatMap || typeof window.LWLiveHeatMap.create !== 'function') return null;
        liveHeatMap = window.LWLiveHeatMap.create(host, { full: true });
        return liveHeatMap;
    }

    function isFavorited(name) {
        return readFavorites().includes(name);
    }

    function toggleFavorite(name) {
        const list = readFavorites();
        const idx = list.indexOf(name);
        if (idx === -1) list.push(name); else list.splice(idx, 1);
        writeFavorites(list);
        const favorite = list.includes(name);
        Promise.resolve(window.setFavoriteLocationPreference?.(name, favorite)).catch(() => {});
        return favorite;
    }

    function statusMeta(status) {
        const isOn = status === 'on';
        const isUnknown = status === 'unknown' || !status;
        return {
            isOn,
            isUnknown,
            label: isUnknown ? 'Checking' : isOn ? 'Power is ON' : 'Power is OFF',
            cls: isUnknown ? 'unknown' : isOn ? 'on' : 'off'
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
        if (user.city && String(user.city).trim()) return String(user.city).trim();
        return user.region ? String(user.region).trim() : null;
    }

    function normalizeAreaName(name) {
        return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    // ── Distance ───────────────────────────────────────────────
    function haversineKm(a, b) {
        if (!a || !b) return null;
        const R = 6371;
        const dLat = (b.lat - a.lat) * Math.PI / 180;
        const dLng = (b.lng - a.lng) * Math.PI / 180;
        const lat1 = a.lat * Math.PI / 180;
        const lat2 = b.lat * Math.PI / 180;
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.asin(Math.sqrt(h));
    }

    function withDistances(locations) {
        if (!userCoords) return locations;
        return locations.map(loc => ({
            ...loc,
            distanceKm: (typeof loc.lat === 'number' && typeof loc.lng === 'number')
                ? haversineKm(userCoords, { lat: loc.lat, lng: loc.lng })
                : null
        }));
    }

    // ============================================================
    //  Map bootstrap
    // ============================================================

    function initMap() {
        if (mapInitStarted) return;
        mapInitStarted = true;

        const canvas = document.getElementById('locMapCanvas');
        const loading = document.getElementById('locMapLoading');
        if (!canvas) return;

        if (!window.maplibregl) {
            if (loading) loading.innerHTML = '<span>Map failed to load. Check your connection.</span>';
            console.error('MapLibre GL JS did not load.');
            return;
        }

        map = new maplibregl.Map({
            container: canvas,
            style: STYLE_STREET,
            center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
            zoom: COUNTRY_ZOOM,
            pitchWithRotate: false,
            attributionControl: true
        });

        map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }), 'top-right');

        const geolocate = new maplibregl.GeolocateControl({
            positionOptions: { enableHighAccuracy: true },
            trackUserLocation: true,
            showAccuracyCircle: false,
            fitBoundsOptions: { maxZoom: DEFAULT_ZOOM }
        });
        map.addControl(geolocate, 'top-right');

        geolocate.on('geolocate', (pos) => {
            userCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            renderLocations(latestLocations);
        });

        window.__locMap = map; // devtools helper — see applyBrandPalette() comment above

        map.on('load', () => {
            mapReady = true;
            applyBrandPalette();
            if (loading) loading.setAttribute('hidden', '');
            requestUserLocation(geolocate);
            renderVisibleMarkers();
        });

        map.on('moveend', renderVisibleMarkers);
        map.on('zoomend', renderVisibleMarkers);

        map.on('style.load', () => {
            // Re-applied every time setStyle() runs (Street/Satellite toggle) —
            // markers themselves are DOM elements outside the style, so they
            // survive a style swap untouched and don't need re-adding.
            applyBrandPalette();
        });
    }

    // Pulls LightWatch's own design tokens (variables.css) and pushes
    // them onto OpenFreeMap's "dark" style's paint properties, so
    // roads/water/land/labels/boundaries read as part of the app's
    // palette instead of the stock dark theme. OpenFreeMap's styles
    // follow the OpenMapTiles layer-naming schema (different ids than
    // Mapbox's own styles used) — layer ids below match that schema,
    // but are still wrapped per-layer since exact ids can shift
    // between style updates; a missing layer just gets skipped rather
    // than breaking map load. If a layer doesn't take effect, open
    // devtools and run `window.__locMap.getStyle().layers.map(l => l.id)`
    // to get the current id list and adjust the safeSet() calls below.
    function applyBrandPalette() {
        if (currentMapStyle !== 'street' || !map) return;
        const css = getComputedStyle(document.documentElement);
        const darkBg = '#1C1F26';
        const darkBgMid = '#2A2E38';
        const teal = css.getPropertyValue('--teal').trim() || '#3DD9C2';
        const border = '#3a4759';
        const textBright = '#eef3fb';
        const textMuted = '#bdc8da';
        const surface = darkBg;
        const surfaceMuted = darkBgMid;
        const waterColor = color_mix(teal, surface, 0.16);
        const roadColor = darkBgMid;

        const safeSet = (layer, prop, value) => {
            try {
                if (map.getLayer(layer)) map.setPaintProperty(layer, prop, value);
            } catch (err) { /* layer not present in this style version — skip */ }
        };

        safeSet('background', 'background-color', surface);
        safeSet('landcover', 'fill-color', surface);
        safeSet('landuse', 'fill-color', surfaceMuted);
        safeSet('park', 'fill-color', surfaceMuted);
        safeSet('water', 'fill-color', waterColor);
        safeSet('waterway', 'line-color', waterColor);
        safeSet('road_secondary', 'line-color', roadColor);
        safeSet('road_minor', 'line-color', roadColor);
        safeSet('road_major', 'line-color', roadColor);
        safeSet('road_motorway', 'line-color', border);
        safeSet('boundary_state', 'line-color', border);
        safeSet('boundary_country', 'line-color', border);
        safeSet('place_city', 'text-color', textBright);
        safeSet('place_town', 'text-color', textMuted);
        safeSet('place_village', 'text-color', textMuted);
        safeSet('poi_label', 'text-color', 'rgba(255,255,255,0.5)');
        safeSet('road_label', 'text-color', 'rgba(255,255,255,0.45)');
    }

    // Cheap hex-ish blend so applyBrandPalette() doesn't need a full
    // color library just to nudge water toward the brand teal.
    function color_mix(hex, base, amount) {
        const h = hex.replace('#', '');
        const b = base.replace('#', '');
        if (h.length !== 6 || b.length !== 6) return base;
        const mix = (i) => {
            const a = parseInt(h.substr(i, 2), 16);
            const c = parseInt(b.substr(i, 2), 16);
            return Math.round(c + (a - c) * amount).toString(16).padStart(2, '0');
        };
        return `#${mix(0)}${mix(2)}${mix(4)}`;
    }

    // ── Geolocation: center on the user if permitted, else fall back
    //    to their saved/registered location, else Kumasi. ──────────
    function requestUserLocation(geolocateControl) {
        if (!navigator.geolocation) {
            centerOnFallback();
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                userCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                map.flyTo({ center: [userCoords.lng, userCoords.lat], zoom: DEFAULT_ZOOM, essential: true });
                renderLocations(latestLocations);
            },
            () => centerOnFallback(),
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 300000 }
        );
    }

    function centerOnFallback() {
        // Prefer a cached last-known location, then the current user's
        // registered city (once we know its coordinates from the loaded
        // dataset), then Kumasi.
        const cached = LWCache && LWCache.readStale(LOCATION_CACHE_KEY);
        if (cached && typeof cached.lat === 'number' && typeof cached.lng === 'number') {
            map.flyTo({ center: [cached.lng, cached.lat], zoom: DEFAULT_ZOOM, essential: true });
            return;
        }
        const registeredName = normalizeAreaName(getRegisteredLocationName());
        const match = latestLocations.find(l => normalizeAreaName(l.name) === registeredName);
        if (match) {
            map.flyTo({ center: [match.lng, match.lat], zoom: DEFAULT_ZOOM, essential: true });
            return;
        }
        map.flyTo({ center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat], zoom: DEFAULT_ZOOM, essential: true });
    }

    // ============================================================
    //  Markers + clustering (Supercluster, re-rendered on every
    //  moveend/zoomend so only what's in view gets built)
    // ============================================================

    function locationsToGeoJSON(locations) {
        return {
            type: 'FeatureCollection',
            features: locations
                .filter(l => typeof l.lat === 'number' && typeof l.lng === 'number')
                .map(l => ({
                    type: 'Feature',
                    properties: { ...l },
                    geometry: { type: 'Point', coordinates: [l.lng, l.lat] }
                }))
        };
    }

    function rebuildClusterIndex(locations) {
        if (!window.Supercluster) {
            clusterIndex = null;
            return;
        }
        clusterIndex = new Supercluster({ radius: 50, maxZoom: 15 }).load(locationsToGeoJSON(locations).features);
        renderVisibleMarkers();
    }

    function buildMarkerEl(feature) {
        const isCluster = feature.properties.cluster;
        const el = document.createElement('div');

        if (isCluster) {
            const count = feature.properties.point_count;
            const size = Math.min(52, 28 + Math.log2(count + 1) * 6);
            el.className = 'loc-cluster loc-marker--enter';
            el.style.width = `${size}px`;
            el.style.height = `${size}px`;
            el.textContent = count > 99 ? '99+' : String(count);
            el.setAttribute('role', 'button');
            el.setAttribute('aria-label', `${count} locations — zoom in to see them`);
            el.addEventListener('click', () => {
                const expansionZoom = Math.min(
                    clusterIndex.getClusterExpansionZoom(feature.properties.cluster_id),
                    18
                );
                map.easeTo({ center: feature.geometry.coordinates, zoom: expansionZoom });
            });
            return el;
        }

        const meta = statusMeta(feature.properties.status);
        el.className = `loc-marker loc-marker--${meta.cls} loc-marker--enter`;
        el.dataset.locationKey = feature.properties.locationKey;
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', `${feature.properties.name} — ${meta.label}`);
        el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" fill="currentColor"/></svg>';

        if (isFavorited(feature.properties.name)) {
            const star = document.createElement('span');
            star.className = 'loc-marker__favorite';
            star.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8L12 3.5Z"/></svg>';
            el.appendChild(star);
        }

        el.addEventListener('click', (e) => {
            e.stopPropagation();
            openLocationPopup(feature.properties, feature.geometry.coordinates);
        });

        return el;
    }

    // Diffs the previous marker set against the newly-clustered one so
    // unchanged points are left alone (no re-render, no lost transition
    // state) — only additions/removals touch the DOM. Also the "only
    // render visible markers" performance requirement: clusterIndex is
    // always queried against the current viewport bbox + zoom.
    function renderVisibleMarkers() {
        if (!map || !mapReady || !clusterIndex) return;

        const bounds = map.getBounds();
        const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
        const zoom = Math.floor(map.getZoom());
        const clusters = clusterIndex.getClusters(bbox, zoom);

        const nextIds = new Set();
        clusters.forEach(feature => {
            const id = feature.properties.cluster
                ? `cluster-${feature.properties.cluster_id}`
                : `loc-${feature.properties.locationKey}`;
            nextIds.add(id);

            if (markerEls.has(id)) return; // unchanged — leave its DOM/transition state alone

            const el = buildMarkerEl(feature);
            const marker = new maplibregl.Marker({ element: el, anchor: feature.properties.cluster ? 'center' : 'bottom' })
                .setLngLat(feature.geometry.coordinates)
                .addTo(map);
            markerEls.set(id, marker);

            setTimeout(() => el.classList.remove('loc-marker--enter'), 420);
        });

        // Remove markers that scrolled out of view / got absorbed into a
        // cluster since the last render.
        markerEls.forEach((marker, id) => {
            if (!nextIds.has(id)) {
                marker.remove();
                markerEls.delete(id);
            }
        });
    }

    // Applies a fresh status to an already-rendered marker element in
    // place (CSS transition handles the color change) and gives it a
    // brief flash, instead of tearing the marker down and rebuilding it.
    function updateMarkerStatus(locationKey, status) {
        const id = `loc-${locationKey}`;
        const marker = markerEls.get(id);
        if (!marker) return;
        const el = marker.getElement();
        const meta = statusMeta(status);
        el.className = el.className.replace(/loc-marker--(on|off|unknown)/, `loc-marker--${meta.cls}`);
        el.classList.add('loc-marker--flash');
        setTimeout(() => el.classList.remove('loc-marker--flash'), 1450);
    }

    // ============================================================
    //  Info-card popup
    // ============================================================

    function openLocationPopup(props, coordinates) {
        const template = document.getElementById('locPopupCardTemplate');
        if (!template || !map) return;

        const node = template.content.firstElementChild.cloneNode(true);
        const meta = statusMeta(props.status);

        node.querySelector('[data-field="name"]').textContent = props.name;
        const statusEl = node.querySelector('[data-field="status"]');
        statusEl.textContent = meta.label;
        statusEl.className = `loc-popup__status loc-popup__status--${meta.cls}`;

        node.querySelector('[data-field="updated"]').textContent = (window.LWHelpers && props.minutesAgo != null)
            ? LWHelpers.formatRelativeTimeFromMinutes(props.minutesAgo)
            : '—';
        node.querySelector('[data-field="confidence"]').textContent = typeof props.confidence === 'number' ? `${props.confidence}%` : '—';
        node.querySelector('[data-field="reports"]').textContent = props.confirmations != null ? String(props.confirmations) : '0';

        const distance = userCoords && typeof props.lat === 'number'
            ? haversineKm(userCoords, { lat: props.lat, lng: props.lng })
            : null;
        node.querySelector('[data-field="distance"]').textContent = typeof distance === 'number' ? `${distance.toFixed(1)} km` : '—';

        const starBtn = node.querySelector('[data-action="popup-favorite"]');
        const syncStar = () => starBtn.classList.toggle('is-active', isFavorited(props.name));
        syncStar();
        starBtn.addEventListener('click', () => {
            toggleFavorite(props.name);
            syncStar();
            renderLocations(latestLocations); // refreshes the favorite badge on the marker + list
        });

        node.querySelector('[data-action="popup-report"]').addEventListener('click', () => {
            window.currentChatLocation = props.name;
            if (window.LWRouter) window.LWRouter.navigate('report');
        });
        node.querySelector('[data-action="popup-news"]').addEventListener('click', () => {
            if (window.LWRouter) window.LWRouter.navigate('news');
        });
        node.querySelector('[data-action="popup-directions"]').addEventListener('click', () => {
            window.open(`https://www.google.com/maps/dir/?api=1&destination=${props.lat},${props.lng}`, '_blank', 'noopener');
        });

        if (openPopup) openPopup.remove();
        openPopup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, offset: 18, maxWidth: 'none' })
            .setLngLat(coordinates)
            .setDOMContent(node)
            .addTo(map);
        openPopupKey = props.locationKey;
        map.easeTo({ center: coordinates, essential: true });

        openPopup.on('close', () => { openPopup = null; openPopupKey = null; });
    }

    // ============================================================
    //  Nearby-locations list (unchanged row markup/behavior, now
    //  fed by the same dataset the map uses)
    // ============================================================

    function nearbyRowTemplate(area) {
        const meta = statusMeta(area.status);
        const timeText = (window.LWHelpers && area.minutesAgo != null) ? LWHelpers.formatRelativeTimeFromMinutes(area.minutesAgo) : '—';
        const favorited = isFavorited(area.name);
        const distanceText = typeof area.distanceKm === 'number' ? `${area.distanceKm.toFixed(1)} km` : '';

        return `
      <div class="loc-row" data-area="${area.name}" data-status="${area.status}" data-favorite="${favorited ? '1' : '0'}" data-name="${area.name.toLowerCase()}" role="listitem">
        <span class="loc-row__icon loc-row__icon--${meta.cls}" data-action="toggle-area-status" role="button" tabindex="0" aria-disabled="${favorited ? 'true' : 'false'}" style="cursor:${favorited ? 'not-allowed' : 'pointer'}" aria-label="${favorited ? `Unable to report status for favorite location ${area.name}` : `Tap to report the light status for ${area.name}`}">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" fill="currentColor"/></svg>
        </span>
        <div class="loc-row__body">
          <div class="loc-row__name-line">
            <span class="loc-row__name">${area.name}</span>
            ${area.live ? '<span class="loc-row__badge">Your Area</span>' : ''}
          </div>
          <p class="loc-row__status loc-row__status--${meta.cls}">${meta.label}</p>
          <p class="loc-row__meta">Updated ${timeText} · ${area.confirmations || 0} reports</p>
                    <button type="button" class="loc-row__history-toggle" data-action="toggle-weather" aria-expanded="false">Weather</button>
                    <button type="button" class="loc-row__history-toggle" data-action="toggle-history" aria-expanded="false">History</button>
                    <div class="loc-row__history" data-weather-for="${area.locationKey}" hidden></div>
                    <div class="loc-row__history" data-history-for="${area.locationKey}" hidden></div>
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

    function renderLocationHistory(host, events) {
        if (!host) return;
        if (!events.length) {
            host.innerHTML = '<span class="loc-row__history-empty">No status changes in the last 7 days.</span>';
            return;
        }
        const escapeHistoryText = (value) => String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        host.innerHTML = events.map(event => {
            const isOn = event.status === 'on';
                        const eventDate = new Date(event.reportedAt);
                        const eventTime = Number.isNaN(eventDate.getTime())
                                ? '—'
                                : eventDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
            const time = event.reportedAt && window.LWHelpers
                ? LWHelpers.formatRelativeTimeFromDate(event.reportedAt)
                : '—';
            return `<div class="loc-row__history-item loc-row__history-item--${isOn ? 'on' : 'off'}">
              <span class="loc-row__history-dot" aria-hidden="true"></span>
                            <span class="loc-row__history-state">${isOn ? `Light came on at ${eventTime}` : `Light went off at ${eventTime}`}</span>
              <span class="loc-row__history-time">${time}</span>
              <span class="loc-row__history-source">${escapeHistoryText(event.source || 'A volunteer')}</span>
            </div>`;
        }).join('');
    }

    async function toggleLocationHistory(button) {
        const row = button?.closest('.loc-row');
        const host = row?.querySelector('.loc-row__history[data-history-for]');
        if (!row || !host) return;
        const willOpen = host.hidden;
        host.hidden = !willOpen;
        button.setAttribute('aria-expanded', String(willOpen));
        if (!willOpen || locationHistoryCache.has(row.dataset.area) || locationHistoryLoading.has(row.dataset.area)) return;

        locationHistoryLoading.add(row.dataset.area);
        host.innerHTML = '<span class="loc-row__history-empty">Loading history…</span>';
        try {
            const res = await fetch(`${LWHelpers.apiBase()}/lightstatus/history?location=${encodeURIComponent(row.dataset.area)}&days=7&limit=20`);
            let events;
            if (res.ok) {
                events = await res.json();
            } else {
                const fallback = await fetch(`${LWHelpers.apiBase()}/reports?location=${encodeURIComponent(row.dataset.area)}&limit=20`);
                const reports = fallback.ok ? await fallback.json() : [];
                events = Array.isArray(reports) ? reports.filter(event => event.status === 'on' || event.status === 'off').map(event => ({
                    status: event.status,
                    reportedAt: event.reportedAt,
                    source: event.text || 'A volunteer'
                })) : [];
            }
            locationHistoryCache.set(row.dataset.area, Array.isArray(events) ? events : []);
            renderLocationHistory(host, locationHistoryCache.get(row.dataset.area));
        } catch {
            host.innerHTML = '<span class="loc-row__history-empty">History unavailable right now.</span>';
        } finally {
            locationHistoryLoading.delete(row.dataset.area);
        }
    }

    // ── Per-location weather (new) ────────────────────────────
    // Same lazy-load-on-first-expand pattern as toggleLocationHistory
    // above, hitting the same GET /weather?location=<name> endpoint
    // weather-home.js already uses for the user's own primary spot —
    // that route works for any monitored location name, so this just
    // gives every row in the nearby list the same access, not only
    // the user's own area.
    const locationWeatherCache = new Map();
    const locationWeatherLoading = new Set();

    function renderLocationWeather(host, data) {
        if (!host) return;
        const current = data?.current || {};
        const temp = typeof current.temperatureC === 'number' ? `${Math.round(current.temperatureC)}°C` : '—';
        const rain = typeof current.rainChance === 'number' ? `${current.rainChance}% rain` : null;
        const wind = typeof current.windKph === 'number' ? `${Math.round(current.windKph)} km/h wind` : null;
        const condition = current.description || 'Conditions unavailable';
        const risk = data?.risk?.label;
        const parts = [rain, wind].filter(Boolean).join(' · ');
        host.innerHTML = `
          <div class="loc-row__history-item loc-row__history-item--weather">
            <span class="loc-row__history-dot" style="background: var(--amber, #D6A24A);"></span>
            <span class="loc-row__history-state">${escapeForWeather(temp)} — ${escapeForWeather(condition)}</span>
            ${parts ? `<span class="loc-row__history-time">${escapeForWeather(parts)}</span>` : ''}
            ${risk ? `<span class="loc-row__history-source">Outage risk: ${escapeForWeather(risk)}</span>` : ''}
          </div>
        `;
    }

    function escapeForWeather(value) {
        return String(value || '').replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[ch]));
    }

    async function toggleLocationWeather(button) {
        const row = button?.closest('.loc-row');
        const host = row?.querySelector('.loc-row__history[data-weather-for]');
        if (!row || !host) return;
        const willOpen = host.hidden;
        host.hidden = !willOpen;
        button.setAttribute('aria-expanded', String(willOpen));
        if (!willOpen || locationWeatherCache.has(row.dataset.area) || locationWeatherLoading.has(row.dataset.area)) return;

        locationWeatherLoading.add(row.dataset.area);
        host.innerHTML = '<span class="loc-row__history-empty">Loading weather…</span>';
        try {
            const res = await fetch(`${LWHelpers.apiBase()}/weather?location=${encodeURIComponent(row.dataset.area)}`);
            if (!res.ok) throw new Error(`Bad response (${res.status})`);
            const data = await res.json();
            locationWeatherCache.set(row.dataset.area, data);
            renderLocationWeather(host, data);
        } catch {
            host.innerHTML = '<span class="loc-row__history-empty">Weather unavailable right now.</span>';
        } finally {
            locationWeatherLoading.delete(row.dataset.area);
        }
    }

    function matchesActiveFilter(area) {
        if (currentFilter === 'favorites') return isFavorited(area.name);
        if (currentFilter === 'myareas') return normalizeAreaName(area.name) === normalizeAreaName(getRegisteredLocationName());
        if (currentFilter === 'poweron') return area.status === 'on';
        if (currentFilter === 'poweroff') return area.status === 'off';
        if (currentFilter === 'nearby') return typeof area.distanceKm === 'number' && area.distanceKm <= NEARBY_RADIUS_KM;
        return true;
    }

    function applyFilters() {
        const list = document.getElementById('locNearbyList');
        if (!list) return;

        let visibleCount = 0;
        list.querySelectorAll('.loc-row').forEach(row => {
            const area = latestLocations.find(a => a.name === row.dataset.area);
            const matchesFilter = area ? matchesActiveFilter(area) : true;
            const matchesSearch = !currentSearch || row.dataset.name.includes(currentSearch);
            const show = matchesFilter && matchesSearch;
            row.style.display = show ? '' : 'none';
            if (show) visibleCount++;
        });

        const emptyState = document.getElementById('locationEmptyState');
        if (emptyState) emptyState.style.display = visibleCount === 0 ? 'flex' : 'none';
    }

    function renderLocations(locations) {
        latestLocations = withDistances(locations);

        const list = document.getElementById('locNearbyList');
        if (list) {
            const own = latestLocations.filter(a => a.live);
            let rest = latestLocations.filter(a => !a.live);
            if (currentFilter === 'nearby') {
                rest = rest.slice().sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
            }
            list.innerHTML = own.concat(rest).map(nearbyRowTemplate).join('');
        }

        // Map: filter the working set to the active filter, feed it to
        // Supercluster, and re-render whatever's currently in view.
        const mapSet = currentFilter === 'all' ? latestLocations : latestLocations.filter(matchesActiveFilter);
        rebuildClusterIndex(mapSet);

        // If a popup is open for a location that just updated, refresh it.
        if (openPopupKey) {
            const fresh = latestLocations.find(a => a.locationKey === openPopupKey);
            if (fresh && fresh.lat != null) openLocationPopup(fresh, [fresh.lng, fresh.lat]);
        }

        applyFilters();
    }

    // ============================================================
    //  Data loading (GET /locations/map) + live-update polling
    // ============================================================

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

    async function fetchAllLocations() {
        try {
            const res = await fetch(`${LWHelpers.apiBase()}/locations/map`);
            if (!res.ok) throw new Error('Bad response for /locations/map');
            const data = await res.json();
            if (!Array.isArray(data.locations)) throw new Error('Malformed /locations/map response');
            const registeredName = normalizeAreaName(getRegisteredLocationName());
            return data.locations.map(loc => ({ ...loc, live: normalizeAreaName(loc.name) === registeredName }));
        } catch (err) {
            console.error('Failed to load /locations/map, using offline fallback:', err.message);
            return OFFLINE_FALLBACK_LOCATIONS;
        }
    }

    // A report made anywhere else in the app (Home's primary card, the
    // secondary-location panel, or a tap here) fires this — diff against
    // what markers currently show so changed pins flash + transition
    // instead of the whole map silently going stale between polls.
    function applyLiveUpdate(locations) {
        locations.forEach(loc => {
            const prev = previousStatusByKey.get(loc.locationKey);
            if (prev !== undefined && prev !== loc.status) {
                updateMarkerStatus(loc.locationKey, loc.status);
            }
            previousStatusByKey.set(loc.locationKey, loc.status);
        });
    }

    function refreshLiveHeatMap() {
        if (currentMapStyle !== 'heatmap') return;
        const liveHeatMap = ensureLiveHeatMap();
        if (!liveHeatMap) return;
        liveHeatMap.invalidateSize();
        liveHeatMap.refresh();
        setTimeout(() => {
            liveHeatMap.invalidateSize();
            liveHeatMap.refresh();
        }, 120);
    }

    async function loadLocations(isFirstLoad = false) {
        if (isFirstLoad) {
            const cached = LWCache && LWCache.read(LOCATION_LIST_CACHE_KEY, CACHE_MAX_AGE_MEDIUM_MS);
            if (cached && Array.isArray(cached)) {
                renderLocations(cached);
                cached.forEach(l => previousStatusByKey.set(l.locationKey, l.status));
                hideLocationSkeleton();
            }
        }

        const locations = await fetchAllLocations();
        renderLocations(locations);
        applyLiveUpdate(locations);
        refreshLiveHeatMap();

        if (LWCache) {
            LWCache.write(LOCATION_LIST_CACHE_KEY, locations);
            const own = locations.find(l => l.live);
            if (own) LWCache.write(LOCATION_CACHE_KEY, own);
        }
        hideLocationSkeleton();
    }

    // ============================================================
    //  Search — backend locations first, then the Nominatim (OSM)
    //  geocoder. Nominatim's usage policy caps this at ~1 request/sec
    //  and asks for a distinguishing identifier, which the debounce
    //  below and the app's own User-Agent/Referer already satisfy for
    //  light client-side use; see https://operations.osmfoundation.org/policies/nominatim/
    //  if this ever needs to scale beyond casual search-as-you-type.
    // ============================================================

    function searchResultRow({ icon, iconCls, label, sub }) {
        return `<button type="button" class="loc-search__result">
      <span class="loc-search__result-icon loc-search__result-icon--${iconCls}">${icon}</span>
      <span><span>${label}</span>${sub ? `<span class="loc-search__result-sub">${sub}</span>` : ''}</span>
    </button>`;
    }

    const LIGHTNING_ICON = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" fill="currentColor"/></svg>';
    const PIN_ICON = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 21s7-7.02 7-12a7 7 0 1 0-14 0c0 4.98 7 12 7 12Z" stroke="currentColor" stroke-width="1.8"/></svg>';

    async function runSearch(query) {
        const resultsEl = document.getElementById('locSearchResults');
        if (!resultsEl) return;
        if (!query) { resultsEl.setAttribute('hidden', ''); resultsEl.innerHTML = ''; return; }
        // Feeds the admin dashboard's "Most Searched Locations" widget
        // (see getTopSearchedAreas() in server.js) — best-effort, never
        // blocks the actual search below if it fails.
        window.LWAnalytics?.track('search', { query });

        const q = query.toLowerCase();
        const backendMatches = latestLocations
            .filter(a => a.name.toLowerCase().includes(q))
            .slice(0, 6);

        // Normalized to the same shape the old Mapbox geocoder features
        // used ({ text, place_name, center: [lng, lat] }) so the render
        // and click-through code below didn't need to change.
        let geocoderMatches = [];
        try {
            const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=gh&limit=${Math.max(0, 5 - backendMatches.length)}&q=${encodeURIComponent(query)}`;
            const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
            if (res.ok) {
                const data = await res.json();
                geocoderMatches = (Array.isArray(data) ? data : []).map(place => ({
                    text: (place.display_name || '').split(',')[0].trim() || place.display_name,
                    place_name: place.display_name,
                    center: [parseFloat(place.lon), parseFloat(place.lat)]
                }));
            }
        } catch (err) {
            console.error('Nominatim geocoder search failed:', err.message);
        }

        if (!backendMatches.length && !geocoderMatches.length) {
            resultsEl.innerHTML = '<div class="loc-search__result" style="cursor:default">No matches found</div>';
            resultsEl.removeAttribute('hidden');
            return;
        }

        // Backend (monitored) locations always listed first, per spec.
        resultsEl.innerHTML = backendMatches.map((a, i) => {
            const meta = statusMeta(a.status);
            return `<div data-kind="backend" data-index="${i}">${searchResultRow({ icon: LIGHTNING_ICON, iconCls: meta.cls, label: a.name, sub: meta.label })}</div>`;
        }).join('') + geocoderMatches.map((f, i) => (
            `<div data-kind="geocoder" data-index="${i}">${searchResultRow({ icon: PIN_ICON, iconCls: 'geocoder', label: f.text, sub: f.place_name })}</div>`
        )).join('');

        resultsEl.querySelectorAll('[data-kind]').forEach(wrap => {
            wrap.querySelector('.loc-search__result').addEventListener('click', () => {
                const kind = wrap.dataset.kind;
                const idx = Number(wrap.dataset.index);
                resultsEl.setAttribute('hidden', '');
                if (kind === 'backend') {
                    const area = backendMatches[idx];
                    map && map.flyTo({ center: [area.lng, area.lat], zoom: DEFAULT_ZOOM, essential: true });
                    if (area.lat != null) openLocationPopup(area, [area.lng, area.lat]);
                } else {
                    const feature = geocoderMatches[idx];
                    map && map.flyTo({ center: feature.center, zoom: DEFAULT_ZOOM, essential: true });
                }
            });
        });

        resultsEl.removeAttribute('hidden');
    }

    // ============================================================
    //  Controls
    // ============================================================

    let areaToggleInFlight = false;

    async function toggleAreaStatus(row) {
        if (!row || areaToggleInFlight || !window.LWLightStatus) return;
        if (row.dataset.favorite === '1') return;
        
        const currentlyOn = row.dataset.status === 'on';
        // Don't allow toggling when light is already ON — users can only report outages (OFF)
        if (currentlyOn) return;
        
        areaToggleInFlight = true;

        const areaName = row.dataset.area;
        const icon = row.querySelector('[data-action="toggle-area-status"]');
        const statusEl = row.querySelector('.loc-row__status');
        const nextStatus = 'off';

        icon?.setAttribute('aria-busy', 'true');
        window.LWLightStatus.animateIcon(icon, nextStatus);
        if (statusEl) statusEl.textContent = 'Reporting…';

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
            if (statusEl) statusEl.textContent = statusMeta(row.dataset.status).label;
        } finally {
            icon?.removeAttribute('aria-busy');
            areaToggleInFlight = false;
        }
    }

    function bindControls() {
        if (controlsBound) return;
        controlsBound = true;

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
                clearTimeout(geocoderDebounceTimer);
                geocoderDebounceTimer = setTimeout(() => runSearch(searchInput.value.trim()), 250);
            });
            searchInput.addEventListener('blur', () => {
                setTimeout(() => document.getElementById('locSearchResults')?.setAttribute('hidden', ''), 150);
            });
        }

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
                const historyToggle = event.target.closest('[data-action="toggle-history"]');
                if (historyToggle) {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleLocationHistory(historyToggle);
                    return;
                }
                const weatherToggle = event.target.closest('[data-action="toggle-weather"]');
                if (weatherToggle) {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleLocationWeather(weatherToggle);
                    return;
                }
                const icon = event.target.closest('[data-action="toggle-area-status"]');
                if (icon) {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleAreaStatus(icon.closest('.loc-row'));
                    return;
                }
                const row = event.target.closest('.loc-row');
                if (row && map) {
                    const area = latestLocations.find(a => a.name === row.dataset.area);
                    if (area && area.lat != null) {
                        map.flyTo({ center: [area.lng, area.lat], zoom: DEFAULT_ZOOM, essential: true });
                        openLocationPopup(area, [area.lng, area.lat]);
                    }
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

        // Street / Satellite / Heat Map toggle
        const styleToggle = document.getElementById('locMapStyleToggle');
        function setMapStyle(style) {
            const canvas = document.getElementById('locMapCanvas');
            const heatHost = document.getElementById('locMapHeatPanel');
            if (style === 'heatmap') {
                if (canvas) canvas.hidden = true;
                if (heatHost) heatHost.hidden = false;
                currentMapStyle = 'heatmap';
                const liveHeatMap = ensureLiveHeatMap();
                if (liveHeatMap) {
                    liveHeatMap.invalidateSize();
                    liveHeatMap.refresh();
                } else {
                    setTimeout(() => ensureLiveHeatMap()?.refresh(), 120);
                }
            } else {
                if (canvas) canvas.hidden = false;
                if (heatHost) heatHost.hidden = true;
                const wantsSatellite = style === 'satellite';
                currentMapStyle = wantsSatellite ? 'satellite' : 'street';
                if (map) map.setStyle(wantsSatellite ? STYLE_SATELLITE : STYLE_STREET);
                if (map) setTimeout(() => map.resize(), 60);
            }
            if (styleToggle) styleToggle.querySelectorAll('.loc-map__style-btn').forEach(b => b.classList.toggle('is-active', b.dataset.style === style));
        }

        if (styleToggle) {
            styleToggle.addEventListener('click', (event) => {
                const btn = event.target.closest('.loc-map__style-btn');
                if (!btn) return;
                const style = btn.dataset.style || 'street';
                setMapStyle(style);
            });
        }
    }

    window.addEventListener('lw:lightstatus-changed', () => {
        if (document.body.classList.contains('view-location-active')) loadLocations(false);
    });

    function mount() {
        bindControls();
        initMap();
        loadLocations(true);
    }

    function show() {
        document.body.classList.add('view-location-active');
        clearInterval(locationPollTimer);
        locationPollTimer = setInterval(() => loadLocations(false), POLL_INTERVAL_STANDARD_MS);
        const requestedMode = window.__lwPendingMapMode;
        window.__lwPendingMapMode = null;
        const styleToggle = document.getElementById('locMapStyleToggle');
        const requestedButton = requestedMode && styleToggle
            ? styleToggle.querySelector(`.loc-map__style-btn[data-style="${requestedMode}"]`)
            : null;
        if (requestedButton) {
            requestedButton.click();
        } else if (currentMapStyle === 'heatmap') {
            const liveHeatMap = ensureLiveHeatMap();
            if (liveHeatMap) {
                liveHeatMap.invalidateSize();
                liveHeatMap.refresh();
                setTimeout(() => {
                    liveHeatMap.invalidateSize();
                    liveHeatMap.refresh();
                }, 120);
            }
        } else if (map) {
            setTimeout(() => map.resize(), 60);
        }
    }

    function hide() {
        document.body.classList.remove('view-location-active');
        clearInterval(locationPollTimer);
        locationPollTimer = null;
    }

    // show() only restarts the polling interval — it doesn't fetch
    // immediately, so data wouldn't actually change until that interval
    // next ticked (up to POLL_INTERVAL_STANDARD_MS later). refresh() calls
    // the same loadLocations(false) the interval itself calls, so a pull
    // gets an immediate network refetch instead of a wait.
    function refresh() {
        loadLocations(false);
    }

    window.LWViews = window.LWViews || {};
    window.LWViews.location = { mount, show, hide, refresh };
})();