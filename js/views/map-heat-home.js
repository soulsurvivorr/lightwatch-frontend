// ============================================================
//  VIEWS/MAP-HEAT-HOME.JS — live Leaflet heat map for the Home
//  view's "Live Map Heat" card (#lwxMapCard / #lwxMapVisual).
//
//  Real OpenStreetMap tiles (dark basemap via CARTO's free dark_all
//  tiles — still OSM data, no Google Maps, no token) + a genuine
//  Leaflet.heat heat layer, driven by the existing GET /locations/map
//  endpoint. Each entry in that response is one monitored place's
//  latest community-reported status (lat, lng, status, reportedAt) —
// exactly the "report" shape this card heats. Stable, unknown, and outage
// points use separate color-isolated heat layers so dense stable areas
// cannot accumulate into the outage/red gradient when zoomed out.
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
    const POLL_INTERVAL_MS = Number(window.LW_HEATMAP_POLL_MS) || 10 * 1000; // Default: refresh every 10 seconds (override via LW_HEATMAP_POLL_MS)
    const MAX_ZOOM = 16;
    // The full map fits tight (maxZoom 16 above) since it has room to zoom
    // freely. The small home-card preview should stay pulled back a bit
    // more by default so it reads as an overview, not a tight crop on
    // whichever cluster of points happens to be closest together.
    const HOME_CARD_FIT_MAX_ZOOM = 8;
    const HEAT_RADIUS = 40; // 35-45px
    const HEAT_BLUR = 30;   // 25-35px

    // Same statuses, as marker dot colors and isolated heat-layer colors.
    const STATUS_COLOR = {
        on: { fill: '#0B914E', glow: 'rgba(11, 145, 78, 0.55)' },
        unknown: { fill: '#D6A24A', glow: 'rgba(214, 162, 74, 0.55)' },
        off: { fill: '#E5484D', glow: 'rgba(229, 72, 77, 0.6)' }
    };

    // Ghana-wide default view (this app is GH-only) — used until the
    // first real batch of points comes in and the map fits to them.
    const DEFAULT_CENTER = [7.9465, -1.0232];
    const DEFAULT_ZOOM = 6;

    if (typeof L === 'undefined' || typeof L.heatLayer !== 'function') {
        console.error('[map-heat-home] Leaflet or Leaflet.heat failed to load');
        return;
    }

    // ---- Shared SSE connection ----
    // One EventSource for the whole page rather than one per card: the
    // home card and the Locations view's own full-map heat panel can
    // both be alive at once, and each opening its own /locations/stream
    // connection would just be two redundant sockets doing the same
    // job. Lazily opened on the first instance and fanned out to every
    // registered instance's own refresh() from there.
    let sharedEventSource = null;
    let sseConnected = false;
    const liveInstanceRefreshers = new Set();

    function ensureSharedSse() {
        if (sharedEventSource || typeof EventSource === 'undefined') return;
        try {
            const base = (typeof LWHelpers !== 'undefined' && typeof LWHelpers.apiBase === 'function')
                ? LWHelpers.apiBase()
                : (window.API_URL || '');
            const url = `${base}/locations/stream`;
            sharedEventSource = new EventSource(url);
            sharedEventSource.addEventListener('location:update', () => {
                liveInstanceRefreshers.forEach((fn) => {
                    try { fn(); } catch (e) { console.error('[map-heat-home] SSE update handling error', e); }
                });
            });
            sharedEventSource.onopen = () => {
                sseConnected = true;
                console.log('[map-heat-home] SSE connected');
            };
            sharedEventSource.onerror = () => {
                // EventSource auto-reconnects on its own; fall back to the
                // faster poll cadence for however long the connection is down.
                sseConnected = false;
                console.warn('[map-heat-home] SSE connection error');
            };
        } catch (err) {
            console.warn('[map-heat-home] SSE not available', err);
        }
    }

    function createLiveHeatMap(visual, options = {}) {
        if (!visual || visual.dataset.liveHeatMapBound === '1') return null;
        visual.dataset.liveHeatMapBound = '1';
        const isFullMap = options.full === true;

    function statusKey(rawStatus) {
        return String(rawStatus || 'unknown').toLowerCase();
    }

    function colorFor(rawStatus) {
        return STATUS_COLOR[statusKey(rawStatus)] || STATUS_COLOR.unknown;
    }

    function escapeHtml(str) {
        return String(str || '').replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[ch]));
    }

    // ---- Build the card's inner DOM once ----
    // (map canvas + the "Live" badge / stats bar overlays that sit on
    // top of it — see home.css .lwx-map-live-badge / .lwx-map-stats).
    // The canvas gets its dark background as an inline style, not just
    // via CSS: Leaflet's own stylesheet sets ".leaflet-container {
    // background: #ddd}" once L.map() runs, and because leaflet.css is
    // linked after home.css in <head>, it would otherwise win the
    // cascade and show a flash/patch of light gray. Inline style always
    // beats an external stylesheet regardless of link order.
    visual.classList.add('lwx-heat-map-host');
    visual.innerHTML = `
        <div class="lwx-heat-map" style="background:#0b0e14"></div>
        <div class="lwx-map-live-badge"><span class="pulse pulse--on" aria-hidden="true"></span>Live</div>
        <div class="lwx-map-stats" id="lwxMapStatsBar">
            <span class="lwx-map-report-count">Loading…</span>
            <span class="lwx-map-stats__sep" aria-hidden="true">•</span>
            <span class="lwx-map-updated-at">—</span>
        </div>
        <div class="lwx-map-status" id="lwxMapStatus" hidden></div>
    `;

    const mapEl = visual.querySelector('.lwx-heat-map');
    const reportCountEl = visual.querySelector('.lwx-map-report-count');
    const updatedAtEl = visual.querySelector('.lwx-map-updated-at');
    const statusEl = visual.querySelector('.lwx-map-status');

    // ---- Map — built lazily, the first time the card is actually
    // visible (see ensureMapBuilt() below), and then exactly once after
    // that. This view's script runs *before* app.js (the router) ever
    // gets to mark #view-home as the active view — see index.html's
    // script order — so at the moment this file first executes, the
    // card can easily still be sitting at display:none with zero layout
    // size. Leaflet reads its container's actual pixel size at init
    // time; building it against a 0×0 box is what produces a map that
    // only ever renders a tiny sliver in one corner, which
    // invalidateSize() later can't fully recover from. Deferring
    // construction until there's real layout avoids that entirely. ----
    let map = null;
    let heatLayers = {};
    let markersLayer = null;
    let mapBuilt = false;
    let pendingLocations = null; // data that arrived before the map could be built

    function isVisible(el) {
        return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    }

    function buildMap() {
        if (mapBuilt) return;
        mapBuilt = true;

        map = L.map(mapEl, {
            center: DEFAULT_CENTER,
            zoom: DEFAULT_ZOOM,
            maxZoom: MAX_ZOOM,
            zoomControl: isFullMap,
            attributionControl: isFullMap,
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

        // Tapping the open map background (not a marker, not a drag)
        // opens the full map — same "this is just a preview, tap through
        // for detail" behavior the old per-point status panel had.
        if (!isFullMap) {
            map.on('click', () => {
                document.getElementById('lwxViewFullMapBtn')?.click();
            });
        }

        // ---- Layer registry (future-ready) ----
        // Additional live overlays — weather radar, lightning strikes,
        // storm warnings, flood alerts, planned ECG maintenance zones —
        // can be added later by calling
        // registerLayer('radar', L.someLayer(...)) and toggling
        // layers.radar.addTo(map) / .remove() independently of the heat
        // and markers layers below. Nothing else in this file needs to
        // change.
        const layers = {};
        function registerLayer(name, leafletLayer) {
            layers[name] = leafletLayer;
            return leafletLayer;
        }

        Object.entries(STATUS_COLOR).forEach(([status, color]) => {
            const layer = L.heatLayer([], {
                radius: HEAT_RADIUS,
                blur: HEAT_BLUR,
                maxZoom: MAX_ZOOM,
                max: 1.0,
                minOpacity: 0.35,
                gradient: {
                    0.0: 'rgba(0, 0, 0, 0)',
                    1.0: color.fill
                }
            });
            heatLayers[status] = registerLayer(`heat-${status}`, layer);
            layer.addTo(map);
        });

        // Per-location colored dot + name label, layered on top of the
        // heat blur — one per plotted place, colored to match its
        // current status, so individual towns are identifiable and not
        // just an anonymous glow. A plain LayerGroup so it can be
        // cleared and rebuilt each poll without touching the heat layer.
        markersLayer = registerLayer('markers', L.layerGroup());
        markersLayer.addTo(map);

        // Belt-and-braces: even though we only build once the container
        // reports a real size, force a size recheck a couple of times
        // right after construction — covers the case where the reveal
        // and the build happen in the same tick, before the browser has
        // actually painted the new layout.
        requestAnimationFrame(() => map.invalidateSize());
        setTimeout(() => map.invalidateSize(), 250);

        if (pendingLocations) {
            renderHeat(pendingLocations);
            pendingLocations = null;
        }
    }

    // Returns true if the map exists (building it first if the card has
    // just become visible); false if it still can't be built yet.
    function ensureMapBuilt() {
        if (mapBuilt) return true;
        if (isVisible(visual)) {
            buildMap();
            return true;
        }
        return false;
    }

    let hasFitBoundsOnce = false;
    let hasLoadedOnce = false;
    let pollTimer = null;

    function setStatus(message, variant) {
        if (!statusEl) return;
        statusEl.textContent = message || '';
        statusEl.dataset.variant = variant || 'loading';
        statusEl.hidden = !message;
    }

    async function fetchReports() {
        if (fetchReports.__inFlight) return null;
        fetchReports.__inFlight = true;
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
        } finally {
            fetchReports.__inFlight = false;
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

    // Smoothly swaps each isolated status layer's data in place. Keeping
    // statuses separate prevents Leaflet.heat's density accumulation from
    // changing a stable green area into an outage red area at low zoom.
    // Colored location markers are rebuilt the same way: clearLayers()
    // first removes every marker from the previous poll before the new
    // batch is added, so nothing stale is ever left on the map.
    function renderHeat(locations) {
        const plottable = locations.filter(loc => Number.isFinite(loc.lat) && Number.isFinite(loc.lng));

        const points = plottable.map(loc => [loc.lat, loc.lng]);
        Object.keys(heatLayers).forEach((status) => {
            const statusPoints = plottable
                .filter(loc => statusKey(loc.status) === status)
                .map(loc => [loc.lat, loc.lng, 1]);
            heatLayers[status].setLatLngs(statusPoints);
        });

        markersLayer.clearLayers();
        // Used to cap the mini card at its 8 highest-severity points so
        // "off"/"unknown" locations wouldn't lose their labeled pin to
        // crowding — but that meant any location outside the top 8 (like
        // a brand-new "unknown" one competing with lots of others) never
        // got a name/pin at all, even though the full map showed it fine.
        // Show every plottable location on both, same as the full map.
        plottable
            .forEach(loc => {
                const color = colorFor(loc.status);
                const icon = L.divIcon({
                    className: 'lwx-heat-marker-icon',
                    iconSize: [14, 14],
                    iconAnchor: [7, 7],
                    html: `
                        <span class="lwx-heat-marker__dot" style="--lwx-marker-fill:${color.fill};--lwx-marker-glow:${color.glow}"></span>
                        <span class="lwx-heat-marker__label">${escapeHtml(loc.name)}</span>
                    `
                });
                const marker = L.marker([loc.lat, loc.lng], { icon, keyboard: false });
                const statusLabel = statusKey(loc.status) === 'off' ? 'power outage' : statusKey(loc.status) === 'on' ? 'stable' : 'status unknown';
                marker.bindTooltip(`${loc.name || 'Unknown area'}: ${statusLabel}`, { direction: 'top', offset: [0, -6] });
                // Tapping a specific location behaves the same as tapping
                // the map background — opens the full map for detail.
                if (!isFullMap) {
                    marker.on('click', () => {
                        document.getElementById('lwxViewFullMapBtn')?.click();
                    });
                }
                markersLayer.addLayer(marker);
            });

        if (points.length && !hasFitBoundsOnce) {
            // Only auto-fit once, on the first real batch of points —
            // after that, leave the user's own pan/zoom alone between polls.
            // Mini card gets extra padding on top of its lower zoom cap so
            // it reads as a wide overview rather than a tight crop.
            const bounds = L.latLngBounds(points.map(p => [p[0], p[1]]));
            map.fitBounds(bounds.pad(isFullMap ? 0.35 : 0.6), { maxZoom: isFullMap ? MAX_ZOOM : HOME_CARD_FIT_MAX_ZOOM, animate: true });
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
            if (ensureMapBuilt()) {
                renderHeat(locations);
            } else {
                // Card's still hidden (e.g. Home isn't the active view yet)
                // — hang onto the data and draw it the moment the map can
                // be built, instead of dropping this poll on the floor.
                pendingLocations = locations;
            }
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
        clearTimeout(pollTimer);
        async function tick() {
            await refresh();
            // SSE is the primary signal once it's up — this loop just
            // becomes a slow safety net in case an update event is missed.
            // While SSE is down/still connecting, poll at the normal cadence.
            const nextDelay = sseConnected ? POLL_INTERVAL_MS * 6 : POLL_INTERVAL_MS;
            pollTimer = setTimeout(tick, nextDelay);
        }
        tick();
    }

    // ---- SSE: register this instance so the shared connection's
    // 'location:update' events (see ensureSharedSse() above) trigger
    // its refresh() too — no per-instance EventSource needed.
    liveInstanceRefreshers.add(refresh);
    ensureSharedSse();

    // Fires on every reveal of the card's view (including, per home.js's
    // own use of the same event, the very first one) — makes sure the
    // map gets built/resized/refreshed as soon as it's actually on
    // screen, not just on the next 30s poll.
    function handleReveal() {
        const justBuilt = ensureMapBuilt();
        if (justBuilt && map) map.invalidateSize();
        refresh();
    }

    setStatus('Loading live status…', 'loading');
    startPolling();
    window.addEventListener('lw-page-revealed', handleReveal);
    // Fired by location.js right after a new location is successfully
    // added (loc-header__add) — every live heat-map instance on the page
    // (home card + the Locations view's own full-map heat panel) picks
    // it up immediately rather than waiting on its own poll/SSE cycle.
    window.addEventListener('lw:locations-changed', () => {
        if (ensureMapBuilt() && map) map.invalidateSize();
        refresh();
    });

    // Extra safety nets for the "still hidden when this script ran"
    // case, in case lw-page-revealed isn't dispatched for the very first
    // view shown on page load:
    // 1) ResizeObserver — fires when the (until-now display:none) card
    //    is laid out for the first time.
    if (typeof ResizeObserver === 'function') {
        const ro = new ResizeObserver(() => {
            if (ensureMapBuilt() && map) map.invalidateSize();
        });
        ro.observe(visual);
    }
    // 2) Short polling loop as a last resort, in case neither of the
    //    above fires before the router shows the view — stops once the
    //    map is built or after ~6s.
    let visibilityChecks = 0;
    const visibilityPoll = setInterval(() => {
        visibilityChecks += 1;
        if (mapBuilt || visibilityChecks > 40) {
            clearInterval(visibilityPoll);
            return;
        }
        if (ensureMapBuilt() && map) {
            map.invalidateSize();
            if (pendingLocations) refresh();
        }
    }, 150);

        return {
            refresh,
            invalidateSize() {
                if (map) map.invalidateSize();
            }
        };
    }

    window.LWLiveHeatMap = { create: createLiveHeatMap };

    const homeVisual = document.getElementById('lwxMapVisual');
    if (homeVisual) createLiveHeatMap(homeVisual);
})();