// ============================================================
//  VIEWS/WEATHER-HOME.JS — live weather for the Home view.
//
//  Replaces the hardcoded placeholder numbers baked into
//  index.html (#lwxWeatherCard, #lwxGridRiskCard,
//  #lwxWeatherImpactCard) with a real fetch to the backend's
//  GET /weather route (see weather.js on the server), which itself
//  calls Open-Meteo. No API key needed anywhere in this file.
//
//  LOCATION: prefers a real GPS fix (navigator.geolocation) since
//  that's the most accurate signal available client-side. If the
//  user hasn't granted permission (or geolocation is unavailable),
//  falls back to whatever city name Home is already showing in
//  #locationName/#locationSubtitleArea — the same text home.js's
//  secondary-location code and index.html's own sync script already
//  read from. Either way the server does the real resolution (and
//  the "unrecognized small town -> nearby known town" fallback), so
//  this file never has to guess coordinates itself.
//
//  Loaded after config.js, api.js, and home.js (see index.html's
//  script order) — needs API_URL from config.js and
//  fetchWithBackendTimeout/getBackendErrorMessage from api.js, and
//  reads #locationName as a fallback the same way home.js's own
//  secondary-location code does. Wrapped the same way as every other
//  view file, for name-collision hygiene.
// ============================================================

