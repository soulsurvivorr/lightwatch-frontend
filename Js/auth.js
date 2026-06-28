// ============================================================
//  AUTH.JS — Load this on EVERY page (home, chat, etc.)
//  Handles: session read/write, sign-out, auto-sign-in guard
// ============================================================

const AUTH_KEY     = 'app_auth_token';
const USER_KEY     = 'app_user';
const REMEMBER_KEY = 'app_remember';

// ── Read session from whichever storage was used ─────────────
function getSession() {

    // First check remembered login
    const remembered =
        localStorage.getItem(REMEMBER_KEY) === 'true';

    let token;
    let userRaw;

    if (remembered) {
        token = localStorage.getItem(AUTH_KEY);
        userRaw = localStorage.getItem(USER_KEY);
    } else {
        token = sessionStorage.getItem(AUTH_KEY);
        userRaw = sessionStorage.getItem(USER_KEY);
    }

    // Fallback protection
    if (!token || !userRaw) {

        // Maybe sessionStorage was cleared but localStorage still exists
        const backupToken = localStorage.getItem(AUTH_KEY);
        const backupUser = localStorage.getItem(USER_KEY);

        if (backupToken && backupUser) {
            try {
                return {
                    token: backupToken,
                    user: JSON.parse(backupUser),
                    remembered: true
                };
            } catch {
                clearSession();
                return null;
            }
        }

        return null;
    }

    try {
        return {
            token,
            user: JSON.parse(userRaw),
            remembered
        };
    }
    catch {

        clearSession();
        return null;
    }
}
// ── Save session after successful verification ────────────────
function saveSession(user, token, rememberMe) {
    if (rememberMe) {
        localStorage.setItem(AUTH_KEY,     token);
        localStorage.setItem(USER_KEY,     JSON.stringify(user));
        localStorage.setItem(REMEMBER_KEY, 'true');
    } else {
        sessionStorage.setItem(AUTH_KEY, token);
        sessionStorage.setItem(USER_KEY, JSON.stringify(user));
        localStorage.removeItem(REMEMBER_KEY);
    }
}

// ── Wipe everything cleanly ───────────────────────────────────
function clearSession() {
    [AUTH_KEY, USER_KEY, REMEMBER_KEY,
     'currentUserId', 'currentUserData', 'chatHandle',
     'maskedContact', 'signupUser', 'userIdentifier',
     'pendingUserId', 'rememberMePending'
    ].forEach(k => {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
    });
}

// ── Sign out — works from ANY page ───────────────────────────
function signOut() {
    clearSession();

    // Figure out the correct path back to index.html from wherever we are
    // Works whether you're at /pages/home.html or /index.html
    const depth = window.location.pathname.split('/').filter(Boolean).length;
    const prefix = depth > 1 ? '../'.repeat(depth - 1) : './';
    window.location.replace(prefix + 'index.html');
}

// ── Guard: redirect to login if no session ────────────────────
//  Call this at the top of any protected page
function requireAuth() {
    if (!getSession()) {
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