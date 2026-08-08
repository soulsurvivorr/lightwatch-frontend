// ============================================================
//  UTILS/LOCATION-PICKER.JS
//  Shared "type a city, get real map-matched suggestions, or use my
//  GPS" behavior for any city text input — used by both signup.js
//  (new account) and account.js (editing an existing account's city)
//  so the two forms work identically instead of drifting apart.
//
//  Wires up:
//   - Search-as-you-type against Nominatim (same OSM geocoder
//     location.js's own search dropdown uses), scoped to Ghana and
//     biased by a region select/value when one is supplied — this is
//     what lets someone typing "Esereso" or "Mmim" pick the ACTUAL
//     map match instead of typing a bare name that later gets
//     geocoded server-side and might land on the wrong same-named
//     town.
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

    function resultRow(label, sub) {
        return `<button type="button" class="loc-search__result">
      <span class="loc-search__result-icon loc-search__result-icon--geocoder">${PIN_ICON}</span>
      <span><span>${label}</span>${sub ? `<span class="loc-search__result-sub">${sub}</span>` : ''}</span>
    </button>`;
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
    //   input       — the city text <input> (required)
    //   resultsEl    — container to render the dropdown into (optional —
    //                  search-as-you-type is skipped without one)
    //   locateBtn    — "use my location" button (optional)
    //   hintEl       — status text element (optional)
    //   getRegion    — () => current region string, for biasing/query
    //                  disambiguation (optional)
    //   onPick       — ({ label, lat, lng }) => void, called on any
    //                  confirmed pick (search result or GPS fix)
    function attach({ input, resultsEl, locateBtn, hintEl, getRegion, onPick }) {
        if (!input) return { getCoords: () => null, reset: () => {} };

        let coords = null;
        let debounceTimer = null;
        let abortController = null;
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

            renderResults(matches, query);
        }

        input.addEventListener('input', () => {
            coords = null; // typed text no longer matches whatever was last confirmed
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => search(input.value.trim()), 200);
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

        if (locateBtn) {
            locateBtn.addEventListener('click', () => {
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
            });
        }

        return {
            getCoords: () => coords,
            reset: () => { coords = null; clearResults(); },
            // Re-run search-as-you-type against whatever's already typed.
            // Call this when the caller's region select changes after the
            // city field already has text, so results narrow to the newly
            // chosen region instead of waiting for the next keystroke.
            refresh: () => search(input.value.trim())
        };
    }

    window.LWLocationPicker = { attach };
})();