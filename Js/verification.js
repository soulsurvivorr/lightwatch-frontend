// ============================================================
//  VERIFICATION.JS
//  Requires: auth.js loaded BEFORE this script
// ============================================================

function getVerificationValue(key) {
    return sessionStorage.getItem(key) || localStorage.getItem(key);
}

const userValue     = getVerificationValue('userIdentifier');
const maskedContact = getVerificationValue('maskedContact');

document.getElementById('code-text').textContent =
    `Enter the code we sent to ${maskedContact || maskValue(userValue)}`;

function maskValue(value) {
    if (!value) return '';
    if (value.includes('@')) {
        const [name, domain] = value.split('@');
        return name[0] + '*****@' + domain;
    }
    return value[0] + '*******' + value[value.length - 1];
}

const continueBtn = document.getElementById('continueBtn');
const errorMsg    = document.getElementById('error-msg');
const otpBoxes    = Array.from(document.querySelectorAll('.otp-box'));
const resendLink  = document.getElementById('resendCodeLink');

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

// -----------------------------------------------------
// Wire up each box: digits only, auto-advance to the next
// box when filled, jump back on backspace when empty, and
// support pasting the whole code at once.
// -----------------------------------------------------
otpBoxes.forEach((box, index) => {
    box.addEventListener('input', () => {
        box.value = box.value.replace(/[^0-9]/g, '').slice(0, 1);

        if (box.value && index < otpBoxes.length - 1) {
            otpBoxes[index + 1].focus();
        }

        updateButtonState();
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
        updateButtonState();
    });
});

// -----------------------------------------------------
// MAIN: verify the OTP code entered across the 4 boxes
// -----------------------------------------------------
otpBoxes[0]?.focus();

async function checkOTP() {
    const otpValue  = getOtpValue();
    const emailPhone = getVerificationValue('userIdentifier');

    errorMsg.textContent = '';

    if (otpValue.length < otpBoxes.length) {
        errorMsg.textContent = 'Please enter the full code';
        return;
    }

    continueBtn.disabled = true;

    try {
        const response = await fetch(`${API_URL}/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emailPhone, code: otpValue })
        });

        const result = await response.json();

        if (!response.ok) {
            errorMsg.textContent = result.error || 'Incorrect code';
            return;
        }


        const rememberMe = getVerificationValue('rememberMePending') === 'true';
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

        // Clean up all temporary sign-in/signup data from BOTH storages —
        // sign-in stashes these in sessionStorage, signup stashes them in
        // localStorage.
        ['userIdentifier', 'maskedContact', 'pendingUserId',
         'rememberMePending', 'chatHandle', 'signupUser'
        ].forEach(k => {
            sessionStorage.removeItem(k);
            localStorage.removeItem(k);
        });

        window.location.replace('../pages/home.html');

    } catch (err) {
        console.error('Verification failed:', err);
        errorMsg.textContent = 'Server error. Please try again.';
    } finally {
        continueBtn.disabled = false;
    }
}

continueBtn.addEventListener('click', e => { e.preventDefault(); checkOTP(); });

// -----------------------------------------------------
// RESEND CODE — wires up the "Get a new code" link to the
// backend's /resend route (this was sitting unwired before).
// -----------------------------------------------------
resendLink?.addEventListener('click', async () => {
    const emailPhone = getVerificationValue('userIdentifier');
    if (!emailPhone) return;

    const originalText = resendLink.textContent;
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
            return;
        }

        otpBoxes.forEach(box => { box.value = ''; box.classList.remove('filled'); });
        updateButtonState();
        otpBoxes[0]?.focus();

    } catch (err) {
        console.error('Resend failed:', err);
        errorMsg.textContent = 'Server error. Please try again.';
    } finally {
        resendLink.textContent = originalText;
    }
});