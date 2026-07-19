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
// NEARBY_MAP — which areas show up under "Nearby" for a given
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
let currentUserId = (typeof getSession === 'function' && getSession()?.user?.id) || localStorage.getItem('currentUserId');
let locationReports = []; // reports scoped to the current location, newest first
let reportsPollInterval = null;


// -----------------------------------------------------
// FETCHERS
// -----------------------------------------------------
async function fetchLocationReports(location) {
    try {
        const res = await fetch(`${API_BASE}/reports?location=${encodeURIComponent(location)}&limit=50`);
        if (!res.ok) throw new Error('bad response');
        return await res.json();
    } catch (err) {
        return [];
    }
}

async function fetchNearby(locationKey) {
    if (!nearbyListEl) return;
    const neighbors = NEARBY_MAP[locationKey] || [];

    if (neighbors.length === 0) {
        nearbyListEl.innerHTML = '<span class="nearby-list__empty">No nearby areas mapped for this location yet.</span>';
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
// RECENT REPORTS: latest 5 for this location, checkmark style.
// -----------------------------------------------------
function renderRecentReports() {
    if (!recentReportsListEl) return;

    const recent = locationReports.slice(0, 5);
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
        name.textContent = nameForReportId(entry.id);
        const text = document.createElement('p');
        text.className = "report-item__text";
        text.textContent = isOn ? "Light ON" : "Light OFF";
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
    if (!currentUserId || !achievementCard) return;

    try {
        const [userRes, myReportsRes] = await Promise.all([
            fetch(`${API_BASE}/user/${currentUserId}`),
            fetch(`${API_BASE}/reports?userId=${encodeURIComponent(currentUserId)}&limit=100`)
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
        // Leave the card hidden rather than show broken/zeroed numbers.
    }
}


// -----------------------------------------------------
// ORCHESTRATION
// -----------------------------------------------------
async function refreshLocationPanel() {
    if (!currentLocation) return;
    locationReports = await fetchLocationReports(currentLocation);
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
if (window.currentChatLocation) {
    initForLocation(window.currentChatLocation);
} else {
    window.addEventListener('locationReady', (e) => initForLocation(e.detail?.location));
}

loadAchievements();
window.addEventListener('lw:route-changed', (e) => {
    if (e.detail.view !== 'home') {
        clearInterval(reportsPollInterval);
    } else if (currentLocation) {
        clearInterval(reportsPollInterval);
        reportsPollInterval = setInterval(refreshLocationPanel, 20000);
    }
});
})();
