// =========================================================
// onboarding.js
// Full-screen walkthrough shown EVERY time a signed-out visitor
// lands on index.html (not just the first-ever visit). It blocks
// interaction with the sign-in form until the final step is
// acknowledged.
//
// Two deliberate exceptions, both one-shot flags consumed here:
//  1. lw_launch_overlay_pending — set by index.html's own
//     auth-check script the instant it finds a valid session and
//     is about to redirect straight to home.html. If that's set,
//     a redirect is already in flight, so there's no point opening
//     onboarding underneath it (and doing so was the source of the
//     home-page transition flash — this overlay competing with the
//     launch overlay for a frame before the navigation actually
//     tears the page down).
//  2. lw_skip_onboarding_once — set by auth.js's signOut() right
//     before it redirects here, so coming back from "Sign out" on
//     the account page doesn't immediately re-run the walkthrough.
// =========================================================

const SKIP_ONBOARDING_ONCE_KEY = 'lw_skip_onboarding_once';
const LAUNCH_PENDING_KEY = 'lw_launch_overlay_pending';

function consumeSkipOnboardingOnce() {
  try {
    const skip = sessionStorage.getItem(SKIP_ONBOARDING_ONCE_KEY) === '1';
    sessionStorage.removeItem(SKIP_ONBOARDING_ONCE_KEY);
    return skip;
  } catch {
    return false;
  }
}

function isSessionRedirectPending() {
  try {
    // Deliberately NOT consumed here — home.html's own launch-overlay
    // code (auth.js) is what consumes this key. We only need to peek
    // at it to know whether to bother opening onboarding at all.
    return sessionStorage.getItem(LAUNCH_PENDING_KEY) === '1';
  } catch {
    return false;
  }
}

let onboardingCurrentSlide = 0;

function setOnboardingSlide(index) {
  const slides = document.querySelectorAll('.onboarding-slide');
  const dots = document.querySelectorAll('.onboarding-dots__dot');
  const nextBtn = document.getElementById('onboardingNextBtn');
  if (!slides.length) return;

  onboardingCurrentSlide = Math.max(0, Math.min(index, slides.length - 1));

  slides.forEach((slide, i) => slide.classList.toggle('is-active', i === onboardingCurrentSlide));
  dots.forEach((dot, i) => dot.classList.toggle('is-active', i === onboardingCurrentSlide));

  if (nextBtn) {
    nextBtn.textContent = onboardingCurrentSlide === slides.length - 1 ? "Let's go" : 'Next';
  }
}

function closeOnboarding() {
  const overlay = document.getElementById('onboardingOverlay');
  if (!overlay) return;
  overlay.classList.remove('is-open');
  setTimeout(() => overlay.remove(), 250);
}

// The login form/page underneath sits behind html.auth-check (hidden)
// until this runs — see index.html's inline auth-check script. Every
// exit path in initOnboarding() must call this exactly once, and must
// call it only AFTER it's safe (i.e. either the overlay is already
// fully opaque, or there's no overlay to hide behind at all).
function revealAuthCheckBody() {
  document.documentElement.classList.remove('auth-check');
}

function openOnboardingInstant() {
  const overlay = document.getElementById('onboardingOverlay');
  if (!overlay) return;
  setOnboardingSlide(0);
  // No backdrop fade-in on this first mount — the login page underneath
  // is still hidden (auth-check) at the moment this runs, so a 220ms
  // opacity transition would just let it "reflect" through for that
  // whole window instead of removing the flash. Snap straight to fully
  // opaque, THEN reveal the page underneath, so there's genuinely
  // nothing to peek through at any point. Same reasoning as auth.js's
  // showAppLaunchOverlay(). The card's own entrance animation (text
  // fade/slide) is untouched — only the overlay backdrop's transition
  // is disabled, and only for this one mount.
  overlay.style.transition = 'none';
  overlay.classList.add('is-open');
  void overlay.offsetHeight; // force the instant state to actually paint
  overlay.style.transition = '';
  revealAuthCheckBody();
}

function initOnboarding() {
  const overlay = document.getElementById('onboardingOverlay');
  if (!overlay) {
    revealAuthCheckBody();
    return;
  }

  // A valid session was just found — this device is about to be
  // redirected straight to home.html. Don't open onboarding underneath
  // that hand-off; just drop the overlay from the DOM. Body stays
  // hidden (not revealed) since a navigation is already in flight —
  // nothing should paint here at all before that redirect lands.
  if (isSessionRedirectPending()) {
    overlay.remove();
    return;
  }

  // Coming straight from tapping "Sign out" — skip the walkthrough this
  // one time only. The next fresh visit to index.html shows it again.
  // No overlay will cover the login form, so reveal it now.
  if (consumeSkipOnboardingOnce()) {
    overlay.remove();
    revealAuthCheckBody();
    return;
  }

  document.getElementById('onboardingNextBtn')?.addEventListener('click', () => {
    const totalSlides = document.querySelectorAll('.onboarding-slide').length;
    if (onboardingCurrentSlide >= totalSlides - 1) {
      closeOnboarding();
    } else {
      setOnboardingSlide(onboardingCurrentSlide + 1);
    }
  });

  document.querySelectorAll('.onboarding-dots__dot').forEach((dot, i) => {
    dot.addEventListener('click', () => setOnboardingSlide(i));
  });

  // Don't show the walkthrough on top of the boot loader — wait until
  // it clears (body loses .app-loading), same signal home.js waits on.
  // A short fallback timeout covers the case where that class is
  // already gone by the time we get here. In practice index.html's
  // <body> never carries .app-loading, so this resolves immediately —
  // kept as a guard in case that ever changes.
  if (!document.body.classList.contains('app-loading')) {
    openOnboardingInstant();
    return;
  }

  const observer = new MutationObserver(() => {
    if (!document.body.classList.contains('app-loading')) {
      observer.disconnect();
      openOnboardingInstant();
    }
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  setTimeout(() => {
    observer.disconnect();
    openOnboardingInstant();
  }, 1200);
}

document.addEventListener('DOMContentLoaded', initOnboarding);