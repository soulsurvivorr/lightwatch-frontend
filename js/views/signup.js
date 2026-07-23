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
// ============================================================

(function () {
    let nameInput, emailPhoneInput, regionInput, cityInput,
        notifyUpdatesInput, form, errorEl, submitBtn;
    let isMounted = false;

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

        const signupFields = document.querySelectorAll('#view-signup .prompt-inputs');
        const inputFieldSection = document.getElementById('input-field-section');
        let focusedField = null;
        const updateKeyboardShift = () => {
            if (!focusedField) return;
            const viewportBottom = (window.visualViewport?.height || window.innerHeight) - 18;
            const fieldBottom = focusedField.getBoundingClientRect().bottom;
            const shift = Math.min(0, viewportBottom - fieldBottom);
            inputFieldSection?.style.setProperty('--signup-keyboard-shift', `${shift}px`);
        };
        const clearKeyboardShift = () => {
            inputFieldSection?.style.removeProperty('--signup-keyboard-shift');
        };
        signupFields.forEach((field) => {
            field.addEventListener('focus', () => {
                focusedField = field;
                requestAnimationFrame(updateKeyboardShift);
                setTimeout(updateKeyboardShift, 180);
            });
            field.addEventListener('blur', () => {
                if (focusedField === field) {
                    focusedField = null;
                    clearKeyboardShift();
                }
            });
        });
        window.visualViewport?.addEventListener('resize', () => {
            if (focusedField) requestAnimationFrame(updateKeyboardShift);
        });

        prefillFromPriorAttempt();

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
    //  show() / hide() — called by the router when this view
    //  becomes visible or hidden. This is where we fix the
    //  scrolling issue by forcing the body to be scrollable.
    // ============================================================

    function show() {
        console.log('Signup view shown - fixing scroll');
        
        // Force the html element to be scrollable
        document.documentElement.style.overflow = 'auto';
        document.documentElement.style.height = 'auto';
        document.documentElement.style.minHeight = '100%';
        document.documentElement.style.position = 'static';
        
        // Force the body to be scrollable
        document.body.style.overflow = 'auto';
        document.body.style.height = 'auto';
        document.body.style.minHeight = '100vh';
        document.body.style.position = 'static';
        document.body.style.maxHeight = 'none';
        
        // Force authShell to not block scrolling
        const authShell = document.getElementById('authShell');
        if (authShell) {
            authShell.style.overflow = 'visible';
            authShell.style.height = 'auto';
            authShell.style.minHeight = '100%';
            authShell.style.position = 'static';
        }

        // Force the signup view to be visible and scrollable
        const signupView = document.getElementById('view-signup');
        if (signupView) {
            signupView.style.display = 'block';
            signupView.style.overflow = 'visible';
            signupView.style.height = 'auto';
            signupView.style.minHeight = '100dvh';
        }

        // Force a reflow to ensure the styles apply
        void document.body.offsetHeight;
        
        // Also check if there's a class from login that's blocking scroll
        document.body.classList.remove('login-active');
    }

    function hide() {
        // Reset styles when hiding
        const signupView = document.getElementById('view-signup');
        if (signupView && signupView.hidden) {
            // Only reset if signup is actually hidden
            document.documentElement.style.overflow = '';
            document.documentElement.style.height = '';
            document.documentElement.style.minHeight = '';
            document.documentElement.style.position = '';
            
            document.body.style.overflow = '';
            document.body.style.height = '';
            document.body.style.minHeight = '';
            document.body.style.position = '';
            document.body.style.maxHeight = '';
            
            const authShell = document.getElementById('authShell');
            if (authShell) {
                authShell.style.overflow = '';
                authShell.style.height = '';
                authShell.style.minHeight = '';
                authShell.style.position = '';
            }
            
            if (signupView) {
                signupView.style.display = '';
                signupView.style.overflow = '';
                signupView.style.height = '';
                signupView.style.minHeight = '';
            }
        }
    }

    window.LWViews = window.LWViews || {};
    window.LWViews.signup = { mount, show, hide };
})();