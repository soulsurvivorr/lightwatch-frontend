// ============================================================
//  VIEWS/LIGHTSTATUS.JS — the extended "Live status pulse" panel on
//  Home (reliability meter, trend banner, timeline, achievements).
//  Lives inside the Home view, same as chat.js.
//
//  Wrapped in an IIFE to avoid the formatRelativeTime name collision
//  with chat.js/reports.js now that every view's script coexists in
//  one document. Added a pause/resume for reportsPollInterval (20s)
//  tied to the router's view-changed event, matching the same
//  pattern chat.js already had for tab visibility.
// ============================================================

(function () {
// FIX (the actual root cause of the whole tap-to-report bug, plus
// more): every fetch() in this file — fetchPrimaryLightStatus,
// toggleLightStatus, fetchLocationReports, fetchNearby,
// loadAchievements, window.LWLightStatus.report — builds its URL from
// `${API_BASE}/...`. API_BASE was never defined anywhere in this file
// or any other loaded script; the actual global config.js sets up
// (and api.js/other views correctly use) is `API_URL` — confirmed
// live in the console: "[Config] API_URL set to: https://...". Every
// one of those fetches has been throwing a ReferenceError before the
// request was ever sent, since the moment this file was written —
// each call site just happens to sit inside its own try/catch that
// silently falls back to an empty list / hidden card / reverted UI
// state, so nothing ever surfaced as a visible error. That's why the
// reliability meter, trend banner, achievements card, and nearby list
// have likely never shown real data either, not just the tap-to-
// report toggle. Aliasing to the correctly-populated global here
// fixes every one of those call sites at once, with no need to touch
// each of the 7 individually.
const API_BASE = API_URL;

const reliabilityMeterValue = document.getElementById('reliabilityMeterValue');
const reliabilityMeterFill = document.getElementById('reliabilityMeterFill');
const reliabilityMeterTrack = document.getElementById('reliabilityMeterTrack');
const reliabilityMeterCaption = document.getElementById('reliabilityMeterCaption');
const trendBanner = document.getElementById('trendBanner');
const trendBannerIcon = document.getElementById('trendBannerIcon');
const trendBannerTitle = document.getElementById('trendBannerTitle');
const trendBannerSub = document.getElementById('trendBannerSub');
const statusTimelineEl = document.getElementById('statusTimeline');
const recentReportsListEl = document.getElementById('recentReportsList');
const nearbyListEl = document.getElementById('nearbyList');

const confidenceBarFill = document.getElementById('confidenceBarFill');
const confidenceBarValue = document.getElementById('confidenceBarValue');
const confidenceCaption = document.getElementById('confidenceCaption');

const heroMiniDot = document.getElementById('heroMiniDot');
const heroMiniVerified = document.getElementById('heroMiniVerified');
const heroPeopleHelped = document.getElementById('heroPeopleHelped');
const heroStarsGraphic = document.getElementById('heroStarsGraphic');

const communityActivityHeadline = document.getElementById('communityActivityHeadline');
const communityActivityLastReport = document.getElementById('communityActivityLastReport');
const communityActivityNow = document.getElementById('communityActivityNow');

const achievementCard = document.getElementById('achievementCard');
const achievementPoints = document.getElementById('achievementPoints');
const achievementWeekReports = document.getElementById('achievementWeekReports');
const achievementTotalReports = document.getElementById('achievementTotalReports');

// -- Data sources profile.js writes into (hidden in the DOM now,
//    see home.html — this file reads them, never writes them) --
const sourceConfidenceEl = document.getElementById('sourceConfidence');
const heroContributorsPillEl = document.getElementById('heroContributorsPill');

// -- Primary status-hero elements — the tap-to-report light toggle
//    (see LIGHT TOGGLE section below, after STATE) reads/writes these. --
const statusIconEl = document.getElementById('statusIcon');
const statusPillTextEl = document.getElementById('statusPillText');
const statusBadgeEl = document.getElementById('statusBadge');
const lastVerifiedEl = document.getElementById('lastVerified');
const statusPulseEl = document.getElementById('statusPulse');
// The generated city background behind this card (see .lwx-hero-bg /
// .lw-hero-city in home.css) — its window/street/glow/fog/particle
// layers fade in or out via [data-power] on this element, kept in
// sync with currentReportedStatus below.
const heroCityEl = document.querySelector('.lw-hero-city');

// -- Tap-to-report confirm overlay (see .home-reminder-overlay markup
//    reused for #lightConfirmOverlay in index.html) --
const lightConfirmOverlayEl = document.getElementById('lightConfirmOverlay');
const lightConfirmIconEl = document.getElementById('lightConfirmIcon');
const lightConfirmTitleEl = document.getElementById('lightConfirmTitle');
const lightConfirmDescEl = document.getElementById('lightConfirmDesc');
const lightConfirmCancelBtn = document.getElementById('lightConfirmCancelBtn');
const lightConfirmConfirmBtn = document.getElementById('lightConfirmConfirmBtn');

// -----------------------------------------------------
// STATUS ICON WIRING — attached right here, immediately, before any
// of the heavier data/rendering code below runs.
//
// FIX: this used to live at the very bottom of the file (after the
// reliability meter, timeline, achievements, nearby-locations code,
// etc.). This whole file is one script, so if ANY line above that
// point throws — a bad selector, an unexpected null, whatever — the
// button's click listener never gets attached at all, and taps on it
// do nothing with no visible error unless you're watching the
// console. Wiring the button first and wrapping it in its own
// try/catch means a problem elsewhere in this file can no longer
// take the button down with it.
// -----------------------------------------------------
function initStatusIconToggle() {
    if (!statusIconEl) return;

    const triggerStatusIconToggle = () => {
        const now = Date.now();
        if (now - lastStatusIconTriggerAt < 320) return;
        lastStatusIconTriggerAt = now;
        const nextStatus = currentReportedStatus === 'on' ? 'off' : 'on';
        openLightConfirm(nextStatus);
    };

    statusIconEl.setAttribute('role', 'button');
    statusIconEl.setAttribute('tabindex', '0');
    statusIconEl.setAttribute('aria-label', 'Tap to report the current light status');
    statusIconEl.addEventListener('click', triggerStatusIconToggle);
    statusIconEl.addEventListener('touchend', (e) => {
        e.preventDefault();
        triggerStatusIconToggle();
    }, { passive: false });
    statusIconEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            triggerStatusIconToggle();
        }
    });

    lightConfirmCancelBtn?.addEventListener('click', closeLightConfirm);
    lightConfirmConfirmBtn?.addEventListener('click', () => {
        closeLightConfirm();
        toggleLightStatus();
    });
    // Tapping the dimmed backdrop (not the card itself) also dismisses it.
    lightConfirmOverlayEl?.addEventListener('click', (e) => {
        if (e.target === lightConfirmOverlayEl) closeLightConfirm();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && lightConfirmOverlayEl && !lightConfirmOverlayEl.hidden) {
            closeLightConfirm();
        }
    });
}

