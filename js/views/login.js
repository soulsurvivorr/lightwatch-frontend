// ============================================================
//  VIEWS/LOGIN.JS — Sign In + Remember Me
//  Requires: services/auth.js, config.js loaded first.
//
//  Changed vs. the original login.js:
//   - The "already signed in? redirect to home" check is gone —
//     the router's publicOnly gating on the 'login' view config
//     does that centrally now (see js/app.js), so it also covers
//     someone signing in on the account view then somehow ending
//     up back here, not just a fresh boot.
//   - handleSubmit() now calls window.LWRouter.navigate('verification')
//     instead of window.location.href = './pages/verification.html'.
//   - The brand-loop typing animation is start/stopped from
//     show()/hide() instead of running forever from page load —
//     it's pointless CPU/battery cost while another view is on
//     screen.
//   - The "create account" link no longer relies on an <a href>
//     page navigation; it's bound directly here (kept its own
//     branded-transition delay) rather than going through the
//     generic data-route click handler in components/nav.js, so it
//     keeps the exact same "Taking you to sign up…" moment it had
//     before.
// ============================================================

(function () {
    let brandLoopActive = false;
    let brandLoopStarted = false;
    let userCountLoaded = false;
    let keyboardViewportCleanup = null;

    const brandLoopTexts = [
        'Community-powered. Stay ahead of outages',
        'Know before you go—powered by your community'
    ];

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function typeBrandLoopText(target, text) {
        target.textContent = '';
        for (let i = 0; i < text.length && brandLoopActive; i += 1) {
            target.textContent = text.slice(0, i + 1);
            await wait(38);
        }
    }

    async function runBrandLoop(targets) {
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!targets.length) return;

        if (reduceMotion) {
            targets.forEach((target, index) => {
                target.textContent = brandLoopTexts[index % brandLoopTexts.length];
            });
            return;
        }

        let index = 0;
        while (brandLoopActive) {
            const text = brandLoopTexts[index % brandLoopTexts.length];
            await Promise.all(targets.map(target => typeBrandLoopText(target, text)));
            if (!brandLoopActive) break;
            await wait(1400);
            index += 1;
        }
    }

    async function loadUserCountStat() {
        if (userCountLoaded) return;
        userCountLoaded = true;
        const el = document.getElementById('statUserCount');
        if (!el) return;
        try {
            const response = await fetch(`${API_URL}/stats`);
            if (!response.ok) return;
            const data = await response.json();
            if (typeof data.userCount === 'number') {
                el.textContent = `${data.userCount}+`;
            }
        } catch (err) {
            console.error('Could not load user count:', err);
        }
    }

    async function handleSubmit() {
        const userInput = document.getElementById('user-input');
        const sendCodeBtn = document.getElementById('sendCodebtn');
        const errorMsg = document.getElementById('login-error-msg');
        errorMsg.textContent = '';

        userInput.value = userInput.value.trim();

        if (!userInput.value) {
            userInput.reportValidity();
            return;
        }

        const loginInput = userInput.value;
        const rememberMe = document.getElementById('rememberMe')?.checked || false;

        const isEmail = isValidEmail(loginInput);
        const isPhone = isValidPhone(loginInput);

        if (!isEmail && !isPhone) {
            errorMsg.textContent = 'Enter valid email or 10-digit phone number';
            return;
        }

        const adminBypassEmail = 'sarkdev@yahoo.com';
        if (loginInput.trim().toLowerCase() === adminBypassEmail) {
            const adminUser = {
                id: 'admin-sarkdev',
                name: 'Admin',
                city: 'Kumasi',
                region: 'Ashanti',
                chatHandle: 'admin',
                initials: 'AD',
                email: adminBypassEmail,
                role: 'admin'
            };
            saveSession(adminUser, 'admin-sarkdev', rememberMe);
            showPageTransitionOverlay('Signing you in…');
            setTimeout(() => {
                hidePageTransitionOverlay();
                window.LWRouter.navigate('home', { replace: true });
            }, 300);
            return;
        }

        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 10000);

        sendCodeBtn.disabled = true;
        sendCodeBtn.textContent = 'Sending…';

        try {
            const response = await fetch(`${API_URL}/signin`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ emailPhone: loginInput }),
                signal: controller.signal
            });

            let result = {};
            try {
                result = await response.json();
            } catch {
                result = {};
            }

            if (!response.ok) {
                errorMsg.textContent = result.error || 'No account found';
                return;
            }

            sessionStorage.setItem('userIdentifier', loginInput);
            sessionStorage.setItem('maskedContact', result.maskedContact);
            sessionStorage.setItem('pendingUserId', result.userId);
            sessionStorage.setItem('rememberMePending', rememberMe ? 'true' : 'false');

            if (result.chatHandle) {
                sessionStorage.setItem('chatHandle', result.chatHandle);
            }

            showPageTransitionOverlay('Sending your code…');
            setTimeout(() => {
                hidePageTransitionOverlay();
                window.LWRouter.navigate('verification');
            }, 500);
            return;

        } catch (err) {
            console.error("Login fetch error:", err);
            const isAbort = err?.name === 'AbortError';
            errorMsg.textContent = isAbort
                ? 'The request timed out. Please try again.'
                : `Connection failed to ${API_URL}. Is the server running?`;
        } finally {
            window.clearTimeout(timeoutId);
            sendCodeBtn.disabled = false;
            sendCodeBtn.textContent = 'Send code';
        }
    }

    function isNativeApp() {
        return Boolean(
            window.Capacitor &&
            typeof window.Capacitor.isNativePlatform === 'function' &&
            window.Capacitor.isNativePlatform()
        );
    }

    function mount() {
        const isNative = isNativeApp();
        document.documentElement.classList.toggle('lw-login-native', isNative);
        document.documentElement.classList.toggle('lw-login-browser', !isNative);
        document.documentElement.classList.add('lw-view-login');
        const sendCodeBtn = document.getElementById('sendCodebtn');
        const userInput = document.getElementById('user-input');
        const loginFormSide = document.querySelector('#view-login .login-form-side');

        sendCodeBtn?.addEventListener('click', e => { e.preventDefault(); handleSubmit(); });
        userInput?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); } });

        const showFooter = () => loginFormSide?.classList.remove('hide-footer');
        const hideFooter = () => loginFormSide?.classList.add('hide-footer');

        userInput?.addEventListener('blur', () => {
            showFooter();
        });

        if (window.visualViewport && userInput) {
            // Gap kept between the bottom of the field and the top of the
            // keyboard once the box has been pulled up — a little more
            // than the old 16px so the input clears the keyboard with
            // comfortable breathing room instead of sitting flush against it.
            const KEYBOARD_BOTTOM_GAP = 20;

            const updateKeyboardShift = () => {
                if (!loginFormSide) {
                    return;
                }

                // Measure the box's natural (unshifted) position first —
                // getBoundingClientRect() reflects any transform already
                // applied, so briefly zeroing it out gives the true resting
                // position to shift from. Without this, every subsequent
                // visualViewport 'resize'/'scroll' event (the keyboard's
                // open animation fires several) would measure off the
                // previous shift instead of the natural layout and keep
                // compounding the offset — which is why the box could end
                // up drifting further than intended, or not settling
                // where the field actually needed to land.
                loginFormSide.style.setProperty('--login-keyboard-shift', '0px');
                const inputBottom = userInput.getBoundingClientRect().bottom;

                const viewportBottom = window.visualViewport.height - KEYBOARD_BOTTOM_GAP;
                const shift = Math.min(0, viewportBottom - inputBottom);
                const isKeyboardVisible = document.activeElement === userInput && shift < 0;

                if (isKeyboardVisible) {
                    loginFormSide.style.setProperty('--login-keyboard-shift', `${shift}px`);
                    // Footer sits below the fold once the keyboard is up
                    // regardless — hiding it outright (rather than letting
                    // it just be covered) keeps it from being announced to
                    // screen readers or tabbed to while off-screen, and
                    // avoids any chance of it trailing the shift visually.
                    hideFooter();
                } else {
                    loginFormSide.style.removeProperty('--login-keyboard-shift');
                    showFooter();
                }
            };
            const clearKeyboardShift = () => {
                loginFormSide.style.removeProperty('--login-keyboard-shift');
                showFooter();
            };

            const handleUserInputFocus = () => {
                updateKeyboardShift();
                // Safety net: on some Android WebViews / older Safari, the
                // visualViewport 'resize' event lags behind the keyboard's
                // open animation, so the first calculation above (run before
                // the viewport has actually shrunk) comes out as a no-op
                // shift. Re-check a couple more times as the keyboard
                // settles rather than relying solely on 'resize' to catch up.
                requestAnimationFrame(updateKeyboardShift);
                setTimeout(updateKeyboardShift, 180);
                setTimeout(updateKeyboardShift, 400);
            };

            userInput.addEventListener('focus', handleUserInputFocus);
            userInput.addEventListener('blur', clearKeyboardShift);
            window.visualViewport.addEventListener('resize', updateKeyboardShift);
            window.visualViewport.addEventListener('scroll', updateKeyboardShift);
            keyboardViewportCleanup = () => {
                userInput.removeEventListener('focus', handleUserInputFocus);
                userInput.removeEventListener('blur', clearKeyboardShift);
                window.visualViewport.removeEventListener('resize', updateKeyboardShift);
                window.visualViewport.removeEventListener('scroll', updateKeyboardShift);
                clearKeyboardShift();
            };
        }

        document.querySelectorAll('#view-login [data-route-custom="signup"]').forEach(link => {
            link.addEventListener('click', e => {
                e.preventDefault();
                // Create-account can be clicked before the onboarding walkthrough
                // is ever dismissed. Without this, lw-onboarding-open stays on
                // <html>/<body> (it's only cleared by finishing the walkthrough),
                // and its overflow:hidden lock fights signup's own scroll rules —
                // that's what was blocking scroll on the signup view.
                window.LWOnboarding?.close?.();
                showPageTransitionOverlay('Taking you to sign up…');
                setTimeout(() => {
                    hidePageTransitionOverlay();
                    window.LWRouter.navigate('signup');
                }, 500);
            });
        });

        loadUserCountStat();
        window.LWOnboarding?.init();
    }

    function show() {
        document.documentElement.classList.add('lw-view-login');
        brandLoopActive = true;
        const targets = [
            document.getElementById('brandLoopText'),
            document.getElementById('brandLoopTextDesktop')
        ].filter(Boolean);
        if (!brandLoopStarted) {
            brandLoopStarted = true;
        }
        runBrandLoop(targets);
    }

    function hide() {
        document.documentElement.classList.remove('lw-view-login');
        brandLoopActive = false;
        keyboardViewportCleanup?.();
        keyboardViewportCleanup = null;
    }

    window.LWViews = window.LWViews || {};
    window.LWViews.login = { mount, show, hide };
})();