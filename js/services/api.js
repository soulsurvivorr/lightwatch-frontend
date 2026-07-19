// ============================================================
//  API.JS
//  Thin fetch wrapper around API_URL (config.js). New file — most
//  existing view files call fetch(`${API_URL}/...`) directly and
//  keep doing so (that's still perfectly valid; API_URL is still a
//  plain global). This exists for new code (the router uses it for
//  the one call it makes itself) and as the natural home for any
//  view you migrate onto a shared client later.
// ============================================================

const LWApi = {
  async get(path) {
    const res = await fetch(`${API_URL}${path}`);
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    return res.json();
  },

  async post(path, body) {
    const res = await fetch(`${API_URL}${path}`, {
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
