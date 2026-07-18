// =========================================================
// onboarding.js
// Full-screen walkthrough shown once per BROWSING SESSION to a
// signed-out visitor landing on index.html (not just the first-ever
// visit ever, but also not on every single reload/back-navigation
// within the same session — see exception 3 below). It blocks
// interaction with the sign-in form until the final step is
// acknowledged.
//
// Three deliberate exceptions:
//  1. lw_launch_overlay_pending — set by index.html's own
//     auth-check script the instant it finds a valid session and
//     is about to redirect straight to home.html. If that's set,
//     a redirect is already in flight, so there's no point opening
//     onboarding underneath it (and doing so was the source of the
//     home-page transition flash — this overlay competing with the
//     launch overlay for a frame before the navigation actually
//     tears the page down).
//  2. lw_skip_onboarding_once — one-shot, consumed here. Set by
//     auth.js's signOut() right before it redirects here, so coming
//     back from "Sign out" on the account page doesn't immediately
//     re-run the walkthrough.
//  3. lw_onboarding_shown_session — NOT consumed; stays set for the
//     rest of the tab's session. auth.js forces a hard reload of
//     whichever page bfcache tries to restore (e.g. hitting Back
//     from signup.html), which was re-running this file from scratch
//     and reopening the walkthrough from slide 0 every time. This
//     flag remembers it already ran once this session so that reload
//     just reveals the login form instead.
// =========================================================

const SKIP_ONBOARDING_ONCE_KEY = 'lw_skip_onboarding_once';
const LAUNCH_PENDING_KEY = 'lw_launch_overlay_pending';
// Not consumed (removed) like SKIP_ONBOARDING_ONCE_KEY above — this one
// stays set for the rest of the tab's session once the walkthrough has
// been shown, so a back-navigation or forced bfcache reload back to
// index.html later in the SAME session doesn't reopen it from slide 0.
// A genuinely fresh visit (new tab/window, or the browser fully closed)
// gets a clean sessionStorage and shows it again, same as before.
const SHOWN_THIS_SESSION_KEY = 'lw_onboarding_shown_session';

function consumeSkipOnboardingOnce() {
  try {
    const skip = sessionStorage.getItem(SKIP_ONBOARDING_ONCE_KEY) === '1';
    sessionStorage.removeItem(SKIP_ONBOARDING_ONCE_KEY);
    return skip;
  } catch {
    return false;
  }
}

function hasShownOnboardingThisSession() {
  try {
    return sessionStorage.getItem(SHOWN_THIS_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

function markOnboardingShownThisSession() {
  try { sessionStorage.setItem(SHOWN_THIS_SESSION_KEY, '1'); } catch {}
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
  markOnboardingShownThisSession();
  overlay.classList.remove('is-open');
  setTimeout(() => overlay.remove(), 250);
  // Lets app-startup.js know it's now safe to run a service-worker
  // reload it may have been holding back while onboarding was open —
  // see isOnboardingBlocking() there.
  window.dispatchEvent(new CustomEvent('lw-onboarding-closed'));
}

// The login form/page underneath sits behind html.auth-check (hidden)
// until this runs — see index.html's inline auth-check script. Every
// exit path in initOnboarding() must call this exactly once, and must
// call it only AFTER it's safe (i.e. either the overlay is already
// fully opaque, or there's no overlay to hide behind at all).
function revealAuthCheckBody() {
  const doReveal = () => {
    // Delay the removal of 'auth-check' slightly. This ensures the
    // onboarding overlay has painted and is opaque before we reveal
    // the login form underneath, preventing the startup flash.
    //
    // The native splash hide used to fire independently of this, on its
    // own rAF timer — since two rAFs (~30ms) resolve well before this
    // 150ms timeout does, the splash was being hidden while 'auth-check'
    // was still on <html> (body still visibility:hidden), exposing a
    // bare unpainted frame for the ~120ms gap until this timeout caught
    // up. Nesting the splash hide inside this callback means it only
    // ever runs once the body has actually been revealed.
    setTimeout(() => {
      document.documentElement.classList.remove('auth-check');

      // Hide the native splash right here — the moment this page's real
      // content (onboarding card or login form) is actually about to be
      // shown — instead of leaving it to index.html's old blind 2.5s
      // timer, which was the only thing hiding the splash before. Two
      // rAFs guarantee the browser has painted this content at least
      // once first, so hiding the splash reveals real pixels instead of
      // a raw unpainted frame (that gap was the black flash between the
      // app logo and the onboarding overlay).
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.Capacitor?.Plugins?.SplashScreen?.hide();
        });
      });
    }, 150);
  };

  // Wait for the custom webfonts (Sora/Manrope) to finish loading before
  // revealing anything. On a fresh install nothing is cached yet, so the
  // Google Fonts round-trip can still be in flight when this would
  // otherwise fire — without this wait, the splash hides showing the
  // fallback system font, then the real font swaps in moments later,
  // visibly reflowing the onboarding card's first slide (the "shake"
  // some fresh installs saw). document.fonts.ready resolves as soon as
  // every @font-face on the page has settled (loaded or failed), so on
  // every later launch (fonts now HTTP-cached) it resolves almost
  // immediately and this adds no perceptible delay. Capped at 700ms so
  // a stalled connection can never hold the splash up indefinitely.
  if (document.fonts && document.fonts.ready) {
    let settled = false;
    const proceed = () => {
      if (settled) return;
      settled = true;
      doReveal();
    };
    document.fonts.ready.then(proceed).catch(proceed);
    setTimeout(proceed, 700);
  } else {
    doReveal();
  }
}

function openOnboardingInstant() {
  const overlay = document.getElementById('onboardingOverlay');
  if (!overlay) return;
  setOnboardingSlide(0);

  // Snap the dark backdrop to fully opaque with NO transition first.
  // Previously .is-open alone triggered a 0.22s opacity fade — the
  // native splash could start hiding while that fade was still
  // partway through, letting the sign-in form underneath show through
  // for a frame or two (the "index page flashes before onboarding"
  // bug). Forcing a reflow between adding/removing .is-instant commits
  // the "already opaque" state to the render tree before anything
  // else happens, so there is no fade window left for a flash to land
  // in.
  overlay.classList.add('is-instant');
  overlay.classList.add('is-open');
  void overlay.offsetWidth; // force reflow — commits the instant state
  overlay.classList.remove('is-instant');

  // The card itself still gets its normal slide-up + fade-in
  // transition (defined in onboarding.css) — that's the "smooth,
  // deliberate entrance" the walkthrough should have. It's just now
  // playing on top of a backdrop that's already guaranteed solid,
  // instead of racing the backdrop's own fade.

  // Now it's safe to reveal the underlying body / hide the native
  // splash — the overlay already fully covers whatever's underneath.
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

  // Already shown once this session — a back-navigation or forced
  // bfcache reload (auth.js) brought them back to index.html, not a
  // fresh visit. Don't restart the walkthrough from slide 0.
  if (hasShownOnboardingThisSession()) {
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