// openLightConfirm/closeLightConfirm/toggleLightStatus are declared
// with `function` further down (see LIGHT TOGGLE section) — that's
// fine to reference here even though this call happens first
// textually, since function declarations are hoisted with their full
// body, not just their name. Only the ATTACHING happens now; the
// listeners themselves don't run until the person actually taps,
// by which point the rest of the file has long finished loading.
try {
    initStatusIconToggle();
} catch (err) {
    console.error('[lightstatus] status icon wiring failed — tap-to-report will not work:', err);
}

const ICON_PEOPLE = '👥';
const ICON_BOLT = '⚡';
const ICON_WARNING = '⚠️';
const ICON_CHECK = '✓';
const ICON_STAR_FILLED = '★';
const ICON_STAR_EMPTY = '☆';
const ICON_DOT_ON = '●';
const ICON_DOT_OFF = '●';
const ICON_DOT_UNKNOWN = '○';

// FIX: renderNearby() (below) called dotIconForStatus(area.status) but
// no function of that name was ever defined anywhere in this file —
// only the ICON_DOT_ON/OFF/UNKNOWN constants existed, applied inline
// via ternary at the one other call site (renderHeroMiniCard, see
// heroMiniDot.innerHTML further down). That made every render of the
// Nearby list throw "dotIconForStatus is not defined" inside the
// forEach callback, which aborts the rest of that renderNearby() pass
// silently (async, so it surfaces only as an unhandled promise
// rejection in the console, not a visible on-page error).
function dotIconForStatus(status) {
    return status === 'on' ? ICON_DOT_ON : status === 'off' ? ICON_DOT_OFF : ICON_DOT_UNKNOWN;
}

// -----------------------------------------------------
// GHANA_NAMES — cosmetic display names for the recent-reports
// feed, same idea as the anon-<word>-<number> chat handles
// server.js generates: reports stay genuinely anonymous, this
// just gives each one a friendly face instead of "anonymous".
// Picked deterministically per report id so a given report
// doesn't change name on every refresh.
// -----------------------------------------------------
const GHANA_NAMES = [
    "Kofi", "Kwabena", "Kwame", "Kwaku", "Yaw", "Kwadwo", "Kwesi",
    "Akosua", "Abena", "Adwoa", "Afua", "Ama", "Yaa", "Esi",
    "Nana", "Kojo", "Ohene", "Sarkodie", "Robert", "Eric",
    "Priscilla", "Michael", "Comfort", "Gifty", "Selina"
];

function nameForReportId(id) {
    const str = String(id || Math.random());
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    return GHANA_NAMES[hash % GHANA_NAMES.length];
}


// -----------------------------------------------------
// NEARBY_MAP — which locations show up under "Nearby" for a given
// location. We don't have geocoding/lat-lng yet, so this is a
// hand-built adjacency map based on how these neighborhoods
// actually sit relative to each other in Kumasi. Worth a
// sanity check against local knowledge — this is a reasonable
// approximation, not verified survey data.
// -----------------------------------------------------
const NEARBY_MAP = {
    "bantama": ["Suame", "Kejetia", "Asafo", "Manhyia"],
    "adum": ["Kejetia", "Nhyiaeso", "Bantama"],
    "asafo": ["Asokwa", "Nhyiaeso", "Bantama"],
    "asokwa": ["Ahodwo", "Asafo"],
    "ahodwo": ["Asokwa", "Nhyiaeso"],
    "suame": ["Bantama", "Suame Magazine", "Kejetia"],
    "suame magazine": ["Suame", "Bantama"],
    "tafo": ["Oforikrom", "Asuoyeboah"],
    "kejetia": ["Adum", "Bantama", "Asafo"],
    "kejetia market": ["Adum", "Bantama"],
    "nhyiaeso": ["Adum", "Asafo", "Ahodwo", "Santasi"],
    "santasi": ["Nhyiaeso", "Bomso"],
    "bomso": ["Ayigya", "Santasi"],
    "asuoyeboah": ["Tafo", "Oforikrom"],
    "kwadaso": ["Patasi", "Santasi"],
    "oforikrom": ["Ayigya", "Tafo"],
    "ayigya": ["Bomso", "Oforikrom"],
    "patasi": ["Kwadaso", "Suame"],
    "manhyia": ["Bantama", "Suame"]
};


// -----------------------------------------------------
// HELPERS: duration / relative-time formatting
// -----------------------------------------------------
const DAY = 24 * 60 * 60 * 1000;

