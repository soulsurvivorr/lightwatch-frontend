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
const otpInput    = document.getElementById('otp-input');

async function checkOTP() {
    const otpValue  = otpInput.value.trim();
    const emailPhone = getVerificationValue('userIdentifier');

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

// Update button color base on input
function updateButtonState() {
    if (otpInput.value.trim().length > 0) {
        continueBtn.classList.add('active');
    } else {
        continueBtn.classList.remove('active');
    }
}

otpInput.addEventListener('input', updateButtonState);
continueBtn.addEventListener('click', e => { e.preventDefault(); checkOTP(); });
otpInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); checkOTP(); } });