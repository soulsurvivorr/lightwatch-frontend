// ============================================================
//  CONFIG.JS — single source of truth for the backend base URL.
// ============================================================

// Production backend URL - used by all platforms (Web & Android)
const API_URL = "https://lightwatch-backend-lightwatch-backend.up.railway.app";

// Expose the configured backend URL on window as a compatibility shim
// for older scripts that still read window.API_URL directly.
window.API_URL = API_URL;

console.log("[Config] API_URL set to:", API_URL);
