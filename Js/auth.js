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
    // Note: 'lw_home_reminder_seen' is NOT touched here — it's a
    // permanent per-device flag (localStorage, see home-reminder.js),
    // not a per-session one, so signing in shouldn't reset it.

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
    // Note: 'lw_home_reminder_seen' is deliberately NOT in this list —
    // it's a permanent per-device "have they ever seen this" flag
    // (localStorage, see home-reminder.js), not session state, so
    // signing out shouldn't reset it either.
    [AUTH_KEY, USER_KEY, REMEMBER_KEY,
     TEMP_AUTH_KEY, TEMP_USER_KEY, TEMP_EXPIRES_KEY,
     'currentUserId', 'currentUserData', 'chatHandle',
     'maskedContact', 'signupUser', 'userIdentifier',
    'pendingUserId', 'rememberMePending',
    'lw_skip_disclaimer_once',
    // Set by index.html right before it redirects a signed-in device to
    // home.html, and normally consumed there. If it's still set at
    // sign-out time it's stale — and if it survives to the next cold
    // launch, onboarding.js's isSessionRedirectPending() wrongly thinks
    // a redirect is already in flight and bails out of
    // revealAuthCheckBody(), leaving the whole page (native splash +
    // body) hidden behind auth-check indefinitely.
    'lw_launch_overlay_pending'
    ].forEach(k => {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
    });
}

// ── Branded transition overlay: brief full-screen moment (logo +
//    a status line) shown whenever the app hands off from one page
//    to another — signing out, sending a code, moving from signup
//    into verification, and verification succeeding into home —
//    instead of an abrupt blank flash or an inconsistent fade.
//    Shared across every page because auth.js loads on all of them. ──
let pageTransitionOverlayEl = null;

function showPageTransitionOverlay(message = 'Loading…') {
    if (pageTransitionOverlayEl) {
        const text = pageTransitionOverlayEl.querySelector('.lw-text');
        if (text) text.textContent = message;
        pageTransitionOverlayEl.setAttribute('aria-hidden', 'false');
        return pageTransitionOverlayEl;
    }

    const overlay = document.createElement('div');
    overlay.id = 'lwPageTransitionOverlay';
    overlay.setAttribute('aria-hidden', 'false');
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
            #lwPageTransitionOverlay .lw-mark { width: 64px; height: 64px; border-radius: 18px; animation: lwSignOutPulse 1.1s ease-in-out infinite; }
            #lwPageTransitionOverlay .lw-text { margin-top: 14px; font-family: 'Manrope', sans-serif; font-size: 0.85rem; color: rgba(255,255,255,0.75); letter-spacing: 0.02em; }
        </style>
        <div style="display:flex;flex-direction:column;align-items:center;">
            <img class="lw-mark" src="/images/dev-logo.png" alt="LightWatch">
            <span class="lw-text">${message}</span>
        </div>
    `;
    document.body.appendChild(overlay);
    pageTransitionOverlayEl = overlay;
    return overlay;
}

// App-launch splash overlay removed — this is now a native (Capacitor)
// app, so the transition from index.html finding a session to
// home.html actually rendering is covered by the real native splash
// screen (kept up across the navigation, hidden by home.html once
// it is ready), not a JS-drawn overlay. See index.html's auth-check
// script for the redirect itself.


// ── Sign out — works from ANY page ───────────────────────────
let signOutInProgress = false;

function signOut() {
    // Guard: multiple bound handlers (or a fast double-click) firing on
    // the same action should still only produce one overlay/redirect.
    if (signOutInProgress) return;
    signOutInProgress = true;

    clearSession();
    // Onboarding now shows on every fresh visit to index.html (see
    // onboarding.js) — except this one, since the person was just using
    // the app a second ago. Consumed once by onboarding.js and never
    // set again until the next sign-out.
    try { sessionStorage.setItem('lw_skip_onboarding_once', '1'); } catch {}

    // Branded transition before we leave
    showPageTransitionOverlay('Signing out…');

    // Figure out the correct path back to index.html from wherever we are
    const depth = window.location.pathname.split('/').filter(Boolean).length;
    const prefix = depth > 1 ? '../'.repeat(depth - 1) : './';

    // Immediate replace for native feel
    window.location.replace(prefix + 'index.html');
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
        // Pages that are meant to be reachable WITHOUT a session — signing
        // in/up is, by definition, done before one exists. Redirecting any
        // of these away just because there's no session yet would break
        // the flow that creates the session in the first place (this bit
        // us on verification.html: mid-OTP-entry, there's no session, so
        // an unscoped check would bounce the page back to index.html).
        const isPublicAuthPage =
            path.endsWith('/index.html') || path === '/' || path === '' ||
            path.endsWith('/verification.html') ||
            path.endsWith('/signup.html');
        if (isPublicAuthPage) {
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

// ── Wire all [data-action="signout"] buttons on the page ──────
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-action="signout"]').forEach(btn => {
        btn.addEventListener('click', e => { e.preventDefault(); signOut(); });
    });
});

// ── Back-forward cache (phone back-gesture, browser back button) ──
//    A bfcache restore does NOT re-run any <script> — the browser just
//    repaints the exact frozen DOM from the moment the page was left,
//    then fires 'pageshow' with persisted:true. That's why calling
//    requireAuth() up top (above) only fixes FRESH loads: it can't stop
//    a stale frame from painting on a restore, because none of this
//    file's top-level code executes again on restore.
//
//    That frozen snapshot isn't just "possibly stale" — it can be
//    genuinely incomplete. If the page was navigated away from before
//    profile.js finished its fetch (a very normal thing to do), bfcache
//    just freezes it mid-load: some sections still showing skeleton
//    placeholders, others already showing raw/unstyled content,
//    permanently, because nothing ever re-runs to finish the job on
//    restore. Hiding-then-revealing that snapshot (an earlier version
//    of this fix) still meant showing that broken half-loaded state
//    once revealed.
//
//    So instead: hide the page the instant it's about to be frozen
//    (pagehide), so there's nothing stale to flash on the way back —
//    and on restore, don't trust the snapshot at all. Just reload for
//    real, so profile.js and everything else runs fresh and complete,
//    same as any normal visit.
let lwBfcacheReloading = false;

window.addEventListener('pagehide', () => {
    document.documentElement.classList.add('lw-bfcache-hide');
});

window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
        if (lwBfcacheReloading) return;
        lwBfcacheReloading = true;
        window.location.reload();
    }
});