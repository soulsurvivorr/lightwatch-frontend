// ============================================================
//  UTILS/HEAT-PANEL.JS
//  A small, dependency-free "heat map": real monitored locations
//  (name + lat/lng + status from GET /locations/map) laid out on a
//  blank panel by relative position, each drawn as a large soft
//  colored glow (.lw-heat-point__halo, sized off the panel itself via
//  CSS container query units so it scales per instance) — red for an
//  outage, amber for unknown, green for stable — that blends with
//  nearby cities' halos (mix-blend-mode: screen) so the panel reads
//  as actual spreading "heat" rather than isolated pins. A small dot
//  + city label sit on top of the halo for the precise point + name.
//
//  WHY NOT A REAL MAP: a MapLibre `heatmap` layer on the same street
//  tiles the pin map already uses just reads as a second copy of that
//  map with a blur filter on top — it doesn't communicate "here's the
//  status, at a glance" any more clearly than the real thing. This is
//  the opposite trade: no streets, no tiles, no real-world accuracy —
//  just where each place sits *relative to the others*, colored by
//  its current status, so the whole picture reads in about a second.
//
//  Exposes window.LWHeatPanel.create(container, options) ->
//  { update(locations) }. Used by:
//    - views/map-heat-home.js  (Home's "Live Map Heat" card)
//    - views/location.js       (Location view's "Live Heat Map" panel)
//
//  Loaded early (see index.html — right after utils/helpers.js) so
//  both of those files can rely on it already being defined.
// ============================================================

