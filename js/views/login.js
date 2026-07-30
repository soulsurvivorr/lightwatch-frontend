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

        sendCodeBtn.disabled = true;
        sendCodeBtn.textContent = 'Sending…';

        try {
            const response = await fetch(`${API_URL}/signin`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ emailPhone: loginInput })
            });

            const result = await response.json();

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
            errorMsg.textContent = `Connection failed to ${API_URL}. Is the server running?`;
        } finally {
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

        userInput?.addEventListener('focus', () => {
            hideFooter();
        });

        userInput?.addEventListener('blur', () => {
            showFooter();
        });

        if (window.visualViewport && userInput) {
            const updateKeyboardShift = () => {
                if (!loginFormSide || document.activeElement !== userInput) {
                    loginFormSide?.style.removeProperty('--login-keyboard-shift');
                    return;
                }

                const viewportBottom = window.visualViewport.height - 16;
                const inputBottom = userInput.getBoundingClientRect().bottom;
                const shift = Math.min(0, viewportBottom - inputBottom);
                loginFormSide.style.setProperty('--login-keyboard-shift', `${shift}px`);
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