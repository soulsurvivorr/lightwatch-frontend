// ============================================================
//  VERIFICATION.JS
//  Requires: auth.js loaded BEFORE this script
// ============================================================

const userValue     = sessionStorage.getItem('userIdentifier');
const maskedContact = sessionStorage.getItem('maskedContact');

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
const otpInput    = document.getElementById('otp-input');

async function checkOTP() {
    const otpValue  = otpInput.value.trim();
    const emailPhone = sessionStorage.getItem('userIdentifier');

    errorMsg.textContent = '';

    if (!otpValue) {
        errorMsg.textContent = 'Please enter the code';
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

        // Build user object and save session
        const rememberMe = sessionStorage.getItem('rememberMePending') === 'true';
        const user = {
            id:       result.userId,
            chatHandle: result.chatHandle,
            name:     result.chatHandle,
            initials: (result.chatHandle || 'U').slice(0, 2).toUpperCase()
        };

        saveSession(user, result.userId, rememberMe); // from auth.js

        // Clean up all temporary sign-in data
        ['userIdentifier', 'maskedContact', 'pendingUserId',
         'rememberMePending', 'chatHandle', 'signupUser'
        ].forEach(k => sessionStorage.removeItem(k));

        window.location.replace('../pages/home.html');

    } catch (err) {
        console.error('Verification failed:', err);
        errorMsg.textContent = 'Server error. Please try again.';
    } finally {
        continueBtn.disabled = false;
    }
}

continueBtn.addEventListener('click', e => { e.preventDefault(); checkOTP(); });
otpInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); checkOTP(); } });