// ============================================================
//  LOGIN.JS — Sign In + Remember Me + Auto Sign-in (PWA)
//  Requires: auth.js loaded BEFORE this script
// ============================================================

const userInput   = document.getElementById('user-input');
const sendCodeBtn = document.getElementById('sendCodebtn');
const errorMsg    = document.getElementById('error-msg');
const brandLoopTargets = [
    document.getElementById('brandLoopText'),
    document.getElementById('brandLoopTextDesktop')
].filter(Boolean);

const brandLoopTexts = [
    'Community-powered. Stay ahead of outages',
    'Know before you go—powered by your community'
];

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function typeBrandLoopText(target, text) {
    target.textContent = '';
    for (let i = 0; i < text.length; i += 1) {
        target.textContent = text.slice(0, i + 1);
        await wait(38);
    }
}

async function runBrandLoop() {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!brandLoopTargets.length) return;

    if (reduceMotion) {
        brandLoopTargets.forEach((target, index) => {
            target.textContent = brandLoopTexts[index % brandLoopTexts.length];
        });
        return;
    }

    let index = 0;
    while (true) {
        const text = brandLoopTexts[index % brandLoopTexts.length];
        await Promise.all(brandLoopTargets.map(target => typeBrandLoopText(target, text)));
        await wait(1400);
        index += 1;
    }
}

// ── Auto sign-in: remembered users or valid 24h signup session ─
document.addEventListener('DOMContentLoaded', () => {
    const session = getSession(); // from auth.js
    if (session) {
        window.location.replace('./pages/home.html');
    }
});

// ── Registered user count for the "Registered users" stat ────
// Public, no-auth endpoint — just a headline number. If it fails
// for any reason (offline, cold backend, etc.) we just leave the
// "—" placeholder rather than showing an error on the sign-in page.
async function loadUserCountStat() {
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
loadUserCountStat();
runBrandLoop();

// ── Send OTP code ─────────────────────────────────────────────
async function handleSubmit() {
    errorMsg.textContent = '';

    // Normalize first (trims whitespace-only input down to empty) so the
    // native "required" check below also catches someone who just typed
    // spaces, then let the browser show its own validation bubble instead
    // of a custom "cannot be empty" message.
    userInput.value = userInput.value.trim();

    // Note: userInput is type="email" (for browser autofill suggestions),
    // so its native checkValidity()/reportValidity() only accept email-shaped
    // strings and would incorrectly reject valid phone numbers. We do our
    // own required + format check below instead of relying on those.
    if (!userInput.value) {
        userInput.reportValidity();
        return;
    }

    const loginInput = userInput.value;
    const rememberMe = document.getElementById('rememberMe')?.checked || false;

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

        showPageTransitionOverlay('Sending your code…');
        setTimeout(() => { window.location.href = './pages/verification.html'; }, 260);
        return;

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

// ── Create account links — same branded hand-off as everywhere else ──
document.querySelectorAll('a[href="./pages/signup.html"]').forEach(link => {
    link.addEventListener('click', e => {
        e.preventDefault();
        showPageTransitionOverlay('Taking you to sign up…');
        setTimeout(() => window.location.href = link.href, 260);
    });
});