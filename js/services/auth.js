// ============================================================
//  SERVICES/AUTH.JS
//  Session read/write/sign-out. Classic (non-module) script, loaded
//  early — every view file still calls getSession()/saveSession()/
//  clearSession()/signOut()/showPageTransitionOverlay() as bare
//  globals, exactly like the original multi-page app.
//
//  Changed vs. the original auth.js:
//   - requireAuth() no longer redirects by itself — the router
//     (js/app.js) is the single place that decides whether a view
//     is reachable and where to send someone instead. requireAuth()
//     is kept as a read-only helper (`getSession() != null`) for any
//     view code that still wants a quick boolean check.
//   - signOut() now asks the router to navigate to the login view
//     instead of doing window.location.replace('index.html') — there
//     is only one document now, so "going to index.html" means
//     "show the login view".
//   - The bfcache pagehide/pageshow reload workaround is gone. That
//     existed because every navigation used to tear down and reload
//     a real separate HTML document, so the browser's back/forward
//     cache could restore a stale, half-loaded page. In the SPA
//     there is only ever one document — nothing is ever torn down
//     between views — so that failure mode no longer exists.
// ============================================================

// ── Read session from whichever storage was used ─────────────
function getSession() {
    const remembered = localStorage.getItem(REMEMBER_KEY) === 'true';
    const token   = remembered ? localStorage.getItem(AUTH_KEY)  : sessionStorage.getItem(AUTH_KEY);
    const userRaw = remembered ? localStorage.getItem(USER_KEY)  : sessionStorage.getItem(USER_KEY);
    if (token && userRaw) {
        try { return { token, user: JSON.parse(userRaw), remembered }; }
        catch { return null; }
    }

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

    // Views that already mounted for a previous session (the SPA never
    // reloads the document between sign-outs/sign-ins) need to know a
    // (possibly different) user just signed in, so they can re-fetch
    // instead of continuing to show stale data from whoever was signed
    // in before. See account.js/profile.js listeners.
    window.dispatchEvent(new CustomEvent('lw-session-changed', { detail: { userId: user.id } }));
}

// ── Wipe everything cleanly ───────────────────────────────────
function clearSession() {
    [AUTH_KEY, USER_KEY, REMEMBER_KEY,
     TEMP_AUTH_KEY, TEMP_USER_KEY, TEMP_EXPIRES_KEY,
     'currentUserId', 'currentUserData', 'chatHandle',
     'maskedContact', 'signupUser', 'userIdentifier',
     'pendingUserId', 'rememberMePending',
     'lw_skip_disclaimer_once',
     'lw_launch_overlay_pending'
    ].forEach(k => {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
    });
}

// ── Branded transition overlay ─────────────────────────────────
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
            <img class="lw-mark" src="./images/dev-logo.png" alt="LightWatch">
            <span class="lw-text">${message}</span>
        </div>
    `;
    document.body.appendChild(overlay);
    pageTransitionOverlayEl = overlay;
    return overlay;
}

function hidePageTransitionOverlay() {
    if (pageTransitionOverlayEl) {
        pageTransitionOverlayEl.remove();
        pageTransitionOverlayEl = null;
    }
}

// ── Sign out — callable from any view ─────────────────────────
let signOutInProgress = false;

function signOut() {
    if (signOutInProgress) return;
    signOutInProgress = true;

    clearSession();
    try { sessionStorage.setItem(SKIP_ONBOARDING_ONCE_KEY, '1'); } catch {}

    showPageTransitionOverlay('Signing out…');

    setTimeout(() => {
        hidePageTransitionOverlay();
        signOutInProgress = false;
        window.LWRouter.navigate('login', { replace: true });
    }, 350);
}

// ── Read-only helper: is there a session right now? ───────────
// The router is what actually enforces access — this never
// redirects on its own anymore.
function requireAuth() {
    return Boolean(getSession());
}

// ── Wire any [data-action="signout"] buttons currently in the DOM.
//    Called by the router after each view mount, since views are
//    swapped in/out rather than the whole document reloading.
function bindSignOutButtons(root = document) {
    root.querySelectorAll('[data-action="signout"]').forEach(btn => {
        if (btn.dataset.signoutBound === '1') return;
        btn.dataset.signoutBound = '1';
        btn.addEventListener('click', e => { e.preventDefault(); signOut(); });
    });
}
