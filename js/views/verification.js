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

    let verifyCard, continueBtn, errorMsg, otpBoxesWrap, otpBoxes, resendLink, editLink;
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
            const response = await fetch(`${API_URL}/verify`, {
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
            const userResponse = await fetch(`${API_URL}/user/${result.userId}`);
            const fullUser = await userResponse.json();
            const user = {
                id: fullUser._id,
                name: fullUser.name,
                city: fullUser.city,
                region: fullUser.region,
                chatHandle: fullUser.chatHandle,
                initials: (fullUser.name || 'U')
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
            errorMsg.textContent = 'Server error. Please try again.';
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
        continueBtn = document.getElementById('continueBtn');
        errorMsg = document.getElementById('error-msg');
        otpBoxesWrap = document.getElementById('otpBoxes');
        otpBoxes = Array.from(document.querySelectorAll('#view-verification .otp-box'));
        resendLink = document.getElementById('resendCodeLink');
        editLink = document.getElementById('editContactLink');

        const updateKeyboardShift = () => {
            if (!verifyCard || !focusedOtp) return;
            const viewportBottom = (window.visualViewport?.height || window.innerHeight) - 18;
            const fieldBottom = focusedOtp.getBoundingClientRect().bottom;
            const shift = Math.min(0, viewportBottom - fieldBottom - 72);
            verifyCard.style.setProperty('--verify-keyboard-shift', `${shift}px`);
        };

        const clearKeyboardShift = () => {
            verifyCard?.style.removeProperty('--verify-keyboard-shift');
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