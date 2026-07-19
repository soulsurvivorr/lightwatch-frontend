// ============================================================
//  STORAGE.JS
//  Generic localStorage/sessionStorage JSON helpers. New file —
//  the original app read/wrote localStorage directly (and slightly
//  differently) in almost every page script. Existing view files
//  keep doing that (rewriting every call site was judged too risky
//  for behavior this load-bearing); this is here for new code, and
//  for any view file you migrate onto it later.
// ============================================================

const LWStorage = {
  getJSON(key, storage = localStorage) {
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  setJSON(key, value, storage = localStorage) {
    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },

  remove(key, storage = localStorage) {
    try { storage.removeItem(key); } catch {}
  }
};
