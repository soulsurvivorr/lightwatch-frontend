// ============================================================
//  API.JS
//  Thin fetch wrapper around API_URL (config.js). New file — most
//  existing view files call fetch(`${API_URL}/...`) directly and
//  keep doing so (that's still perfectly valid; API_URL is still a
//  plain global). This exists for new code (the router uses it for
//  the one call it makes itself) and as the natural home for any
//  view you migrate onto a shared client later.
// ============================================================

const BACKEND_TIMEOUT_MS = 15000;

function buildBackendError(message) {
  const err = new Error(message);
  err.isBackendError = true;
  return err;
}

function getBackendErrorMessage(error) {
  if (!error) return 'Could not reach the backend. Is the backend still running?';
  const text = String(error.message || error || '');
  if (/timed out/i.test(text) || error.name === 'AbortError') {
    return `Backend request timed out after ${BACKEND_TIMEOUT_MS / 1000} seconds. Is the backend still running?`;
  }
  if (/Failed to fetch|NetworkError|Network request failed/i.test(text)) {
    return 'Could not reach the backend. Is the backend still running?';
  }
  return text;
}

async function fetchWithBackendTimeout(path, options = {}) {
  const url = path.startsWith('http') ? path : `${API_URL}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal, ...options });
    return response;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw buildBackendError(`Request to ${url} timed out after ${BACKEND_TIMEOUT_MS}ms.`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

const LWApi = {
  async get(path) {
    const res = await fetchWithBackendTimeout(`${API_URL}${path}`);
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    return res.json();
  },

  async post(path, body) {
    const res = await fetchWithBackendTimeout(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `POST ${path} failed: ${res.status}`);
      err.data = data;
      throw err;
    }
    return data;
  }
};

window.fetchWithBackendTimeout = fetchWithBackendTimeout;
window.getBackendErrorMessage = getBackendErrorMessage;
window.BACKEND_TIMEOUT_MS = BACKEND_TIMEOUT_MS;
