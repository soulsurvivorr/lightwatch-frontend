// ============================================================
//  VIEWS/ONBOARDING.JS
//  Full-screen walkthrough shown once per browsing session to a
//  signed-out visitor landing on the login view.
//
//  SIMPLIFIED FOR THE SPA vs. the original onboarding.js:
//   - Dropped entirely: the "is a redirect to home.html already in
//     flight?" check (LAUNCH_PENDING_KEY / isSessionRedirectPending).
//     That existed because index.html's inline auth-check script
//     could find a session and kick off a redirect to home.html
//     WHILE onboarding.js was also independently deciding whether to
//     open the walkthrough on the very same document — a real race
//     between two scripts on two different documents. In the SPA,
//     the router (js/app.js) resolves session state BEFORE the
//     login view is ever shown; if a session exists, the router
//     sends the visitor straight to the home view and the login
//     view (and this file's init()) is simply never reached. There
//     is nothing left to race.
//   - Dropped entirely: revealAuthCheckBody() and all the native
//     splash-screen/`html.auth-check` choreography. That existed to
//     avoid a flash of unstyled/wrong content while a brand-new HTML
//     document was parsing. In the SPA the document has already
//     fully loaded (this code runs long after first paint, only
//     when the router first shows the login view) — there is no
//     blank document to hide.
//   - Kept: the once-per-session gate (SHOWN_THIS_SESSION_KEY), the
//     one-shot "just signed out, don't replay this" skip
//     (SKIP_ONBOARDING_ONCE_KEY), and the slide/dot navigation.
// ============================================================

(function () {
    let onboardingCurrentSlide = 0;
    let initialized = false;

    // Same fix as chat.js's card reparenting — guarantees this
    // fixed-position overlay can never be mispositioned by any
    // ancestor's transform/filter/contain, present or future.
    function ensureOverlayOnBody() {
        const overlay = document.getElementById('onboardingOverlay');
        if (overlay && overlay.parentElement !== document.body) {
            document.body.appendChild(overlay);
        }
    }

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
        setTimeout(() => { overlay.hidden = true; }, 100);
        window.dispatchEvent(new CustomEvent('lw-onboarding-closed'));
    }

    function openOnboarding() {
        const overlay = document.getElementById('onboardingOverlay');
        if (!overlay) return;
        setOnboardingSlide(0);
        overlay.hidden = false;
        // Force a reflow before adding .is-open so the entrance
        // transition actually plays instead of being skipped.
        void overlay.offsetWidth;
        overlay.classList.add('is-open');
    }

    function init() {
        if (initialized) return; // login view only needs this wired once
        initialized = true;

        ensureOverlayOnBody();

        const overlay = document.getElementById('onboardingOverlay');
        if (!overlay) return;

        if (consumeSkipOnboardingOnce()) return;
        if (hasShownOnboardingThisSession()) return;

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

        openOnboarding();
    }

    window.LWOnboarding = { init };
})();