// signup.js
// Sends data to backend to START signup. User is NOT saved
// to users.json until they pass the verification page.

const nameInput = document.getElementById('name');
const emailPhoneInput = document.getElementById('email-phone');
const regionInput = document.getElementById('region');
const cityInput = document.getElementById('city');
const notifyUpdatesInput = document.getElementById('notifyUpdates');
const form = document.getElementById('signupForm');
const errorEl = document.getElementById('email_phone-error');
const submitBtn = document.getElementById('signUpBtn');

// If someone lands here via the verification page's "Edit" link, restore
// what they'd already typed so fixing a typo'd email/phone doesn't mean
// retyping everything else.
(function prefillFromPriorAttempt() {
    try {
        const saved = JSON.parse(localStorage.getItem('signupUser') || 'null');
        if (!saved) return;
        if (saved.name) nameInput.value = saved.name;
        if (saved.emailPhone) emailPhoneInput.value = saved.emailPhone;
        if (saved.region) regionInput.value = saved.region;
        if (saved.city) cityInput.value = saved.city;
        if (notifyUpdatesInput && typeof saved.wantsAlerts === 'boolean') {
            notifyUpdatesInput.checked = saved.wantsAlerts;
        }
    } catch {
        // Ignore malformed/missing data — form just starts blank.
    }
})();

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
    return /^\d{10}$/.test(phone);
}

function setLoading(isLoading) {
    if (!submitBtn) return;
    submitBtn.classList.toggle('is-loading', isLoading);
    submitBtn.disabled = isLoading;
}

// Ask for push permission from *this* click/tap, not from the checkbox's
// 'change' event. The checkbox defaults to checked, so for anyone who
// just leaves it on and submits, 'change' never fires and permission
// was never requested. Calling this here, before any await in
// handleSignup(), keeps it inside the same user gesture the browser
// (notably iOS Safari) requires for Notification.requestPermission().
//
// IMPORTANT: this returns the enableLightWatchPush() promise so the
// caller can await it. The native permission dialog it triggers is an
// OS-level prompt — while it's on screen, mobile browsers (iOS Safari
// and Android Chrome both do this) can throttle or drop in-flight
// network requests on the page underneath it. If the signup fetch
// below is fired while that dialog is still up, it fails with a
// generic network error ("Could not reach the server") on this first
// submit only — the very next submit has permission already decided,
// no dialog appears, and it works. Awaiting this call before making
// any network request avoids the overlap.
async function requestPushIfWanted() {
    if (notifyUpdatesInput?.checked && typeof window.enableLightWatchPush === 'function') {
        try {
            await window.enableLightWatchPush();
        } catch (err) {
            // Never let a push opt-in failure block signup itself.
            console.error('Push opt-in failed (continuing signup):', err);
        }
    }
}

async function handleSignup() {
    const userData = {
        name: nameInput.value.trim(),
        emailPhone: emailPhoneInput.value.trim(),
        region: regionInput.value,
        city: cityInput.value.trim(),
        wantsAlerts: Boolean(notifyUpdatesInput?.checked)
    };

    errorEl.textContent = "";

    if (!userData.name || !userData.emailPhone || !userData.region || !userData.city) {
        return;
    }

    const validEmail = isValidEmail(userData.emailPhone);
    const validPhone = isValidPhone(userData.emailPhone);

    if (!validEmail && !validPhone) {
        errorEl.textContent = "Enter a valid email or phone number";
        return;
    }

    // Validation passed and we're about to go async — this is the last
    // synchronous moment in this user gesture, so request push here.
    // We await it so the permission dialog fully resolves before the
    // signup fetch below ever fires (see comment on the function).
    await requestPushIfWanted();

    setLoading(true);

    try {
        const response = await fetch(`${API_URL}/signup`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(userData)
        });

        const result = await response.json();

        if (!response.ok) {
            errorEl.textContent = result.error || "Something went wrong";
            setLoading(false);
            return;
        }

        // Store who is verifying so the verification page can ask the server
        localStorage.setItem("userIdentifier", result.emailPhone);
        localStorage.setItem("maskedContact", result.maskedContact);
        localStorage.setItem("signupUser", JSON.stringify(userData));

        // Auto-save sign-in on this browser after signup verification.
        // User can still explicitly sign out at any time.
        localStorage.setItem("rememberMePending", "true");

        document.body.classList.add('lw-leaving');
        setTimeout(() => window.location.replace("../pages/verification.html"), 220);

    } catch (error) {
        console.error("Signup failed:", error);
        errorEl.textContent = "Could not reach the server. Is it running?";
        setLoading(false);
    }
}

form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (submitBtn?.disabled) return;
    handleSignup();
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !submitBtn?.disabled) {
        e.preventDefault();
        handleSignup();
    }
});

// Also request push immediately if the user explicitly flips the
// toggle on mid-visit (covers the case where it started unchecked).
if (notifyUpdatesInput) {
    notifyUpdatesInput.addEventListener('change', () => {
        if (!notifyUpdatesInput.checked) return;
        if (typeof window.enableLightWatchPush === 'function') {
            window.enableLightWatchPush();
        }
    });
}