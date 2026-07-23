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

// Use var instead of const to prevent duplicate declaration errors
// Check if it's already defined before declaring
if (typeof HOME_REMINDER_SEEN_KEY === 'undefined') {
    var HOME_REMINDER_SEEN_KEY = 'lw_home_reminder_seen';
}

// Also export to window if needed
if (typeof window.HOME_REMINDER_SEEN_KEY === 'undefined') {
    window.HOME_REMINDER_SEEN_KEY = HOME_REMINDER_SEEN_KEY;
}

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

function shouldShowHomeReminder() {
  if (typeof getSession === 'function' && !getSession()) return false;

  try {
    return localStorage.getItem(HOME_REMINDER_SEEN_KEY) !== '1';
  } catch {
    // Storage blocked (e.g. private browsing) — fall back to showing
    // it; that's a much smaller annoyance than a hard error.
    return true;
  }
}

function markHomeReminderSeen() {
  try { localStorage.setItem(HOME_REMINDER_SEEN_KEY, '1'); } catch {}
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