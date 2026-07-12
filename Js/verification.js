// ============================================================
//  VERIFICATION.JS
//  Requires: auth.js loaded BEFORE this script
// ============================================================

const RESEND_COOLDOWN_SECONDS = 60;

function getVerificationValue(key) {
    return sessionStorage.getItem(key) || localStorage.getItem(key);
}

const userValue     = getVerificationValue('userIdentifier');
const maskedContact = getVerificationValue('maskedContact');
const isSignupFlow  = !!getVerificationValue('signupUser');

document.getElementById('code-text').textContent =
    `Enter the code we sent to ${maskedContact || maskValue(userValue)}`;

function maskValue(value) {
    if (!value) return '';
    if (value.includes('@')) {
        const [name, domain] = value.split('@');
        const visible = name.slice(0, 3);
        const hiddenLen = Math.max(name.length - visible.length, 3);
        return visible + '*'.repeat(hiddenLen) + '@' + domain;
    }
    const visible = value.slice(0, 3);
    const hiddenLen = Math.max(value.length - visible.length, 3);
    return visible + '*'.repeat(hiddenLen);
}

const verifyCard    = document.getElementById('verifyCard');
const continueBtn   = document.getElementById('continueBtn');
const errorMsg      = document.getElementById('error-msg');
const otpBoxesWrap  = document.getElementById('otpBoxes');
const otpBoxes      = Array.from(document.querySelectorAll('.otp-box'));
const resendLink    = document.getElementById('resendCodeLink');
const editLink      = document.getElementById('editContactLink');

// Editing the email/phone means going back to the form that collected
// it. We only know how to route that back for the signup flow (that's
// the page we have); hide the link otherwise rather than send someone
// somewhere wrong.
if (editLink && !isSignupFlow) {
    editLink.style.display = 'none';
}

// -----------------------------------------------------
// Combine the 4 boxes into one code string
// -----------------------------------------------------
function getOtpValue() {
    return otpBoxes.map(box => box.value).join('');
}

// -----------------------------------------------------
// Enable + turn the button gold only once every box has
// a digit in it. Also toggles a "filled" class per box
// (used purely for the underline color change in CSS).
// -----------------------------------------------------
function updateButtonState() {
    otpBoxes.forEach(box => box.classList.toggle('filled', box.value !== ''));
    const isFull = getOtpValue().length === otpBoxes.length;
    continueBtn.disabled = !isFull;
    continueBtn.classList.toggle('active', isFull);
}

// Auto-submit once every box is filled — but give the button a brief
// moment to visibly switch to its "active" (filled-in) color first,
// instead of jumping straight from empty to the loading spinner.
function autoSubmitWhenFull() {
    updateButtonState();
    if (getOtpValue().length === otpBoxes.length) {
        setTimeout(checkOTP, 220);
    }
}

function shakeOtpBoxes() {
    otpBoxesWrap.classList.remove('is-shaking');
    // Force reflow so the animation can re-trigger on repeated errors
    void otpBoxesWrap.offsetWidth;
    otpBoxesWrap.classList.add('is-shaking');
}

// -----------------------------------------------------
// Wire up each box: digits only, auto-advance to the next
// box when filled, jump back on backspace when empty, and
// support pasting the whole code at once.
// -----------------------------------------------------
otpBoxes.forEach((box, index) => {
    box.addEventListener('input', () => {
        const digits = box.value.replace(/[^0-9]/g, '');

        // iOS Safari natively fills one digit per box when every box has
        // autocomplete="one-time-code". Some other browsers' AutoFill
        // (notably Android/Chrome) instead drop the entire code into
        // whichever box was focused — same shape as a paste, so handle
        // it the same way rather than only taking the first digit.
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

// -----------------------------------------------------
// MAIN: verify the OTP code entered across the 4 boxes
// -----------------------------------------------------
otpBoxes[0]?.focus();

let verifyInFlight = false;

async function checkOTP() {
    if (verifyInFlight) return;

    const otpValue  = getOtpValue();
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
        const userResponse = await fetch (`${API_URL}/user/${result.userId}`);
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

        // Signup without permanent remember: keep a temporary browser session
        // for 24h, then require sign-in again.
        if (!rememberMe && signupFlow) {
            const oneDayMs = 24 * 60 * 60 * 1000;
            localStorage.setItem('app_temp_auth_token', result.userId);
            localStorage.setItem('app_temp_user', JSON.stringify(user));
            localStorage.setItem('app_temp_expires_at', String(Date.now() + oneDayMs));
        }

        // Clean up all temporary sign-in/signup data from BOTH storages —
        // sign-in stashes these in sessionStorage, signup stashes them in
        // localStorage.
        ['userIdentifier', 'maskedContact', 'pendingUserId',
         'rememberMePending', 'chatHandle', 'signupUser'
        ].forEach(k => {
            sessionStorage.removeItem(k);
            localStorage.removeItem(k);
        });

        // Small success moment, then the same branded overlay used
        // everywhere else in the auth flow, before we hand off to home.html.
        verifyCard.classList.add('is-success');
        setTimeout(() => {
            showPageTransitionOverlay('Verified — taking you in…');
            setTimeout(() => window.location.replace('../pages/home.html'), 260);
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

continueBtn.addEventListener('click', e => { e.preventDefault(); checkOTP(); });

// -----------------------------------------------------
// RESEND CODE — wires up the "Get a new code" link to the
// backend's /resend route, plus a 60s cooldown so it can't
// be spammed. The link is disabled and shows a countdown
// until the cooldown runs out.
// -----------------------------------------------------
let cooldownInterval = null;

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

// A code was already sent to land us on this page — start the
// cooldown right away rather than waiting for a resend click.
startResendCooldown();

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