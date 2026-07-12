// =========================================================
// onboarding.js
// Full-screen walkthrough shown on the first fresh visit to
// index.html only. It blocks interaction with the sign-in form
// until the final step is acknowledged, then never shows again
// on this device (localStorage-gated) — including when someone
// navigates to sign-up and comes straight back to sign-in.
// =========================================================

const ONBOARDING_SEEN_KEY = 'lw_onboarding_seen';

function hasSeenOnboarding() {
  try {
    return localStorage.getItem(ONBOARDING_SEEN_KEY) === '1';
  } catch {
    // Storage blocked (e.g. private browsing) — fall back to showing
    // it; that's a much smaller annoyance than a hard error.
    return false;
  }
}

function markOnboardingSeen() {
  try {
    localStorage.setItem(ONBOARDING_SEEN_KEY, '1');
  } catch {
    // Ignore — nothing we can do if storage is blocked.
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

function openOnboarding() {
  const overlay = document.getElementById('onboardingOverlay');
  if (!overlay) return;
  setOnboardingSlide(0);
  markOnboardingSeen();
  requestAnimationFrame(() => overlay.classList.add('is-open'));
}

function initOnboarding() {
  const overlay = document.getElementById('onboardingOverlay');
  if (!overlay) return;

  // Already completed on this device — nothing to wire up, nothing to
  // show. This is what makes it a true one-time walkthrough instead of
  // reappearing on every trip back to the sign-in page.
  if (hasSeenOnboarding()) {
    overlay.remove();
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
  // already gone by the time we get here.
  if (!document.body.classList.contains('app-loading')) {
    openOnboarding();
    return;
  }

  const observer = new MutationObserver(() => {
    if (!document.body.classList.contains('app-loading')) {
      observer.disconnect();
      openOnboarding();
    }
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  setTimeout(() => {
    observer.disconnect();
    openOnboarding();
  }, 1200);
}

document.addEventListener('DOMContentLoaded', initOnboarding);