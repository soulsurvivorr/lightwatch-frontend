// ============================================================
//  CONFIG.JS — single source of truth for the backend base URL.
//  Loaded first, as a classic (non-module) script, so API_URL is a
//  plain global every other script (view modules, services) can
//  read directly — exactly like the original multi-page app.
// ============================================================
const API_URL = "https://lightwatch-backend.onrender.com";
