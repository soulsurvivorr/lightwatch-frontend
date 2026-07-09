// =========================================================
// areas.js
// Powers the "Areas" page — a browsable grid of Kumasi
// neighborhoods and their light status.
//
// LIVE_AREAS are wired to the real GET /lightstatus endpoint
// (same one home.js uses for the user's own location), so if
// someone reports a status change for one of these, it will
// show up here on the next poll.
//
// DEMO_AREAS is hardcoded for now, purely so the page looks
// populated before more neighborhoods have real contributors.
// Swap an entry from DEMO_AREAS into LIVE_AREAS any time that
// neighborhood starts getting real reports — no other change
// needed, fetchLiveArea() will pick it up automatically.
// =========================================================

const LIVE_AREAS = ['Bantama', 'Asokwa', 'Adum'];

const DEMO_AREAS = [
  { name: 'Suame', status: 'on', lastUpdated: '2h ago', contributors: 6 },
  { name: 'Ahodwo', status: 'off', lastUpdated: '38m ago', contributors: 3 },
  { name: 'Nhyiaeso', status: 'on', lastUpdated: '5h ago', contributors: 9 }
];

// Matches the slower polling cadence used elsewhere on the site
// (keeps Render's request logs quiet).
const POLL_INTERVAL_MS = 45000;

let areasPollTimer = null;

function apiBase() {
  // Reuse whichever global base config exists in this deployment.
  // Priority: API_URL (current app) -> API_BASE_URL (legacy) -> relative.
  if (typeof API_URL !== 'undefined' && API_URL) return API_URL;
  if (typeof API_BASE_URL !== 'undefined' && API_BASE_URL) return API_BASE_URL;
  return '';
}

function relativeTime(dateInput) {
  if (!dateInput) return 'No reports yet';
  const diffMs = Date.now() - new Date(dateInput).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function areaCardTemplate({ name, status, lastUpdated, contributors, live }) {
  const isOn = status === 'on';
  const isUnknown = status === 'unknown' || !status;
  const statusLabel = isUnknown ? 'Checking status' : isOn ? 'Light on' : 'Light off';
  const badgeClass = isUnknown ? 'badge--low' : isOn ? 'badge--on' : 'badge--off';
  const pulseClass = isUnknown ? 'pulse--low' : isOn ? 'pulse--on' : 'pulse--off';
  const contributorLabel = contributors === null || contributors === undefined
    ? '—'
    : `${contributors} contributor${contributors === 1 ? '' : 's'}`;

  return `
    <div class="area-card" data-area="${name}">
      <div class="area-card__top">
        <div class="area-card__name-row">
          <span class="pulse ${pulseClass}"></span>
          <span class="area-card__name">${name}</span>
        </div>
        ${live ? '<span class="area-card__live-tag">Live</span>' : ''}
      </div>
      <span class="badge ${badgeClass}">${statusLabel}</span>
      <div class="area-card__meta">
        <span>${contributorLabel}</span>
        <span>${lastUpdated}</span>
      </div>
    </div>
  `;
}

function renderSummary(areas) {
  const total = areas.length;
  const onCount = areas.filter(a => a.status === 'on').length;
  const summaryEl = document.getElementById('areasSummaryText');
  if (summaryEl) {
    summaryEl.textContent = `${onCount} of ${total} areas currently have power`;
  }
}

function renderAreas(liveResults, demoResults) {
  const grid = document.getElementById('areaGrid');
  if (!grid) return;

  const allAreas = [...liveResults, ...demoResults]
    .sort((a, b) => a.name.localeCompare(b.name));

  renderSummary(allAreas);
  grid.innerHTML = allAreas.map(areaCardTemplate).join('');
}

async function fetchLiveArea(name) {
  try {
    const res = await fetch(`${apiBase()}/lightstatus?location=${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`Bad response for ${name}`);
    const data = await res.json();
    return {
      name,
      status: data.status || 'unknown',
      lastUpdated: relativeTime(data.reportedAt),
      contributors: data.stats ? data.stats.uniqueContributors : null,
      live: true
    };
  } catch (err) {
    console.error(`Failed to load live status for ${name}:`, err.message);
    return { name, status: 'unknown', lastUpdated: 'Unavailable', contributors: null, live: true };
  }
}

async function loadAreas() {
  const demoAreas = DEMO_AREAS.map(area => ({ ...area, live: false }));
  const liveAreas = await Promise.all(LIVE_AREAS.map(fetchLiveArea));
  renderAreas(liveAreas, demoAreas);
}

function startAreasPolling() {
  loadAreas();
  clearInterval(areasPollTimer);
  areasPollTimer = setInterval(loadAreas, POLL_INTERVAL_MS);
}

document.addEventListener('DOMContentLoaded', startAreasPolling);
window.addEventListener('beforeunload', () => clearInterval(areasPollTimer));