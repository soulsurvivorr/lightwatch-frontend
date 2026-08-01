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
            const response = await fetch(`${API_URL}/signup`, {
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

            showPageTransitionOverlay('Setting up verification…');
            setTimeout(() => {
                hidePageTransitionOverlay();
                window.LWRouter.navigate('verification');
            }, 260);

        } catch (error) {
            console.error("Signup failed:", error);
            errorEl.textContent = "Could not reach the server. Is it running?";
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

    // ---- City field: native app only. When it's focused and the
    // on-screen keyboard is up, nudge the whole .signup-wrap up just
    // enough to keep the city field clear of the keyboard, then ease it
    // back down on blur. Same transform + CSS-var approach as the login
    // box (see login.js/login.css --login-keyboard-shift), rather than
    // margin-top on the single field-group: shifting the whole wrap
    // keeps the field's position relative to the rest of the card
    // consistent instead of just that one row jumping around on its
    // own. Skipped entirely outside the native app — a regular mobile
    // browser already scrolls the focused field into view itself. ----
    function bindCityKeyboardShift() {
        if (!cityInput || !isNativeApp() || !window.visualViewport) return;
        const wrap = document.querySelector('.signup-wrap');
        if (!wrap) return;

        const KEYBOARD_BOTTOM_GAP = 20; // px of breathing room below the field
        let isFocused = false;

        const updateShift = () => {
            if (!isFocused) return;

            // Measure the wrap's natural (unshifted) position first, same
            // reasoning as login's updateKeyboardShift: getBoundingClientRect()
            // reflects any transform already applied, so zero it out before
            // measuring or repeated 'resize' events during the keyboard's
            // open animation would compound the offset instead of shifting
            // from the true resting position each time.
            wrap.style.setProperty('--signup-keyboard-shift', '0px');
            const fieldBottom = cityInput.getBoundingClientRect().bottom;

            const viewportBottom = window.visualViewport.height - KEYBOARD_BOTTOM_GAP;
            const shift = Math.min(0, viewportBottom - fieldBottom);

            if (shift < 0) {
                wrap.style.setProperty('--signup-keyboard-shift', `${shift}px`);
            } else {
                wrap.style.removeProperty('--signup-keyboard-shift');
            }
        };
        const clearShift = () => {
            wrap.style.removeProperty('--signup-keyboard-shift');
        };

        const handleNativeKeyboardState = () => {
            if (!isFocused) return;
            updateShift();
            requestAnimationFrame(updateShift);
            setTimeout(updateShift, 180);
            setTimeout(updateShift, 400);
        };

        cityInput.addEventListener('focus', () => {
            isFocused = true;
            updateShift();
            requestAnimationFrame(updateShift);
            setTimeout(updateShift, 180);
            setTimeout(updateShift, 400);
        });
        cityInput.addEventListener('blur', () => {
            isFocused = false;
            clearShift();
        });
        window.visualViewport.addEventListener('resize', updateShift);
        window.visualViewport.addEventListener('scroll', updateShift);
        window.addEventListener('lw-keyboard-show', handleNativeKeyboardState);
        window.addEventListener('lw-keyboard-hide', clearShift);
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
        bindCustomRouteLinks();
        bindCityKeyboardShift();

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