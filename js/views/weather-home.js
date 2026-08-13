// ============================================================
//  VIEWS/WEATHER-HOME.JS — live weather for the Home view.
//
//  Replaces the hardcoded placeholder numbers baked into
//  index.html (#lwxWeatherCard, #lwxGridRiskCard,
//  #lwxWeatherImpactCard) with a real fetch to the backend's
//  GET /weather route (see weather.js on the server), which itself
//  calls WeatherAPI.com. No API key needed anywhere in this file —
//  that lives in the backend's WEATHERAPI_KEY env var.
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
        humidity: document.getElementById('lwxWeatherHumidity'),
        graph: document.getElementById('lwxWeatherGraph'),
        risk: document.getElementById('lwxWeatherRisk'),
        bannerTitle: document.getElementById('lwxWeatherBannerTitle'),
        bannerSub: document.getElementById('lwxWeatherBannerSub'),
        updated: document.getElementById('lwxWeatherUpdated'),
        gridRiskCard: document.getElementById('lwxGridRiskCard'),
        gridRiskBadge: document.getElementById('lwxGridRiskBadge'),
        gridRiskDesc: document.getElementById('lwxGridRiskDesc'),
        gridRiskEta: document.getElementById('lwxGridRiskEta'),
        weatherImpactCard: document.getElementById('lwxWeatherImpactCard'),
        weatherImpactDesc: document.getElementById('lwxWeatherImpactDesc'),
        riskCarousel: document.getElementById('lwxRiskCarousel'),
        riskCarouselViewport: document.getElementById('lwxRiskCarouselViewport'),
        riskCarouselTrack: document.getElementById('lwxRiskCarouselTrack'),
        riskCarouselDots: document.getElementById('lwxRiskCarouselDots'),
        forecastList: document.getElementById('lwxForecastList'),
        alertCard: document.getElementById('lwxWeatherAlert'),
        alertTitle: document.getElementById('lwxWeatherAlertTitle'),
        alertTime: document.getElementById('lwxWeatherAlertTime'),
        alertImpacts: document.getElementById('lwxWeatherAlertImpacts')
    };

    // Home view isn't on screen (or this markup changed) — nothing to wire up.
    if (!els.card) return;

    // Keep the skeleton mask active immediately so the card's default
    // placeholder content never flashes before the weather request settles.
    els.card.classList.add('lwx-weather-card--loading');

    // ------------------------------------------------------------
    // SCENE — a handful of illustrated elements (sun/moon, clouds,
    // rain, a lightning bolt, fog) built once and left in the DOM.
    // Which ones are actually visible + animated is driven entirely
    // by CSS off the data-weather attribute (see home.css) — this
    // function only ever builds the shapes, never toggles them.
    // ------------------------------------------------------------
    function buildScene() {
        const scene = document.createElement('div');
        scene.className = 'lwx-weather-scene';
        scene.setAttribute('aria-hidden', 'true');

        scene.innerHTML = `
            <div class="lwx-scene-sun"></div>
            <div class="lwx-scene-moon"></div>
            <div class="lwx-scene-stars"></div>
            <div class="lwx-scene-cloud lwx-scene-cloud--1"></div>
            <div class="lwx-scene-cloud lwx-scene-cloud--2"></div>
            <div class="lwx-scene-cloud lwx-scene-cloud--3"></div>
            <div class="lwx-scene-rain"></div>
            <div class="lwx-scene-lightning"></div>
            <div class="lwx-scene-flash"></div>
            <div class="lwx-scene-fog--1"></div>
            <div class="lwx-scene-fog--2"></div>
        `;

        // Stars — scattered positions + independently randomized twinkle
        // timing so they don't all blink in lockstep.
        const starsHost = scene.querySelector('.lwx-scene-stars');
        for (let i = 0; i < 10; i++) {
            const star = document.createElement('span');
            star.className = 'lwx-scene-star';
            star.style.top = `${8 + Math.random() * 55}%`;
            star.style.left = `${5 + Math.random() * 90}%`;
            star.style.animationDelay = `${(Math.random() * 2.6).toFixed(2)}s`;
            starsHost.appendChild(star);
        }

        // Rain drops — randomized horizontal position, fall speed and
        // start delay, so the rain reads as natural rather than a
        // visibly repeating tile.
        const rainHost = scene.querySelector('.lwx-scene-rain');
        for (let i = 0; i < 22; i++) {
            const drop = document.createElement('span');
            drop.className = 'lwx-scene-drop';
            drop.style.left = `${Math.random() * 100}%`;
            drop.style.animationDuration = `${(0.55 + Math.random() * 0.5).toFixed(2)}s`;
            drop.style.animationDelay = `${(Math.random() * 1.2).toFixed(2)}s`;
            rainHost.appendChild(drop);
        }

        els.card.insertBefore(scene, els.card.firstChild);
        return scene;
    }

    // Built once on load; CSS handles all show/hide/animation from
    // here based on the card's data-weather attribute.
    buildScene();

    let riskCarousel = null;
    let lastRiskCarouselData = null;

    function buildRiskSlides(data) {
        const fallback = data || {};
        const current = fallback.current || {};
        const risk = fallback.risk || {};
        const location = fallback.location || 'your area';
        const level = risk.level || 'low';
        const levelLabel = level === 'high' ? 'High Risk' : level === 'medium' ? 'Medium Risk' : 'Low Risk';
        const eta = risk.eta || 'Now';
        const temp = current.temperatureC != null ? `${Math.round(current.temperatureC)}°C` : '—';
        const wind = current.windKph != null ? `${Math.round(current.windKph)} km/h` : '—';
        const rain = current.rainChance != null ? `${current.rainChance}%` : '—';

        const baseAccent = level === 'high' ? '#ff6b6b' : level === 'medium' ? '#f2b84b' : '#3dd9c2';
        const basePanel = level === 'high'
            ? 'linear-gradient(145deg, rgba(255,107,107,0.16), rgba(255,107,107,0.04))'
            : level === 'medium'
                ? 'linear-gradient(145deg, rgba(242,184,75,0.16), rgba(242,184,75,0.04))'
                : 'linear-gradient(145deg, rgba(61,217,194,0.16), rgba(61,217,194,0.04))';
        const baseBorder = level === 'high' ? 'rgba(255,107,107,0.28)' : level === 'medium' ? 'rgba(242,184,75,0.3)' : 'rgba(61,217,194,0.24)';
        const baseBadge = level === 'high' ? 'rgba(255,107,107,0.16)' : level === 'medium' ? 'rgba(242,184,75,0.18)' : 'rgba(61,217,194,0.18)';
        const baseIcon = level === 'high' ? 'radial-gradient(circle, rgba(255,107,107,0.24), rgba(255,107,107,0.03) 72%)' : level === 'medium' ? 'radial-gradient(circle, rgba(242,184,75,0.24), rgba(242,184,75,0.03) 72%)' : 'radial-gradient(circle, rgba(61,217,194,0.24), rgba(61,217,194,0.03) 72%)';

        const theme = { accent: baseAccent, panel: basePanel, border: baseBorder, badge: baseBadge, icon: baseIcon };

        return [
            {
                title: 'Grid Risk',
                badge: levelLabel,
                description: risk.gridRiskDescription || `Local conditions around ${location} are steady right now.`,
                footLabel: 'Estimated arrival',
                footValue: eta,
                iconSvg: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M17 34a11 11 0 0 1 1.4-21.6A14 14 0 0 1 45 15.3a9.8 9.8 0 0 1-2 19.4H17Z" fill="#8C97AE"/><path d="M32 29 24 43h6l-4.5 11L38 39h-6l4.5-10Z" fill="#F2B33D"/></svg>`,
                theme
            },
            {
                title: 'Weather Impact',
                badge: 'Live outlook',
                description: risk.impactDescription || `Weather is shaping how quickly the area may shift today.`,
                footLabel: 'Current window',
                footValue: eta,
                iconSvg: `<img src="./images/cloud-lightining.png" alt="Storm cloud" style="width:100%;height:100%;object-fit:contain;display:block;" />`,
                theme
            },
            {
                title: 'Outdoor Readiness',
                badge: 'Today',
                description: `Expect ${current.condition || 'mixed'} conditions with a ${temp} feel and ${wind} winds.`,
                footLabel: 'Rain chance',
                footValue: rain,
                iconSvg: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15 39a10 10 0 0 1 1.2-19.3A13.1 13.1 0 0 1 44 14.6a8.8 8.8 0 0 1-1.8 17.4H15Z" fill="#8C97AE"/><path d="M28 20 22 32h5l-2.9 10 10-13h-5l3-9Z" fill="#F2B33D"/></svg>`,
                theme: { ...theme, accent: '#8fb6ff', panel: 'linear-gradient(145deg, rgba(143,182,255,0.16), rgba(143,182,255,0.04))', border: 'rgba(143,182,255,0.24)', badge: 'rgba(143,182,255,0.16)', icon: 'radial-gradient(circle, rgba(143,182,255,0.24), rgba(143,182,255,0.03) 72%)' }
            },
            {
                title: 'Charging Window',
                badge: 'Best time',
                description: `If you need to charge devices, plan around the next ${eta.toLowerCase() === 'now' ? 'few hours' : eta.toLowerCase()} window.`,
                footLabel: 'Wind',
                footValue: wind,
                iconSvg: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="14" y="16" width="36" height="26" rx="8" fill="#3DD9C2" fill-opacity="0.18" stroke="#3DD9C2" stroke-width="3"/><path d="M28 26v12M36 26v12M44 30h-6" stroke="#3DD9C2" stroke-width="3" stroke-linecap="round"/></svg>`,
                theme: { ...theme, accent: '#7ad2ff', panel: 'linear-gradient(145deg, rgba(122,210,255,0.16), rgba(122,210,255,0.04))', border: 'rgba(122,210,255,0.24)', badge: 'rgba(122,210,255,0.16)', icon: 'radial-gradient(circle, rgba(122,210,255,0.24), rgba(122,210,255,0.03) 72%)' }
            },
            {
                title: 'Community Pulse',
                badge: 'Nearby signal',
                description: `Neighbors around ${location} are seeing ${level === 'high' ? 'strong urgency' : level === 'medium' ? 'steady caution' : 'calm conditions'}.`,
                footLabel: 'Rain chance',
                footValue: rain,
                iconSvg: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="10" fill="#F2B33D"/><circle cx="40" cy="24" r="8" fill="#8C97AE"/><path d="M17 44c2.5-6 6-8.8 12-8.8 6 0 9.7 2.8 13 8.8" stroke="#3DD9C2" stroke-width="3" stroke-linecap="round"/></svg>`,
                theme: { ...theme, accent: '#8c7bff', panel: 'linear-gradient(145deg, rgba(140,123,255,0.16), rgba(140,123,255,0.04))', border: 'rgba(140,123,255,0.24)', badge: 'rgba(140,123,255,0.16)', icon: 'radial-gradient(circle, rgba(140,123,255,0.24), rgba(140,123,255,0.03) 72%)' }
            }
        ];
    }

    function riskSlideHtml(slide) {
        return `
            <div class="lwx-risk-card" style="--risk-accent:${slide.theme.accent};--risk-panel:${slide.theme.panel};--risk-border:${slide.theme.border};--risk-badge-bg:${slide.theme.badge};--risk-icon-bg:${slide.theme.icon};">
              <div class="lwx-risk-card__text">
                <span class="lwx-risk-card__title">${slide.title}</span>
                <span class="lwx-risk-card__badge">${slide.badge}</span>
                <p>${slide.description}</p>
                <span class="lwx-risk-card__foot-label">${slide.footLabel}</span>
                <strong class="lwx-risk-card__foot-value">${slide.footValue}</strong>
              </div>
              <span class="lwx-risk-card__icon" aria-hidden="true">${slide.iconSvg}</span>
            </div>
        `;
    }

    function renderRiskDots(count, activeIndex) {
        if (!els.riskCarouselDots) return;
        els.riskCarouselDots.innerHTML = Array.from({ length: count }, (_, i) =>
            `<span class="lwx-risk-carousel__dot${i === activeIndex ? ' is-active' : ''}" data-dot-index="${i}"></span>`
        ).join('');
    }

    // FIX: this used to rebuild els.riskCarouselTrack.innerHTML from
    // buildRiskSlides() directly and jump the transform to
    // `-${index * 100}%` via modulo — which is exactly what produced
    // the ugly instant snap-back once the last card looped to the
    // first. Slide rendering now goes through the shared
    // createLoopCarousel() helper (see home.js, loaded before this
    // file), which clones the first/last slide so the loop animates
    // seamlessly instead of jumping.
    function renderRiskCarousel(data) {
        if (!els.riskCarouselTrack || !riskCarousel) return;
        lastRiskCarouselData = data || lastRiskCarouselData || {};
        const slides = buildRiskSlides(lastRiskCarouselData);
        riskCarousel.render(slides.map(riskSlideHtml));
    }

    function initRiskCarousel() {
        if (!els.riskCarousel || typeof window.createLoopCarousel !== 'function') return;

        riskCarousel = window.createLoopCarousel({
            viewport: els.riskCarouselViewport,
            track: els.riskCarouselTrack,
            autoplayMs: 9000,
            onChange: renderRiskDots
        });

        renderRiskCarousel();
        riskCarousel.startAutoplay();

        els.riskCarouselDots?.addEventListener('click', (event) => {
            const dot = event.target.closest('[data-dot-index]');
            if (!dot || !riskCarousel) return;
            riskCarousel.goTo(Number(dot.dataset.dotIndex));
            riskCarousel.startAutoplay();
        });
    }

    initRiskCarousel();

    function normalizeLocationText(value) {
        if (typeof value !== 'string') return '';
        const trimmed = value.trim().replace(/\s+/g, ' ');
        if (!trimmed) return '';
        const lowered = trimmed.toLowerCase();
        if (['your location', 'your area', 'unknown', 'not set', 'n/a', 'none', '—', '-'].includes(lowered)) {
            return '';
        }
        return trimmed.replace(/,\s*(kumasi|ghana|accra)\s*,?.*$/gi, '').trim();
    }

    function currentLocationText() {
        const candidates = [];

        try {
            const rawUserData = localStorage.getItem('currentUserData')
                || sessionStorage.getItem('currentUserData')
                || localStorage.getItem('signupUser')
                || sessionStorage.getItem('signupUser');
            if (rawUserData) {
                const parsed = JSON.parse(rawUserData);
                if (parsed && typeof parsed === 'object') {
                    const city = normalizeLocationText(parsed.city);
                    const region = normalizeLocationText(parsed.region);
                    const location = normalizeLocationText(parsed.location);
                    if (city && region) candidates.push(`${city}, ${region}`);
                    else if (city) candidates.push(city);
                    else if (region) candidates.push(region);
                    else if (location) candidates.push(location);
                }
            }
        } catch {
            // Ignore malformed cached user data; continue with DOM/window fallbacks.
        }

        const locationNameEl = document.getElementById('locationName');
        const locationSubtitleEl = document.getElementById('locationSubtitleArea');
        const weatherCityEl = document.getElementById('lwxWeatherCity');

        const fallbackCandidates = [
            locationNameEl?.textContent,
            locationSubtitleEl?.textContent,
            weatherCityEl?.textContent,
            window.currentChatLocation
        ];

        fallbackCandidates.forEach((candidate) => {
            const normalized = normalizeLocationText(candidate);
            if (normalized) candidates.push(normalized);
        });

        return candidates.find(Boolean) || '';
    }

    async function buildWeatherUrl() {
        const locationText = currentLocationText();
        if (!locationText) return null;

        const params = new URLSearchParams();
        params.set('location', locationText);
        return `/weather?${params.toString()}`;
    }

    function setLoadingState() {
        if (els.card) els.card.classList.add('lwx-weather-card--loading');
        if (els.desc) {
            els.desc.dataset.state = 'loading';
            els.desc.textContent = 'Checking live weather…';
        }
        if (els.temp) {
            els.temp.innerHTML = '&mdash;';
        }
    }

    function setErrorState() {
        if (els.card) els.card.classList.add('lwx-weather-card--loading');
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

    // Tracks the last successful fetch so the "Updated Xs ago" line can
    // keep counting up between polls instead of only changing once every
    // REFRESH_INTERVAL_MS — this (plus the pulsing "Live" dot in the
    // markup) is a big part of what makes a calm-weather card, with no
    // rain/lightning of its own, still read as a live feed.
    let lastFetchedAt = null;
    let updatedTickTimer = null;
    let lastRenderedTempC = null;

    function formatUpdatedAgo() {
        if (!lastFetchedAt) return '';
        const secs = Math.round((Date.now() - lastFetchedAt) / 1000);
        if (secs < 5) return 'Updated just now';
        if (secs < 60) return `Updated ${secs}s ago`;
        const mins = Math.round(secs / 60);
        return `Updated ${mins} min${mins === 1 ? '' : 's'} ago`;
    }

    function refreshUpdatedTicker() {
        if (els.updated && lastFetchedAt) {
            els.updated.textContent = formatUpdatedAgo();
        }
    }

    function startUpdatedTicker() {
        clearInterval(updatedTickTimer);
        updatedTickTimer = setInterval(refreshUpdatedTicker, 1000);
    }

    // Briefly flashes the temperature + "Updated" line so a fresh
    // reading visibly lands instead of silently overwriting the old
    // one — removed again a moment later so it doesn't stay lit.
    function flashJustUpdated() {
        if (els.temp) {
            els.temp.classList.remove('lwx-just-updated');
            // Force reflow so re-adding the class restarts the animation
            // even if a previous flash's timeout hasn't cleared it yet.
            void els.temp.offsetWidth;
            els.temp.classList.add('lwx-just-updated');
        }
        if (els.updated) els.updated.classList.add('lwx-just-updated');
        clearTimeout(flashJustUpdated._t);
        flashJustUpdated._t = setTimeout(() => {
            if (els.updated) els.updated.classList.remove('lwx-just-updated');
        }, 1200);
    }

    // ------------------------------------------------------------
    // TREND GRAPH — a small SVG line+area chart of the next few
    // hours' temperature, drawn fresh into #lwxWeatherGraph on every
    // render() from the /weather route's `hourly` array (see
    // weather.js's hourlyTrend). Smoothed with a Catmull-Rom curve so
    // it reads as a gentle moving line rather than sharp zig-zags.
    // ------------------------------------------------------------
    function catmullRomPath(points) {
        if (points.length < 2) return '';
        if (points.length === 2) {
            return `M${points[0].x},${points[0].y} L${points[1].x},${points[1].y}`;
        }
        let d = `M${points[0].x},${points[0].y}`;
        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[i - 1] || points[i];
            const p1 = points[i];
            const p2 = points[i + 1];
            const p3 = points[i + 2] || p2;
            const cp1x = p1.x + (p2.x - p0.x) / 6;
            const cp1y = p1.y + (p2.y - p0.y) / 6;
            const cp2x = p2.x - (p3.x - p1.x) / 6;
            const cp2y = p2.y - (p3.y - p1.y) / 6;
            d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
        }
        return d;
    }

    // WeatherAPI hour.time is a local "YYYY-MM-DD HH:00" string —
    // parsed as-is (no timezone math needed, it's already local).
    function formatHourLabel(timeStr) {
        if (typeof timeStr !== 'string') return '';
        const parsed = new Date(timeStr.replace(' ', 'T'));
        if (Number.isNaN(parsed.getTime())) return '';
        let hour = parsed.getHours();
        const suffix = hour >= 12 ? 'PM' : 'AM';
        hour = hour % 12 || 12;
        return `${hour}${suffix}`;
    }

    function buildTrendGraphSvg(hourly, accent) {
        const points = Array.isArray(hourly)
            ? hourly.filter((h) => h && typeof h.temperatureC === 'number')
            : [];
        if (points.length < 2) return '';

        const width = 300;
        const height = 90;
        const padX = 8;
        const padTop = 16;
        const padBottom = 20;
        const plotW = width - padX * 2;
        const plotH = height - padTop - padBottom;

        const temps = points.map((p) => p.temperatureC);
        const minT = Math.min(...temps);
        const maxT = Math.max(...temps);
        const range = Math.max(maxT - minT, 1); // keep a flat line off the floor/ceiling

        const coords = points.map((p, i) => ({
            x: padX + (plotW * i) / (points.length - 1),
            y: padTop + plotH - ((p.temperatureC - minT) / range) * plotH,
            temp: p.temperatureC,
            time: p.time
        }));

        const linePath = catmullRomPath(coords);
        const last = coords[coords.length - 1];
        const first = coords[0];
        const areaPath = `${linePath} L${last.x.toFixed(1)},${(padTop + plotH).toFixed(1)} L${first.x.toFixed(1)},${(padTop + plotH).toFixed(1)} Z`;

        const dots = coords.map((c) => {
            const isPeak = c.temp === maxT;
            return `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${isPeak ? 2.6 : 1.6}" class="lwx-weather-graph__dot${isPeak ? ' lwx-weather-graph__dot--peak' : ''}"></circle>`;
        }).join('');

        const midIndex = Math.floor((coords.length - 1) / 2);
        const labels = coords.map((c, i) => {
            if (i !== 0 && i !== coords.length - 1 && i !== midIndex) return '';
            const anchor = i === 0 ? 'start' : i === coords.length - 1 ? 'end' : 'middle';
            const text = i === 0 ? 'Now' : formatHourLabel(c.time);
            if (!text) return '';
            return `<text x="${c.x.toFixed(1)}" y="${height - 4}" text-anchor="${anchor}" class="lwx-weather-graph__hour">${text}</text>`;
        }).join('');

        const peak = coords.find((c) => c.temp === maxT);
        const peakLabel = peak
            ? `<text x="${peak.x.toFixed(1)}" y="${Math.max(peak.y - 6, 10).toFixed(1)}" text-anchor="middle" class="lwx-weather-graph__temp">${Math.round(peak.temp)}&deg;</text>`
            : '';

        const gradientId = `lwxWeatherGraphFill${Math.random().toString(36).slice(2, 8)}`;

        return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="lwx-weather-graph__svg" role="img" aria-label="Temperature trend for the next few hours">
            <defs>
              <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="${accent}" stop-opacity="0.38"></stop>
                <stop offset="100%" stop-color="${accent}" stop-opacity="0"></stop>
              </linearGradient>
            </defs>
            <path d="${areaPath}" fill="url(#${gradientId})" stroke="none"></path>
            <path d="${linePath}" fill="none" stroke="${accent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
            ${dots}
            ${peakLabel}
            ${labels}
          </svg>`;
    }

    function renderTrendGraph(hourly, riskLevel) {
        if (!els.graph) return;
        const accent = riskLevel === 'high' ? '#ff6b6b' : riskLevel === 'medium' ? '#f2b84b' : '#3dd9c2';
        const svg = buildTrendGraphSvg(hourly, accent);
        if (svg) {
            els.graph.innerHTML = svg;
            els.graph.classList.add('lwx-weather-card__graph--ready');
        } else {
            els.graph.innerHTML = '';
            els.graph.classList.remove('lwx-weather-card__graph--ready');
        }
    }

    function buildForecastItems(data) {
        const hourly = Array.isArray(data?.hourly) ? data.hourly : [];
        const riskLevel = data?.risk?.level || 'low';
        return hourly.slice(0, 6).map((hour, index) => {
            const temp = hour?.temperatureC != null ? `${Math.round(hour.temperatureC)}°C` : '—';
            const label = hour?.time ? formatHourLabel(hour.time) : `+${index + 1}h`;
            let dotClass = 'lwx-forecast-list__dot--stable';
            let labelText = 'Stable';
            let riskText = 'Stable';

            if (riskLevel === 'high') {
                dotClass = 'lwx-forecast-list__dot--outage';
                labelText = 'Storm Risk';
                riskText = 'Storm Risk';
            } else if (riskLevel === 'medium' || (hour?.rainChance != null && hour.rainChance >= 40)) {
                dotClass = 'lwx-forecast-list__dot--mixed';
                labelText = 'Rain Likely';
                riskText = 'Rain Likely';
            }

            return `
                <li>
                  <span class="lwx-forecast-list__time">${label}</span>
                  <span class="lwx-forecast-list__dot ${dotClass}"></span>
                  <span class="lwx-forecast-list__label${riskLevel === 'high' ? ' lwx-forecast-list__label--danger' : ''}">${riskText}</span>
                  <span class="lwx-forecast-list__temp">${temp}</span>
                </li>
            `;
        });
    }

    function renderForecastList(data) {
        if (!els.forecastList) return;
        const forecastItems = buildForecastItems(data);
        els.forecastList.innerHTML = forecastItems.length
            ? forecastItems.join('')
            : '<li><span class="lwx-forecast-list__time">Now</span><span class="lwx-forecast-list__dot lwx-forecast-list__dot--stable"></span><span class="lwx-forecast-list__label">Stable</span></li>';
    }

    function render(data) {
        const { current, risk, location, approximate } = data;

        if (els.card) els.card.classList.remove('lwx-weather-card--loading');
        if (els.city) els.city.textContent = approximate ? `Near ${location}` : location;
        if (els.temp && current.temperatureC != null) {
            const roundedTemp = Math.round(current.temperatureC);
            const tempChanged = lastRenderedTempC !== null && lastRenderedTempC !== roundedTemp;
            els.temp.innerHTML = `${roundedTemp}&deg;C`;
            lastRenderedTempC = roundedTemp;
            if (tempChanged) flashJustUpdated();
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
        if (els.humidity) {
            els.humidity.textContent = current.humidity != null ? `${Math.round(current.humidity)}%` : '—';
        }
        renderTrendGraph(data.hourly, risk.level);
        if (els.risk) {
            els.risk.textContent = risk.label.replace(' Risk', '');
            applyRiskClass(els.risk, 'lwx-risk-text', risk.level);
        }

        // Illustrated scene — see the data-weather rules in home.css and
        // the shapes built by buildScene() above. "clear" splits into a
        // sun (daytime) or moon+stars (nighttime) scene using
        // WeatherAPI's own is_day flag, not local device time.
        const isNight = current.isDay === 0;
        const sceneCondition = current.condition === 'clear' && isNight
            ? 'clear-night'
            : current.condition;
        els.card.setAttribute('data-weather', sceneCondition);
        // Independent of the condition itself — night, cloudy or not,
        // dims the sky and shows stars, so overcast/rainy nights still
        // read as night instead of looking identical to daytime.
        els.card.classList.toggle('lwx-weather-card--night', isNight);

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

        renderForecastList(data);
        renderRiskCarousel(data);
        renderWeatherAlert(data);
    }

    // FIX: #lwxWeatherAlert used to be permanently hardcoded to
    // "Thunderstorm Warning" / "5:10 PM" / a fixed 3-item impacts
    // list — no file anywhere ever wrote to #lwxWeatherAlertTitle,
    // #lwxWeatherAlertTime, or #lwxWeatherAlertImpacts, so it showed
    // the exact same storm warning on a clear, calm day. Driven now
    // from the same risk/current data the risk carousel already
    // uses, and hidden outright on a low-risk read instead of always
    // claiming a thunderstorm is coming.
    function renderWeatherAlert(data) {
        if (!els.alertCard) return;
        const { current, risk } = data || {};
        if (!risk || risk.level === 'low') {
            els.alertCard.hidden = true;
            return;
        }

        els.alertCard.hidden = false;
        els.alertCard.dataset.risk = risk.level;

        const condition = String(current?.condition || '').toLowerCase();
        const temp = current?.temperatureC != null ? `${Math.round(current.temperatureC)}°C` : 'mild';
        const wind = current?.windKph != null ? `${Math.round(current.windKph)} km/h` : 'light';
        const isThunder = condition.includes('storm') || condition.includes('thunder');
        const isRain = condition.includes('rain') || condition.includes('drizzle') || condition.includes('shower');
        const isFog = condition.includes('fog') || condition.includes('mist');
        const isWindy = Number(current?.windKph || 0) >= 30;
        const eta = risk.eta || 'soon';

        let title = 'Weather outlook';
        let subtitle = `Conditions are steady ${eta === 'Now' ? 'right now' : `for ${eta.toLowerCase()}`}`;
        let impacts = [];

        if (risk.level === 'high') {
            if (isThunder) {
                title = 'Storm risk';
                subtitle = `Thunderstorms could arrive ${eta === 'Now' ? 'right now' : eta.toLowerCase()}`;
                impacts = ['Brief outages and flickering lights possible', 'Roads can become slick and slow', 'Keep devices charged and plan an indoor fallback'];
            } else if (isRain) {
                title = 'Heavy rain watch';
                subtitle = `Rain is building ${eta === 'Now' ? 'right now' : eta.toLowerCase()}`;
                impacts = ['Flood-prone roads may become slow', `Expect ${temp} air and ${wind} winds`, 'Charge devices and keep essentials ready'];
            } else if (isFog || isWindy) {
                title = 'Visibility risk';
                subtitle = `Conditions may turn rough ${eta === 'Now' ? 'right now' : eta.toLowerCase()}`;
                impacts = ['Reduced visibility near low-lying areas', 'Outdoor movement may feel less stable', `Current feel is about ${temp}`];
            } else {
                title = 'Severe weather watch';
                subtitle = `Conditions may change ${eta === 'Now' ? 'right now' : eta.toLowerCase()}`;
                impacts = ['Keep an eye on the forecast', 'Plan for brief service interruptions', 'Carry backup power if you rely on it'];
            }
        } else {
            if (isRain) {
                title = 'Rain advisory';
                subtitle = `Showers are expected ${eta === 'Now' ? 'right now' : eta.toLowerCase()}`;
                impacts = ['Travel may take a little longer', `Expect ${temp} conditions with ${wind} winds`, 'A light layer will help'];
            } else if (isFog) {
                title = 'Low-visibility advisory';
                subtitle = `Mornings may stay hazy ${eta === 'Now' ? 'right now' : eta.toLowerCase()}`;
                impacts = ['Drivers should slow down near low areas', `Current conditions feel like ${temp}`, 'Plan extra margin for travel'];
            } else if (isWindy) {
                title = 'Wind advisory';
                subtitle = `Winds are picking up ${eta === 'Now' ? 'right now' : eta.toLowerCase()}`;
                impacts = ['Loose items may shift outdoors', `Expect ${wind} winds with ${temp} air`, 'Keep chargers and backup lights ready'];
            } else {
                title = 'Weather outlook';
                subtitle = `Conditions remain manageable ${eta === 'Now' ? 'right now' : eta.toLowerCase()}`;
                impacts = ['No major disruptions expected', `Current feel is ${temp}`, 'Stay ready for small changes through the day'];
            }
        }

        if (els.alertTitle) els.alertTitle.textContent = title;
        if (els.alertTime) els.alertTime.textContent = subtitle;

        if (els.alertImpacts) {
            els.alertImpacts.innerHTML = impacts.map((item) => `<li>${item}</li>`).join('');
        }
    }

    let pollTimer = null;
    let retryTimer = null;

    async function refresh() {
        const url = await buildWeatherUrl();
        if (!url) {
            setLoadingState();
            clearTimeout(retryTimer);
            retryTimer = setTimeout(refresh, 1000);
            return;
        }

        setLoadingState();
        try {
            const response = await fetchWithBackendTimeout(url);
            if (!response.ok) throw new Error(`Weather request failed (${response.status})`);
            const data = await response.json();
            render(data);
            lastFetchedAt = Date.now();
            refreshUpdatedTicker();
            startUpdatedTicker();
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

    function stopPolling() {
        clearInterval(pollTimer);
        pollTimer = null;
        clearTimeout(retryTimer);
        retryTimer = null;
    }

    startPolling();
    // Home's own data (location name, etc.) may still be loading from
    // cache on first paint — re-run once the real page data is in, same
    // signal home.js already listens for elsewhere in this view.
    window.addEventListener('lw-page-revealed', refresh);
    window.addEventListener('locationReady', refresh);

    // FIX (background jank / stale carousel state on return to Home —
    // the same bug class documented at the top of home.js and already
    // fixed there for the Did You Know / Trending Stories cards): this
    // file never told the router's LWViews contract about its own
    // 9s-autoplaying risk carousel, its 10-minute weather poll, or its
    // 1s "Updated Xs ago" ticker — none of which are Home-specific work
    // there's any reason to keep running while some other view (Map,
    // Report, Account...) is on screen. Left unpaused, the risk
    // carousel keeps auto-advancing (and, once every 10 minutes,
    // getting a full slide-track rebuild from a fresh poll) the entire
    // time you're away, so by the time you come back to Home its
    // position/animation state no longer has anything to do with what
    // you last saw — the most visible symptom being a card that's
    // mid-transition or on a stale/duplicate clone slide, i.e. reads as
    // the carousel having "disappeared".
    //
    // home.js (loaded before this file) already created
    // window.LWViews.home with its own show()/hide() — merge into the
    // existing hooks here rather than overwriting them outright, or
    // this would silently break the pause/resume that already fixed
    // the same problem for the Did You Know and Trending Stories cards.
    window.LWViews = window.LWViews || {};
    const existingHomeHooks = window.LWViews.home || {};
    const prevShow = typeof existingHomeHooks.show === 'function' ? existingHomeHooks.show : null;
    const prevHide = typeof existingHomeHooks.hide === 'function' ? existingHomeHooks.hide : null;
    window.LWViews.home = {
        show() {
            prevShow?.();
            riskCarousel?.startAutoplay();
            startUpdatedTicker();
            startPolling();
        },
        hide() {
            prevHide?.();
            riskCarousel?.stopAutoplay();
            clearInterval(updatedTickTimer);
            updatedTickTimer = null;
            stopPolling();
        }
    };

})();