const HOME_REMINDER_SEEN_KEY = 'lw_home_reminder_seen';
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

  return sessionStorage.getItem(HOME_REMINDER_SEEN_KEY) !== '1';
}

function closeHomeReminder() {
  const overlay = document.getElementById('homeReminderOverlay');
  if (!overlay) return;
  homeReminderDismissed = true;
  clearPendingReminderOpen();
  document.body.classList.remove('modal-open');
  overlay.hidden = true;
  overlay.classList.remove('is-open');
  sessionStorage.setItem(HOME_REMINDER_SEEN_KEY, '1');
}

function openHomeReminder() {
  const overlay = document.getElementById('homeReminderOverlay');
  if (!overlay || homeReminderDismissed) return;
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

document.addEventListener('DOMContentLoaded', initHomeReminder);