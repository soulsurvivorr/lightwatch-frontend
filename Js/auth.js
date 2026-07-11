// ============================================================
//  AUTH.JS — Load this on EVERY page (home, chat, etc.)
//  Handles: session read/write, sign-out, auto-sign-in guard
// ============================================================

const AUTH_KEY     = 'app_auth_token';
const USER_KEY     = 'app_user';
const REMEMBER_KEY = 'app_remember';
const TEMP_AUTH_KEY = 'app_temp_auth_token';
const TEMP_USER_KEY = 'app_temp_user';
const TEMP_EXPIRES_KEY = 'app_temp_expires_at';

// ── Read session from whichever storage was used ─────────────
function getSession() {
    const remembered = localStorage.getItem(REMEMBER_KEY) === 'true';
    const token   = remembered ? localStorage.getItem(AUTH_KEY)  : sessionStorage.getItem(AUTH_KEY);
    const userRaw = remembered ? localStorage.getItem(USER_KEY)  : sessionStorage.getItem(USER_KEY);
    if (token && userRaw) {
        try { return { token, user: JSON.parse(userRaw), remembered }; }
        catch { return null; }
    }

    // Fallback for signup users who chose not to be remembered forever:
    // keep them signed in for 24h across browser restarts.
    const tempToken = localStorage.getItem(TEMP_AUTH_KEY);
    const tempUserRaw = localStorage.getItem(TEMP_USER_KEY);
    const tempExpiresAt = Number(localStorage.getItem(TEMP_EXPIRES_KEY) || '0');
    if (!tempToken || !tempUserRaw || !tempExpiresAt) return null;
    if (Date.now() > tempExpiresAt) {
        localStorage.removeItem(TEMP_AUTH_KEY);
        localStorage.removeItem(TEMP_USER_KEY);
        localStorage.removeItem(TEMP_EXPIRES_KEY);
        return null;
    }

    try {
        const tempUser = JSON.parse(tempUserRaw);
        sessionStorage.setItem(AUTH_KEY, tempToken);
        sessionStorage.setItem(USER_KEY, JSON.stringify(tempUser));
        return { token: tempToken, user: tempUser, remembered: false };
    }
    catch { return null; }
}

// ── Save session after successful verification ────────────────
function saveSession(user, token, rememberMe) {
    sessionStorage.removeItem('lw_home_reminder_seen');

    if (rememberMe) {
        localStorage.setItem(AUTH_KEY,        token);
        localStorage.setItem(USER_KEY,        JSON.stringify(user));
        localStorage.setItem(REMEMBER_KEY,    'true');
        localStorage.setItem('currentUserId', user.id);
        localStorage.setItem('currentUserData', JSON.stringify(user));

        sessionStorage.removeItem(AUTH_KEY);
        sessionStorage.removeItem(USER_KEY);
        sessionStorage.removeItem('currentUserId');
        sessionStorage.removeItem('currentUserData');
    } else {
        sessionStorage.setItem(AUTH_KEY,        token);
        sessionStorage.setItem(USER_KEY,        JSON.stringify(user));
        sessionStorage.setItem('currentUserId', user.id);
        sessionStorage.setItem('currentUserData', JSON.stringify(user));

        localStorage.removeItem(REMEMBER_KEY);
        localStorage.removeItem(AUTH_KEY);
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem('currentUserId');
        localStorage.removeItem('currentUserData');
    }
}

// ── Wipe everything cleanly ───────────────────────────────────
function clearSession() {
    [AUTH_KEY, USER_KEY, REMEMBER_KEY,
     TEMP_AUTH_KEY, TEMP_USER_KEY, TEMP_EXPIRES_KEY,
     'currentUserId', 'currentUserData', 'chatHandle',
     'maskedContact', 'signupUser', 'userIdentifier',
    'pendingUserId', 'rememberMePending',
    'lw_home_reminder_seen', 'lw_skip_disclaimer_once'
    ].forEach(k => {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
    });
}

// ── Sign-out overlay: brief branded moment before we land back
//    on the sign-in screen, instead of an abrupt blank flash ───
let signOutOverlayEl = null;

