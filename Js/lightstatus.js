// =========================================================
// light-status.js
// Powers the on/off switch for Bantama's reported light
// status. Flipping it updates the badge, the pulsing dot,
// the status pill text, AND recalculates the outage stats
// (average outage length, frequency) from a small log of
// on/off events.
//
// Also drives the "Live status pulse" panel: a reliability
// meter, a today/trend banner, a same-day activity timeline,
// and a recent community reports feed — replacing the old
// static grid mosaic.
//
// This is all client-side / in-memory for now. The natural
// next step (not done here) is POSTing each toggle to a
// backend route like POST /locations/:id/status, so the
// status — and the reports feed below — is shared across
// everyone instead of just this browser tab.
// =========================================================

const lightSwitch = document.getElementById('lightSwitch');
const lightSwitchState = document.getElementById('lightSwitchState');
const statusBadge = document.getElementById('statusBadge');
const statusPulse = document.getElementById('statusPulse');
const statusPillText = document.getElementById('statusPillText');
const lastVerified = document.getElementById('lastVerified');
const avgOutageEl = document.getElementById('avgOutage');
const outageFreqEl = document.getElementById('outageFreq');
const lastOutageLengthEl = document.getElementById('lastOutageLength');

// -- Live status pulse panel elements --
const reliabilityMeterValue = document.getElementById('reliabilityMeterValue');
const reliabilityMeterFill = document.getElementById('reliabilityMeterFill');
const reliabilityMeterTrack = document.getElementById('reliabilityMeterTrack');
const reliabilityMeterCaption = document.getElementById('reliabilityMeterCaption');
const sourceConfidenceEl = document.getElementById('sourceConfidence');
const trendBanner = document.getElementById('trendBanner');
const trendBannerIcon = document.getElementById('trendBannerIcon');
const trendBannerTitle = document.getElementById('trendBannerTitle');
const trendBannerSub = document.getElementById('trendBannerSub');
const statusTimelineEl = document.getElementById('statusTimeline');
const recentReportsListEl = document.getElementById('recentReportsList');
const communityPulseLine = document.getElementById('communityPulseLine');
const heroContributorsPill = document.getElementById('heroContributorsPill');


// -----------------------------------------------------
// GHANA_NAMES — first names used to give each report in
// the "Latest community reports" feed a friendly face,
// instead of surfacing anyone's real account details.
// Reports stay genuinely anonymous under the hood (same
// idea as the anon-<word>-<number> chat handles server.js
// generates) — this is purely a cosmetic display name
// picked at report time, mixing common Akan day-names with
// other names you'll actually hear day-to-day in Kumasi.
// -----------------------------------------------------
const GHANA_NAMES = [
    "Kofi", "Kwabena", "Kwame", "Kwaku", "Yaw", "Kwadwo", "Kwesi",
    "Akosua", "Abena", "Adwoa", "Afua", "Ama", "Yaa", "Esi",
    "Nana", "Kojo", "Ohene", "Sarkodie", "Robert", "Eric",
    "Priscilla", "Michael", "Comfort", "Gifty", "Selina"
];

function pickGhanaName() {
    return GHANA_NAMES[Math.floor(Math.random() * GHANA_NAMES.length)];
}


// -----------------------------------------------------
// EVENT LOG
// Each time the switch flips, we record { status, time, name }.
// From this log we can derive: how often the light goes
// off, how long it stays off on average, today's timeline,
// and the recent-reports feed — "name" is the display name
// assigned to that particular report (see GHANA_NAMES above).
//
// Seeded with a small bit of history so the stats panel
// isn't empty on first load — matches the "1h 12m" / "3
// this week" numbers already shown in the original HTML.
// -----------------------------------------------------
const now = Date.now();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let statusLog = [
    { status: "off", time: now - (6 * DAY), name: pickGhanaName() },
    { status: "on",  time: now - (6 * DAY) + (1 * HOUR) + (5 * 60 * 1000), name: pickGhanaName() },
    { status: "off", time: now - (3 * DAY), name: pickGhanaName() },
    { status: "on",  time: now - (3 * DAY) + (48 * 60 * 1000), name: pickGhanaName() },
    { status: "off", time: now - (1 * DAY) - (1 * HOUR) - (12 * 60 * 1000), name: pickGhanaName() },
    { status: "on",  time: now - (1 * DAY), name: pickGhanaName() },
];

let isOn = true;