function formatDuration(ms) {
    if (ms == null || Number.isNaN(ms)) return "—";
    const totalMinutes = Math.round(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes}m`;
    return `${hours}h ${minutes}m`;
}

function formatRelativeTime(time) {
    const diffMs = Date.now() - time;
    const diffMinutes = Math.round(diffMs / 60000);

    if (diffMinutes < 1) return "Just now";
    if (diffMinutes < 60) return `${diffMinutes} min ago`;

    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const date = new Date(time);
    const isToday = new Date().toDateString() === date.toDateString();
    const yesterday = new Date(Date.now() - DAY);
    const isYesterday = yesterday.toDateString() === date.toDateString();
    const clock = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    if (isToday) return clock;
    if (isYesterday) return `Yesterday, ${clock}`;
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatStatusTimestamp(time) {
    const date = new Date(time);
    const now = new Date();
    const clock = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const yesterday = new Date(now.getTime() - DAY);

    if (date.toDateString() === now.toDateString()) {
        return clock;
    }
    if (date.toDateString() === yesterday.toDateString()) {
        return `Yesterday, ${clock}`;
    }
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function startOfTodayMs() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function slugify(loc) {
    return (loc || '').split(',')[0].trim().toLowerCase();
}


// -----------------------------------------------------
// STATE
// -----------------------------------------------------
let currentLocation = null;
let currentLocationKey = null;
let currentUserId = null;
let locationReports = []; // reports scoped to the current location, newest first
let reportsPollInterval = null;

function isValidObjectId(value) {
    return typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value.trim());
}

function resolveCurrentUserId() {
    const sessionId = (typeof getSession === 'function' && getSession()?.user?.id) || null;
    const storedId = localStorage.getItem('currentUserId') || sessionStorage.getItem('currentUserId');
    const candidate = String(sessionId || storedId || '').trim();
    currentUserId = isValidObjectId(candidate) ? candidate : null;
    return currentUserId;
}

function getReporterId() {
    const sessionId = (typeof getSession === 'function' && getSession()?.user?.id) || null;
    const candidate = sessionId || currentUserId || resolveCurrentUserId();
    return isValidObjectId(candidate) ? candidate.trim() : undefined;
}


// -----------------------------------------------------
// LIGHT TOGGLE — status-hero__icon as a tap-to-report control.
//
// This is the missing wiring for the toggle that used to live as a
// dedicated on/off switch — the backend side (POST/GET /lightstatus,
// applyLightStatusUpdate in server.js) never went anywhere; only the
// frontend control did. #statusIcon already ships with cursor:pointer
// and a transition in home.css, which is why it was always the
// intended target for this rather than a new element.
//
// Same POST /lightstatus { location, status, userId } contract every
// other reporter in this app uses (the old dedicated switch, the
// admin panel, presumably a future report-modal quick-action) — a tap
// here shows up identically everywhere else that reads GET
// /lightstatus: this file's own primary card, home.js's secondary-
// location panel, and location.js's per-area rows.
// -----------------------------------------------------
let currentReportedStatus = 'unknown';
let lightToggleInFlight = false;
let lastStatusIconTriggerAt = 0;
let lastPrimaryReportedAt = null;

// One glyph per state — a filled/glowing bulb for ON (green via the
// --on class's color), an outlined/crossed bulb for OFF (red via the
// --off class's color), and the neutral power glyph for unknown. Both
// use currentColor so the existing --on/--off/--unknown classes below
// still drive the actual color.
const STATUS_ICON_SVG = {
    on: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M9 21h6M10 18h4M8.5 14.5A5.5 5.5 0 1 1 15.5 14.5c-.7.9-1.5 1.8-1.5 3H10c0-1.2-.8-2.1-1.5-3Z" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    off: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M9 21h6M10 18h4M8.5 14.5A5.5 5.5 0 1 1 15.5 14.5c-.7.9-1.5 1.8-1.5 3H10c0-1.2-.8-2.1-1.5-3Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 4l16 16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    unknown: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 3v8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M7 6.3a7.5 7.5 0 1 0 10 0" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'
};

function applyPrimaryStatusIconState(status) {
    // Unknown status has no lit-windows evidence either way, so the city
    // renders dark/off — same as a confirmed outage — rather than adding
    // a third visual state nothing else in this card has.
    if (heroCityEl) heroCityEl.setAttribute('data-power', status === 'on' ? 'on' : 'off');

    if (!statusIconEl) return;
    statusIconEl.classList.remove('status-hero__icon--on', 'status-hero__icon--off', 'status-hero__icon--unknown');
    const key = status === 'on' ? 'on' : status === 'off' ? 'off' : 'unknown';
    statusIconEl.classList.add(`status-hero__icon--${key}`);
    statusIconEl.innerHTML = STATUS_ICON_SVG[key];
}

// Paints every element the primary status-hero row owns from a
// { status, reportedAt } shape — the same shape both GET /lightstatus
// and the record POST /lightstatus returns use.
function paintPrimaryStatus(data) {
    currentReportedStatus = data.status || 'unknown';
    if (data.reportedAt) lastPrimaryReportedAt = data.reportedAt;
    applyPrimaryStatusIconState(currentReportedStatus);

    if (statusPillTextEl) {
        const titleIconClass = currentReportedStatus === 'on'
            ? 'status-hero__title-icon status-hero__title-icon--on'
            : currentReportedStatus === 'off'
                ? 'status-hero__title-icon status-hero__title-icon--off'
                : 'status-hero__title-icon status-hero__title-icon--unknown';
        const titleText = currentReportedStatus === 'on'
            ? 'Light is on now'
            : currentReportedStatus === 'off'
                ? 'Light is off now'
                : 'No reports yet — tap to check in';
        statusPillTextEl.innerHTML = `<span class="${titleIconClass}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" fill="currentColor"/></svg></span><span>${titleText}</span>`;
    }

    if (statusBadgeEl) {
        const known = currentReportedStatus === 'on' || currentReportedStatus === 'off';
        statusBadgeEl.hidden = !known;
        statusBadgeEl.classList.remove('badge--low');
        statusBadgeEl.classList.toggle('badge--on', currentReportedStatus === 'on');
        statusBadgeEl.classList.toggle('badge--off', currentReportedStatus === 'off');
        if (known) statusBadgeEl.textContent = currentReportedStatus === 'on' ? 'Power ON' : 'Power OFF';
    }

    if (lastVerifiedEl && data.reportedAt) {
        lastVerifiedEl.textContent = formatStatusTimestamp(new Date(data.reportedAt).getTime());
    }

    if (statusPulseEl) {
        statusPulseEl.classList.remove('pulse--on', 'pulse--off', 'pulse--low');
        statusPulseEl.classList.add(
            currentReportedStatus === 'on' ? 'pulse--on'
            : currentReportedStatus === 'off' ? 'pulse--off'
            : 'pulse--low'
        );
    }

    renderHeroMiniCard();
}

async function fetchPrimaryLightStatus() {
    if (!currentLocation) return false;
    try {
        const res = await fetch(`${API_BASE}/lightstatus?location=${encodeURIComponent(currentLocation)}`);
        if (!res.ok) throw new Error('bad response');
        const data = await res.json();
        paintPrimaryStatus(data);
        return true;
    } catch (err) {
        // Leave whatever was last painted on screen rather than blank it.
        return false;
    }
}

// Runs the same brief "deciding" animation on any status-hero__icon-
// shaped element, primary or secondary — see home.js's secondary-
// location panel, which reuses this so both toggles feel identical.
function animateIconDecision(iconEl, nextStatus) {
    if (!iconEl) return;
    iconEl.classList.remove('status-hero__icon--switching-on', 'status-hero__icon--switching-off');
    void iconEl.offsetWidth; // restart the animation on repeated taps
    iconEl.classList.add(nextStatus === 'on' ? 'status-hero__icon--switching-on' : 'status-hero__icon--switching-off');
    setTimeout(() => {
        iconEl.classList.remove('status-hero__icon--switching-on', 'status-hero__icon--switching-off');
    }, 700);
}

async function toggleLightStatus() {
    if (lightToggleInFlight) {
        // FIX (diagnostic): this used to return here with zero output.
        // Combined with the bug just below, if `lightToggleInFlight`
        // ever got stuck `true` (see next comment), EVERY subsequent
        // tap — including the very ones used to debug this — would
        // hit this line and exit completely silently: no warning, no
        // network call, nothing. That silence is exactly what showed
        // up testing this: getEventListeners() confirmed the click
        // listener WAS attached and firing, so the only place left
        // that could swallow everything without a trace was here.
        console.warn('[lightstatus] toggleLightStatus() ignored: a previous toggle is still marked in-flight.');
        return;
    }
    if (!currentLocation) {
        // FIX (diagnostic): this used to be only
        // `window.lwToast?.(...)`. If window.lwToast is ever undefined
        // (it currently is — see the missing toast.js <script> tag fix
        // in index.html), `?.()` on it does nothing at all: no toast,
        // no console output, no error — this function just returns and
        // the tap looks like it silently did nothing, with zero signal
        // as to why. console.warn here always fires regardless of
        // whether the toast wiring is fixed, so this early-return can
        // never be silent again.
        console.warn('[lightstatus] toggleLightStatus() aborted: currentLocation is not set yet.');
        window.lwToast?.('Location is still loading. Try again in a moment.');
        return;
    }

    // FIX (the actual stuck-forever bug): `lightToggleInFlight = true`
    // used to be set here, OUTSIDE the try block below, followed by
    // several more lines (getReporterId(), animateIconDecision(),
    // statusPillTextEl.innerHTML) that also ran outside the try. The
    // flag is only ever reset back to `false` in the `finally` block
    // — so if ANY of those pre-fetch lines ever threw (a bad session/
    // localStorage read inside getReporterId(), a null/weird DOM state
    // in animateIconDecision(), anything), execution would jump
    // straight past `finally` and out of the function entirely,
    // leaving `lightToggleInFlight` permanently `true`. From that
    // point on, every single future tap — forever, until the page is
    // reloaded — would hit the early-return above and exit in
    // complete silence: no network request, no error, no toast,
    // nothing. That matches everything observed while debugging this
    // (click listener confirmed attached and firing, yet nothing ever
    // happened downstream of it). Moving the flag-set + everything
    // that follows inside the try means `finally` — and therefore the
    // flag reset — is now unconditionally reached no matter what
    // throws, so this state can no longer happen.
    lightToggleInFlight = true;

    try {
        const previousStatus = currentReportedStatus;
        const previousReportedAt = lastPrimaryReportedAt;
        const nextStatus = previousStatus === 'on' ? 'off' : 'on';
        const reporterId = getReporterId();

        animateIconDecision(statusIconEl, nextStatus);
        statusIconEl?.setAttribute('aria-busy', 'true');
        if (statusPillTextEl) {
            const pendingIconClass = nextStatus === 'on'
                ? 'status-hero__title-icon status-hero__title-icon--on'
                : 'status-hero__title-icon status-hero__title-icon--off';
            const pendingText = nextStatus === 'on' ? 'Reporting light on…' : 'Reporting light off…';
            statusPillTextEl.innerHTML = `<span class="${pendingIconClass}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" fill="currentColor"/></svg></span><span>${pendingText}</span>`;
        }

        const res = await fetch(`${API_BASE}/lightstatus`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ location: currentLocation, status: nextStatus, userId: reporterId })
        });
        if (!res.ok) throw new Error('report failed');
        const record = await res.json();
        paintPrimaryStatus({ status: record.status, reportedAt: record.reportedAt });

        // Broadcast so any other view currently on screen (Locations'
        // per-area rows, Home's secondary-location panel) can refresh
        // instead of showing a status that just went stale.
        window.dispatchEvent(new CustomEvent('lw:lightstatus-changed', {
            detail: { locationKey: currentLocationKey, status: record.status }
        }));

        refreshLocationPanel();
    } catch (err) {
        // FIX (diagnostic): this caught and silently swallowed the
        // real error — no console.error, nothing — so even a genuine
        // network/CORS/5xx failure here would look identical to
        // nothing happening at all. Logging it means the next real
        // failure (as opposed to the stuck-flag case above) shows up
        // immediately instead of looking like the exact same silence.
        console.error('[lightstatus] toggleLightStatus() failed:', err);
        // Always restore the last confirmed state immediately so the
        // hero never gets stuck on "Reporting..." after a failed submit.
        paintPrimaryStatus({ status: currentReportedStatus, reportedAt: lastPrimaryReportedAt });
        // Then try a non-blocking sync in case another device/admin
        // updated status concurrently.
        fetchPrimaryLightStatus();
    } finally {
        statusIconEl?.removeAttribute('aria-busy');
        lightToggleInFlight = false;
    }
}

// #statusIcon reads as a button, not a switch — tapping it doesn't fire
// the report immediately, it opens this confirm step first (the same
// "are you sure" pattern admin.html uses before pushing a location's
// status). toggleLightStatus() itself is unchanged and only runs once
// the person taps Confirm.
function openLightConfirm(nextStatus) {
    if (!lightConfirmOverlayEl) {
        // No confirm markup on the page for some reason — fall back to
        // the old direct-toggle behavior instead of doing nothing.
        toggleLightStatus();
        return;
    }
    if (lightConfirmIconEl) lightConfirmIconEl.innerHTML = STATUS_ICON_SVG[nextStatus];
    if (lightConfirmTitleEl) {
        lightConfirmTitleEl.textContent = nextStatus === 'on' ? 'Mark light as ON?' : 'Mark light as OFF?';
    }
    if (lightConfirmDescEl) {
        lightConfirmDescEl.textContent = nextStatus === 'on'
            ? "Confirm the light just came back on where you are. This updates the status everyone else sees."
            : "Confirm the light just went off where you are. This updates the status everyone else sees.";
    }
    // FIX: .home-reminder-overlay's default (closed) state is opacity:0 /
    // visibility:hidden / pointer-events:none at the CSS level — the
    // [hidden] attribute rule is just a display:none backstop. Actual
    // visibility is gated on the .is-open class (see home-reminder.js's
    // openHomeReminder(), the working reference for this pattern).
    // Clearing `hidden` alone left the overlay at opacity 0: in the DOM,
    // but never shown. Also mirrors home-reminder.js in locking page
    // scroll via body.modal-open while the overlay is up.
    lightConfirmOverlayEl.hidden = false;
    lightConfirmOverlayEl.setAttribute('aria-hidden', 'false');
    lightConfirmOverlayEl.classList.add('is-open');
    document.body.classList.add('modal-open');
}

function closeLightConfirm() {
    if (!lightConfirmOverlayEl) return;
    // FIX: aria-hidden was being set on this overlay while the Confirm
    // (or Cancel) button inside it still had focus — browsers block
    // that (a hidden subtree can't contain the focused element) and
    // log a console warning. Move focus back to the trigger icon
    // first if focus is currently inside the overlay, then hide it.
    if (lightConfirmOverlayEl.contains(document.activeElement)) {
        statusIconEl?.focus();
    }
    lightConfirmOverlayEl.hidden = true;
    lightConfirmOverlayEl.setAttribute('aria-hidden', 'true');
    lightConfirmOverlayEl.classList.remove('is-open');
    document.body.classList.remove('modal-open');
}


// -----------------------------------------------------
// FETCHERS
// -----------------------------------------------------
async function fetchLocationReports(location) {
    try {
        const res = await fetch(`${API_BASE}/lightstatus/history?location=${encodeURIComponent(location)}`);
        if (res.ok) return await res.json();
    } catch (err) {
        // Older deployments do not have /lightstatus/history yet.
    }
    try {
        const fallback = await fetch(`${API_BASE}/reports?location=${encodeURIComponent(location)}&limit=100`);
        if (!fallback.ok) throw new Error('fallback history unavailable');
        const reports = await fallback.json();
        return Array.isArray(reports) ? reports.filter(r => r.status === 'on' || r.status === 'off').map(r => ({
            id: r.id,
            status: r.status,
            reportedAt: r.reportedAt,
            source: r.text || 'A volunteer'
        })) : [];
    } catch (err) {
        return [];
    }
}

async function fetchNearby(locationKey) {
    if (!nearbyListEl) return;
    const neighbors = NEARBY_MAP[locationKey] || [];

    if (neighbors.length === 0) {
        nearbyListEl.innerHTML = '<span class="nearby-list__empty">No nearby locations mapped for this location yet.</span>';
        return;
    }

    const results = await Promise.all(neighbors.map(async name => {
        try {
            const res = await fetch(`${API_BASE}/lightstatus?location=${encodeURIComponent(name)}`);
            const data = await res.json();
            return { name, status: data.status || 'unknown', reportedAt: data.reportedAt || null };
        } catch (err) {
            return { name, status: 'unknown', reportedAt: null };
        }
    }));

    renderNearby(results);
}

function renderNearby(results) {
    if (!nearbyListEl) return;
    nearbyListEl.innerHTML = '';

    results.forEach(area => {
        const item = document.createElement('div');
        item.className = 'nearby-item';

        const metaText = area.reportedAt
            ? `Verified ${formatRelativeTime(new Date(area.reportedAt).getTime())}`
            : 'No reports yet';

        const nameRow = document.createElement('span');
        nameRow.className = 'nearby-item__name';
        nameRow.innerHTML = `<span class="nearby-item__dot">${dotIconForStatus(area.status)}</span>${area.name}`;

        const meta = document.createElement('span');
        meta.className = 'nearby-item__meta';
        meta.textContent = metaText;

        item.appendChild(nameRow);
        item.appendChild(meta);
        nearbyListEl.appendChild(item);
    });
}


// -----------------------------------------------------
// COMMUNITY ACTIVITY
// -----------------------------------------------------
function renderCommunityActivity() {
    if (!communityActivityHeadline) return;

    const todayStart = startOfTodayMs();
    const reportsToday = locationReports.filter(r => new Date(r.reportedAt).getTime() >= todayStart);
    const locationLabel = currentLocation ? currentLocation.split(',')[0].trim() : 'your area';

    communityActivityHeadline.innerHTML = reportsToday.length > 0
        ? `${ICON_PEOPLE} ${reportsToday.length} report${reportsToday.length === 1 ? '' : 's'} checked in on ${locationLabel} today`
        : `${ICON_PEOPLE} No reports for ${locationLabel} yet today`;

    if (communityActivityLastReport) {
        communityActivityLastReport.textContent = locationReports[0]
            ? `Last report ${formatRelativeTime(new Date(locationReports[0].reportedAt).getTime())}`
            : 'No reports yet';
    }

    if (communityActivityNow) {
        const fiveMinAgo = Date.now() - 5 * 60 * 1000;
        const activeNow = locationReports.filter(r => new Date(r.reportedAt).getTime() >= fiveMinAgo).length;
        communityActivityNow.innerHTML = activeNow > 0
            ? `<span class="community-activity__live-dot"></span> ${activeNow} reporting in the last few minutes`
            : `<span class="community-activity__live-dot"></span> No new activity right now`;
    }
}


// -----------------------------------------------------
// TREND BANNER: "Stable today" vs "Frequent outages today",
// based on outages reported since local midnight.
// -----------------------------------------------------
function updateTrendBanner() {
    if (!trendBanner) return;
    if (trendBanner.dataset.homeTrending === '1') return;

    const todayStart = startOfTodayMs();
    const outagesToday = locationReports.filter(r => r.status === 'off' && new Date(r.reportedAt).getTime() >= todayStart);

    if (outagesToday.length === 0) {
        // locationReports is newest-first, so the first "off" we find is the most recent
        const lastOff = locationReports.find(r => r.status === 'off');
        trendBanner.classList.remove('trend-banner--warning');
        trendBanner.classList.add('trend-banner--stable');
        if (trendBannerIcon) trendBannerIcon.innerHTML = ICON_BOLT;
        if (trendBannerTitle) trendBannerTitle.textContent = "Stable today";
        if (trendBannerSub) {
            trendBannerSub.textContent = lastOff
                ? `No outage for ${formatDuration(Date.now() - new Date(lastOff.reportedAt).getTime())}`
                : "No outages on record yet";
        }
    } else {
        trendBanner.classList.remove('trend-banner--stable');
        trendBanner.classList.add('trend-banner--warning');
        if (trendBannerIcon) trendBannerIcon.innerHTML = ICON_WARNING;
        if (trendBannerTitle) trendBannerTitle.textContent = "Frequent outages today";
        if (trendBannerSub) {
            trendBannerSub.textContent = `${outagesToday.length} outage${outagesToday.length === 1 ? '' : 's'} since this morning`;
        }
    }
}


// -----------------------------------------------------
// TIMELINE: today's on/off events, newest first.
// -----------------------------------------------------
function renderTimeline() {
    if (!statusTimelineEl) return;

    const todayStart = startOfTodayMs();
    const todaysEvents = locationReports.filter(r => new Date(r.reportedAt).getTime() >= todayStart);

    statusTimelineEl.innerHTML = "";

    if (todaysEvents.length === 0) {
        const empty = document.createElement('li');
        empty.className = "status-timeline__empty";
        empty.textContent = "No status changes yet today.";
        statusTimelineEl.appendChild(empty);
        return;
    }

    todaysEvents.forEach(entry => {
        const item = document.createElement('li');
        item.className = `status-timeline__item status-timeline__item--${entry.status}`;

        const dot = document.createElement('span');
        dot.className = "status-timeline__dot";

        const body = document.createElement('div');
        body.className = "status-timeline__body";

        const label = document.createElement('strong');
        label.textContent = entry.status === "on" ? "Light came on" : "Power went off";

        const time = document.createElement('span');
        time.textContent = formatRelativeTime(new Date(entry.reportedAt).getTime());

        body.appendChild(label);
        body.appendChild(time);
        item.appendChild(dot);
        item.appendChild(body);
        statusTimelineEl.appendChild(item);
    });
}


// -----------------------------------------------------
// LOCATION HISTORY: every on/off event for Home, newest first.
// -----------------------------------------------------
function renderRecentReports() {
    if (!recentReportsListEl) return;

    const recent = locationReports;
    recentReportsListEl.innerHTML = "";

    if (recent.length === 0) {
        const empty = document.createElement('p');
        empty.className = "status-timeline__empty";
        empty.textContent = "No reports for this location yet — be the first to check in.";
        recentReportsListEl.appendChild(empty);
        return;
    }

    recent.forEach(entry => {
        const isOn = entry.status === "on";
        const item = document.createElement('div');
        item.className = `report-item report-item--check report-item--${isOn ? 'success' : 'warning'}`;

        const check = document.createElement('span');
        check.className = "report-item__check";
        check.innerHTML = ICON_CHECK;

        const body = document.createElement('div');
        body.className = "report-item__body";
        const name = document.createElement('strong');
        const eventDate = new Date(entry.reportedAt);
        const eventTime = Number.isNaN(eventDate.getTime())
            ? '—'
            : eventDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        name.textContent = isOn ? `Light came on at ${eventTime}` : `Light went off at ${eventTime}`;
        const text = document.createElement('p');
        text.className = "report-item__text";
        text.textContent = `Source: ${entry.source || 'A volunteer'}`;
        body.appendChild(name);
        body.appendChild(text);

        const time = document.createElement('span');
        time.className = "report-item__time";
        time.textContent = formatRelativeTime(new Date(entry.reportedAt).getTime());

        item.appendChild(check);
        item.appendChild(body);
        item.appendChild(time);
        recentReportsListEl.appendChild(item);
    });

    const historyItems = recentReportsListEl.querySelectorAll('.report-item');
    if (historyItems.length > 4) {
        historyItems.forEach((item, index) => {
            if (index >= 4) item.hidden = true;
        });

        const expandButton = document.createElement('button');
        expandButton.type = 'button';
        expandButton.className = 'report-history__toggle';
        expandButton.textContent = `Show all history (${historyItems.length})`;
        expandButton.setAttribute('aria-expanded', 'false');
        expandButton.addEventListener('click', () => {
            const expanded = expandButton.getAttribute('aria-expanded') === 'true';
            historyItems.forEach((item, index) => {
                if (index >= 4) item.hidden = expanded;
            });
            expandButton.setAttribute('aria-expanded', String(!expanded));
            expandButton.textContent = expanded
                ? `Show all history (${historyItems.length})`
                : 'Show less history';
        });
        recentReportsListEl.appendChild(expandButton);
    }
}


// -----------------------------------------------------
// RELIABILITY / CONFIDENCE: drives the pulse-panel meter, the
// new visual bar on the card, and the hero mini-card's stars —
// all from one shared percentage so they never disagree.
// -----------------------------------------------------
function reliabilityLabel(percent) {
    if (percent >= 85) return "Highly reliable";
    if (percent >= 65) return "Reliable";
    if (percent >= 40) return "Moderately reliable";
    return "Low reliability — few recent reports";
}

function applyConfidenceValue(percent, isLocalEstimate) {
    const clamped = Math.max(0, Math.min(100, percent));
    const gradient = clamped >= 70
        ? 'linear-gradient(90deg, var(--teal), color-mix(in srgb, var(--teal) 70%, var(--brand)))'
        : clamped >= 40
            ? 'linear-gradient(90deg, var(--amber), var(--brand))'
            : 'linear-gradient(90deg, var(--red), var(--amber))';

    if (reliabilityMeterFill && reliabilityMeterValue) {
        reliabilityMeterValue.textContent = `${clamped}%`;
        reliabilityMeterFill.style.width = `${clamped}%`;
        reliabilityMeterFill.style.background = gradient;
        reliabilityMeterTrack?.setAttribute('aria-valuenow', String(clamped));
        if (reliabilityMeterCaption) {
            reliabilityMeterCaption.textContent = isLocalEstimate
                ? "Estimated from this location's recent reports — syncs once more data is in."
                : "Based on how often recent reports agree with each other.";
        }
    }

    if (confidenceBarFill && confidenceBarValue) {
        confidenceBarFill.style.width = `${clamped}%`;
        confidenceBarFill.style.background = gradient;
        confidenceBarValue.textContent = `${clamped}%`;
    }

    if (confidenceCaption) {
        const contributorsText = heroContributorsPillEl?.textContent?.trim();
        const contributorsCount = contributorsText ? parseInt(contributorsText, 10) : NaN;
        const contributorsLabel = !Number.isNaN(contributorsCount)
            ? `${contributorsCount} trusted contributor${contributorsCount === 1 ? '' : 's'}`
            : null;
        confidenceCaption.textContent = contributorsLabel
            ? `${reliabilityLabel(clamped)} · ${contributorsLabel}`
            : reliabilityLabel(clamped);
    }

    if (heroStarsGraphic) {
        const starCount = Math.max(0, Math.min(5, Math.round(clamped / 20)));
        heroStarsGraphic.innerHTML = ICON_STAR_FILLED.repeat(starCount) + ICON_STAR_EMPTY.repeat(5 - starCount);
    }
}

function localReliabilityEstimate() {
    if (locationReports.length === 0) return null;
    const oneWeekAgo = Date.now() - (7 * DAY);
    const recentEntries = locationReports.filter(r => new Date(r.reportedAt).getTime() >= oneWeekAgo);
    if (recentEntries.length === 0) return null;
    const onCount = recentEntries.filter(r => r.status === "on").length;
    return Math.round((onCount / recentEntries.length) * 100);
}

function syncReliabilityMeter() {
    const sourceText = sourceConfidenceEl?.textContent?.trim();
    const parsed = sourceText ? parseInt(sourceText, 10) : NaN;

    if (!Number.isNaN(parsed) && sourceText.includes('%')) {
        applyConfidenceValue(parsed, false);
        return;
    }

    const estimate = localReliabilityEstimate();
    if (estimate !== null) {
        applyConfidenceValue(estimate, true);
    }
}

// Keep the meter in sync whenever profile.js updates #sourceConfidence
// (it's fetched/set independently on its own poll cycle).
if (sourceConfidenceEl && typeof MutationObserver !== 'undefined') {
    const confidenceObserver = new MutationObserver(syncReliabilityMeter);
    confidenceObserver.observe(sourceConfidenceEl, { childList: true, characterData: true, subtree: true });
}


// -----------------------------------------------------
// HERO MINI-CARD: reads the status badge profile.js already set
// (rather than re-fetching status), plus today's report count.
// -----------------------------------------------------
function renderHeroMiniCard() {
    if (!heroMiniDot) return;

    const badgeEl = document.getElementById('statusBadge');
    const isOn = badgeEl?.classList.contains('badge--on');
    const isOff = badgeEl?.classList.contains('badge--off');
    heroMiniDot.innerHTML = isOn ? ICON_DOT_ON : isOff ? ICON_DOT_OFF : ICON_DOT_UNKNOWN;

    const lastVerifiedEl = document.getElementById('lastVerified');
    const verifiedText = lastVerifiedEl?.textContent?.trim();
    if (heroMiniVerified) {
        heroMiniVerified.textContent = verifiedText && verifiedText !== '—'
            ? `Verified ${verifiedText}`
            : 'Awaiting first report';
    }

    if (heroPeopleHelped) {
        const todayStart = startOfTodayMs();
        const helpedToday = locationReports.filter(r => new Date(r.reportedAt).getTime() >= todayStart).length;
        heroPeopleHelped.textContent = helpedToday > 0
            ? `${helpedToday} ${helpedToday === 1 ? 'person' : 'people'} helped today`
            : 'Be the first to help today';
    }
}


// -----------------------------------------------------
// ACHIEVEMENTS: real numbers only — reportCount from /user/:id,
// this-week count from /reports?userId=. "Points" is a simple,
// documented formula (3 pts per report made today), not a
// hidden/fake score. NOTE: /reports is capped at 100 results,
// so "this week" undercounts only for a user with >100 reports
// in the last 7 days — unlikely at this stage, but worth
// knowing about if the community grows a lot.
// -----------------------------------------------------
async function loadAchievements() {
    if (!achievementCard) return;

    const resolvedUserId = resolveCurrentUserId();
    if (!resolvedUserId) {
        achievementCard.hidden = true;
        return;
    }

    try {
        const [userRes, myReportsRes] = await Promise.all([
            fetch(`${API_BASE}/user/${resolvedUserId}`),
            fetch(`${API_BASE}/reports?userId=${encodeURIComponent(resolvedUserId)}&limit=100`)
        ]);

        if (!userRes.ok) throw new Error('user fetch failed');
        const user = await userRes.json();
        const myReports = myReportsRes.ok ? await myReportsRes.json() : [];

        const todayStart = startOfTodayMs();
        const weekAgo = Date.now() - 7 * DAY;
        const reportsToday = myReports.filter(r => new Date(r.reportedAt).getTime() >= todayStart).length;
        const reportsThisWeek = myReports.filter(r => new Date(r.reportedAt).getTime() >= weekAgo).length;
        const pointsToday = reportsToday * 3;

        achievementCard.hidden = false;
        if (achievementPoints) achievementPoints.innerHTML = `+${pointsToday} <span>points</span>`;
        if (achievementWeekReports) achievementWeekReports.textContent = String(reportsThisWeek);
        if (achievementTotalReports) achievementTotalReports.textContent = user.reportCount != null ? String(user.reportCount) : '—';
    } catch (err) {
        achievementCard.hidden = true;
    }
}


// -----------------------------------------------------
// ORCHESTRATION
// -----------------------------------------------------
async function refreshLocationPanel() {
    if (!currentLocation) return;
    locationReports = await fetchLocationReports(currentLocation);
    fetchPrimaryLightStatus();
    renderCommunityActivity();
    syncReliabilityMeter();
    updateTrendBanner();
    renderTimeline();
    renderRecentReports();
    renderHeroMiniCard();
}

function initForLocation(location) {
    if (!location || location === currentLocation) return;
    currentLocation = location;
    currentLocationKey = slugify(location);

    refreshLocationPanel();
    fetchNearby(currentLocationKey);

    clearInterval(reportsPollInterval);
    // Offset from profile.js's 10s status poll so the two don't hammer
    // the backend in lockstep.
    reportsPollInterval = setInterval(refreshLocationPanel, 20000);
}

// profile.js dispatches 'locationReady' (and sets window.currentChatLocation)
// once it knows the user's location — that fetch is async, so it may not
// have happened yet when this script runs. Handle both orders.
//
// FIX: if profile.js's fetch resolves and dispatches 'locationReady'
// BEFORE this script has run far enough to attach its listener (a real
// race, not hypothetical — script load order isn't a guarantee here),
// the event is missed forever and currentLocation never gets set, so
// the card silently never paints anything past its initial skeleton
// text. Short interval below catches that case within 300ms without
// needing profile.js to change how/when it dispatches.
if (window.currentChatLocation) {
    initForLocation(window.currentChatLocation);
} else {
    window.addEventListener('locationReady', (e) => initForLocation(e.detail?.location));
    const locationReadyFallback = setInterval(() => {
        if (window.currentChatLocation) {
            clearInterval(locationReadyFallback);
            initForLocation(window.currentChatLocation);
        }
    }, 300);
    setTimeout(() => clearInterval(locationReadyFallback), 15000);
}

// FIX: a status change made elsewhere (the admin panel, another
// device, another tab) only reached this card on the next 20s poll
// tick — so testing a toggle by flipping to the admin panel and back
// could sit on stale data for up to 20s, which read as "it just
// didn't update." Refetching immediately whenever the tab regains
// focus/visibility closes that gap without shortening the background
// poll interval for everyone.
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentLocation) {
        fetchPrimaryLightStatus();
    }
});
window.addEventListener('focus', () => {
    if (currentLocation) fetchPrimaryLightStatus();
});

// Any component that reports light status (modal, secondary location,
// future quick actions) broadcasts this event. Refresh immediately so
// the primary hero does not sit on stale/unknown text until the poll.
//
// FIX: this listened for 'lw:light-status-reported' and read
// e.detail.location, but every reporter (toggleLightStatus above,
// window.LWLightStatus.report) actually dispatches
// 'lw:lightstatus-changed' with e.detail.locationKey (already
// slugified — see location.js's own listener for the same event).
// The name AND the field were wrong, so this never fired and the
// primary hero only ever updated on its own 20s poll.
window.addEventListener('lw:lightstatus-changed', (e) => {
    const reportedKey = e?.detail?.locationKey;
    if (!currentLocationKey || !reportedKey) return;
    if (reportedKey === currentLocationKey) {
        fetchPrimaryLightStatus();
        refreshLocationPanel();
    }
});

loadAchievements();
// -----------------------------------------------------
// PUBLIC API — lets other views drive the exact same report
// (POST /lightstatus), icon-state, and tap-animation logic instead of
// re-implementing it. Used by home.js's secondary-location panel and
// location.js's per-area rows.
// -----------------------------------------------------
window.LWLightStatus = {
    // POSTs a report for any location (not just the primary one) and
    // returns the updated { status, reportedAt, ... } record.
    async report(location, status, userId) {
        const reporterId = isValidObjectId(userId) ? userId.trim() : undefined;
        const res = await fetch(`${API_BASE}/lightstatus`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ location, status, userId: reporterId })
        });
        if (!res.ok) throw new Error('report failed');
        const record = await res.json();
        window.dispatchEvent(new CustomEvent('lw:lightstatus-changed', {
            detail: { locationKey: slugify(location), status: record.status }
        }));
        return record;
    },
    animateIcon: animateIconDecision,
    applyIconState: applyPrimaryStatusIconState,
    formatRelativeTime,
    async refreshNow() {
        if (currentLocation) {
            await Promise.resolve(fetchPrimaryLightStatus());
            await Promise.resolve(refreshLocationPanel());
        }
    }
};

window.addEventListener('lw:route-changed', (e) => {
    if (e.detail.view !== 'home') {
        clearInterval(reportsPollInterval);
    } else if (currentLocation) {
        clearInterval(reportsPollInterval);
        reportsPollInterval = setInterval(refreshLocationPanel, 20000);
    }
});
})();