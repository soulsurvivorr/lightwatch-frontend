// ============================================================
//  UTILS/LOCATION-PICKER.JS
//  Shared "type a city, get real map-matched suggestions, or use my
//  GPS" behavior for any city text input — used by both signup.js
//  (new account) and account.js (editing an existing account's city)
//  so the two forms work identically instead of drifting apart.
//
//  Wires up:
//   - Instant, local prefix search against a pre-built town/city
//     gazetteer (data/gh-towns.json, produced offline by
//     scripts/build_gh_towns.py from OpenStreetMap) — this is what
//     makes "Nk" pop up Nkawie/Nkoranza/etc. before the user finishes
//     typing, with zero network round-trip. Scoped to whatever region
//     is selected, same as the live search below.
//   - Nominatim search-as-you-type as a slower background layer
//     underneath the instant local one — same OSM geocoder
//     location.js's own search dropdown uses, biased by the selected
//     region — which fills in anything the local gazetteer doesn't
//     have (a town added to OSM after the gazetteer was last built,
//     an unusual spelling, etc.). Debounced, since this one *is* a
//     real network call.
//   - "Use my location" (navigator.geolocation), which both reverse-
//     geocodes a friendly city name (via GET /geocode/reverse) AND
//     keeps the raw GPS fix — the fix is what actually gets saved,
//     the name is just what fills the text field.
//
//  Either path calls onPick({ label, lat, lng }) and the caller reads
//  the confirmed coordinates back via the returned .getCoords(). A
//  hand-typed edit after a pick clears the stored coords — we can't
//  vouch for a position that no longer matches what's in the box.
// ============================================================

