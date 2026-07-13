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
    'lw_skip_disclaimer_once'
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

// ── App "launch" overlay: same black full-bleed + logo as above, but
//    wordless, with the logo doing a soft entrance and — when
//    dismissed — an "opens wide" reveal (scales up and fades out over
//    the real page underneath), instead of the pulsing loop used
//    while waiting. Think of it as the app itself opening, X/Twitter-
//    style, rather than a generic loading state.
//
//    This is ONLY for one scenario: someone already registered and
//    already signed in on this device reopens the app after fully
//    closing it. It is NOT used for signing in, signing up, or
//    verification — those keep the ordinary showPageTransitionOverlay
//    text version. See initColdStartLaunchOverlay() below for the
//    actual trigger. ──
let appLaunchOverlayEl = null;

function showAppLaunchOverlay() {
    if (appLaunchOverlayEl) return appLaunchOverlayEl;

    const overlay = document.createElement('div');
    overlay.id = 'lwAppLaunchOverlay';
    overlay.setAttribute('aria-hidden', 'true');
    // No entrance animation on the backdrop itself — the canvas behind
    // it is already #1C1F26 (painted pre-script by the html.lw-cold-boot
    // rule in home.html's <head>), so fading this in just gave the real
    // page a translucent window to show through for no visual benefit.
    // Appearing instantly means there's genuinely nothing to "reflect"
    // through during mount.
    overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 100000;
        display: flex; align-items: center; justify-content: center;
        background: #1C1F26;
    `;
    overlay.innerHTML = `
        <style>
            /* Entrance: glow blooms open with the mark snapping in on a
               slight overshoot (back-out easing) instead of a plain
               fade — a quick, decisive "arrival" rather than a passive
               materialization. Same keyframe names/timings as the
               entrance already played briefly on index.html just
               before hand-off, so the two don't read as two different
               animations stitched together. */
            @keyframes lwLaunchGlowIn {
                0%   { opacity: 0;    transform: scale(0.5); }
                60%  { opacity: 0.45; transform: scale(1.08); }
                100% { opacity: 0.35; transform: scale(1); }
            }
            @keyframes lwLaunchMarkIn {
                0%   { transform: scale(0.7);  opacity: 0; }
                65%  { transform: scale(1.08); opacity: 1; }
                100% { transform: scale(1);    opacity: 1; }
            }
            /* Exit: two things happen on the same clock.
               1) The mark itself "flares" — a quick scale-up with a
                  fast fade, like a brief flash of light, rather than
                  just shrinking away.
               2) The overlay performs a hard-edged iris/spotlight
                  collapse via clip-path (never an opacity fade —
                  opacity would let the real page blend through
                  translucently for the whole exit, which is what read
                  as the home page "flashing"/"reflecting" through the
                  logo before). Every pixel is either overlay or page,
                  nothing in between.
               Together: a bright pulse at the mark's position, then
               the page opens up around it — the same general shape as
               a classic "logo flashes, app opens" reveal, without
               copying the specific bird/shape/colors of any existing
               app's mark. */
            #lwAppLaunchOverlay {
                clip-path: circle(150% at 50% 50%);
            }
            #lwAppLaunchOverlay.is-opening {
                clip-path: circle(0% at 50% 50%);
                transition: clip-path 0.48s cubic-bezier(.19,1,.22,1);
            }
            @keyframes lwLaunchMarkFlare {
                0%   { transform: scale(1);    opacity: 1; }
                35%  { transform: scale(1.22); opacity: 1; }
                100% { transform: scale(1.4);  opacity: 0; }
            }
            @keyframes lwLaunchGlowBurst {
                0%   { opacity: 0.35; transform: scale(1); }
                35%  { opacity: 0.7;  transform: scale(1.5); }
                100% { opacity: 0;    transform: scale(2.1); }
            }
            #lwAppLaunchOverlay .lw-launch-glow {
                position: absolute;
                inset: 0;
                margin: auto;
                width: 160px; height: 160px;
                border-radius: 50%;
                background: radial-gradient(circle, rgba(240,172,61,0.4), rgba(74,144,217,0.2) 55%, transparent 75%);
                filter: blur(8px);
                animation: lwLaunchGlowIn 0.6s cubic-bezier(.16,.84,.44,1) both;
            }
            #lwAppLaunchOverlay .lw-launch-mark {
                position: relative;
                width: 76px; height: 76px; border-radius: 20px;
                animation: lwLaunchMarkIn 0.5s cubic-bezier(.34,1.56,.64,1) both;
            }
            #lwAppLaunchOverlay.is-opening .lw-launch-glow {
                animation: lwLaunchGlowBurst 0.28s ease-out forwards;
            }
            #lwAppLaunchOverlay.is-opening .lw-launch-mark {
                animation: lwLaunchMarkFlare 0.28s ease-out forwards;
            }
        </style>
        <div class="lw-launch-glow" aria-hidden="true"></div>
        <img class="lw-launch-mark" src="/images/dev-logo.png" alt="LightWatch">
    `;
    document.body.appendChild(overlay);
    appLaunchOverlayEl = overlay;
    return overlay;
}

// Plays the reveal, then removes the overlay. Duration here must match
// the .is-opening clip-path transition above (0.48s) — it's the same
// clock, just read from JS so we know when it's safe to remove the
// element from the DOM.
function dismissAppLaunchOverlay() {
    if (!appLaunchOverlayEl) return;
    const el = appLaunchOverlayEl;
    appLaunchOverlayEl = null;
    el.classList.add('is-opening');
    document.documentElement.classList.remove('lw-cold-boot');
    // Let the real content settle into place a beat behind the
    // overlay opening, instead of just sitting there already fully
    // formed the instant the overlay clears (see .lw-content-reveal
    // in home.html's <head>).
    const realContent = document.getElementById('realPageContent');
    realContent?.classList.add('lw-content-reveal');
    // lwContentReveal's fill-mode is `both`, so its final keyframe
    // (transform: scale(1)) stays applied to #realPageContent forever
    // if we never remove the class — and ANY non-`none` transform on
    // an ancestor creates a new containing block for position:fixed
    // descendants. .chat-card (the mobile chat popup) lives inside
    // #realPageContent, so a stuck transform here silently detaches
    // its "fixed" positioning from the viewport and re-anchors it to
    // #realPageContent's (much taller, scrollable) box instead — the
    // popup opens off-screen while the scroll-lock still applies,
    // which reads as "chat opens (locks the page) but never appears".
    // Strip the class once the animation finishes; the end state
    // (opacity 1, scale 1) is visually identical to no class at all,
    // so this causes zero visible change but removes the transform.
    if (realContent) {
        realContent.addEventListener('animationend', () => {
            realContent.classList.remove('lw-content-reveal');
        }, { once: true });
        // Fallback in case animationend doesn't fire (e.g. tab was
        // backgrounded mid-animation) — matches the animation's own
        // 0.5s duration plus a small buffer.
        setTimeout(() => realContent.classList.remove('lw-content-reveal'), 600);
    }
    // Must match the #lwAppLaunchOverlay.is-opening clip-path
    // transition duration above (0.48s) — same clock, just read from
    // JS so we know when it's safe to remove the element from the DOM.
    setTimeout(() => el.remove(), 480);
}

// Kept as its own name for readability at sign-out call sites; it's
// just the shared overlay with sign-out's copy. (Sign-out does NOT use
// the wordless launch overlay below — that one is reserved for the
// cold-start-with-existing-session case only.)
function showSignOutOverlay() {
    return showPageTransitionOverlay('Signing out…');
}

// ── Hand-off for the "opens wide" reveal across a real page
//    navigation. A page load and the page it redirects to are two
//    separate documents/JS contexts, so the overlay can't just
//    animate straight through one continuous script — instead,
//    whoever shows it right before redirecting to home.html marks the
//    hand-off with markAppLaunchPending(). home.html then shows the
//    overlay itself the instant auth.js runs there (before its
//    skeleton can flash), and dismisses it with the opening animation
//    once the real page content is ready. ──
const LAUNCH_OVERLAY_PENDING_KEY = 'lw_launch_overlay_pending';

function markAppLaunchPending() {
    try { sessionStorage.setItem(LAUNCH_OVERLAY_PENDING_KEY, '1'); } catch {}
}

function consumeAppLaunchPending() {
    try {
        const pending = sessionStorage.getItem(LAUNCH_OVERLAY_PENDING_KEY) === '1';
        sessionStorage.removeItem(LAUNCH_OVERLAY_PENDING_KEY);
        return pending;
    } catch {
        return false;
    }
}

// ── The actual trigger for the wordless splash lives in index.html
//    itself, not here. index.html has its own inline auth-check
//    script (in <head>, before this file even loads) that already
//    redirects straight to home.html when a session exists — that's
//    the correct place to show the overlay, since by the time this
//    file's <script src> at the bottom of index.html's body would run,
//    that earlier redirect has usually already fired. See index.html
//    for the overlay markup + trigger. ──

// On home.html itself: if a launch was just requested, show the
// overlay immediately (before the skeleton can flash) and dismiss it
// with the opening animation once the real page content is ready.
(function initAppLaunchOverlayOnHome() {
    if (!/\/home\.html$/i.test(window.location.pathname)) return;
    if (!consumeAppLaunchPending()) return;

    showAppLaunchOverlay();

    let released = false;
    let fallback;
    const release = () => {
        if (released) return;
        released = true;
        clearTimeout(fallback);
        observer.disconnect();
        dismissAppLaunchOverlay();
    };

    const isStillLoading = () =>
        document.body.classList.contains('app-loading') ||
        document.body.classList.contains('page-data-loading');

    // Primary signal: the event the page-ready flow already dispatches
    // once real content replaces the skeleton (see home.js).
    window.addEventListener('lw-page-revealed', release, { once: true });

    // Backup signal: same class-removal check home-reminder.js already
    // relies on, in case the event above isn't dispatched in every path.
    const observer = new MutationObserver(() => {
        if (!isStillLoading()) release();
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    // Covers the (unlikely but possible) case where loading already
    // finished before this script even ran — a MutationObserver only
    // fires on FUTURE changes, so without this check we'd sit waiting
    // on a mutation that already happened, and only recover via the
    // fallback below — i.e. the splash would hang around for seconds
    // after the real page was already sitting there ready underneath.
    if (!isStillLoading()) {
        release();
    } else {
        // Genuine last resort only — kept long on purpose so a slower
        // connection never gets its skeleton exposed by an overlay
        // that dismissed too early. Real loads should always finish
        // via one of the two signals above well before this fires.
        fallback = setTimeout(release, 7000);
    }
})();

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