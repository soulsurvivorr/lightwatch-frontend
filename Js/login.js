// Handles the sign-in form: takes an email or phone number,
// asks the backend if that account exists, and moves the
// user forward if it does.
const userInput = document.getElementById('user-input');
const sendCodebtn = document.getElementById('sendCodebtn');
const errorMsg = document.getElementById('error-msg');

// SIGN IN HANDLER
async function handleSubmit() {
    const loginInput = userInput.value.trim();
    const rememberMe = document.getElementById('rememberMe');

    errorMsg.textContent = "";

    // 1. empty check
    if (!loginInput) {
        errorMsg.textContent = "Input cannot be empty";
        return;
    }

    // 2. format check
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginInput);
    const isPhone = /^[0-9]{10}$/.test(loginInput);

    if (!isEmail && !isPhone) {
        errorMsg.textContent = "Enter valid email or 10-digit phone number";
        return;
    }

    // 3. SEND TO BACKEND
    try {
        const response = await fetch(`${API_URL}/signin`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"  
            },
            body: JSON.stringify({
                emailPhone: loginInput
            })
        });

        const result = await response.json();

        // backend rejected login
        if (!response.ok) {
            errorMsg.textContent = result.error || "No account found";  
            return;
        }

        // 4. SAVE WHO IS VERIFYING (so verification.js can ask the server)
        localStorage.setItem("userIdentifier", loginInput);
        localStorage.setItem("maskedContact", result.maskedContact);
        if (result.chatHandle) {
            localStorage.setItem("chatHandle", result.chatHandle);
        }

        if (rememberMe?.checked) {
            localStorage.setItem("rememberMe", true);
        }

        // 5. NEXT PAGE
        window.location.href = "./pages/verification.html";

    } catch (error) {
        console.error(error);
        errorMsg.textContent = "Server not running or unreachable";
    }
}

// ============================================================
//  AUTH.JS — Remember Me + Auto Sign-in for PWA
// ============================================================

const AUTH_KEY   = 'app_auth_token';
const USER_KEY   = 'app_user';
const REMEMBER_KEY = 'app_remember';

// ── SAVE session after login ─────────────────────────────────
function saveSession(user, token, rememberMe) {
  if (rememberMe) {
    // Persists even after browser/PWA close
    localStorage.setItem(AUTH_KEY,     token);
    localStorage.setItem(USER_KEY,     JSON.stringify(user));
    localStorage.setItem(REMEMBER_KEY, 'true');
  } else {
    // Clears when tab/browser closes
    sessionStorage.setItem(AUTH_KEY, token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    localStorage.removeItem(REMEMBER_KEY); // clear old remember flag
  }
}

// ── READ saved session ────────────────────────────────────────
function getSession() {
  const remembered = localStorage.getItem(REMEMBER_KEY) === 'true';

  const token = remembered
    ? localStorage.getItem(AUTH_KEY)
    : sessionStorage.getItem(AUTH_KEY);

  const userRaw = remembered
    ? localStorage.getItem(USER_KEY)
    : sessionStorage.getItem(USER_KEY);

  if (!token || !userRaw) return null;

  return {
    token,
    user: JSON.parse(userRaw),
    remembered
  };
}

// ── CLEAR session on sign out ─────────────────────────────────
function clearSession() {
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(REMEMBER_KEY);
  sessionStorage.removeItem(AUTH_KEY);
  sessionStorage.removeItem(USER_KEY);
}

// ── AUTO SIGN-IN on page load ─────────────────────────────────
function checkAutoSignIn() {
  const session = getSession();

  if (session) {
    console.log('✅ Auto signed in as', session.user.name);
    onSignedIn(session.user, session.token); // go straight to app
    return true;
  }

  return false; // show login screen
}

// ── Called when sign-in succeeds (from your login form) ───────
function handleLoginSubmit(event) {
  event.preventDefault();

  const email      = document.getElementById('email').value.trim();
  const password   = document.getElementById('password').value;
  const rememberMe = document.getElementById('rememberMe').checked;

  // 🔁 Replace this with your real API call
  fakeLoginAPI(email, password).then(({ user, token }) => {
    saveSession(user, token, rememberMe);
    onSignedIn(user, token);
  }).catch(() => {
    showLoginError('Incorrect email or password.');
  });
}

// ── What to do once signed in ─────────────────────────────────
function onSignedIn(user, token) {
  // Hide login screen, show app
  document.getElementById('loginScreen')?.classList.add('hidden');
  document.getElementById('appShell')?.classList.remove('hidden');

  // Update profile card / topbar
  const nameEls = document.querySelectorAll('[data-user-name]');
  nameEls.forEach(el => el.textContent = user.name);

  const avatarEls = document.querySelectorAll('[data-user-avatar]');
  avatarEls.forEach(el => el.textContent = user.initials || user.name[0]);
}

// ── Sign out ──────────────────────────────────────────────────
function signOut() {
  clearSession();
  location.reload(); // or redirect to login page
}

// ── Wire up on DOM ready ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Try auto sign-in first
  if (checkAutoSignIn()) return;

  // Wire login form
  document.getElementById('loginForm')
    ?.addEventListener('submit', handleLoginSubmit);

  // Wire sign-out button(s)
  document.querySelectorAll('[data-action="signout"]')
    .forEach(btn => btn.addEventListener('click', signOut));
});

// ── Fake API (replace with yours) ────────────────────────────
function fakeLoginAPI(email, password) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (email && password) {
        resolve({
          token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.demo',
          user: {
            name: 'John Doe',
            initials: 'JD',
            email,
            role: 'Admin'
          }
        });
      } else {
        reject(new Error('Invalid credentials'));
      }
    }, 600);
  });
}

// EVENTS
sendCodebtn.addEventListener('click', (event) => {
    event.preventDefault();
    handleSubmit();
});

userInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        handleSubmit();
    }
});