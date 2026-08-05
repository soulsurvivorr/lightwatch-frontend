// ============================================================
//  VIEWS/MAP-HEAT-HOME.JS — live status heat panel for the Home
//  view's "Live Map Heat" card (#lwxMapCard / #lwxMapVisual).
//
//  Replaces the old static SVG street-grid + hand-placed
//  .lwx-map-blob mock with real GET /locations/map data, rendered
//  through the shared window.LWHeatPanel (utils/heat-panel.js) — see
//  that file's header for why this is a colored status panel rather
//  than a MapLibre map. Tapping "View full map" still just routes to
//  the Map tab (data-route="location"), where the real pin map and
//  its own larger Live Heat Map panel live.
//
//  Loaded after utils/heat-panel.js and api.js (see index.html's
//  script order) for LWHeatPanel and LWHelpers.apiBase().
// ============================================================

(function () {
    const POLL_INTERVAL_MS = 90 * 1000; // independent of the Map tab's own poll cadence — this is just a preview
    const MAX_POINTS = 8; // small card — keep it to the areas that matter most (outages ranked first, see heat-panel.js)

    const visual = document.getElementById('lwxMapVisual');
    if (!visual || !window.LWHeatPanel) return; // Home view isn't on screen, or this markup/script changed

    const panel = window.LWHeatPanel.create(visual, {
        maxPoints: MAX_POINTS,
        onSelect() {
            // Tapping any single point does the same thing the "View
            // full map" button does — jump to the real map for detail,
            // rather than trying to cram a popup into a small preview.
            const btn = document.getElementById('lwxViewFullMapBtn');
            if (btn) btn.click();
        }
    });

    let pollTimer = null;
    let hasLoadedOnce = false;

    async function fetchLocations() {
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

    async function refresh() {
        const locations = await fetchLocations();
        if (locations) {
            hasLoadedOnce = true;
            panel.update(locations);
        } else if (!hasLoadedOnce) {
            // Nothing has ever loaded successfully — show the error
            // instead of leaving the panel on its initial "Loading…"
            // text forever. If a later poll succeeds, update() clears
            // this automatically. A dropped poll *after* real points
            // are already showing just leaves the last-known state up
            // rather than blanking it out over one missed request.
            panel.showError("Couldn't reach the server for live status.");
        }
    }

    function startPolling() {
        refresh();
        clearInterval(pollTimer);
        pollTimer = setInterval(refresh, POLL_INTERVAL_MS);
    }

    startPolling();
    window.addEventListener('lw-page-revealed', refresh);
})();