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

        const setHint = (text) => { if (hintEl) hintEl.textContent = text; };
        const clearResults = () => {
            if (!resultsEl) return;
            resultsEl.setAttribute('hidden', '');
            resultsEl.innerHTML = '';
        };

        async function search(query) {
            if (!resultsEl) return;
            if (!query || query.length < 2) { clearResults(); return; }

            const region = typeof getRegion === 'function' ? getRegion() : '';
            const q = region ? `${query}, ${region}, Ghana` : `${query}, Ghana`;
            let matches = [];
            try {
                const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=gh&limit=6&q=${encodeURIComponent(q)}`;
                const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
                if (res.ok) {
                    const data = await res.json();
                    matches = Array.isArray(data) ? data : [];
                }
            } catch (err) {
                console.error('Location search failed:', err.message);
            }

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

        input.addEventListener('input', () => {
            coords = null; // typed text no longer matches whatever was last confirmed
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => search(input.value.trim()), 350);
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
            reset: () => { coords = null; clearResults(); }
        };
    }

    window.LWLocationPicker = { attach };
})();