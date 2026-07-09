// =========================================================
// areas.js
// Powers the "Areas" page — a browsable grid of Kumasi
// neighborhoods and their light status.
//
// Bantama is wired to the real GET /lightstatus endpoint (same
// source home.js uses). The rest of the rows are intentionally
// hardcoded preview/demo entries so the page stays simple.
// =========================================================

const DEMO_AREAS = [
  { name: 'Asokwa', status: 'on', lastUpdated: '12m ago', reports: 14, confidence: 86, live: false },
  { name: 'Adum', status: 'off', lastUpdated: '6m ago', reports: 9, confidence: 78, live: false },
  { name: 'Suame', status: 'on', lastUpdated: '22m ago', reports: 11, confidence: 72, live: false },
  { name: 'Ahodwo', status: 'off', lastUpdated: '18m ago', reports: 7, confidence: 67, live: false },
  { name: 'Nhyiaeso', status: 'on', lastUpdated: '31m ago', reports: 8, confidence: 63, live: false },
  { name: 'Tafo', status: 'unknown', lastUpdated: 'No fresh update', reports: 4, confidence: 41, live: false },
  { name: 'KNUST', status: 'on', lastUpdated: '9m ago', reports: 16, confidence: 89, live: false }
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

function areaCardTemplate({ name, status, lastUpdated, reports, confidence, live }) {
  const isOn = status === 'on';
  const isUnknown = status === 'unknown' || !status;
  const statusLabel = isUnknown ? 'Checking status' : isOn ? 'Light on' : 'Light off';
  const badgeClass = isUnknown ? 'badge--low' : isOn ? 'badge--on' : 'badge--off';
  const pulseClass = isUnknown ? 'pulse--low' : isOn ? 'pulse--on' : 'pulse--off';
  const reportLabel = reports === null || reports === undefined
    ? '—'
    : `${reports} report${reports === 1 ? '' : 's'}`;
  const confidenceValue = Math.max(20, Math.min(100, Number(confidence || 0)));
  const confidenceTone = confidenceValue >= 80 ? 'high' : confidenceValue >= 60 ? 'mid' : 'low';

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
          <span class="area-card__meta-label">Reports</span>
          <span class="area-card__meta-value">${reportLabel}</span>
        </div>
        <div class="area-card__meta-item">
          <span class="area-card__meta-label">Updated</span>
          <span class="area-card__meta-value">${lastUpdated}</span>
        </div>
        <div class="area-card__meta-item area-card__meta-item--confidence">
          <span class="area-card__meta-label">Community confidence</span>
          <span class="area-card__meta-value area-card__meta-value--confidence">${confidenceValue}%</span>
          <span class="area-card__confidence-track" role="img" aria-label="Community confidence ${confidenceValue}%">
            <span class="area-card__confidence-fill area-card__confidence-fill--${confidenceTone}" style="width:${confidenceValue}%"></span>
          </span>
        </div>
      </div>
    </div>
  `;
}

function renderSummary(areas) {
  const total = areas.length;
  const liveCount = areas.filter(a => a.live).length;
  const signalCount = total - liveCount;
  const summaryEl = document.getElementById('areasSummaryText');
  if (summaryEl) {
    summaryEl.textContent = `${liveCount} live area and ${signalCount} community-signal neighborhoods`; 
  }
}

function renderFeaturedBantama(areas) {
  const bantama = areas.find(a => a.name.toLowerCase() === 'bantama');
  if (!bantama) return;

  const statusEl = document.getElementById('featuredBantamaStatus');
  const updatedEl = document.getElementById('featuredBantamaUpdated');
  const reportsEl = document.getElementById('featuredBantamaReports');
  const pulseEl = document.getElementById('featuredBantamaPulse');

  const isOn = bantama.status === 'on';
  const isUnknown = bantama.status === 'unknown' || !bantama.status;

  if (statusEl) statusEl.textContent = isUnknown ? 'Checking status' : (isOn ? 'Light on' : 'Light off');
  if (updatedEl) updatedEl.textContent = bantama.lastUpdated;
  if (reportsEl) reportsEl.textContent = (bantama.reports ?? '—').toString();
  if (pulseEl) {
    pulseEl.classList.remove('pulse--on', 'pulse--off', 'pulse--low');
    pulseEl.classList.add(isUnknown ? 'pulse--low' : (isOn ? 'pulse--on' : 'pulse--off'));
  }
}

function renderAreas(liveResults) {
  const grid = document.getElementById('areaGrid');
  if (!grid) return;

  const allAreas = [...liveResults, ...DEMO_AREAS];

  renderSummary(allAreas);
  renderFeaturedBantama(allAreas);
  grid.innerHTML = allAreas.map(areaCardTemplate).join('');
}

async function fetchLiveBantama() {
  const name = 'Bantama';
  try {
    const res = await fetch(`${apiBase()}/lightstatus?location=${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`Bad response for ${name}`);
    const data = await res.json();
    return {
      name,
      status: data.status || 'unknown',
      lastUpdated: relativeTime(data.reportedAt),
      reports: data.stats ? data.stats.totalChecks : null,
      confidence: data.stats?.sourceConfidence ? Number(data.stats.sourceConfidence) : 92,
      live: true
    };
  } catch (err) {
    console.error(`Failed to load live status for ${name}:`, err.message);
    return { name, status: 'unknown', lastUpdated: 'Unavailable', reports: null, confidence: 38, live: true };
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