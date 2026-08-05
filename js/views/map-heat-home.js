// ============================================================
//  VIEWS/MAP-HEAT-HOME.JS — live Leaflet heat map for the Home
//  view's "Live Map Heat" card (#lwxMapCard / #lwxMapVisual).
//
//  Real OpenStreetMap tiles (dark basemap via CARTO's free dark_all
//  tiles — still OSM data, no Google Maps, no token) + a genuine
//  Leaflet.heat heat layer, driven by the existing GET /locations/map
//  endpoint. Each entry in that response is one monitored place's
//  latest community-reported status (lat, lng, status, reportedAt) —
//  exactly the "report" shape this card heats: on/unknown/off convert
//  to a 0.2 / 0.5 / 1.0 intensity so stable areas glow green, mixed
//  areas glow yellow, and outages glow red, blending naturally where
//  reports sit close together.
//
//  Tapping anywhere on the preview still just routes to the Map tab
//  (data-route="location"), where the real full pin map lives — same
//  behavior the old status-panel version had for its points.
//
//  Loaded after Leaflet + Leaflet.heat and api.js (see index.html's
//  script order) for L, L.heatLayer, and LWHelpers.apiBase().
//
//  FUTURE-READY: additional live layers (weather radar, lightning
//  strikes, storm warnings, flood alerts, planned ECG maintenance
//  zones) can register themselves on the `layers` map below and toggle
//  independently — the heat layer is just the first one. See
//  registerLayer() / layers.heat for the pattern to follow.
// ============================================================

