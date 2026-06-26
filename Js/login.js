// ============================================================
//  LOGIN.JS — Sign In + Remember Me + Auto Sign-in (PWA)
// ============================================================

// ── Storage keys ─────────────────────────────────────────────
const AUTH_KEY     = 'app_auth_token';
const USER_KEY     = 'app_user';
const REMEMBER_KEY = 'app_remember';

// ── DOM refs ──────────────────────────────────────────────────
const userInput   = document.getElementById('user-input');
const sendCodeBtn = document.getElementById('sendCodebtn');
const errorMsg    = document.getElementById('error-msg');


// ============================================================
//  SESSION HELPERS
// ============================================================

// Save session — localStorage if Remember Me, sessionStorage if not
function saveSession(user, token, rememberMe) {
    if (rememberMe) {
        localStorage.setItem(AUTH_KEY,     token);
        localStorage.setItem(USER_KEY,     JSON.stringify(user));
        localStorage.setItem(REMEMBER_KEY, 'true');
    } else {
        sessionStorage.setItem(AUTH_KEY, token);
        sessionStorage.setItem(USER_KEY, JSON.stringify(user));
        localStorage.removeItem(REMEMBER_KEY);
    }
}

// Read session from whichever storage was used
function getSession() {
    const remembered = localStorage.getItem(REMEMBER_KEY) === 'true';

    const token  = remembered
        ? localStorage.getItem(AUTH_KEY)
        : sessionStorage.getItem(AUTH_KEY);

    const userRaw = remembered
        ? localStorage.getItem(USER_KEY)
        : sessionStorage.getItem(USER_KEY);

    if (!token || !userRaw) return null;

    return { token, user: JSON.parse(userRaw), remembered };
}

// Wipe everything on sign out
function clearSession() {
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(REMEMBER_KEY);
    sessionStorage.removeItem(AUTH_KEY);
    sessionStorage.removeItem(USER_KEY);
}


// ============================================================
//  AUTO SIGN-IN — runs on page load
//  If a saved session exists, skip the login page entirely
// ============================================================
function checkAutoSignIn() {
    const session = getSession();

    if (session) {
        console.log('✅ Auto signed in as', session.user.chatHandle);
        // Already verified before — go straight to the app
        window.location.href = './pages/home.html'; // ← adjust path if needed
        return true;
    }

    return false; // no saved session, stay on login page
}


// ============================================================
//  SIGN IN HANDLER
//  Validates input → calls your /signin backend →
//  saves Remember Me flag → goes to verification page
// ============================================================
async function handleSubmit() {
    const loginInput = userInput.value.trim();
    const rememberMe = document.getElementById('rememberMe')?.checked || false;

    errorMsg.textContent = "";

    // 1. Empty check
    if (!loginInput) {
        errorMsg.textContent = "Input cannot be empty";
        return;
    }

    // 2. Format check
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginInput);
    const isPhone = /^[0-9]{10}$/.test(loginInput);

    if (!isEmail && !isPhone) {
        errorMsg.textContent = "Enter valid email or 10-digit phone number";
        return;
    }

    // 3. Call your /signin backend
    try {
        const response = await fetch(`${API_URL}/signin`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ emailPhone: loginInput })
        });

        const result = await response.json();

        if (!response.ok) {
            errorMsg.textContent = result.error || "No account found";
            return;
        }

        // 4. Save everything verification.js will need
        localStorage.setItem("userIdentifier",  loginInput);
        localStorage.setItem("maskedContact",   result.maskedContact);
        localStorage.setItem("pendingUserId",   result.userId);

        if (result.chatHandle) {
            localStorage.setItem("chatHandle", result.chatHandle);
        }

        // ✅ Save Remember Me choice so verification.js can use it
        //    after the code is confirmed
        localStorage.setItem("rememberMePending", rememberMe ? "true" : "false");

        // 5. Go to verification page
        window.location.href = "./pages/verification.html";

    } catch (error) {
        console.error(error);
        errorMsg.textContent = "Server not running or unreachable";
    }
}


// ============================================================
//  EVENTS
// ============================================================
sendCodeBtn.addEventListener('click', (event) => {
    event.preventDefault();
    handleSubmit();
});

userInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        handleSubmit();
    }
});

// Auto sign-in check — if already remembered, skip to app
document.addEventListener('DOMContentLoaded', () => {
    checkAutoSignIn();
});