(function () {
    const STATUS_COLOR = {
        off: { fill: 'rgba(229, 72, 77, 0.85)', glow: 'rgba(229, 72, 77, 0.55)', ring: true },
        unknown: { fill: 'rgba(214, 162, 74, 0.85)', glow: 'rgba(214, 162, 74, 0.5)', ring: false },
        on: { fill: 'rgba(11, 145, 78, 0.85)', glow: 'rgba(11, 145, 78, 0.45)', ring: false }
    };

    function colorFor(status) {
        return STATUS_COLOR[status] || STATUS_COLOR.unknown;
    }

    // Turns real lat/lng into a 0-100% layout position *relative to the
    // other points passed in* — this deliberately isn't a map
    // projection, just "who's north/south/east/west of who", scaled to
    // fill the panel with breathing room at the edges for labels.
    function layoutPoints(locations, padPct) {
        const valid = locations.filter(l => Number.isFinite(l.lat) && Number.isFinite(l.lng));
        if (!valid.length) return [];

        const lats = valid.map(l => l.lat);
        const lngs = valid.map(l => l.lng);
        const minLat = Math.min(...lats), maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
        const latRange = maxLat - minLat || 1;
        const lngRange = maxLng - minLng || 1;
        const span = 100 - padPct * 2;

        return valid.map((l, i) => {
            // Degenerate case (every point at the same coordinate, or
            // only one point) — lay them out on a small circle instead
            // of stacking every blob in the exact same spot.
            const flatLat = maxLat === minLat;
            const flatLng = maxLng === minLng;
            let xPct, yPct;
            if (flatLat && flatLng) {
                const angle = (i / valid.length) * Math.PI * 2;
                xPct = 50 + Math.cos(angle) * (valid.length > 1 ? 18 : 0);
                yPct = 50 + Math.sin(angle) * (valid.length > 1 ? 18 : 0);
            } else {
                xPct = padPct + ((l.lng - minLng) / lngRange) * span;
                yPct = padPct + ((maxLat - l.lat) / latRange) * span; // north (higher lat) = higher on the panel
            }
            return { ...l, xPct, yPct };
        });
    }

    // Ranks "off" first so, if a panel caps how many points it shows,
    // the places that actually need attention are the ones kept.
    function severityRank(status) {
        if (status === 'off') return 0;
        if (status === 'unknown' || !status) return 1;
        return 2;
    }

    function create(container, options) {
        if (!container) return { update() {}, showLoading() {}, showError() {} };
        const opts = options || {};
        const maxPoints = opts.maxPoints || 999;
        const padPct = opts.padPct != null ? opts.padPct : 14;
        const onSelect = typeof opts.onSelect === 'function' ? opts.onSelect : null;

        container.classList.add('lw-heat-panel');
        container.innerHTML = `
            <svg class="lw-heat-panel__grid" viewBox="0 0 300 190" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <g fill="none" stroke="currentColor" stroke-width="1" opacity="0.22" stroke-linecap="round">
                    <path d="M-10 28 C 60 8, 130 55, 200 30 S 320 15, 340 25"/>
                    <path d="M-10 75 C 70 55, 150 105, 220 78 S 320 60, 340 72"/>
                    <path d="M-10 132 C 65 112, 160 158, 230 128 S 320 118, 340 128"/>
                    <path d="M25 -10 C 5 55, 62 95, 35 150 S 45 210, 30 200"/>
                    <path d="M108 -10 C 88 55, 148 90, 118 150 S 130 210, 112 200"/>
                    <path d="M190 -10 C 168 60, 232 100, 198 150 S 212 210, 192 200"/>
                    <path d="M262 -10 C 240 55, 298 95, 268 150 S 280 210, 262 200"/>
                </g>
            </svg>
            <div class="lw-heat-panel__points" aria-hidden="true"></div>
            <div class="lw-heat-panel__status" aria-live="polite"></div>
        `;
        const pointsHost = container.querySelector('.lw-heat-panel__points');
        const statusEl = container.querySelector('.lw-heat-panel__status');
        const pointEls = new Map(); // locationKey -> element, so live updates move/recolor instead of rebuilding
        let hasEverRenderedPoints = false;

        function pointKey(loc, index) {
            return loc.locationKey || loc.name || `pt-${index}`;
        }

        // Loading/error/empty text — shown whenever there are no points
        // to draw, so the card never just sits there as a bare grid with
        // no explanation. Cleared automatically the moment update()
        // successfully renders at least one point.
        function setStatus(message, variant) {
            if (!statusEl) return;
            statusEl.textContent = message || '';
            statusEl.dataset.variant = variant || 'loading';
            statusEl.hidden = !message;
        }

        function showLoading(message) {
            setStatus(message || 'Loading live status…', 'loading');
        }

        function showError(message) {
            setStatus(message || "Couldn't load live status.", 'error');
        }

        // Shown once on creation, before the first update() call ever
        // lands — without this the panel was just a blank grid for
        // however long the first fetch took, indistinguishable from
        // a fetch that had already failed.
        showLoading();

        function update(locations) {
            const sorted = (locations || [])
                .slice()
                .sort((a, b) => severityRank(a.status) - severityRank(b.status))
                .slice(0, maxPoints);

            const laidOut = layoutPoints(sorted, padPct);
            const seenKeys = new Set();

            laidOut.forEach((loc, i) => {
                const key = pointKey(loc, i);
                seenKeys.add(key);
                const color = colorFor(loc.status);

                let el = pointEls.get(key);
                if (!el) {
                    el = document.createElement('button');
                    el.type = 'button';
                    el.className = 'lw-heat-point';
                    el.innerHTML = `
                        <span class="lw-heat-point__halo" aria-hidden="true"></span>
                        <span class="lw-heat-point__ring" aria-hidden="true"></span>
                        <span class="lw-heat-point__dot" aria-hidden="true"></span>
                        <span class="lw-heat-point__label"></span>
                    `;
                    if (onSelect) el.addEventListener('click', () => onSelect(loc));
                    pointsHost.appendChild(el);
                    pointEls.set(key, el);
                }

                el.style.left = `${loc.xPct}%`;
                el.style.top = `${loc.yPct}%`;
                el.style.setProperty('--lw-heat-fill', color.fill);
                el.style.setProperty('--lw-heat-glow', color.glow);
                el.classList.toggle('lw-heat-point--alert', !!color.ring);
                // The signed-in user's own reported location gets a
                // distinct "you are here" blue pin on top of its status
                // color, same idea as the pin map's own blue GPS dot —
                // see location.js's `live` flag (set by matching against
                // the user's registered city).
                el.classList.toggle('lw-heat-point--self', !!loc.live);
                // Places nobody has ever pinned via the location picker —
                // GET /locations/map falls back to geocoding the town name
                // for these and marks them coordsApproximate: true. Both
                // this panel and the pin map read the same flag off the
                // same response, so they stay consistent with each other;
                // here it renders as a dashed ring instead of a solid
                // filled dot, so it's clear at a glance which points are
                // user-confirmed positions vs. best-effort guesses.
                el.classList.toggle('lw-heat-point--approx', !!loc.coordsApproximate);
                // Flip the label to sit below the dot instead of above
                // when the point is near the top edge, so it doesn't
                // get clipped by the panel's own bounds.
                el.classList.toggle('lw-heat-point--label-below', loc.yPct < 18);
                el.querySelector('.lw-heat-point__label').textContent = loc.name || '';
                const statusLabel = loc.status === 'off' ? 'power outage' : loc.status === 'on' ? 'stable' : 'status unknown';
                const approxSuffix = loc.coordsApproximate ? ' (approximate location)' : '';
                el.setAttribute('aria-label', `${loc.name || 'Unknown area'}: ${statusLabel}${approxSuffix}`);
                el.title = el.getAttribute('aria-label');
            });

            // Drop points that no longer exist in the latest dataset
            // (e.g. a filtered view, or a location removed server-side).
            pointEls.forEach((el, key) => {
                if (!seenKeys.has(key)) {
                    el.remove();
                    pointEls.delete(key);
                }
            });

            if (laidOut.length) {
                hasEverRenderedPoints = true;
                setStatus(null);
            } else if (!hasEverRenderedPoints) {
                // A genuinely empty (but successful) response — distinct
                // from a fetch failure, which callers should report via
                // showError() instead of calling update([]).
                setStatus('No monitored locations to show yet.', 'empty');
            }
        }

        return { update, showLoading, showError };
    }

    window.LWHeatPanel = { create };
})();