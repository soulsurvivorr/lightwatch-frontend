const HOME_REMINDER_SEEN_KEY = 'lw_home_reminder_seen';
const HOME_REMINDER_SKIP_ONCE_KEY = 'lw_skip_disclaimer_once';

function shouldShowHomeReminder() {
  if (typeof getSession === 'function' && !getSession()) return false;

  const skipOnce = sessionStorage.getItem(HOME_REMINDER_SKIP_ONCE_KEY) === '1';
  if (skipOnce) {
    sessionStorage.removeItem(HOME_REMINDER_SKIP_ONCE_KEY);
    return false;
  }

  return sessionStorage.getItem(HOME_REMINDER_SEEN_KEY) !== '1';
}

function closeHomeReminder() {
  const overlay = document.getElementById('homeReminderOverlay');
  if (!overlay) return;
  overlay.hidden = true;
  sessionStorage.setItem(HOME_REMINDER_SEEN_KEY, '1');
}

function openHomeReminder() {
  const overlay = document.getElementById('homeReminderOverlay');
  if (!overlay) return;
  overlay.hidden = false;
}

function initHomeReminder() {
  const overlay = document.getElementById('homeReminderOverlay');
  if (!overlay) return;

  document.getElementById('homeReminderCloseBtn')?.addEventListener('click', closeHomeReminder);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeHomeReminder();
  });

  if (!shouldShowHomeReminder()) return;

  const showReminder = () => openHomeReminder();

  if (!document.body.classList.contains('app-loading')) {
    showReminder();
    return;
  }

  const observer = new MutationObserver(() => {
    if (!document.body.classList.contains('app-loading')) {
      observer.disconnect();
      showReminder();
    }
  });

  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  setTimeout(() => {
    observer.disconnect();
    showReminder();
  }, 1600);
}

document.addEventListener('DOMContentLoaded', initHomeReminder);