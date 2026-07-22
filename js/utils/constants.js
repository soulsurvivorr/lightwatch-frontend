// ============================================================
//  CONSTANTS.JS
//  Storage keys and shared numeric constants that used to be
//  re-declared (sometimes inconsistently) at the top of several
//  page scripts. Centralized here so there's exactly one spelling
//  of each key. Classic script (loads before every view module) so
//  these are plain globals — same access pattern the app already
//  used for cross-file values like API_URL.
// ============================================================

// ---- Session (services/auth.js) ----
const AUTH_KEY = 'app_auth_token';
const USER_KEY = 'app_user';
const REMEMBER_KEY = 'app_remember';
const TEMP_AUTH_KEY = 'app_temp_auth_token';
const TEMP_USER_KEY = 'app_temp_user';
const TEMP_EXPIRES_KEY = 'app_temp_expires_at';

// ---- Onboarding / first-run (views/onboarding.js) ----
const SKIP_ONBOARDING_ONCE_KEY = 'lw_skip_onboarding_once';
const SHOWN_THIS_SESSION_KEY = 'lw_onboarding_shown_session';
const HOME_REMINDER_SEEN_KEY = 'lw_home_reminder_seen';

// ---- Theme (components/theme.js) ----
const THEME_PREF_KEY = 'lw_theme_pref';

// ---- First-boot skeleton gate (app.js / views/profile.js) ----
// Native install, so localStorage survives app close/reopen — this
// flag is what lets the full-page skeleton show once (true cold
// start, nothing cached yet) and never again after that.
const FIRST_BOOT_DONE_KEY = 'lw_first_boot_done';

// ---- Polling cadence — kept deliberately slow app-wide to keep the
//      Render backend's request logs quiet (see areas.js/reports.js
//      history). Views that poll should use one of these rather than
//      inventing their own number.
const POLL_INTERVAL_STANDARD_MS = 45000; // areas, light status
const POLL_INTERVAL_FAST_MS = 30000;     // reports

// ---- Generic cache max-age (services/cache.js consumers) ----
const CACHE_MAX_AGE_SHORT_MS = 15 * 60 * 1000;  // reports
const CACHE_MAX_AGE_MEDIUM_MS = 30 * 60 * 1000; // areas, light status