// -----------------------------------------------------
// HELPER: format milliseconds as "1h 12m"
// -----------------------------------------------------
function formatDuration(ms) {
    const totalMinutes = Math.round(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes}m`;
    return `${hours}h ${minutes}m`;
}


// -----------------------------------------------------
// HELPER: format a timestamp as a relative "X min ago"
// string, falling back to a clock time once it's more
// than a day old (matches the "Today / Yesterday" grouping
// people expect from a status timeline).
// -----------------------------------------------------
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


// -----------------------------------------------------
// HELPER: recalculate average outage length + frequency
// from statusLog, then update the stat elements on screen.
// -----------------------------------------------------
function recalculateStats() {

    // walk the log in pairs: an "off" followed by the next "on"
    // is one complete outage we can measure
    const outageDurations = [];

    for (let i = 0; i < statusLog.length - 1; i++) {
        if (statusLog[i].status === "off" && statusLog[i + 1].status === "on") {
            const duration = statusLog[i + 1].time - statusLog[i].time;
            outageDurations.push(duration);
        }
    }

    // average outage length
    if (outageDurations.length > 0) {
        const totalMs = outageDurations.reduce((sum, d) => sum + d, 0);
        const avgMs = totalMs / outageDurations.length;
        if (avgOutageEl) avgOutageEl.textContent = formatDuration(avgMs);
        if (lastOutageLengthEl) {
            lastOutageLengthEl.textContent = formatDuration(
                outageDurations[outageDurations.length - 1]
            );
        }
    }

    // frequency: how many outages started in the last 7 days
    const oneWeekAgo = Date.now() - (7 * DAY);
    const outagesThisWeek = statusLog.filter(
        entry => entry.status === "off" && entry.time >= oneWeekAgo
    ).length;

    if (outageFreqEl) {
        outageFreqEl.textContent = `${outagesThisWeek} this week`;
    }
}


// -----------------------------------------------------
// TREND BANNER: "Stable today" vs "Frequent outages today",
// based on outages that started in the last 24h.
// -----------------------------------------------------
function updateTrendBanner() {
    if (!trendBanner) return;

    const oneDayAgo = Date.now() - DAY;
    const outagesToday = statusLog.filter(
        entry => entry.status === "off" && entry.time >= oneDayAgo
    );

    if (outagesToday.length === 0) {
        // stable — show how long it's been since the last outage started,
        // if we have one on record at all
        const lastOffEvent = [...statusLog].reverse().find(e => e.status === "off");
        trendBanner.classList.remove('trend-banner--warning');
        trendBanner.classList.add('trend-banner--stable');
        if (trendBannerIcon) trendBannerIcon.textContent = "⚡";
        if (trendBannerTitle) trendBannerTitle.textContent = "Stable today";
        if (trendBannerSub) {
            trendBannerSub.textContent = lastOffEvent
                ? `No outage for ${formatDuration(Date.now() - lastOffEvent.time)}`
                : "No outages on record yet";
        }
    } else {
        trendBanner.classList.remove('trend-banner--stable');
        trendBanner.classList.add('trend-banner--warning');
        if (trendBannerIcon) trendBannerIcon.textContent = "⚠️";
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

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const todaysEvents = statusLog
        .filter(entry => entry.time >= startOfToday.getTime())
        .slice()
        .reverse();

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
        time.textContent = formatRelativeTime(entry.time);

        body.appendChild(label);
        body.appendChild(time);
        item.appendChild(dot);
        item.appendChild(body);
        statusTimelineEl.appendChild(item);
    });
}


// -----------------------------------------------------
// RECENT REPORTS: most recent few log entries, shown as
// who reported what and when. Capped at 5, newest first.
// -----------------------------------------------------
function renderRecentReports() {
    if (!recentReportsListEl) return;

    const recent = statusLog.slice(-5).reverse();
    recentReportsListEl.innerHTML = "";

    recent.forEach(entry => {
        const item = document.createElement('div');
        item.className = `report-item report-item--${entry.status === 'on' ? 'success' : 'warning'}`;

        const left = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = entry.name || pickGhanaName();
        const text = document.createElement('p');
        text.className = "report-item__text";
        text.textContent = entry.status === "on"
            ? "Confirmed power is back on."
            : "Reported the light is off.";
        left.appendChild(name);
        left.appendChild(text);

        const time = document.createElement('span');
        time.className = "report-item__time";
        time.textContent = formatRelativeTime(entry.time);

        item.appendChild(left);
        item.appendChild(time);
        recentReportsListEl.appendChild(item);
    });

    // "Community activity" line in the panel header — built from real
    // numbers already on the page (contributor pill + last-verified time)
    // rather than inventing a separate figure.
    if (communityPulseLine) {
        const contributorsText = heroContributorsPill?.textContent?.trim();
        const lastReport = recent[0] ? formatRelativeTime(recent[0].time) : null;
        if (contributorsText && lastReport) {
            communityPulseLine.textContent = `${contributorsText} · last report ${lastReport}`;
        } else if (lastReport) {
            communityPulseLine.textContent = `Last report ${lastReport}`;
        }
    }
}


// -----------------------------------------------------
// RELIABILITY METER: mirrors whatever percentage lands in
// #sourceConfidence (populated elsewhere once wired to the
// backend's /lightstatus stats). Until then, falls back to
// a locally computed estimate from this device's own log —
// clearly labeled as such so it's never mistaken for a
// verified network-wide figure.
// -----------------------------------------------------
function localReliabilityEstimate() {
    const oneWeekAgo = Date.now() - (7 * DAY);
    const recentEntries = statusLog.filter(e => e.time >= oneWeekAgo);
    if (recentEntries.length === 0) return null;
    const onCount = recentEntries.filter(e => e.status === "on").length;
    return Math.round((onCount / recentEntries.length) * 100);
}

function applyReliabilityValue(percent, isLocalEstimate) {
    if (!reliabilityMeterFill || !reliabilityMeterValue) return;
    const clamped = Math.max(0, Math.min(100, percent));

    reliabilityMeterValue.textContent = `${clamped}%`;
    reliabilityMeterFill.style.width = `${clamped}%`;
    reliabilityMeterTrack?.setAttribute('aria-valuenow', String(clamped));

    reliabilityMeterFill.style.background = clamped >= 70
        ? 'linear-gradient(90deg, var(--teal), color-mix(in srgb, var(--teal) 70%, var(--brand)))'
        : clamped >= 40
            ? 'linear-gradient(90deg, var(--amber), var(--brand))'
            : 'linear-gradient(90deg, var(--red), var(--amber))';

    if (reliabilityMeterCaption) {
        reliabilityMeterCaption.textContent = isLocalEstimate
            ? "Estimated from reports on this device — syncs once shared data is on."
            : "Based on how often recent reports agree with each other.";
    }
}

function syncReliabilityMeter() {
    const sourceText = sourceConfidenceEl?.textContent?.trim();
    const parsed = sourceText ? parseInt(sourceText, 10) : NaN;

    if (!Number.isNaN(parsed) && sourceText.includes('%')) {
        applyReliabilityValue(parsed, false);
        return;
    }

    const estimate = localReliabilityEstimate();
    if (estimate !== null) {
        applyReliabilityValue(estimate, true);
    }
}

// Keep the meter in sync if/when something else populates #sourceConfidence
// (e.g. a backend-driven script loaded elsewhere on the page).
if (sourceConfidenceEl && typeof MutationObserver !== 'undefined') {
    const confidenceObserver = new MutationObserver(syncReliabilityMeter);
    confidenceObserver.observe(sourceConfidenceEl, { childList: true, characterData: true, subtree: true });
}


// -----------------------------------------------------
// HELPER: apply the current isOn state to every visual
// element tied to status (badge, pulse dot, pill text,
// switch itself).
// -----------------------------------------------------
function renderStatus() {

    if (isOn) {
        statusBadge.textContent = "Light on";
        statusBadge.className = "badge badge--on";

        statusPulse.className = "pulse pulse--on";
        statusPillText.textContent = "Light is on now";

        lightSwitch.classList.remove("light-switch--off");
        lightSwitch.classList.add("light-switch--on");
        lightSwitch.setAttribute("aria-checked", "true");
        lightSwitchState.textContent = "ON";

    } else {
        statusBadge.textContent = "Light off";
        statusBadge.className = "badge badge--off";

        statusPulse.className = "pulse pulse--off";
        statusPillText.textContent = "Light is off right now";

        lightSwitch.classList.remove("light-switch--on");
        lightSwitch.classList.add("light-switch--off");
        lightSwitch.setAttribute("aria-checked", "false");
        lightSwitchState.textContent = "OFF";
    }

    lastVerified.textContent = "Just now";
}


// -----------------------------------------------------
// FULL REFRESH: everything the pulse panel shows, in one
// call — used on load and after every toggle.
// -----------------------------------------------------
function refreshPulsePanel() {
    recalculateStats();
    updateTrendBanner();
    renderTimeline();
    renderRecentReports();
    syncReliabilityMeter();
}


// -----------------------------------------------------
// HANDLE CLICK: flip the status, log it (with a freshly
// picked display name for the reports feed), then refresh
// every part of the pulse panel.
// -----------------------------------------------------
lightSwitch?.addEventListener('click', () => {

    isOn = !isOn;

    statusLog.push({
        status: isOn ? "on" : "off",
        time: Date.now(),
        name: pickGhanaName()
    });

    renderStatus();
    refreshPulsePanel();
});


// -----------------------------------------------------
// INITIAL RENDER
// -----------------------------------------------------
refreshPulsePanel();