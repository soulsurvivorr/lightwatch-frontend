// ============================================================
//  VIEWS/MAP-HEAT-HOME.JS — real, live MapLibre heat map for the
//  Home view's "Live Map Heat" card (#lwxMapCard / #lwxMapVisual).
//
//  Replaces the old static SVG street-grid + hand-placed
//  .lwx-map-blob mock in index.html with an actual MapLibre GL map
//  running a native `heatmap` layer, sourced from the same
//  GET /locations/map endpoint the full Map tab (views/location.js)
//  already uses. It's a second, independent MapLibre instance from
//  the one on the Map tab — this is a small live preview, not a
//  navigable copy of it. Tapping "View full map" still just routes
//  to the Map tab (data-route="location"), where the full pin map
//  now sits alongside its own second Live Heat Map card — see
//  views/location.js for that half.
//
//  Loaded after maplibre-gl (see index.html's script order — this
//  file sits right after the maplibre-gl / supercluster tags, same
//  place location.js does) and after api.js/config.js for
//  LWHelpers.apiBase(). No supercluster needed here — a heatmap
//  layer wants raw weighted points, not clustered markers.
//
//  HEAT WEIGHTING: /locations/map only ever reports status as
//  'on' | 'off' | 'unknown' (see location.js's own marker-status
//  handling) — there's no separate "mixed" tier in the real data,
//  the legend's "Mixed" bucket is really just "unknown". Weighted
//  off=1 (hottest), unknown=0.45, on=0.08 (present but cool) so the
//  ramp still shows an outage-heavy area as visibly hot instead of a
//  flat wash.
// ============================================================

(function () {
    const POLL_INTERVAL_MS = 90 * 1000; // independent of the Map tab's own poll cadence — this is just a preview

    const visual = document.getElementById('lwxMapVisual');
    if (!visual) return; // Home view isn't on screen, or this markup changed

    const canvas = document.getElementById('lwxMapCanvas');
    if (!canvas || typeof maplibregl === 'undefined') return;

    function getThemeMode() {
        const explicit = document.documentElement.getAttribute('data-theme');
        if (explicit === 'light') return 'light';
        if (explicit === 'dark') return 'dark';
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }

    function getStreetStyle() {
        return getThemeMode() === 'light'
            ? 'https://tiles.openfreemap.org/styles/positron'
            : 'https://tiles.openfreemap.org/styles/dark';
    }

    const DEFAULT_CENTER = [-1.6244, 6.6885]; // Kumasi — last-resort center only
    const HEAT_WEIGHT = { off: 1, unknown: 0.45, on: 0.08 };

    let map = null;
    let mapReady = false;
    let pollTimer = null;

    function pointsToGeoJSON(locations) {
        const features = (locations || [])
            .filter(l => Number.isFinite(l.lat) && Number.isFinite(l.lng))
            .map(l => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [l.lng, l.lat] },
                properties: { weight: HEAT_WEIGHT[l.status] ?? HEAT_WEIGHT.unknown }
            }));
        return { type: 'FeatureCollection', features };
    }

    function addHeatLayer() {
        if (map.getSource('lwx-heat-source')) return;
        map.addSource('lwx-heat-source', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
        map.addLayer({
            id: 'lwx-heat-layer',
            type: 'heatmap',
            source: 'lwx-heat-source',
            paint: {
                'heatmap-weight': ['get', 'weight'],
                'heatmap-intensity': 1.1,
                'heatmap-radius': 34,
                'heatmap-opacity': 0.85,
                'heatmap-color': [
                    'interpolate', ['linear'], ['heatmap-density'],
                    0,    'rgba(11, 107, 58, 0)',
                    0.2,  'rgba(11, 107, 58, 0.55)',
                    0.45, 'rgba(214, 162, 74, 0.7)',
                    0.75, 'rgba(229, 122, 72, 0.8)',
                    1,    'rgba(229, 72, 77, 0.9)'
                ]
            }
        });
    }

    async function fetchLocations() {
        try {
            const base = (window.LWHelpers && LWHelpers.apiBase) ? LWHelpers.apiBase() : (window.API_URL || '');
            const res = await fetch(`${base}/locations/map`);
            if (!res.ok) throw new Error(`Bad response (${res.status})`);
            const data = await res.json();
            if (!Array.isArray(data.locations)) throw new Error('Malformed /locations/map response');
            return data.locations;
        } catch (err) {
            console.error('[map-heat-home] fetch failed:', err.message);
            return null;
        }
    }

    async function refreshHeat() {
        if (!mapReady) return;
        const locations = await fetchLocations();
        if (!locations) return;

        const geojson = pointsToGeoJSON(locations);
        const source = map.getSource('lwx-heat-source');
        if (source) source.setData(geojson);

        // Fit the preview to wherever the data actually is, once, the
        // first time real points arrive — avoids shipping a hardcoded
        // bounding box that only makes sense for one town.
        if (!refreshHeat._fitted && geojson.features.length) {
            refreshHeat._fitted = true;
            const bounds = new maplibregl.LngLatBounds();
            geojson.features.forEach(f => bounds.extend(f.geometry.coordinates));
            map.fitBounds(bounds, { padding: 28, maxZoom: 13, duration: 0 });
        }
    }

    function initMap() {
        map = new maplibregl.Map({
            container: canvas,
            style: getStreetStyle(),
            center: DEFAULT_CENTER,
            zoom: 11,
            attributionControl: false,
            // Preview widget, not the full Map tab — keep it from
            // hijacking the page's own scroll/pinch, but still let
            // people drag/pan it since it's a real live map, not a
            // picture.
            scrollZoom: false,
            dragRotate: false,
            pitchWithRotate: false,
            touchPitch: false
        });

        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

        map.on('load', () => {
            addHeatLayer();
            mapReady = true;
            refreshHeat();
        });
    }

    function startPolling() {
        clearInterval(pollTimer);
        pollTimer = setInterval(refreshHeat, POLL_INTERVAL_MS);
    }

    initMap();
    startPolling();
    window.addEventListener('lw-page-revealed', () => {
        if (mapReady) refreshHeat();
        if (map) setTimeout(() => map.resize(), 60); // card may have been laid out at 0 width while hidden
    });
})();