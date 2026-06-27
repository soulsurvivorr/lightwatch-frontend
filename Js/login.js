// ============================================================
//  LOGIN.JS — Sign In + Remember Me + Auto Sign-in (PWA)
//  Requires: auth.js loaded BEFORE this script
// ============================================================

const userInput   = document.getElementById('user-input');
const sendCodeBtn = document.getElementById('sendCodebtn');
const errorMsg    = document.getElementById('error-msg');

// ── Auto sign-in: if already logged in, skip to app ──────────
document.addEventListener('DOMContentLoaded', () => {
    const session = getSession(); // from auth.js
    if (session) {
        window.location.replace('./pages/home.html');
    }
});

// ── Send OTP code ─────────────────────────────────────────────
async function handleSubmit() {
    const loginInput = userInput.value.trim();
    const rememberMe = document.getElementById('rememberMe')?.checked || false;

    errorMsg.textContent = '';

    if (!loginInput) {
        errorMsg.textContent = 'Input cannot be empty';
        return;
    }

    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginInput);
    const isPhone = /^[0-9]{10}$/.test(loginInput);

    if (!isEmail && !isPhone) {
        errorMsg.textContent = 'Enter valid email or 10-digit phone number';
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

        // Store what verification.js needs
        sessionStorage.setItem('userIdentifier',  loginInput);
        sessionStorage.setItem('maskedContact',   result.maskedContact);
        sessionStorage.setItem('pendingUserId',   result.userId);
        sessionStorage.setItem('rememberMePending', rememberMe ? 'true' : 'false');

        if (result.chatHandle) {
            sessionStorage.setItem('chatHandle', result.chatHandle);
        }

        window.location.href = './pages/verification.html';

    } catch (err) {
        console.error(err);
        errorMsg.textContent = 'Server not running or unreachable';
    } finally {
        sendCodeBtn.disabled = false;
        sendCodeBtn.textContent = 'Send code';
    }
}

sendCodeBtn.addEventListener('click', e => { e.preventDefault(); handleSubmit(); });
userInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); } });