(function () {
    const POLL_INTERVAL_MS = 30 * 1000; // "Refresh every 30 seconds"
    const MAX_ZOOM = 16;
    const HEAT_RADIUS = 40; // 35-45px
    const HEAT_BLUR = 30;   // 25-35px

    // ON / UNKNOWN / OFF -> heat intensity. Keys are lowercase since
    // GET /locations/map already returns lowercase status strings
    // ('on' | 'off' | 'unknown'); normalized defensively below anyway.
    const STATUS_INTENSITY = { on: 0.2, unknown: 0.5, off: 1.0 };

    // Ghana-wide default view (this app is GH-only) — used until the
    // first real batch of points comes in and the map fits to them.
    const DEFAULT_CENTER = [7.9465, -1.0232];
    const DEFAULT_ZOOM = 6;

    const visual = document.getElementById('lwxMapVisual');
    if (!visual) return; // Home view isn't on screen, or this markup changed

    if (typeof L === 'undefined' || typeof L.heatLayer !== 'function') {
        console.error('[map-heat-home] Leaflet or Leaflet.heat failed to load');
        return;
    }

    // ---- Build the card's inner DOM once ----
    // (map canvas + the "Live" badge / stats bar overlays that sit on
    // top of it — see home.css .lwx-map-live-badge / .lwx-map-stats).
    visual.classList.add('lwx-heat-map-host');
    visual.innerHTML = `
        <div class="lwx-heat-map" id="lwxHeatMapCanvas"></div>
        <div class="lwx-map-live-badge"><span class="pulse pulse--on" aria-hidden="true"></span>Live</div>
        <div class="lwx-map-stats" id="lwxMapStatsBar">
            <span id="lwxMapReportCount">Loading…</span>
            <span class="lwx-map-stats__sep" aria-hidden="true">•</span>
            <span id="lwxMapUpdatedAt">—</span>
        </div>
        <div class="lwx-map-status" id="lwxMapStatus" hidden></div>
    `;

    const mapEl = visual.querySelector('#lwxHeatMapCanvas');
    const reportCountEl = visual.querySelector('#lwxMapReportCount');
    const updatedAtEl = visual.querySelector('#lwxMapUpdatedAt');
    const statusEl = visual.querySelector('#lwxMapStatus');

    // ---- Map — created exactly once. Guards against this script ever
    // running twice on the same page (re-creating a Leaflet map on top
    // of a live one is a memory leak). ----
    const map = L.map(mapEl, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        maxZoom: MAX_ZOOM,
        zoomControl: false,        // small preview card — keep it clean
        attributionControl: false, // "Hide Leaflet attribution on the homepage"
        scrollWheelZoom: false,    // don't fight page scroll
        touchZoom: true,           // pinch-zoom stays on for mobile
        tap: true,
        dragging: true
    });

    // Dark OSM basemap (CARTO's free "dark_all" tiles — OpenStreetMap
    // data underneath, no Google Maps, no API key).
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: MAX_ZOOM
    }).addTo(map);

    // Tapping the preview (not dragging it) opens the full map — same
    // "this is just a preview, tap through for detail" behavior the old
    // per-point status panel had.
    map.on('click', () => {
        document.getElementById('lwxViewFullMapBtn')?.click();
    });

    // ---- Layer registry (future-ready) ----
    // Additional live overlays — weather radar, lightning strikes, storm
    // warnings, flood alerts, planned ECG maintenance zones — can be
    // added later by calling registerLayer('radar', L.someLayer(...))
    // and toggling layers.radar.addTo(map) / .remove() independently of
    // the heat layer below. Nothing else in this file needs to change.
    const layers = {};
    function registerLayer(name, leafletLayer) {
        layers[name] = leafletLayer;
        return leafletLayer;
    }

    const heatLayer = registerLayer('heat', L.heatLayer([], {
        radius: HEAT_RADIUS,
        blur: HEAT_BLUR,
        maxZoom: MAX_ZOOM,
        max: 1.0,
        minOpacity: 0.35,
        gradient: {
            0.0: 'rgba(11, 145, 78, 0)',
            0.2: '#0B914E', // stable
            0.5: '#D6A24A', // mixed / unknown
            1.0: '#E5484D'  // outage
        }
    }));
    heatLayer.addTo(map);

    let hasFitBoundsOnce = false;
    let hasLoadedOnce = false;
    let pollTimer = null;

    function statusIntensity(rawStatus) {
        const key = String(rawStatus || 'unknown').toLowerCase();
        return STATUS_INTENSITY[key] != null ? STATUS_INTENSITY[key] : STATUS_INTENSITY.unknown;
    }

    function setStatus(message, variant) {
        if (!statusEl) return;
        statusEl.textContent = message || '';
        statusEl.dataset.variant = variant || 'loading';
        statusEl.hidden = !message;
    }

    async function fetchReports() {
        try {
            const base = (typeof LWHelpers !== 'undefined' && typeof LWHelpers.apiBase === 'function')
                ? LWHelpers.apiBase()
                : (window.API_URL || '');
            const url = `${base}/locations/map`;
            const res = window.fetchWithBackendTimeout
                ? await window.fetchWithBackendTimeout(url)
                : await fetch(url);
            if (!res.ok) throw new Error(`Bad response (${res.status})`);
            const data = await res.json();
            if (!data || !Array.isArray(data.locations)) throw new Error('Malformed /locations/map response');
            return data.locations;
        } catch (err) {
            console.error('[map-heat-home] fetch failed:', err?.message || err);
            return null;
        }
    }

    function updateStatsBar(count, latestTimestamp) {
        if (reportCountEl) {
            reportCountEl.textContent = count === 1 ? '1 active report' : `${count} active reports`;
        }
        if (updatedAtEl) {
            // Prefer the most recent report's own timestamp; fall back to
            // "now" (poll time) if nothing in the batch carries one.
            const when = latestTimestamp ? new Date(latestTimestamp) : new Date();
            const label = Number.isNaN(when.getTime())
                ? '—'
                : when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            updatedAtEl.textContent = `Updated ${label}`;
        }
    }

    // Smoothly swaps the heat layer's data in place — reuses the same
    // Leaflet.heat instance/canvas every poll (setLatLngs() replaces the
    // old point set wholesale, so nothing from a previous poll lingers),
    // rather than tearing down and recreating a layer each refresh.
    function renderHeat(locations) {
        const points = locations
            .filter(loc => Number.isFinite(loc.lat) && Number.isFinite(loc.lng))
            .map(loc => [loc.lat, loc.lng, statusIntensity(loc.status)]);

        heatLayer.setLatLngs(points);

        if (points.length && !hasFitBoundsOnce) {
            // Only auto-fit once, on the first real batch of points —
            // after that, leave the user's own pan/zoom alone between polls.
            const bounds = L.latLngBounds(points.map(p => [p[0], p[1]]));
            map.fitBounds(bounds.pad(0.35), { maxZoom: MAX_ZOOM, animate: true });
            hasFitBoundsOnce = true;
        }

        const latestTimestamp = locations.reduce((latest, loc) => {
            if (!loc.reportedAt) return latest;
            const t = new Date(loc.reportedAt).getTime();
            if (Number.isNaN(t)) return latest;
            return !latest || t > latest ? t : latest;
        }, null);

        updateStatsBar(points.length, latestTimestamp);
        setStatus(null);
    }

    async function refresh() {
        const locations = await fetchReports();
        if (locations) {
            hasLoadedOnce = true;
            renderHeat(locations);
        } else if (!hasLoadedOnce) {
            // Nothing has ever loaded successfully — show the error instead
            // of leaving the card on "Loading…" forever. A later successful
            // poll clears this automatically via setStatus(null) above. A
            // dropped poll *after* real data is already showing just leaves
            // the last-known heat map up rather than blanking it out.
            setStatus("Couldn't reach the server for live status.", 'error');
        }
    }

    function startPolling() {
        refresh();
        clearInterval(pollTimer);
        pollTimer = setInterval(refresh, POLL_INTERVAL_MS);
    }

    // Leaflet sizes itself off its container's actual rendered
    // dimensions at creation time — if the Home view is hidden (e.g.
    // display:none via the SPA router) when this script runs, the map
    // would otherwise freeze at 0×0. invalidateSize() on reveal (and via
    // ResizeObserver, for any other layout shift) keeps it correctly
    // sized without ever recreating the map instance.
    function handleReveal() {
        map.invalidateSize();
        refresh();
    }

    setStatus('Loading live status…', 'loading');
    startPolling();
    window.addEventListener('lw-page-revealed', handleReveal);

    if (typeof ResizeObserver === 'function') {
        const ro = new ResizeObserver(() => map.invalidateSize());
        ro.observe(visual);
    }
})();