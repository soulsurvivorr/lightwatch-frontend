// =========================================================
// areas.js
// Powers the "Areas" page — a browsable grid of Kumasi
// neighborhoods and their light status.
//
// Areas shown on this page are wired to the real GET /lightstatus
// endpoint (same source home.js uses). No demo rows are injected.
// =========================================================

const AREAS = [
  'Bantama',
  'Asokwa',
  'Adum',
  'Suame',
  'Ahodwo',
  'Nhyiaeso',
  'Tafo',
  'KNUST'
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
        ${live ? '<span class="area-card__live-tag">Live feed</span>' : ''}
      </div>
      <div class="area-card__right">
        <span class="badge ${badgeClass}">${statusLabel}</span>
      </div>
      <div class="area-card__meta-grid">
        <div class="area-card__meta-item">
          <span class="area-card__meta-label">Contributors</span>
          <span class="area-card__meta-value">${contributorLabel}</span>
        </div>
        <div class="area-card__meta-item">
          <span class="area-card__meta-label">Updated</span>
          <span class="area-card__meta-value">${lastUpdated}</span>
        </div>
      </div>
    </div>
  `;
}

function renderSummary(areas) {
  const total = areas.length;
  const onCount = areas.filter(a => a.status === 'on').length;
  const offCount = areas.filter(a => a.status === 'off').length;
  const summaryEl = document.getElementById('areasSummaryText');
  if (summaryEl) {
    summaryEl.textContent = `${onCount} on, ${offCount} off, ${total} tracked areas live`;
  }
}

function renderFeaturedBantama(areas) {
  const bantama = areas.find(a => a.name.toLowerCase() === 'bantama');
  if (!bantama) return;

  const statusEl = document.getElementById('featuredBantamaStatus');
  const updatedEl = document.getElementById('featuredBantamaUpdated');
  const contributorsEl = document.getElementById('featuredBantamaContributors');
  const pulseEl = document.getElementById('featuredBantamaPulse');

  const isOn = bantama.status === 'on';
  const isUnknown = bantama.status === 'unknown' || !bantama.status;

  if (statusEl) statusEl.textContent = isUnknown ? 'Checking status' : (isOn ? 'Light on' : 'Light off');
  if (updatedEl) updatedEl.textContent = bantama.lastUpdated;
  if (contributorsEl) contributorsEl.textContent = (bantama.contributors ?? '—').toString();
  if (pulseEl) {
    pulseEl.classList.remove('pulse--on', 'pulse--off', 'pulse--low');
    pulseEl.classList.add(isUnknown ? 'pulse--low' : (isOn ? 'pulse--on' : 'pulse--off'));
  }
}

function renderAreas(liveResults) {
  const grid = document.getElementById('areaGrid');
  if (!grid) return;

  const allAreas = [...liveResults];

  renderSummary(allAreas);
  renderFeaturedBantama(allAreas);
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
  const liveAreas = await Promise.all(AREAS.map(fetchLiveArea));
  renderAreas(liveAreas);
}

function startAreasPolling() {
  loadAreas();
  clearInterval(areasPollTimer);
  areasPollTimer = setInterval(loadAreas, POLL_INTERVAL_MS);
}

document.addEventListener('DOMContentLoaded', startAreasPolling);
window.addEventListener('beforeunload', () => clearInterval(areasPollTimer));