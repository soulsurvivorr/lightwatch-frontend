// ============================================================
//  CACHE.JS
//  Consolidates the "paint last-known value instantly from
//  localStorage, then refresh from the network" pattern that was
//  copy-pasted (with the same shape but different key names) into
//  areas.js, reports.js, and profile.js's light-status card.
//
//  Wired into views/areas.js and views/reports.js as a
//  demonstration of the intended pattern going forward. Other call
//  sites (profile.js's LIGHT_STATUS_CACHE) were left on their
//  original inline implementation for this pass — same behavior,
//  just not yet ported, since that file is the highest-traffic one
//  in the app and a mechanical port deserves its own dedicated
//  test pass rather than riding along with this refactor.
// ============================================================

const LWCache = {
  read(key, maxAgeMs) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.cachedAt) return null;
      if (Date.now() - parsed.cachedAt > maxAgeMs) return null;
      return parsed.value;
    } catch {
      return null;
    }
  },

  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify({ value, cachedAt: Date.now() }));
      return true;
    } catch {
      return false;
    }
  }
};
