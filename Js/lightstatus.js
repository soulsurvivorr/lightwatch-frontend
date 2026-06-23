// =========================================================
// light-status.js
// Powers the on/off switch for Bantama's reported light
// status. Flipping it updates the badge, the pulsing dot,
// the status pill text, AND recalculates the outage stats
// (average outage length, frequency) from a small log of
// on/off events.
//
// This is all client-side / in-memory for now. The natural
// next step (not done here) is POSTing each toggle to a
// backend route like POST /locations/:id/status, so the
// status is shared across everyone instead of just this
// browser tab.
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


// -----------------------------------------------------
// EVENT LOG
// Each time the switch flips, we record { status, time }.
// From this log we can derive: how often the light goes
// off, and how long it stays off on average.
//
// Seeded with a small bit of history so the stats panel
// isn't empty on first load — matches the "1h 12m" / "3
// this week" numbers already shown in the original HTML.
// -----------------------------------------------------
const now = Date.now();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let statusLog = [
    { status: "off", time: now - (6 * DAY) },
    { status: "on",  time: now - (6 * DAY) + (1 * HOUR) + (5 * 60 * 1000) },
    { status: "off", time: now - (3 * DAY) },
    { status: "on",  time: now - (3 * DAY) + (48 * 60 * 1000) },
    { status: "off", time: now - (1 * DAY) - (1 * HOUR) - (12 * 60 * 1000) },
    { status: "on",  time: now - (1 * DAY) },
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
// HANDLE CLICK: flip the status, log it, recalculate
// stats, and re-render.
// -----------------------------------------------------
lightSwitch?.addEventListener('click', () => {

    isOn = !isOn;

    statusLog.push({
        status: isOn ? "on" : "off",
        time: Date.now()
    });

    renderStatus();
    recalculateStats();
});


// -----------------------------------------------------
// INITIAL RENDER
// -----------------------------------------------------
recalculateStats();