// =========================================================
// light-status.js
// Drives the "Live status pulse" panel on Home: community
// activity, a reliability/confidence bar, a today/trend
// banner, a same-day activity timeline, a recent community
// reports feed, a "Nearby" mini-card list, the hero mini-card
// (verified status / people helped / star rating), and the
// Achievements card in the sidebar.
//
// DIVISION OF LABOR WITH profile.js:
// profile.js already owns the light switch, the status badge/
// pill/pulse dot, and the raw numbers in #sourceConfidence /
// #heroContributorsPill / #heroChecksPill / #avgOutage /
// #outageFreq / #lastVerified (it fetches /lightstatus and
// POSTs toggles). This file does NOT re-fetch or re-render any
// of that — it reads those elements as a data source (same
// MutationObserver pattern the original version of this file
// used) and fetches the separate /reports endpoint (scoped to
// this location) for everything profile.js doesn't cover.
//
// Previously this whole panel ran on a fake in-browser
// "statusLog" that reset on every page load. That's gone now —
// everything below comes from GET /reports?location=... (added
// an optional ?location filter server-side to support this)
// and, for Achievements, GET /reports?userId=... + GET /user/:id.
// =========================================================

const API_BASE = typeof API_URL !== 'undefined' ? API_URL : '';

// -----------------------------------------------------
// ICONS — small inline SVGs sized to sit exactly where the old
// emoji characters (🟢/🔴/⚪, 👥, ⚡, ⚠️, ✔) used to sit, so no
// layout or CSS elsewhere needs to change.
// -----------------------------------------------------
const ICON_DOT_ON = `<svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:0.85em;height:0.85em;vertical-align:middle;" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="#3DD9C2" stroke="#1C8C7A" stroke-width="0.6"/></svg>`;
const ICON_DOT_OFF = `<svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:0.85em;height:0.85em;vertical-align:middle;" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="#E5484D" stroke="#A32E32" stroke-width="0.6"/></svg>`;
const ICON_DOT_UNKNOWN = `<svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:0.85em;height:0.85em;vertical-align:middle;" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="none" stroke="#9AA1AC" stroke-width="1.1"/></svg>`;
const ICON_PEOPLE = `<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:1em;height:1em;vertical-align:-0.15em;" aria-hidden="true"><circle cx="7" cy="6.8" r="2.4" stroke="currentColor" stroke-width="1.3"/><circle cx="14" cy="7.6" r="2" stroke="currentColor" stroke-width="1.3"/><path d="M2.3 16.4c.6-2.9 2.4-4.5 4.7-4.5s4.1 1.6 4.7 4.5M12 12.6c1.9.1 3.3 1.5 3.8 3.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;
const ICON_BOLT = `<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:1em;height:1em;" aria-hidden="true"><path d="M11.2 2.2 4.8 11.4a.8.8 0 0 0 .66 1.26h3.3l-.72 5.14a.8.8 0 0 0 1.44.58l6-8.3a.8.8 0 0 0-.65-1.27h-3.3l.72-5.13a.8.8 0 0 0-1.43-.58Z" fill="currentColor"/></svg>`;
const ICON_WARNING = `<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:1em;height:1em;" aria-hidden="true"><path d="M10 2.6 18.3 16.6H1.7L10 2.6Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M10 8v3.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="10" cy="14" r="0.95" fill="currentColor"/></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:0.85em;height:0.85em;" aria-hidden="true"><path d="M3 8.5 6.3 12 13 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const STAR_PATH = "M9 1.3 11.2 6l5.1.5-3.9 3.4 1.2 5-4.6-2.7-4.6 2.7 1.2-5-3.9-3.4L6.8 6Z";
const ICON_STAR_FILLED = `<svg viewBox="0 0 18 18" fill="#D6A24A" stroke="#D6A24A" stroke-width="0.6" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" style="width:0.9em;height:0.9em;" aria-hidden="true"><path d="${STAR_PATH}"/></svg>`;
const ICON_STAR_EMPTY = `<svg viewBox="0 0 18 18" fill="none" stroke="#C7CBD3" stroke-width="0.9" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" style="width:0.9em;height:0.9em;" aria-hidden="true"><path d="${STAR_PATH}"/></svg>`;

function dotIconForStatus(status) {
    return status === 'on' ? ICON_DOT_ON : status === 'off' ? ICON_DOT_OFF : ICON_DOT_UNKNOWN;
}

// -- Elements this file owns / renders into --
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