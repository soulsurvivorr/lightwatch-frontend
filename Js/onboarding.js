// =========================================================
// onboarding.js
// A one-time walkthrough shown the first time a user reaches the
// app. It advances slide-by-slide and closes after the final step.
// Once completed, it's stored in localStorage so it never shows
// again on this device.
//
// To reset it for testing: localStorage.removeItem('lw_onboarding_seen')
// =========================================================

const ONBOARDING_KEY = 'lw_onboarding_seen';
let onboardingCurrentSlide = 0;

function hasSeenOnboarding() {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === '1';
  } catch {
    return true; // if storage is unavailable, don't block the app on it
  }
}

function markOnboardingSeen() {
  try {
    localStorage.setItem(ONBOARDING_KEY, '1');
  } catch {
    /* ignore */
  }
}

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
  markOnboardingSeen();
  setTimeout(() => overlay.remove(), 250);
}

function openOnboarding() {
  const overlay = document.getElementById('onboardingOverlay');
  if (!overlay) return;
  setOnboardingSlide(0);
  requestAnimationFrame(() => overlay.classList.add('is-open'));
}

function initOnboarding() {
  const overlay = document.getElementById('onboardingOverlay');
  if (!overlay) return;

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