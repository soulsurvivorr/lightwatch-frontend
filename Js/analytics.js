// analytics.js
// Drop-in usage tracker for the LightWatch analytics system.
// Include on every page (after config.js/auth.js, if present):
//   <script src="./Js/analytics.js"></script>
//
// Add `data-screen="home"` (or "chat", "reports", "signup", etc.) to the
// <body> tag of each page so events are labeled correctly. If it's missing,
// the tracker falls back to document.title.
//
// What it tracks automatically, once included:
//   - "app_open"    once per device per calendar day (drives daily/returning users)
//   - "screen_view" once per page load
//   - "exit"        when the tab is hidden/closed, with time-on-screen (drives
//                    average screen time + drop-off screens)
//
// What you call manually:
//   LWAnalytics.trackSearch("bantama")          // drives "most searched areas"
//
// Everything is fire-and-forget (sendBeacon where available) — a failed or
// slow analytics call never blocks or breaks the page.

(function (global) {
  const API = global.LW_API_BASE || (typeof API !== "undefined" ? API : "https://lightwatch-backend.onrender.com");
  const DEVICE_KEY = "lw_device_id";
  const SESSION_KEY = "lw_session_id";
  const LAST_OPEN_DAY_KEY = "lw_last_open_day";

  function uuid() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getDeviceId() {
    try {
      let id = localStorage.getItem(DEVICE_KEY);
      if (!id) {
        id = uuid();
        localStorage.setItem(DEVICE_KEY, id);
      }
      return id;
    } catch (e) {
      return null; // e.g. storage disabled — tracking just skips deviceId
    }
  }

  function getSessionId() {
    try {
      let id = sessionStorage.getItem(SESSION_KEY);
      if (!id) {
        id = uuid();
        sessionStorage.setItem(SESSION_KEY, id);
      }
      return id;
    } catch (e) {
      return null;
    }
  }

  function currentUserId() {
    try {
      if (typeof getSession === "function") {
        const s = getSession();
        return (s && (s.userId || s.id || s._id)) || null;
      }
    } catch (e) {}
    return null;
  }

  function currentScreen() {
    return document.body?.dataset?.screen || document.title || "unknown";
  }

  function send(payload) {
    const body = JSON.stringify(
      Object.assign(
        {
          deviceId: getDeviceId(),
          sessionId: getSessionId(),
          userId: currentUserId(),
        },
        payload
      )
    );

    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: "application/json" });
        navigator.sendBeacon(`${API}/analytics/track`, blob);
        return;
      }
    } catch (e) {
      /* fall through to fetch */
    }

    try {
      fetch(`${API}/analytics/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    } catch (e) {
      /* best-effort only */
    }
  }

  let screenEnteredAt = Date.now();
  let exitSent = false;

  function trackAppOpenOncePerDay() {
    try {
      const today = new Date().toISOString().slice(0, 10);
      if (localStorage.getItem(LAST_OPEN_DAY_KEY) === today) return;
      localStorage.setItem(LAST_OPEN_DAY_KEY, today);
    } catch (e) {
      /* if storage is unavailable, just send it every load — harmless */
    }
    send({ type: "app_open", screen: currentScreen() });
  }

  function trackScreenView() {
    screenEnteredAt = Date.now();
    exitSent = false;
    send({ type: "screen_view", screen: currentScreen() });
  }

  function trackExit() {
    if (exitSent) return;
    exitSent = true;
    const durationMs = Date.now() - screenEnteredAt;
    send({ type: "exit", screen: currentScreen(), durationMs });
  }

  // Call when a user performs a location/area search — e.g. from
  // home.js's searchMockPlaces(), or once they pick a suggestion.
  function trackSearch(query, locationKey) {
    send({ type: "search", query, locationKey: locationKey || query, screen: currentScreen() });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") trackExit();
  });
  window.addEventListener("pagehide", trackExit);

  function init() {
    trackAppOpenOncePerDay();
    trackScreenView();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  global.LWAnalytics = { trackSearch, trackScreenView, trackExit };
})(window);