function showSignOutOverlay() {
    if (signOutOverlayEl) return signOutOverlayEl;

    const overlay = document.createElement('div');
    overlay.id = 'lwSignOutOverlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 99999;
        display: flex; align-items: center; justify-content: center;
        background: #1C1F26;
        animation: lwSignOutFadeIn 0.18s ease both;
    `;
    overlay.innerHTML = `
        <style>
            @keyframes lwSignOutFadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes lwSignOutPulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(0.92); opacity: 0.7; } }
            #lwSignOutOverlay .lw-mark { width: 64px; height: 64px; border-radius: 18px; animation: lwSignOutPulse 1.1s ease-in-out infinite; }
            #lwSignOutOverlay .lw-text { margin-top: 14px; font-family: 'Manrope', sans-serif; font-size: 0.85rem; color: rgba(255,255,255,0.75); letter-spacing: 0.02em; }
        </style>
        <div style="display:flex;flex-direction:column;align-items:center;">
            <img class="lw-mark" src="/images/dev-logo.png" alt="LightWatch">
            <span class="lw-text">Signing out…</span>
        </div>
    `;
    document.body.appendChild(overlay);
    signOutOverlayEl = overlay;
    return overlay;
}

// ── Sign out — works from ANY page ───────────────────────────
let signOutInProgress = false;

function signOut() {
    // Guard: multiple bound handlers (or a fast double-click) firing on
    // the same action should still only produce one overlay/redirect.
    if (signOutInProgress) return;
    signOutInProgress = true;

    clearSession();
    showSignOutOverlay();

    // Figure out the correct path back to index.html from wherever we are
    // Works whether you're at /pages/home.html or /index.html
    const depth = window.location.pathname.split('/').filter(Boolean).length;
    const prefix = depth > 1 ? '../'.repeat(depth - 1) : './';

    // Give the overlay a beat to actually paint/register before we leave.
    setTimeout(() => {
        window.location.replace(prefix + 'index.html');
    }, 700);
}

// ── Guard: redirect to login if no session ────────────────────
//  Call this at the top of any protected page
function requireAuth() {
    // Allow local file preview/editing without forcing a redirect.
    if (window.location.protocol === 'file:') {
        return;
    }

    if (!getSession()) {
        const path = window.location.pathname.toLowerCase();
        // Avoid redirecting index -> index forever when this guard is
        // accidentally loaded on the public login/landing page.
        if (path.endsWith('/index.html') || path === '/' || path === '') {
            return;
        }

        // Flip this BEFORE issuing the redirect. location.replace() doesn't
        // stop the rest of the page's scripts from running while the new
        // document loads — without this flag, profile.js's auto-run was
        // still rendering "Guest" placeholder content into the real (now
        // unhidden-by-skeleton) page for a frame or two before the redirect
        // actually took over, which is the flash users were seeing on the
        // way back to sign-in. Anything that renders user data checks this
        // flag first and bails out instead of painting anything.
        window.__lwAuthRedirecting = true;

        const depth = window.location.pathname.split('/').filter(Boolean).length;
        const prefix = depth > 1 ? '../'.repeat(depth - 1) : './';
        window.location.replace(prefix + 'index.html');
    }
}

// ── Run the guard immediately, as soon as auth.js itself parses.
//    auth.js loads early (non-deferred) on every protected page, well
//    before profile.js/notification.js (which are deferred and render
//    content). Checking here — instead of relying on each page's own
//    script (home.js/account.js) to call requireAuth() later in the
//    load order — closes the window where a signed-out visitor could
//    briefly see a page's real content before being bounced to sign-in.
requireAuth();

// ── Wire all [data-action="signout"] buttons on the page ──────
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-action="signout"]').forEach(btn => {
        btn.addEventListener('click', e => { e.preventDefault(); signOut(); });
    });
});

// ── Re-check session when a page is restored from the back-forward
//    cache (phone back-gesture, browser back button). Without this,
//    a protected page's requireAuth() only ran once on the original
//    load — after signing out, hitting back could silently restore
//    the cached authenticated DOM instead of bouncing to sign-in.
window.addEventListener('pageshow', (event) => {
    if (event.persisted && typeof requireAuth === 'function') {
        requireAuth();
    }
});