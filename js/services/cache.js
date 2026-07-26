// ============================================================
//  CACHE.JS
//  Consolidates the "paint last-known value instantly, then refresh
//  from the network" pattern used across views/location.js,
//  views/profile.js (light-status card), and views/account.js
//  (account extras) / views/home.js (secondary-location panel).
//
//  Changed vs. the original cache.js:
//   - Added an in-memory layer underneath the existing localStorage
//     one. localStorage alone already survives a full app restart,
//     but every read still means JSON.parse()'ing a string — and,
//     more importantly, it gave callers no way to say "I already
//     loaded this once THIS run, never show a loading state for it
//     again while the app keeps running" (see LightWatch's Home/
//     Areas/Account skeleton — it was gating on a permanent
//     "has this device ever booted" flag instead, which meant real
//     data quietly went stale between app opens with nothing on
//     screen announcing that). The in-memory Map is what now makes
//     that guarantee possible for free: once a key has been read or
//     written in this page-load, read() returns it instantly and
//     the caller doesn't need any flag of its own.
//   - read()/write() keep their original two-argument signatures, so
//     every existing call site (views/areas.js) works unchanged.
// ============================================================

const LWCache = {
  // In-memory store — lives exactly as long as this page-load does.
  // The SPA never reloads the document between views/sign-ins, so
  // this is naturally "keep data in memory while the app is running"
  // with zero extra bookkeeping in each view file.
  _memory: new Map(),

  read(key, maxAgeMs) {
    // 1) Memory first — instant, no JSON.parse, always the freshest
    //    thing this running app instance has seen for this key.
    const cached = this._memory.get(key);
    if (cached && (maxAgeMs == null || Date.now() - cached.cachedAt <= maxAgeMs)) {
      return cached.value;
    }

    // 2) Fall back to localStorage — survives a full app restart,
    //    which the in-memory map by definition cannot.
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.cachedAt) return null;
      if (maxAgeMs != null && Date.now() - parsed.cachedAt > maxAgeMs) return null;
      // Warm the memory layer so the next read this session is instant
      // and doesn't need another disk hit / JSON.parse.
      this._memory.set(key, parsed);
      return parsed.value;
    } catch {
      return null;
    }
  },

  // Same lookup as read(), but ignores age entirely and returns
  // whatever's on record even if it's long stale. Useful for an
  // instant first paint you're about to refresh anyway — showing a
  // 2-hour-old number for a heartbeat is always better than showing
  // a blank "—" while the network call is in flight.
  readStale(key) {
    return this.read(key, null);
  },

  write(key, value) {
    const entry = { value, cachedAt: Date.now() };
    this._memory.set(key, entry);
    try {
      localStorage.setItem(key, JSON.stringify(entry));
      return true;
    } catch {
      // Storage full/blocked — the memory copy above still landed,
      // so this run of the app still benefits even if persistence
      // across restarts doesn't.
      return false;
    }
  },

  has(key) {
    return this._memory.has(key);
  }
};