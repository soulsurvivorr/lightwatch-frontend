// ============================================================
//  HELPERS.JS
//  Small formatting helpers that were previously copy-pasted with
//  slight variations across areas.js, reports.js, lightstatus.js.
//  Classic script, plain globals (LWHelpers namespace to avoid
//  polluting bare identifiers view files might already use).
// ============================================================

const LWHelpers = {
  // location.js style — input is a plain number of minutes already
  // computed by the caller.
  formatRelativeTimeFromMinutes(minutes) {
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
  },

  // reports.js style — input is an ISO date string; shorter labels
  // ("1m ago" vs "1 min ago") since it renders in a denser list.
  formatRelativeTimeFromDate(dateStr) {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMs / 3600000);
    const days = Math.floor(diffMs / 86400000);

    if (mins < 1) return 'Just now';
    if (mins < 60) return mins === 1 ? '1m ago' : `${mins}m ago`;
    if (hours < 24) return hours === 1 ? '1h ago' : `${hours}h ago`;
    return days === 1 ? 'Yesterday' : `${days}d ago`;
  },

  safeId(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  },

  apiBase() {
    if (typeof API_URL !== 'undefined' && API_URL) return API_URL;
    if (typeof API_BASE_URL !== 'undefined' && API_BASE_URL) return API_BASE_URL;
    return '';
  }
};
