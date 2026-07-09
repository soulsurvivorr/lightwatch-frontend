// =========================================================
// areas.js
// Powers the "Areas" page — a simple list of Kumasi
// neighborhoods and their current light status.
//
// Bantama is wired to the real GET /lightstatus endpoint (same
// source home.js uses). Other towns are lightweight static entries.
// =========================================================

const DEMO_AREAS = [
  { name: 'Asokwa', status: 'on', updatedAgo: '12 mins ago', live: false },
  { name: 'Adum', status: 'off', updatedAgo: '4 mins ago', live: false },
  { name: 'Suame', status: 'on', updatedAgo: '18 mins ago', live: false },
  { name: 'Ahodwo', status: 'off', updatedAgo: '9 mins ago', live: false },
  { name: 'Nhyiaeso', status: 'on', updatedAgo: '21 mins ago', live: false },
  { name: 'Tafo', status: 'unknown', updatedAgo: '7 mins ago', live: false },
  { name: 'KNUST', status: 'on', updatedAgo: '5 mins ago', live: false },
  { name: 'Ejisu', status: 'unknown', updatedAgo: '15 mins ago', live: false },
  { name: 'Kwadaso', status: 'off', updatedAgo: '11 mins ago', live: false }
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

function areaCardTemplate({ name, status, live, updatedAgo }) {
  const isOn = status === 'on';
  const isUnknown = status === 'unknown' || !status;
  const statusLabel = isUnknown ? 'Checking status' : isOn ? 'Light on' : 'Light off';
  const badgeClass = isUnknown ? 'badge--low' : isOn ? 'badge--on' : 'badge--off';
  const pulseClass = isUnknown ? 'pulse--low' : isOn ? 'pulse--on' : 'pulse--off';
  const sinceText = updatedAgo || 'Recently';
  const contextLine = isOn
    ? `${sinceText} since power on`
    : isUnknown
      ? `${sinceText} since last status check`
      : `${sinceText} since power off`;
  const contextTag = live ? 'Live feed' : 'Community signal';

  return `
    <div class="area-card" data-area="${name}" role="listitem">
      <div class="area-card__top">
        <span class="pulse ${pulseClass}"></span>
        <span class="area-card__name">${name}</span>
        <span class="area-card__tag">${contextTag}</span>
      </div>
      <div class="area-card__status">
        <span class="badge ${badgeClass}">${statusLabel}</span>
      </div>
      <p class="area-card__context">${contextLine}</p>
    </div>
  `;
}

function renderSummary(areas) {
  const onCount = areas.filter(a => a.status === 'on').length;
  const offCount = areas.filter(a => a.status === 'off').length;
  const unknownCount = areas.filter(a => a.status === 'unknown' || !a.status).length;
  const summaryEl = document.getElementById('areasSummaryText');
  if (summaryEl) {
    summaryEl.textContent = `${onCount} on · ${offCount} off · ${unknownCount} checking`;
  }
}

function renderAreas(liveResults) {
  const grid = document.getElementById('areaGrid');
  if (!grid) return;

  const allAreas = [...liveResults, ...DEMO_AREAS];
  const prioritizedAreas = allAreas
    .map((area, index) => ({ area, index }))
    .sort((a, b) => {
      const aOn = a.area.status === 'on' ? 1 : 0;
      const bOn = b.area.status === 'on' ? 1 : 0;
      if (aOn !== bOn) return bOn - aOn;
      return a.index - b.index;
    })
    .map(entry => entry.area);

  renderSummary(prioritizedAreas);
  grid.innerHTML = prioritizedAreas.map(areaCardTemplate).join('');
}

async function fetchLiveBantama() {
  const name = 'Bantama';
  try {
    const res = await fetch(`${apiBase()}/lightstatus?location=${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`Bad response for ${name}`);
    const data = await res.json();
    const reportedAt = data.reportedAt ? new Date(data.reportedAt).getTime() : null;
    const diffMins = reportedAt ? Math.max(1, Math.round((Date.now() - reportedAt) / 60000)) : null;
    const updatedAgo = diffMins ? `${diffMins} mins ago` : 'Recently';
    return {
      name,
      status: data.status || 'unknown',
      updatedAgo,
      live: true
    };
  } catch (err) {
    console.error(`Failed to load live status for ${name}:`, err.message);
    return { name, status: 'unknown', updatedAgo: 'Recently', live: true };
  }
}

async function loadAreas() {
  const liveBantama = await fetchLiveBantama();
  renderAreas([liveBantama]);
}

function startAreasPolling() {
  loadAreas();
  clearInterval(areasPollTimer);
  areasPollTimer = setInterval(loadAreas, POLL_INTERVAL_MS);
}

document.addEventListener('DOMContentLoaded', startAreasPolling);
window.addEventListener('beforeunload', () => clearInterval(areasPollTimer));