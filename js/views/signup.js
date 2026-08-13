// ============================================================
//  VIEWS/SIGNUP.JS
//  Sends data to backend to START signup. User is NOT saved to
//  users.json until they pass the verification view.
//
//  Wrapped into mount()/show()/hide() for the router: all the DOM
//  queries and event binding that used to run at module-load time
//  now run once, from mount(), the first time someone actually
//  reaches this view. isValidEmail/isValidPhone now come from
//  utils/validators.js instead of being redeclared here.
//
//  Navigation change: on successful signup, this now calls
//  window.LWRouter.navigate('verification') instead of
//  window.location.replace('../pages/verification.html').
//
//  Everything that used to be an inline <script> at the bottom of
//  the #view-signup markup (name title-casing, the "use my
//  location" flow, and the back-button/login-link nav) now lives
//  here in mount(), alongside the rest of this view's JS.
// ============================================================

(function () {
    let nameInput, emailPhoneInput, regionInput, cityInput,
        notifyUpdatesInput, form, errorEl, submitBtn;
    let isMounted = false;
    let locationPicker = null; // set in bindLocationPicker() — .getCoords() feeds handleSignup()

    const EMOJI_RE = /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;

    function isNativeApp() {
        return Boolean(
            window.Capacitor &&
            typeof window.Capacitor.isNativePlatform === 'function' &&
            window.Capacitor.isNativePlatform()
        );
    }

    // Capacitor-wrapped app OR a homescreen-installed PWA (iOS "Add to
    // Home Screen", or any browser's own standalone install) — both run
    // with no browser chrome, so both need the same keyboard-aware
    // handling. isNativeApp() alone used to gate this, which is why it
    // never ran for anyone using the installed PWA rather than the native
    // shell: a regular in-tab browser gets native scroll-into-view
    // behavior, but a standalone PWA doesn't reliably get the same
    // treatment on iOS, and used to fall through with nothing at all.
    function isStandaloneOrNative() {
        if (isNativeApp()) return true;
        if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
        if (window.navigator.standalone) return true; // legacy iOS Safari flag
        return false;
    }

    // ---- Keyboard-aware viewport height, for the full-bleed backgrounds.
    // 100dvh alone doesn't reliably shrink with the on-screen keyboard in
    // iOS standalone display mode, which is what left the edge-to-edge
    // background (.lw-ambient, #authShell) with a gap/cut at the bottom
    // the instant any input was focused — the full-bleed elements stayed
    // sized to the old, pre-keyboard height. visualViewport.height does
    // track the real, keyboard-aware visible height, so this pipes it
    // into a CSS var those elements read instead. Runs everywhere (not
    // just standalone) since it's a no-op improvement in a normal tab. ----
    function bindViewportHeightSync() {
        if (!window.visualViewport) return;
        const root = document.documentElement;
        const sync = () => {
            root.style.setProperty('--lw-viewport-height', `${window.visualViewport.height}px`);
        };
        sync();
        window.visualViewport.addEventListener('resize', sync);
        window.visualViewport.addEventListener('scroll', sync);
    }

    function prefillFromPriorAttempt() {
        try {
            const saved = JSON.parse(localStorage.getItem('signupUser') || 'null');
            if (!saved) return;
            if (saved.name) nameInput.value = saved.name;
            if (saved.emailPhone) emailPhoneInput.value = saved.emailPhone;
            if (saved.region) regionInput.value = saved.region;
            if (saved.city) cityInput.value = saved.city;
            if (notifyUpdatesInput && typeof saved.wantsAlerts === 'boolean') {
                notifyUpdatesInput.checked = saved.wantsAlerts;
            }
        } catch {
            // Ignore malformed/missing data — form just starts blank.
        }
    }

    function setLoading(isLoading) {
        if (!submitBtn) return;
        submitBtn.classList.toggle('is-loading', isLoading);
        submitBtn.disabled = isLoading;
    }

    async function requestPushIfWanted() {
        if (notifyUpdatesInput?.checked && typeof window.enableLightWatchPush === 'function') {
            try {
                await window.enableLightWatchPush();
            } catch (err) {
                console.error('Push opt-in failed (continuing signup):', err);
            }
        }
    }

    async function handleSignup() {
        const coords = locationPicker?.getCoords();
        const userData = {
            name: nameInput.value.trim(),
            emailPhone: emailPhoneInput.value.trim(),
            region: regionInput.value,
            city: cityInput.value.trim(),
            wantsAlerts: Boolean(notifyUpdatesInput?.checked)
        };
        if (coords) {
            userData.lat = coords.lat;
            userData.lng = coords.lng;
        }

        errorEl.textContent = "";

        if (!userData.name || !userData.emailPhone || !userData.region || !userData.city) {
            return;
        }

        const validEmail = isValidEmail(userData.emailPhone);
        const validPhone = isValidPhone(userData.emailPhone);

        if (!validEmail && !validPhone) {
            errorEl.textContent = "Enter a valid email or phone number";
            return;
        }

        await requestPushIfWanted();

        setLoading(true);

        try {
            const response = await fetchWithBackendTimeout(`${API_URL}/signup`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(userData)
            });

            const result = await response.json();

            if (!response.ok) {
                errorEl.textContent = result.error || "Something went wrong";
                setLoading(false);
                return;
            }

            localStorage.setItem("userIdentifier", result.emailPhone);
            localStorage.setItem("maskedContact", result.maskedContact);
            localStorage.setItem("signupUser", JSON.stringify(userData));
            localStorage.setItem("rememberMePending", "true");
            sessionStorage.setItem('lw_signin_origin', 'signup');

            showPageTransitionOverlay('Setting up verification…');
            setTimeout(() => {
                hidePageTransitionOverlay();
                window.LWRouter.navigate('verification');
            }, 260);

        } catch (error) {
            console.error("Signup failed:", error);
            errorEl.textContent = getBackendErrorMessage(error);
            setLoading(false);
        }
    }

    // ---- Full Name: auto Title Case + block emoji input ----
    function bindNameFormatting() {
        if (!nameInput) return;

        function toTitleCase(str) {
            return str.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
        }

        nameInput.addEventListener('input', () => {
            const start = nameInput.selectionStart;
            const before = nameInput.value;
            const stripped = before.replace(EMOJI_RE, '');
            const removedBeforeCaret = before.slice(0, start).replace(EMOJI_RE, '').length;
            nameInput.value = toTitleCase(stripped);
            try { nameInput.setSelectionRange(removedBeforeCaret, removedBeforeCaret); } catch {}
        });
    }

    // ---- City / Town: search-as-you-type + "use my location", both via
    // the shared picker (js/utils/location-picker.js) so this behaves
    // identically to the account page's city editor. ----
    function bindLocationPicker() {
        const locateBtn = document.getElementById('useLocationBtn');
        const hint = document.getElementById('cityLocationHint');
        const resultsEl = document.getElementById('citySearchResults');
        if (!cityInput) return;

        locationPicker = window.LWLocationPicker?.attach({
            input: cityInput,
            resultsEl,
            locateBtn,
            hintEl: hint,
            getRegion: () => regionInput?.value || ''
        }) || null;
    }

    // ---- One-time coachmark: shortly after landing on signup, point
    // at the locate button and walk through region -> city -> picking
    // the right match. Shown once per session — sessionStorage, not
    // localStorage, so closing the browser (or fully closing/reopening
    // the PWA/app) resets it and the hint shows again next time,
    // instead of being gone for good after the first ever visit.
    const LOCATE_COACH_SEEN_KEY = 'lw_seen_locate_coach';

    function bindLocationCoachmark() {
        const locateBtn = document.getElementById('useLocationBtn');
        if (!cityInput || !locateBtn) return;

        let seen = false;
        try { seen = sessionStorage.getItem(LOCATE_COACH_SEEN_KEY) === '1'; } catch {}
        if (seen) return;

        let coachEl = null;
        let showTimer = null;
        let dismissed = false;

        function reposition() {
            if (!coachEl) return;
            const btnRect = locateBtn.getBoundingClientRect();
            const coachRect = coachEl.getBoundingClientRect();
            const margin = 10;

            const spaceBelow = window.innerHeight - btnRect.bottom;
            const placeBelow = spaceBelow > coachRect.height + 24;

            coachEl.classList.toggle('signup-coach--below', placeBelow);
            coachEl.classList.toggle('signup-coach--above', !placeBelow);

            let left = btnRect.right - coachRect.width;
            left = Math.min(Math.max(left, margin), window.innerWidth - coachRect.width - margin);
            const top = placeBelow ? btnRect.bottom + 12 : btnRect.top - coachRect.height - 12;

            coachEl.style.left = `${left}px`;
            coachEl.style.top = `${Math.max(top, margin)}px`;

            // Point the arrow at the button's true center, not the
            // bubble's edge, so it still lines up when the bubble had
            // to shift to stay on-screen.
            const arrow = coachEl.querySelector('.signup-coach__arrow');
            if (arrow) {
                const arrowLeft = Math.min(
                    Math.max(btnRect.left + btnRect.width / 2 - left - 6, 14),
                    coachRect.width - 26
                );
                arrow.style.left = `${arrowLeft}px`;
            }
        }

        function dismiss() {
            if (dismissed) return;
            dismissed = true;
            clearTimeout(showTimer);
            try { sessionStorage.setItem(LOCATE_COACH_SEEN_KEY, '1'); } catch {}
            locateBtn.classList.remove('locate-btn--coach-pulse');
            document.removeEventListener('pointerdown', onOutsidePointer, true);
            window.removeEventListener('resize', reposition);
            if (coachEl) {
                coachEl.classList.remove('is-visible');
                const el = coachEl;
                setTimeout(() => el.remove(), 260);
                coachEl = null;
            }
        }

        function onOutsidePointer(e) {
            if (coachEl && (coachEl.contains(e.target) || locateBtn.contains(e.target))) return;
            dismiss();
        }

        function show() {
            if (dismissed || document.getElementById('view-signup')?.hidden) return;

            coachEl = document.createElement('div');
            coachEl.className = 'signup-coach';
            coachEl.innerHTML = `
                <p class="signup-coach__text">Pick your <strong>region</strong> first, then start typing your <strong>city/town</strong> — choose the matching suggestion from the list and double-check the spelling.</p>
                <button type="button" class="signup-coach__dismiss">Got it</button>
                <span class="signup-coach__arrow" aria-hidden="true"></span>
            `;
            document.body.appendChild(coachEl);
            locateBtn.classList.add('locate-btn--coach-pulse');

            reposition();
            requestAnimationFrame(() => coachEl?.classList.add('is-visible'));

            coachEl.querySelector('.signup-coach__dismiss')?.addEventListener('click', dismiss);
            document.addEventListener('pointerdown', onOutsidePointer, true);
            window.addEventListener('resize', reposition);
        }

        showTimer = setTimeout(show, 900);

        // Any real interaction with the field it's coaching also counts
        // as "seen" — no need to keep nagging once they've engaged.
        locateBtn.addEventListener('click', dismiss, { once: true });
        cityInput.addEventListener('input', dismiss, { once: true });
        regionInput?.addEventListener('change', () => {
            /* keep coach visible through region pick */
            // Re-scope any already-typed city text to the newly chosen
            // region instead of waiting for the next keystroke to pick it up.
            locationPicker?.refresh();
        });
    }

    // ---- Back button + "Log in" link: both use data-route-custom, same
    // as the "Create account" links on the login view. Wired explicitly
    // here (rather than assuming a global delegated handler) so this
    // view's navigation doesn't depend on anything outside this file. ----
    function bindCustomRouteLinks() {
        document.querySelectorAll('#view-signup [data-route-custom]').forEach((el) => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                const target = el.dataset.routeCustom;
                if (target) window.LWRouter.navigate(target);
            });
        });
    }

    function mount() {
        if (isMounted) return;
        isMounted = true;

        nameInput = document.getElementById('name');
        emailPhoneInput = document.getElementById('email-phone');
        regionInput = document.getElementById('region');
        cityInput = document.getElementById('city');
        notifyUpdatesInput = document.getElementById('notifyUpdates');
        form = document.getElementById('signupForm');
        errorEl = document.getElementById('email_phone-error');
        submitBtn = document.getElementById('signUpBtn');

        prefillFromPriorAttempt();
        bindNameFormatting();
        bindLocationPicker();
        bindLocationCoachmark();
        bindCustomRouteLinks();
        bindViewportHeightSync();

        form.addEventListener("submit", (e) => {
            e.preventDefault();
            if (submitBtn?.disabled) return;
            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }
            handleSignup();
        });

        document.getElementById('view-signup')?.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !submitBtn?.disabled) {
                e.preventDefault();
                form.requestSubmit();
            }
        });

        if (notifyUpdatesInput) {
            notifyUpdatesInput.addEventListener('change', () => {
                if (!notifyUpdatesInput.checked) return;
                if (typeof window.enableLightWatchPush === 'function') {
                    window.enableLightWatchPush();
                }
            });
        }
    }

    // ============================================================
    //  show() / hide() — called by the router when this view becomes
    //  visible or hidden.
    //
    //  This used to force a pile of inline styles (display:block,
    //  height:auto, etc.) onto html/body/#authShell/#view-signup to
    //  "fix" scrolling. That was the actual bug behind the view not
    //  stretching full-height on mobile: signup.css already handles
    //  height/scroll declaratively via `:has(#view-signup:not([hidden]))`,
    //  which depends on #view-signup staying `display: flex` — but the
    //  inline `display: 'block'` set here overrode that (inline styles
    //  beat stylesheet rules), breaking the flex chain `.signup-main`
    //  relies on to fill the screen. CSS already owns this now, so
    //  show()/hide() just handle the one thing that IS this view's
    //  concern: the login-view leftover class.
    // ============================================================

    function show() {
        document.body.classList.remove('login-active');
    }

    function hide() {
        // Nothing to reset — show() no longer sets anything outside
        // this view's own styles.
    }

    window.LWViews = window.LWViews || {};
    window.LWViews.signup = { mount, show, hide };
})();