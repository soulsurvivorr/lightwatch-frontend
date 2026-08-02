// ============================================================
//  VIEWS/VERIFICATION.JS
//  Requires: services/auth.js loaded before this.
//
//  Wrapped into mount()/show()/hide(). Navigation changes:
//   - "Edit" link now calls router.navigate('signup') instead of
//     following an <a href="../pages/signup.html">.
//   - On success, hands off to router.navigate('home', {replace:true})
//     instead of window.location.replace('../pages/home.html').
//   - The resend cooldown's setInterval is now started in show()
//     and cleared in hide(), instead of running forever once
//     started — no reason to keep ticking a countdown for a view
//     that's not on screen.
// ============================================================

(function () {
    const RESEND_COOLDOWN_SECONDS = 60;
    const MASK_STAR_COUNT = 4;

    let verifyCard, verifyBody, continueBtn, errorMsg, otpBoxesWrap, otpBoxes, resendLink, editLink, backBtn, changeContactBtn;
    let cooldownInterval = null;
    let verifyInFlight = false;
    let mounted = false;
    let keyboardViewportCleanup = null;
    let focusedOtp = null;

    function getVerificationValue(key) {
        return sessionStorage.getItem(key) || localStorage.getItem(key);
    }

    function maskValue(value) {
        if (!value) return '';
        if (value.includes('@')) {
            const [name, domain] = value.split('@');
            const visible = name.slice(0, 3);
            return visible + '*'.repeat(MASK_STAR_COUNT) + '@' + domain;
        }
        const visible = value.slice(0, 3);
        return visible + '*'.repeat(MASK_STAR_COUNT);
    }

    function getOtpValue() {
        return otpBoxes.map(box => box.value).join('');
    }

    function updateButtonState() {
        otpBoxes.forEach(box => box.classList.toggle('filled', box.value !== ''));
        const isFull = getOtpValue().length === otpBoxes.length;
        continueBtn.disabled = !isFull;
        continueBtn.classList.toggle('active', isFull);
    }

    function autoSubmitWhenFull() {
        updateButtonState();
        if (getOtpValue().length === otpBoxes.length) {
            setTimeout(checkOTP, 220);
        }
    }

    function shakeOtpBoxes() {
        otpBoxesWrap.classList.remove('is-shaking');
        void otpBoxesWrap.offsetWidth;
        otpBoxesWrap.classList.add('is-shaking');
    }

    async function checkOTP() {
        if (verifyInFlight) return;

        const otpValue = getOtpValue();
        const emailPhone = getVerificationValue('userIdentifier');

        errorMsg.textContent = '';

        if (otpValue.length < otpBoxes.length) {
            errorMsg.textContent = 'Please enter the full code';
            return;
        }

        verifyInFlight = true;
        continueBtn.disabled = true;
        continueBtn.classList.add('is-loading');

        try {
            const response = await fetchWithBackendTimeout(`${API_URL}/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ emailPhone, code: otpValue })
            });

            const result = await response.json();

            if (!response.ok) {
                errorMsg.textContent = result.error || 'Incorrect code';
                shakeOtpBoxes();
                otpBoxes.forEach(box => { box.value = ''; box.classList.remove('filled'); });
                otpBoxes[0]?.focus();
                return;
            }

            const rememberMe = getVerificationValue('rememberMePending') === 'true';
            const signupFlow = !!getVerificationValue('signupUser');
            // Was: a second fetchWithBackendTimeout(`${API_URL}/user/${result.userId}`)
            // here, sequential after the /verify call above — a full extra
            // network round trip (plus /user/:id recomputing chatCount/
            // reportCount, which this screen never used) just to read back
            // name/city/region that /verify now returns directly.
            const user = {
                id: result.userId,
                name: result.name,
                city: result.city,
                region: result.region,
                chatHandle: result.chatHandle,
                initials: (result.name || 'U')
                    .split(' ')
                    .map(word => word[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()
            };

            saveSession(user, result.userId, rememberMe);

            if (!rememberMe && signupFlow) {
                const oneDayMs = 24 * 60 * 60 * 1000;
                localStorage.setItem('app_temp_auth_token', result.userId);
                localStorage.setItem('app_temp_user', JSON.stringify(user));
                localStorage.setItem('app_temp_expires_at', String(Date.now() + oneDayMs));
            }

            ['userIdentifier', 'maskedContact', 'pendingUserId',
             'rememberMePending', 'chatHandle', 'signupUser'
            ].forEach(k => {
                sessionStorage.removeItem(k);
                localStorage.removeItem(k);
            });

            verifyCard.classList.add('is-success');
            setTimeout(() => {
                window.LWRouter.navigate('home', { replace: true });
            }, 700);

        } catch (err) {
            console.error('Verification failed:', err);
            errorMsg.textContent = getBackendErrorMessage(err);
            shakeOtpBoxes();
        } finally {
            verifyInFlight = false;
            continueBtn.classList.remove('is-loading');
            continueBtn.disabled = getOtpValue().length !== otpBoxes.length;
        }
    }

    function startResendCooldown(seconds = RESEND_COOLDOWN_SECONDS) {
        if (!resendLink) return;

        let remaining = seconds;
        resendLink.classList.add('disabled');
        resendLink.setAttribute('aria-disabled', 'true');

        const render = () => {
            const m = Math.floor(remaining / 60);
            const s = String(remaining % 60).padStart(2, '0');
            resendLink.textContent = `Resend available in ${m}:${s}`;
        };

        render();
        clearInterval(cooldownInterval);
        cooldownInterval = setInterval(() => {
            remaining -= 1;
            if (remaining <= 0) {
                clearInterval(cooldownInterval);
                resendLink.textContent = 'Get a new code';
                resendLink.classList.remove('disabled');
                resendLink.removeAttribute('aria-disabled');
                return;
            }
            render();
        }, 1000);
    }

    function refreshMaskedContactLine() {
        const userValue = getVerificationValue('userIdentifier');
        const maskedContact = getVerificationValue('maskedContact');
        const isSignupFlow = !!getVerificationValue('signupUser');

        const codeTextEl = document.getElementById('code-text');
        if (codeTextEl) {
            codeTextEl.textContent =
                `Enter the code we sent to ${userValue ? maskValue(userValue) : (maskedContact || '')}`;
        }
        if (editLink) {
            editLink.style.display = isSignupFlow ? '' : 'none';
        }
    }

    function mount() {
        verifyCard = document.getElementById('verifyCard');
        verifyBody = verifyCard?.querySelector('.verify-body');
        continueBtn = document.getElementById('continueBtn');
        errorMsg = document.getElementById('error-msg');
        otpBoxesWrap = document.getElementById('otpBoxes');
        otpBoxes = Array.from(document.querySelectorAll('#view-verification .otp-box'));
        resendLink = document.getElementById('resendCodeLink');
        editLink = document.getElementById('editContactLink');
        backBtn = document.getElementById('verifyBackBtn');
        changeContactBtn = document.getElementById('changeContactBtn');

        const KEYBOARD_TOP_GAP = 16; // px gap kept below the sticky header once shifted up

        const updateKeyboardShift = () => {
            if (!verifyBody || !focusedOtp) return;
            const headerEl = document.querySelector('#view-verification header');
            const headerBottom = headerEl ? headerEl.getBoundingClientRect().bottom : 0;
            const targetTop = headerBottom + KEYBOARD_TOP_GAP;

            // Measure the body's natural (unshifted) position first —
            // getBoundingClientRect() reflects any transform already
            // applied, so briefly zeroing it out gives us the true
            // resting position to shift from. Only .verify-body moves;
            // the card frame itself stays put.
            verifyBody.style.setProperty('--verify-keyboard-shift', '0px');
            const naturalTop = verifyBody.getBoundingClientRect().top;

            const shift = Math.min(0, targetTop - naturalTop);
            // The card clips overflow by default (rounded corners); while
            // the body is actually shifted above its resting spot, let it
            // escape that clip so it doesn't get cut off mid-float.
            verifyCard?.classList.toggle('kb-active', shift < 0);
            verifyBody.style.setProperty('--verify-keyboard-shift', `${shift}px`);
        };

        const clearKeyboardShift = () => {
            verifyBody?.style.removeProperty('--verify-keyboard-shift');
            verifyCard?.classList.remove('kb-active');
        };

        keyboardViewportCleanup = () => {
            window.visualViewport?.removeEventListener('resize', updateKeyboardShift);
            window.visualViewport?.removeEventListener('scroll', updateKeyboardShift);
            clearKeyboardShift();
            focusedOtp = null;
        };

        editLink?.addEventListener('click', (e) => {
            e.preventDefault();
            window.LWRouter.navigate('signup');
        });

        changeContactBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            const cameFromSignup = !!getVerificationValue('signupUser');
            window.LWRouter.navigate(cameFromSignup ? 'signup' : 'login');
        });

        backBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.history.length > 1) {
                window.history.back();
            } else {
                window.LWRouter.navigate('login');
            }
        });

        otpBoxes.forEach((box, index) => {
            box.addEventListener('focus', () => {
                focusedOtp = box;
                requestAnimationFrame(updateKeyboardShift);
                setTimeout(updateKeyboardShift, 120);
            });
            box.addEventListener('blur', () => {
                if (focusedOtp !== box) return;
                // Auto-advance (input handler) and paste both call
                // .focus() on the next box synchronously, but that
                // focus event fires just after this blur — clearing
                // the shift here immediately would snap the card back
                // to center for a beat before it re-shifts, bouncing
                // on every keystroke. Deferring one tick lets the new
                // focus land first so we only clear when focus truly
                // left the OTP group.
                setTimeout(() => {
                    if (otpBoxes.includes(document.activeElement)) return;
                    focusedOtp = null;
                    clearKeyboardShift();
                }, 0);
            });
            box.addEventListener('input', () => {
                const digits = box.value.replace(/[^0-9]/g, '');

                if (digits.length > 1) {
                    otpBoxes.forEach((b, i) => { b.value = digits[i] || ''; });
                    const nextEmpty = otpBoxes.find(b => !b.value) || otpBoxes[otpBoxes.length - 1];
                    nextEmpty.focus();
                    autoSubmitWhenFull();
                    return;
                }

                box.value = digits.slice(0, 1);

                if (box.value && index < otpBoxes.length - 1) {
                    otpBoxes[index + 1].focus();
                }

                autoSubmitWhenFull();
            });

            box.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && !box.value && index > 0) {
                    otpBoxes[index - 1].focus();
                }
                if (e.key === 'Enter') {
                    e.preventDefault();
                    checkOTP();
                }
            });

            box.addEventListener('paste', (e) => {
                e.preventDefault();
                const digits = (e.clipboardData.getData('text') || '').replace(/[^0-9]/g, '').split('');
                otpBoxes.forEach((b, i) => { b.value = digits[i] || ''; });
                const nextEmpty = otpBoxes.find(b => !b.value) || otpBoxes[otpBoxes.length - 1];
                nextEmpty.focus();
                autoSubmitWhenFull();
            });
        });

        window.visualViewport?.addEventListener('resize', updateKeyboardShift);
        window.visualViewport?.addEventListener('scroll', updateKeyboardShift);

        continueBtn.addEventListener('click', e => { e.preventDefault(); checkOTP(); });

        resendLink?.addEventListener('click', async () => {
            if (resendLink.classList.contains('disabled')) return;

            const emailPhone = getVerificationValue('userIdentifier');
            if (!emailPhone) return;

            resendLink.classList.add('disabled');
            resendLink.textContent = 'Sending…';
            errorMsg.textContent = '';

            try {
                const response = await fetch(`${API_URL}/resend`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ emailPhone })
                });
                const result = await response.json();

                if (!response.ok) {
                    errorMsg.textContent = result.error || 'Could not resend code';
                    resendLink.classList.remove('disabled');
                    resendLink.textContent = 'Get a new code';
                    return;
                }

                otpBoxes.forEach(box => { box.value = ''; box.classList.remove('filled'); });
                updateButtonState();
                otpBoxes[0]?.focus();
                startResendCooldown();

            } catch (err) {
                console.error('Resend failed:', err);
                errorMsg.textContent = 'Server error. Please try again.';
                resendLink.classList.remove('disabled');
                resendLink.textContent = 'Get a new code';
            }
        });

        mounted = true;
    }

    function show() {
        verifyCard?.classList.remove('is-success');
        refreshMaskedContactLine();
        otpBoxes?.forEach(box => { box.value = ''; box.classList.remove('filled'); });
        if (errorMsg) errorMsg.textContent = '';
        otpBoxes?.[0]?.focus();
        startResendCooldown();
    }

    function hide() {
        clearInterval(cooldownInterval);
        keyboardViewportCleanup?.();
        keyboardViewportCleanup = null;
    }

    window.LWViews = window.LWViews || {};
    window.LWViews.verification = { mount, show, hide };
})();