(function () {

    // API_URL comes from config.js (loaded before this file — see
    // index.html's script order) and fetchWithBackendTimeout from
    // api.js, both plain globals already used across the rest of this
    // codebase. Using fetchWithBackendTimeout (not a bare fetch) means
    // a slow/unreachable backend surfaces the same
    // "took too long to respond" / "is the backend still running?"
    // messaging as every other view, instead of hanging silently.
    const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // matches the server's own cache TTL

    const els = {
        card: document.getElementById('lwxWeatherCard'),
        city: document.getElementById('lwxWeatherCity'),
        temp: document.getElementById('lwxWeatherTemp'),
        desc: document.getElementById('lwxWeatherDesc'),
        wind: document.getElementById('lwxWeatherWind'),
        rain: document.getElementById('lwxWeatherRain'),
        risk: document.getElementById('lwxWeatherRisk'),
        bannerTitle: document.getElementById('lwxWeatherBannerTitle'),
        bannerSub: document.getElementById('lwxWeatherBannerSub'),
        gridRiskCard: document.getElementById('lwxGridRiskCard'),
        gridRiskBadge: document.getElementById('lwxGridRiskBadge'),
        gridRiskDesc: document.getElementById('lwxGridRiskDesc'),
        gridRiskEta: document.getElementById('lwxGridRiskEta'),
        weatherImpactCard: document.getElementById('lwxWeatherImpactCard'),
        weatherImpactDesc: document.getElementById('lwxWeatherImpactDesc')
    };

    // Home view isn't on screen (or this markup changed) — nothing to wire up.
    if (!els.card) return;

    function currentLocationText() {
        const el = document.getElementById('locationName') || document.getElementById('locationSubtitleArea');
        const text = el ? el.textContent.trim() : '';
        // Skeleton/placeholder text shouldn't be sent as a real location.
        if (!text || /^your location$/i.test(text) || /^your area$/i.test(text)) return '';
        return text;
    }

    function getGpsFix() {
        return new Promise((resolve) => {
            if (!('geolocation' in navigator)) {
                resolve(null);
                return;
            }
            navigator.geolocation.getCurrentPosition(
                (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                () => resolve(null),
                { timeout: 6000, maximumAge: 10 * 60 * 1000 }
            );
        });
    }

    async function buildWeatherUrl() {
        const gps = await getGpsFix();
        const params = new URLSearchParams();
        if (gps) {
            params.set('lat', gps.lat);
            params.set('lng', gps.lng);
        } else {
            const locationText = currentLocationText();
            if (!locationText) return null; // nothing usable yet — caller retries later
            params.set('location', locationText);
        }
        return `/weather?${params.toString()}`;
    }

    function setLoadingState() {
        if (els.desc) {
            els.desc.dataset.state = 'loading';
            els.desc.textContent = 'Fetching live weather…';
        }
    }

    function setErrorState() {
        if (els.desc) {
            els.desc.dataset.state = 'error';
            els.desc.textContent = "Couldn't load live weather";
        }
    }

    function applyRiskClass(el, baseClass, level) {
        if (!el) return;
        el.classList.remove(`${baseClass}--high`, `${baseClass}--medium`, `${baseClass}--low`);
        el.classList.add(`${baseClass}--${level}`);
    }

    function applyRiskCardVariant(cardEl, level) {
        if (!cardEl) return;
        cardEl.classList.remove('lwx-risk-card--danger', 'lwx-risk-card--warn', 'lwx-risk-card--safe');
        cardEl.classList.add(
            level === 'high' ? 'lwx-risk-card--danger'
                : level === 'medium' ? 'lwx-risk-card--warn'
                    : 'lwx-risk-card--safe'
        );
    }

    function applyBadgeVariant(badgeEl, level) {
        if (!badgeEl) return;
        badgeEl.classList.remove('lwx-risk-card__badge--warn', 'lwx-risk-card__badge--safe');
        if (level === 'medium') badgeEl.classList.add('lwx-risk-card__badge--warn');
        else if (level === 'low') badgeEl.classList.add('lwx-risk-card__badge--safe');
        badgeEl.textContent = level === 'high' ? 'High Risk' : level === 'medium' ? 'Medium Risk' : 'Low Risk';
    }

    function render(data) {
        const { current, risk, location, approximate } = data;

        if (els.city) els.city.textContent = approximate ? `Near ${location}` : location;
        if (els.temp && current.temperatureC != null) {
            els.temp.innerHTML = `${Math.round(current.temperatureC)}&deg;C`;
        }
        if (els.desc) {
            els.desc.dataset.state = 'ready';
            els.desc.textContent = current.description;
        }
        if (els.wind && current.windKph != null) {
            els.wind.textContent = `${Math.round(current.windKph)} km/h`;
        }
        if (els.rain) {
            els.rain.textContent = current.rainChance != null ? `${current.rainChance}%` : '—';
        }
        if (els.risk) {
            els.risk.textContent = risk.label.replace(' Risk', '');
            applyRiskClass(els.risk, 'lwx-risk-text', risk.level);
        }

        // Animated backdrop — see the data-weather rules appended to
        // home.css. This one attribute drives the whole moving scene.
        els.card.setAttribute('data-weather', current.condition);

        // Storm/rain banner — only worth showing when there's actually
        // something ahead; hide it outright on a clear/low-risk read
        // instead of showing a stale "storms expected" line.
        const bannerParent = els.bannerTitle ? els.bannerTitle.closest('.lwx-weather-card__banner') : null;
        if (bannerParent) {
            if (risk.level === 'low') {
                bannerParent.style.display = 'none';
            } else {
                bannerParent.style.display = '';
                if (els.bannerTitle) {
                    els.bannerTitle.textContent = risk.level === 'high'
                        ? `Heavy storms expected${risk.eta ? ` in ${risk.eta}` : ''}.`
                        : `Rain expected${risk.eta ? ` in ${risk.eta}` : ''}.`;
                }
                if (els.bannerSub) {
                    els.bannerSub.textContent = risk.level === 'high'
                        ? 'Possible power interruptions.'
                        : 'Minor disruptions possible.';
                }
            }
        }

        // Grid Risk card
        if (els.gridRiskDesc) els.gridRiskDesc.textContent = risk.gridRiskDescription;
        if (els.gridRiskEta) {
            const footLabel = document.querySelector('#lwxGridRiskCard .lwx-risk-card__foot-label');
            if (risk.eta) {
                els.gridRiskEta.textContent = risk.eta;
                els.gridRiskEta.style.display = '';
                if (footLabel) footLabel.style.display = '';
            } else {
                // No storm/rain ahead in the next 12h — an ETA line
                // reading "Estimated arrival: —" is more confusing than
                // just not showing it.
                els.gridRiskEta.style.display = 'none';
                if (footLabel) footLabel.style.display = 'none';
            }
        }
        applyBadgeVariant(els.gridRiskBadge, risk.level);
        applyRiskCardVariant(els.gridRiskCard, risk.level);

        // Weather Impact card
        if (els.weatherImpactDesc) els.weatherImpactDesc.textContent = risk.impactDescription;
        applyRiskCardVariant(els.weatherImpactCard, risk.level);
    }

    let pollTimer = null;
    let retryTimer = null;

    async function refresh() {
        const url = await buildWeatherUrl();
        if (!url) {
            // No GPS and no location text yet (still on skeleton) — try
            // again shortly rather than failing silently forever.
            clearTimeout(retryTimer);
            retryTimer = setTimeout(refresh, 2000);
            return;
        }

        setLoadingState();
        try {
            const response = await fetchWithBackendTimeout(url);
            if (!response.ok) throw new Error(`Weather request failed (${response.status})`);
            const data = await response.json();
            render(data);
        } catch (err) {
            console.error('[weather-home] fetch failed:', getBackendErrorMessage(err));
            setErrorState();
        }
    }

    function startPolling() {
        refresh();
        clearInterval(pollTimer);
        pollTimer = setInterval(refresh, REFRESH_INTERVAL_MS);
    }

    startPolling();
    // Home's own data (location name, etc.) may still be loading from
    // cache on first paint — re-run once the real page data is in, same
    // signal home.js already listens for elsewhere in this view.
    window.addEventListener('lw-page-revealed', refresh);

})();