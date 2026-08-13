// ============================================================
//  VIEWS/HOME-REMINDER.JS
//  The "first time you land on Home" reminder modal. Not a
//  standalone route — it's a piece of the home view, so it exports
//  initHomeReminder() for views/home.js to call from its own
//  mount(), instead of registering its own DOMContentLoaded handler
//  (there's only one DOMContentLoaded firing for the whole app now).
// ============================================================

// Shown once per DEVICE, the first time home.html is ever reached —
// not once per app session. Backed by localStorage (survives closing
// the app/browser and signing out again), same pattern as
// ONBOARDING_SEEN_KEY in onboarding.js. It deliberately does NOT get
// cleared on sign-in/sign-out (see auth.js) — once a device has seen
// it, it's seen it for good.

// ------------------------------------------------------------
// FIX: This file used to declare `var HOME_REMINDER_SEEN_KEY` at the
// top level, guarded by `if (typeof HOME_REMINDER_SEEN_KEY ===
// 'undefined')`. That guard doesn't do what it looks like it does —
// `var` declarations are hoisted and registered in the global scope
// at PARSE time, regardless of whether the `if` around them ever
// runs. Since this same key is already declared with `let`/`const`
// elsewhere (constants.js, same pattern as ONBOARDING_SEEN_KEY),
// redeclaring it here with `var` is a SyntaxError the instant this
// script is parsed — "Identifier 'HOME_REMINDER_SEEN_KEY' has
// already been declared" — which meant NONE of this file's code ever
// ran, including the window.initHomeReminder export at the bottom.
//
// Fix: don't declare a global at all here. Wrap the whole file in an
// IIFE (like every other view module already does) and use a local
// const that just reads whatever's already on window, falling back
// to the literal only if nothing else has defined it yet.
// ------------------------------------------------------------
(function () {

if (typeof window.HOME_REMINDER_SEEN_KEY === 'undefined') {
    window.HOME_REMINDER_SEEN_KEY = 'lw_home_reminder_seen';
}
const HOME_REMINDER_SEEN_KEY = window.HOME_REMINDER_SEEN_KEY;

let homeReminderDismissed = false;
let homeReminderObserver = null;
let homeReminderFallbackTimer = null;

function clearPendingReminderOpen() {
  if (homeReminderObserver) {
    homeReminderObserver.disconnect();
    homeReminderObserver = null;
  }
  if (homeReminderFallbackTimer) {
    clearTimeout(homeReminderFallbackTimer);
    homeReminderFallbackTimer = null;
  }
}

function getHomeReminderOrigin() {
  try {
    const origin = sessionStorage.getItem('lw_signin_origin');
    return origin === 'login' || origin === 'signup' ? origin : null;
  } catch {
    return null;
  }
}

function shouldShowHomeReminder() {
  if (typeof getSession === 'function' && !getSession()) return false;

  if (!getHomeReminderOrigin()) return false;

  try {
    return sessionStorage.getItem(HOME_REMINDER_SEEN_KEY) !== '1';
  } catch {
    // Storage blocked (e.g. private browsing) — fall back to showing
    // it; that's a much smaller annoyance than a hard error.
    return true;
  }
}

function markHomeReminderSeen() {
  try {
    sessionStorage.setItem(HOME_REMINDER_SEEN_KEY, '1');
    localStorage.removeItem(HOME_REMINDER_SEEN_KEY);
    sessionStorage.removeItem('lw_signin_origin');
  } catch {}
}

function closeHomeReminder() {
  const overlay = document.getElementById('homeReminderOverlay');
  if (!overlay) return;
  homeReminderDismissed = true;
  clearPendingReminderOpen();
  document.body.classList.remove('modal-open');
  overlay.hidden = true;
  overlay.classList.remove('is-open');
}

function openHomeReminder() {
  const overlay = document.getElementById('homeReminderOverlay');
  if (!overlay || homeReminderDismissed) return;
  // Marked seen the moment it's actually shown — not on dismiss. If we
  // waited for dismiss, closing/reloading the app mid-modal (very easy
  // to do while testing, or just by habit) would mean it never gets
  // marked and shows again on every future open. Matches how
  // onboarding.js's openOnboarding() marks itself seen.
  markHomeReminderSeen();
  overlay.hidden = false;
  overlay.classList.add('is-open');
  document.body.classList.add('modal-open');
}

function isHomeStillLoading() {
  return document.body.classList.contains('app-loading') || document.body.classList.contains('page-data-loading');
}

function initHomeReminder() {
  const overlay = document.getElementById('homeReminderOverlay');
  if (!overlay) return;

  document.getElementById('homeReminderCloseBtn')?.addEventListener('click', closeHomeReminder);
  document.getElementById('homeReminderCloseX')?.addEventListener('click', closeHomeReminder);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.hidden) {
      closeHomeReminder();
    }
  });

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeHomeReminder();
  });

  if (!shouldShowHomeReminder()) return;

  const showReminder = () => {
    if (homeReminderDismissed) return;
    clearPendingReminderOpen();
    openHomeReminder();
  };

  if (!isHomeStillLoading()) {
    showReminder();
    return;
  }

  homeReminderObserver = new MutationObserver(() => {
    if (!isHomeStillLoading()) {
      clearPendingReminderOpen();
      showReminder();
    }
  });

  homeReminderObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  homeReminderFallbackTimer = setTimeout(() => {
    clearPendingReminderOpen();
    showReminder();
  }, 1600);
}

// Called explicitly from views/home.js mount() — this widget only
// exists within the home view, so it doesn't need its own
// DOMContentLoaded listener now that all views load up-front.

// Also export to window if needed
if (typeof window.initHomeReminder === 'undefined') {
    window.initHomeReminder = initHomeReminder;
}

})();