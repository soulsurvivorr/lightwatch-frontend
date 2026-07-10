// =========================================================
// areas.js
// Powers the "Areas" page — a dense, scannable list of Kumasi
// neighborhoods and their current light status, with a
// confidence signal, search, and status filtering.
//
// Bantama is wired to the real GET /lightstatus endpoint (same
// source home.js uses). Other towns are lightweight demo entries
// — swap any of them into fetchLiveTowns() once they have real
// contributors.
// =========================================================

// minutesAgo is a plain number so relative time can be computed
// the same way for every row (and re-computed live, not baked
// into a fixed string that goes stale).
// confirmations feeds the confidence tag — how many separate
// community reports currently agree on this status.
const DEMO_AREAS = [
  { name: 'Asokwa', status: 'on', minutesAgo: 12, confirmations: 5 },
  { name: 'Adum', status: 'off', minutesAgo: 244, confirmations: 2 },
  { name: 'Suame', status: 'on', minutesAgo: 18, confirmations: 6 },
  { name: 'Ahodwo', status: 'off', minutesAgo: 9, confirmations: 1 },
  { name: 'Nhyiaeso', status: 'on', minutesAgo: 1450, confirmations: 8 },
  { name: 'Tafo', status: 'unknown', minutesAgo: 7, confirmations: 0 },
  { name: 'KNUST', status: 'on', minutesAgo: 5, confirmations: 4 },
  { name: 'Ejisu', status: 'unknown', minutesAgo: 130, confirmations: 1 },
  { name: 'Kwadaso', status: 'off', minutesAgo: 11, confirmations: 3 }
];

// Matches the slower polling cadence used elsewhere on the site
// (keeps Render's request logs quiet).
const POLL_INTERVAL_MS = 45000;

let areasPollTimer = null;
let currentFilter = 'all';
let currentSearch = '';

function apiBase() {
  // Reuse whichever global base config exists in this deployment.
  // Priority: API_URL (current app) -> API_BASE_URL (legacy) -> relative.
  if (typeof API_URL !== 'undefined' && API_URL) return API_URL;
  if (typeof API_BASE_URL !== 'undefined' && API_BASE_URL) return API_BASE_URL;
  return '';
}

// ---- Relative time: minutes -> "X mins ago" -> "X hrs ago" -> "X days ago" ----
function formatRelativeTime(minutes) {
  if (minutes === null || minutes === undefined) return 'No reports yet';
  if (minutes < 1) return 'Just now';
  if (minutes < 60) {
    return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// ---- Confidence: how many separate reports currently agree ----
function confidenceInfo(confirmations) {
  if (confirmations === null || confirmations === undefined) {
    return { label: 'Unverified', cls: 'unverified', title: 'No community confirmations yet' };
  }
  if (confirmations >= 4) {
    return { label: 'High', cls: 'high', title: `High confidence — ${confirmations} matching reports` };
  }
  if (confirmations >= 2) {
    return { label: 'Medium', cls: 'medium', title: `Medium confidence — ${confirmations} matching reports` };
  }
  if (confirmations === 1) {
    return { label: 'Low', cls: 'low', title: '1 report — not yet confirmed by others' };
  }
  return { label: 'Unverified', cls: 'unverified', title: 'No community confirmations yet' };
}

function areaRowTemplate({ name, status, minutesAgo, confirmations, live }) {
  const isOn = status === 'on';
  const isUnknown = status === 'unknown' || !status;
  const statusLabel = isUnknown ? 'Checking' : isOn ? 'On' : 'Off';
  const badgeClass = isUnknown ? 'badge--low' : isOn ? 'badge--on' : 'badge--off';
  const pulseClass = isUnknown ? 'pulse--low' : isOn ? 'pulse--on' : 'pulse--off';
  const timeText = formatRelativeTime(minutesAgo);
  const confidence = confidenceInfo(confirmations);

  return `
    <div class="area-row" data-area="${name}" data-status="${status}" data-name="${name.toLowerCase()}" role="listitem">
      <span class="area-row__dot pulse ${pulseClass}"></span>
      <span class="area-row__name">${name}${live ? ' <span class="area-row__live">LIVE</span>' : ''}</span>
      <span class="area-row__confidence area-row__confidence--${confidence.cls}" title="${confidence.title}">${confidence.label}</span>
      <span class="area-row__time">${timeText}</span>
      <span class="badge ${badgeClass} area-row__badge">${statusLabel}</span>
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

function applyFilters() {
  const grid = document.getElementById('areaGrid');
  if (!grid) return;

  let visibleCount = 0;
  grid.querySelectorAll('.area-row').forEach(row => {
    const matchesFilter = currentFilter === 'all' || row.dataset.status === currentFilter;
    const matchesSearch = !currentSearch || row.dataset.name.includes(currentSearch);
    const show = matchesFilter && matchesSearch;
    row.style.display = show ? '' : 'none';
    if (show) visibleCount++;
  });

  const emptyState = document.getElementById('areasEmptyState');
  if (emptyState) {
    emptyState.style.display = visibleCount === 0 ? 'flex' : 'none';
  }
}

function renderAreas(areas) {
  const grid = document.getElementById('areaGrid');
  if (!grid) return;

  const prioritized = areas
    .map((area, index) => ({ area, index }))
    .sort((a, b) => {
      const aOn = a.area.status === 'on' ? 1 : 0;
      const bOn = b.area.status === 'on' ? 1 : 0;
      if (aOn !== bOn) return bOn - aOn;
      return a.index - b.index;
    })
    .map(entry => entry.area);

  renderSummary(prioritized);
  grid.innerHTML = prioritized.map(areaRowTemplate).join('');
  applyFilters();
}

async function fetchLiveTowns() {
  const name = 'Bantama';
  try {
    const res = await fetch(`${apiBase()}/lightstatus?location=${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`Bad response for ${name}`);
    const data = await res.json();
    const reportedAt = data.reportedAt ? new Date(data.reportedAt).getTime() : null;
    const minutesAgo = reportedAt ? Math.max(0, Math.round((Date.now() - reportedAt) / 60000)) : null;
    return {
      name,
      status: data.status || 'unknown',
      minutesAgo,
      confirmations: data.stats ? data.stats.uniqueContributors : null,
      live: true
    };
  } catch (err) {
    console.error(`Failed to load live status for ${name}:`, err.message);
    return { name, status: 'unknown', minutesAgo: null, confirmations: null, live: true };
  }
}

async function loadAreas() {
  const liveBantama = await fetchLiveTowns();
  renderAreas([liveBantama, ...DEMO_AREAS]);
}

function bindControls() {
  document.querySelectorAll('.areas-filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.areas-filter-tab').forEach(t => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      currentFilter = tab.dataset.filter;
      applyFilters();
    });
  });

  const searchInput = document.getElementById('areasSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      currentSearch = searchInput.value.trim().toLowerCase();
      applyFilters();
    });
  }
}

function startAreasPolling() {
  bindControls();
  loadAreas();
  clearInterval(areasPollTimer);
  areasPollTimer = setInterval(loadAreas, POLL_INTERVAL_MS);
}

document.addEventListener('DOMContentLoaded', startAreasPolling);
window.addEventListener('beforeunload', () => clearInterval(areasPollTimer));