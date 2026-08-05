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
        riskCarouselDots: document.getElementById('lwxRiskCarouselDots')
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

    let riskCarouselIndex = 0;
    let riskCarouselTimer = null;
    let riskCarouselTouchStartX = 0;
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
                iconSvg: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="11" fill="#F2B33D"/><g stroke="#F2B33D" stroke-width="2.4" stroke-linecap="round"><path d="M24 5v5M42 24h-5M8 24H3M37.5 10.5l-3.5 3.5M13.9 34.1l-3.5 3.5M10.5 10.5 14 14"/></g><path d="M20 40a11 11 0 0 1 1.4-21.6 14 14 0 0 1 26.6 3.9 9.8 9.8 0 0 1-2 19.4H20Z" fill="#C7D0DE"/></svg>`,
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

    function getRiskSlides() {
        if (!els.riskCarouselTrack) return [];
        return Array.from(els.riskCarouselTrack.children).filter((child) => child.classList.contains('lwx-risk-card'));
    }

    function renderRiskCarousel(data) {
        if (!els.riskCarouselTrack) return;
        lastRiskCarouselData = data || lastRiskCarouselData || {};
        const slides = buildRiskSlides(lastRiskCarouselData);
        els.riskCarouselTrack.innerHTML = slides.map((slide) => `
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
        `).join('');

        const renderedSlides = getRiskSlides();
        if (!renderedSlides.length) return;
        const safeIndex = ((riskCarouselIndex % renderedSlides.length) + renderedSlides.length) % renderedSlides.length;
        riskCarouselIndex = safeIndex;
        els.riskCarouselTrack.style.transform = `translateX(-${safeIndex * 100}%)`;
        renderedSlides.forEach((slide, index) => slide.classList.toggle('is-active', index === safeIndex));
    }

    function goToRiskCarouselSlide(index) {
        const slides = getRiskSlides();
        if (!slides.length) return;
        riskCarouselIndex = (index + slides.length) % slides.length;
        renderRiskCarousel(lastRiskCarouselData);
    }

    function startRiskCarouselAutoPlay() {
        clearInterval(riskCarouselTimer);
        const slides = getRiskSlides();
        if (slides.length <= 1) return;
        riskCarouselTimer = setInterval(() => {
            goToRiskCarouselSlide(riskCarouselIndex + 1);
        }, 9000);
    }

    function initRiskCarousel() {
        if (!els.riskCarousel) return;

        renderRiskCarousel();
        startRiskCarouselAutoPlay();

        if (els.riskCarouselViewport) {
            els.riskCarouselViewport.addEventListener('touchstart', (event) => {
                riskCarouselTouchStartX = event.touches[0].clientX;
            }, { passive: true });

            els.riskCarouselViewport.addEventListener('touchend', (event) => {
                const delta = event.changedTouches[0].clientX - riskCarouselTouchStartX;
                if (Math.abs(delta) < 50) return;
                goToRiskCarouselSlide(delta < 0 ? riskCarouselIndex + 1 : riskCarouselIndex - 1);
                startRiskCarouselAutoPlay();
            }, { passive: true });
        }
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

        renderRiskCarousel(data);
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

    startPolling();
    // Home's own data (location name, etc.) may still be loading from
    // cache on first paint — re-run once the real page data is in, same
    // signal home.js already listens for elsewhere in this view.
    window.addEventListener('lw-page-revealed', refresh);
    window.addEventListener('locationReady', refresh);

})();