(function () {
    const PIN_ICON = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 21s7-7.02 7-12a7 7 0 1 0-14 0c0 4.98 7 12 7 12Z" stroke="currentColor" stroke-width="1.8"/></svg>';
    const DEFAULT_GAZETTEER_URL = '/data/gh-towns.json';

    function resultRow(label, sub) {
        return `<button type="button" class="loc-search__result">
      <span class="loc-search__result-icon loc-search__result-icon--geocoder">${PIN_ICON}</span>
      <span><span>${label}</span>${sub ? `<span class="loc-search__result-sub">${sub}</span>` : ''}</span>
    </button>`;
    }

    // ---- Local gazetteer (instant, no network) -------------------------
    // Loaded once per page (module-level, not per-input) and shared by
    // every attach()'d field. build_gh_towns.py produces this file as
    // { "<region key>": [{ name, lat, lon }, ...], ... }.
    let gazetteerPromise = null;
    function loadGazetteer(url) {
        if (!gazetteerPromise) {
            gazetteerPromise = fetch(url)
                .then((res) => (res.ok ? res.json() : {}))
                .catch((err) => {
                    console.error('Town gazetteer failed to load, falling back to live search only:', err.message);
                    return {};
                });
        }
        return gazetteerPromise;
    }

    // Shapes a gazetteer entry into the same { display_name, lat, lon,
    // address } shape a Nominatim result comes in, so downstream
    // rendering/merging doesn't need to know which source a match came
    // from.
    function toSuggestionShape(town, regionKey) {
        const regionLabel = regionKey
            ? regionKey.replace(/\b\w/g, (c) => c.toUpperCase())
            : '';
        return {
            display_name: regionLabel ? `${town.name}, ${regionLabel} Region, Ghana` : `${town.name}, Ghana`,
            lat: town.lat,
            lon: town.lon,
            address: regionKey ? { state: regionKey } : undefined
        };
    }

    function prefixMatchLocal(gazetteer, region, query, limit) {
        const q = query.toLowerCase();
        const regionKey = normalizeRegionKey(region);
        const pools = regionKey && gazetteer[regionKey]
            ? [[regionKey, gazetteer[regionKey]]]
            : Object.entries(gazetteer || {});

        const out = [];
        for (const [key, towns] of pools) {
            for (const t of towns || []) {
                if (t.name && t.name.toLowerCase().startsWith(q)) {
                    out.push(toSuggestionShape(t, key));
                    if (out.length >= limit) return out;
                }
            }
        }
        return out;
    }

    // Merges the instant local matches with whatever Nominatim came back
    // with, local-first, deduped by name so the same town found in both
    // sources doesn't show up twice.
    function mergeSuggestions(localMatches, liveMatches, limit) {
        const seen = new Set();
        const merged = [];
        for (const m of [...localMatches, ...liveMatches]) {
            const label = (m.display_name || '').split(',')[0].trim().toLowerCase();
            if (!label || seen.has(label)) continue;
            seen.add(label);
            merged.push(m);
            if (merged.length >= limit) break;
        }
        return merged;
    }

    // ---- Region scoping -----------------------------------------------
    // Approximate bounding boxes for Ghana's 16 regions, [minLon, minLat,
    // maxLon, maxLat]. These are intentionally generous/padded rather than
    // precise administrative polygons — their only job is to bias Nominatim

    // toward the right part of the country (via viewbox+bounded) so a
    // partial town name resolves to matches near where the user actually
    // is, instead of a same-named town three regions away. The real
    // precision comes from regionMatches() below, which checks each
    // result's own reverse-geocoded region once results come back.
    const GHANA_REGION_BBOX = {
        'greater accra': [-0.55, 5.35, 0.65, 6.20],
        'ashanti': [-2.50, 5.60, -0.60, 7.60],
        'central': [-3.30, 4.70, -0.50, 6.20],
        'western': [-3.30, 4.70, -1.80, 6.20],
        'western north': [-3.30, 5.80, -2.20, 7.00],
        'eastern': [-1.50, 5.50, 0.20, 7.30],
        'volta': [-0.20, 5.80, 1.30, 8.50],
        'oti': [-0.10, 7.00, 0.90, 8.80],
        'northern': [-2.00, 8.00, 0.50, 10.60],
        'north east': [-1.50, 9.90, -0.10, 11.00],
        'savannah': [-2.70, 8.00, -0.30, 10.20],
        'upper east': [-1.20, 10.50, 0.30, 11.20],
        'upper west': [-2.90, 9.60, -1.60, 11.00],
        'bono': [-3.00, 7.00, -1.40, 8.20],
        'bono east': [-1.80, 7.20, -0.10, 8.70],
        'ahafo': [-2.90, 6.70, -2.20, 7.60],
        // Pre-2019 name that split into Bono / Bono East / Ahafo — kept as
        // an alias since older data (and some users) still use it.
        'brong ahafo': [-3.00, 6.70, -0.10, 8.70]
    };

    function normalizeRegionKey(region) {
        return String(region || '')
            .toLowerCase()
            .replace(/\bregion\b/g, '')
            .trim()
            .replace(/\s+/g, ' ');
    }

    function regionViewbox(region) {
        const box = GHANA_REGION_BBOX[normalizeRegionKey(region)];
        if (!box) return null;
        const [minLon, minLat, maxLon, maxLat] = box;
        // Nominatim's viewbox param order is left,top,right,bottom, i.e.
        // minLon,maxLat,maxLon,minLat — not the [minLon,minLat,maxLon,maxLat]
        // order the table above is written in.
        return `${minLon},${maxLat},${maxLon},${minLat}`;
    }

    // Loose match rather than exact: Nominatim's address.state comes back
    // as "Ashanti Region", "Ashanti", or occasionally the pre-2019
    // "Brong-Ahafo" for a town in one of the three regions split out of it
    // in 2019 — so either name containing the other counts as a match.
    function regionMatches(selectedRegion, addressState) {
        if (!selectedRegion || !addressState) return true;
        const a = normalizeRegionKey(selectedRegion);
        const b = normalizeRegionKey(addressState);
        if (!a || !b) return true;
        return a.includes(b) || b.includes(a);
    }

    // options:
    //   input        — the city text <input> (required)
    //   resultsEl    — container to render the dropdown into (optional —
    //                  search-as-you-type is skipped without one)
    //   locateBtn    — "use my location" button (optional)
    //   hintEl       — status text element (optional)
    //   getRegion    — () => current region string, for biasing/query
    //                  disambiguation (optional)
    //   gazetteerUrl — path to the pre-built local town list (optional —
    //                  defaults to '/data/gh-towns.json'; pass `null` to
    //                  disable the instant-local layer and use Nominatim
    //                  alone, e.g. if that build step isn't set up yet)
    //   onPick       — ({ label, lat, lng }) => void, called on any
    //                  confirmed pick (search result or GPS fix)
    function attach({ input, resultsEl, locateBtn, hintEl, getRegion, gazetteerUrl, onPick }) {
        if (!input) return { getCoords: () => null, reset: () => {} };

        const gazetteerSrc = gazetteerUrl === null ? null : (gazetteerUrl || DEFAULT_GAZETTEER_URL);

        // Kick the local gazetteer fetch off right now instead of lazily
        // on the first keystroke (runLocalPass below used to be the only
        // caller of loadGazetteer). loadGazetteer() itself is memoized
        // per-URL, so this just moves the one-time network fetch+parse
        // earlier — by the time the person's typed 2 characters it's
        // almost always already resolved, so that first search feels
        // instant instead of visibly lagging behind the keystroke (this
        // was most of what made a brand-new page's — e.g. signup's —
        // very first search feel slow).
        if (gazetteerSrc) loadGazetteer(gazetteerSrc);

        let coords = null;
        let debounceTimer = null;
        let abortController = null;
        // Whatever the instant local layer found for the CURRENT query —
        // kept around so the slower Nominatim response, when it lands,
        // can be merged on top instead of overwriting it.
        let localMatches = [];
        // Per-input result cache, keyed on region+query. Ghana's town list
        // doesn't change mid-session, so a repeated or backspaced-then-
        // retyped query can be answered instantly instead of re-hitting
        // Nominatim. Capped below rather than left to grow unbounded over
        // a long-lived session.
        const resultCache = new Map();

        const setHint = (text) => { if (hintEl) hintEl.textContent = text; };
        const clearResults = () => {
            if (!resultsEl) return;
            resultsEl.setAttribute('hidden', '');
            resultsEl.innerHTML = '';
        };

        function renderResults(matches, query) {
            if (!resultsEl) return;
            if (!matches.length) {
                resultsEl.innerHTML = '<div class="loc-search__result" style="cursor:default">No matches found — you can still type it in</div>';
                resultsEl.removeAttribute('hidden');
                return;
            }

            resultsEl.innerHTML = matches.map((m, i) => {
                const label = (m.display_name || '').split(',')[0].trim() || m.display_name;
                return `<div data-index="${i}">${resultRow(label, m.display_name)}</div>`;
            }).join('');

            resultsEl.querySelectorAll('[data-index]').forEach((wrap) => {
                wrap.querySelector('.loc-search__result').addEventListener('mousedown', (e) => {
                    // mousedown (not click) so this fires before the input's
                    // own blur handler clears the dropdown out from under it.
                    e.preventDefault();
                    const m = matches[Number(wrap.dataset.index)];
                    const lat = parseFloat(m.lat);
                    const lng = parseFloat(m.lon);
                    const label = (m.display_name || '').split(',')[0].trim() || query;
                    input.value = label;
                    coords = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
                    clearResults();
                    setHint(coords ? 'Location confirmed from map search.' : 'Picked, but that result had no usable position.');
                    if (typeof onPick === 'function') onPick({ label, lat: coords?.lat ?? null, lng: coords?.lng ?? null });
                });
            });

            resultsEl.removeAttribute('hidden');
        }

        function runLocalPass(query) {
            if (!gazetteerSrc) { localMatches = []; return; }
            loadGazetteer(gazetteerSrc).then((data) => {
                if (input.value.trim() !== query) return; // superseded already
                const region = typeof getRegion === 'function' ? getRegion() : '';
                localMatches = prefixMatchLocal(data, region, query, 8);
                if (localMatches.length) renderResults(localMatches, query);
            });
        }

        async function search(query) {
            if (!resultsEl) return;
            if (!query || query.length < 2) { clearResults(); return; }

            const region = typeof getRegion === 'function' ? getRegion() : '';
            const cacheKey = `${region.toLowerCase()}|${query.toLowerCase()}`;

            if (resultCache.has(cacheKey)) {
                renderResults(resultCache.get(cacheKey), query);
                return;
            }

            // A newer keystroke supersedes whatever's still in flight —
            // abort it outright instead of letting it resolve late and
            // (occasionally, since fetches don't always resolve in the
            // order they were sent) paint an older, less-specific result
            // set over a newer one. This is most of what "sometimes takes
            // a little long" actually was: not the request itself being
            // slow, but a slower in-flight request from an earlier
            // keystroke landing after a faster later one.
            if (abortController) abortController.abort();
            abortController = new AbortController();
            const { signal } = abortController;

            const q = region ? `${query}, ${region}, Ghana` : `${query}, Ghana`;
            const viewbox = regionViewbox(region);
            const params = new URLSearchParams({
                format: 'jsonv2',
                countrycodes: 'gh',
                limit: '8',
                addressdetails: '1',
                q
            });
            if (viewbox) {
                // Bias + hard-bound the search to the selected region's
                // bounding box, so "Esereso" while Ashanti is selected
                // surfaces the Ashanti Esereso first instead of a
                // same-named town elsewhere in the country.
                params.set('viewbox', viewbox);
                params.set('bounded', '1');
            }

            let matches = [];
            try {
                const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
                const res = await fetch(url, { headers: { 'Accept-Language': 'en' }, signal });
                if (res.ok) {
                    const data = await res.json();
                    matches = Array.isArray(data) ? data : [];
                }
            } catch (err) {
                if (err.name === 'AbortError') return; // superseded — just drop it
                console.error('Location search failed:', err.message);
            }

            // Prefer matches whose own reverse-geocoded region lines up
            // with what the user picked. If that empties the list (the
            // bounding box is deliberately approximate, and OSM's state
            // field doesn't always agree with our region list), fall back
            // to the unfiltered set rather than showing "no matches" for
            // what's still a real, findable result.
            if (region && matches.length) {
                const scoped = matches.filter((m) => regionMatches(region, m.address && m.address.state));
                if (scoped.length) matches = scoped;
            }

            if (resultCache.size > 200) resultCache.clear();
            resultCache.set(cacheKey, matches);

            // The box may have moved on to a different value while this
            // request was out — don't paint a stale answer over it.
            if (input.value.trim() !== query) return;

            // Merge on top of whatever the instant local layer already
            // showed, rather than replacing it — the local list answered
            // in milliseconds; Nominatim is here to add anything that
            // list didn't have, not to make the box flicker.
            renderResults(mergeSuggestions(localMatches, matches, 8), query);
        }

        input.addEventListener('input', () => {
            coords = null; // typed text no longer matches whatever was last confirmed
            const query = input.value.trim();
            clearTimeout(debounceTimer);

            if (!query || query.length < 2) {
                localMatches = [];
                clearResults();
                return;
            }

            // Instant local pass first — no network, no debounce. This is
            // what lets "Nk" surface Nkawie/Nkoranza/etc. before the user
            // has finished typing, instead of waiting on a live request.
            runLocalPass(query);

            // Nominatim underneath, debounced as before — fills in typo-
            // tolerant/fuzzy matches and anything missing from the local
            // list. Short debounce — just enough to skip firing a request
            // per keystroke during a fast typer's burst — not a delay
            // meant to be felt.
            debounceTimer = setTimeout(() => search(query), 120);
        });
        input.addEventListener('blur', () => {
            setTimeout(clearResults, 150); // let a result's mousedown register first
        });

        function runGeolocation() {
            if (locateBtn) { locateBtn.classList.add('is-loading'); locateBtn.disabled = true; }
            setHint('Requesting location permission…');

            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const lat = pos.coords.latitude;
                    const lng = pos.coords.longitude;
                    setHint('Finding your city…');

                    fetch(`${API_URL}/geocode/reverse?lat=${lat}&lng=${lng}`)
                        .then((res) => res.json())
                        .then((data) => {
                            const place = data && data.city;
                            coords = { lat, lng };
                            if (place) {
                                input.value = place;
                                setHint('Detected automatically — feel free to edit it if it is not quite right.');
                            } else {
                                setHint('Got your position, but could not name the town — please check the text.');
                            }
                            if (typeof onPick === 'function') onPick({ label: place || input.value, lat, lng });
                        })
                        .catch(() => {
                            // We still have a real GPS fix even if naming it failed —
                            // keep the coords, just don't overwrite the typed text.
                            coords = { lat, lng };
                            setHint('Could not name your location, but the position was saved — feel free to edit the text.');
                            if (typeof onPick === 'function') onPick({ label: input.value, lat, lng });
                        })
                        .finally(() => {
                            if (locateBtn) { locateBtn.classList.remove('is-loading'); locateBtn.disabled = false; }
                            input.focus();
                        });
                },
                (err) => {
                    if (locateBtn) { locateBtn.classList.remove('is-loading'); locateBtn.disabled = false; }
                    if (err && err.code === 1) {
                        setHint('Location permission was denied — you can still type your city manually.');
                    } else if (err && err.code === 3) {
                        setHint('Location request timed out — please type your city manually.');
                    } else {
                        setHint('Could not get your location — please type your city manually.');
                    }
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
            );
        }

        // Click always re-checks first — if the user has since revoked
        // permission (or never granted it), this still asks; it just
        // skips the extra round-trip when we already know the answer.
        function requestLocate() {
            if (!('geolocation' in navigator)) {
                setHint('Location is not available on this device — please type your city.');
                return;
            }
            if (navigator.permissions?.query) {
                navigator.permissions.query({ name: 'geolocation' })
                    .then((status) => {
                        if (status.state === 'denied') {
                            setHint('Location is blocked for this site — enable it in your browser/site settings, or type your city manually.');
                            return;
                        }
                        runGeolocation();
                    })
                    .catch(runGeolocation); // Permissions API not supported — fall back to asking directly.
            } else {
                runGeolocation();
            }
        }

        if (locateBtn) {
            locateBtn.addEventListener('click', requestLocate);
        }

        // Auto-locate: if the browser has ALREADY granted this site
        // location permission (from a previous visit/prompt), don't make
        // the person hunt for and tap the locate button again — just
        // silently run the same lookup requestLocate() runs on click.
        // navigator.permissions.query() itself never prompts, so this is
        // safe to call unconditionally; it only proceeds when the answer
        // comes back 'granted'. Skips entirely if the field already has a
        // typed value or a confirmed pick, so it never clobbers something
        // the person (or an earlier auto-locate) already put there.
        function attemptAutoLocate() {
            if (coords || input.value.trim()) return;
            if (!('geolocation' in navigator) || !navigator.permissions?.query) return;
            navigator.permissions.query({ name: 'geolocation' })
                .then((status) => {
                    if (status.state !== 'granted') return;
                    if (coords || input.value.trim()) return; // re-check — state may have changed while we waited
                    runGeolocation();
                })
                .catch(() => {});
        }
        attemptAutoLocate();

        return {
            getCoords: () => coords,
            reset: () => { coords = null; clearResults(); },
            // Re-run search-as-you-type against whatever's already typed.
            // Call this when the caller's region select changes after the
            // city field already has text, so results narrow to the newly
            // chosen region instead of waiting for the next keystroke.
            refresh: () => {
                const query = input.value.trim();
                if (!query || query.length < 2) return;
                runLocalPass(query);
                search(query);
            },
            // Callers that reset() the field (e.g. reopening an "Add
            // location" modal) should call this right after — it re-runs
            // the same already-granted-permission check so the field
            // fills itself again instead of staying blank until a manual
            // locate-button tap.
            autoLocate: attemptAutoLocate
        };
    }

    window.LWLocationPicker = { attach };
})();