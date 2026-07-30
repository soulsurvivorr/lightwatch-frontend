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

    const EMOJI_RE = /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;

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
        const userData = {
            name: nameInput.value.trim(),
            emailPhone: emailPhoneInput.value.trim(),
            region: regionInput.value,
            city: cityInput.value.trim(),
            wantsAlerts: Boolean(notifyUpdatesInput?.checked)
        };

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

    // ---- City / Town: use device location, reverse-geocode, stay editable ----
    function bindLocateButton() {
        const locateBtn = document.getElementById('useLocationBtn');
        const hint = document.getElementById('cityLocationHint');
        if (!locateBtn || !cityInput) return;

        const setHint = (text) => { if (hint) hint.textContent = text; };

        const runGeolocation = () => {
            locateBtn.classList.add('is-loading');
            locateBtn.disabled = true;
            setHint('Requesting location permission…');

            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const { latitude: lat, longitude: lon } = pos.coords;
                    setHint('Finding your city…');

                    fetch(`${API_URL}/geocode/reverse?lat=${lat}&lng=${lon}`)
                        .then((res) => res.json())
                        .then((data) => {
                            const place = data && data.city;
                            if (place) {
                                cityInput.value = place;
                                setHint('Detected automatically — feel free to edit it if it is not quite right.');
                            } else {
                                setHint('Could not determine your city automatically — please type it in.');
                            }
                        })
                        .catch(() => {
                            setHint('Could not reach the location service — please type your city in.');
                        })
                        .finally(() => {
                            locateBtn.classList.remove('is-loading');
                            locateBtn.disabled = false;
                            cityInput.focus();
                        });
                },
                (err) => {
                    locateBtn.classList.remove('is-loading');
                    locateBtn.disabled = false;
                    if (err && err.code === 1) {
                        // PERMISSION_DENIED. Once an origin has been denied, browsers
                        // won't show the OS/browser prompt again on subsequent calls —
                        // they just fail instantly with this same code. If that's
                        // happening on a *first* attempt, the prompt itself never had
                        // a chance to fire, which almost always means one of:
                        //  - the page isn't on HTTPS (or localhost) — geolocation only
                        //    works in a secure context, and silently no-ops otherwise
                        //  - this is loaded inside a WebView/app wrapper and the OS-level
                        //    location permission was never granted to the app itself
                        //  - a Permissions-Policy header/iframe "allow" attribute upstream
                        //    is blocking geolocation for this origin
                        setHint('Location permission was denied — you can still type your city manually.');
                    } else if (err && err.code === 3) {
                        setHint('Location request timed out — please type your city manually.');
                    } else {
                        setHint('Could not get your location — please type your city manually.');
                    }
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
            );
        };

        locateBtn.addEventListener('click', () => {
            if (!('geolocation' in navigator)) {
                setHint('Location is not available on this device — please type your city.');
                return;
            }

            // Check permission state first so a *previously* denied origin gets an
            // accurate message (re-prompting won't happen) instead of implying the
            // browser is about to ask again.
            if (navigator.permissions?.query) {
                navigator.permissions.query({ name: 'geolocation' })
                    .then((status) => {
                        if (status.state === 'denied') {
                            setHint('Location is blocked for this site — enable it in your browser/site settings, or type your city manually.');
                            return;
                        }
                        runGeolocation();
                    })
                    .catch(runGeolocation); // Permissions API not supported — fall back to asking directly.
            } else {
                runGeolocation();
            }
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

    // ---- City field: nudge its container up while it's focused and the
    // on-screen keyboard is covering it (mobile). Only the city field's
    // own .field-group gets --signup-keyboard-shift set, via margin-top
    // rather than transform — the field-group's entrance animation already
    // owns transform with fill:both, so a transform here would just get
    // silently overridden by that animation's frozen end state. ----
    function bindCityKeyboardShift() {
        if (!cityInput) return;
        const fieldGroup = cityInput.closest('.field-group');
        if (!fieldGroup) return;

        let isFocused = false;

        const updateShift = () => {
            if (!isFocused) return;
            const viewportBottom = (window.visualViewport?.height || window.innerHeight) - 18;
            const fieldBottom = fieldGroup.getBoundingClientRect().bottom;
            const shift = Math.min(0, viewportBottom - fieldBottom);
            fieldGroup.style.setProperty('--signup-keyboard-shift', `${shift}px`);
        };
        const clearShift = () => {
            fieldGroup.style.removeProperty('--signup-keyboard-shift');
        };

        cityInput.addEventListener('focus', () => {
            isFocused = true;
            requestAnimationFrame(updateShift);
            setTimeout(updateShift, 180); // keyboard animates in — recheck once it's settled
        });
        cityInput.addEventListener('blur', () => {
            isFocused = false;
            clearShift();
        });
        window.visualViewport?.addEventListener('resize', () => {
            if (isFocused) requestAnimationFrame(updateShift);
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
        bindLocateButton();
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