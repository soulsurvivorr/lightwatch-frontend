// signup.js
// Sends data to backend to START signup. User is NOT saved
// to users.json until they pass the verification page.

const nameInput = document.getElementById('name');
const emailPhoneInput = document.getElementById('email-phone');
const regionInput = document.getElementById('region');
const cityInput = document.getElementById('city');
const form = document.getElementById('signupForm');

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
    return /^\d{10}$/.test(phone);
}

async function handleSignup() {
    const userData = {
        name: nameInput.value.trim(),
        emailPhone: emailPhoneInput.value.trim(),
        region: regionInput.value,
        city: cityInput.value.trim()
    };

    document.getElementById('email_phone-error').textContent = "";

    if (!userData.name || !userData.emailPhone || !userData.region || !userData.city) {
        return;
    }

    const validEmail = isValidEmail(userData.emailPhone);
    const validPhone = isValidPhone(userData.emailPhone);

    if (!validEmail && !validPhone) {
        document.getElementById('email_phone-error').textContent =
            "Enter a valid email or phone number";
        return;
    }

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
            document.getElementById('email_phone-error').textContent =
                result.error || "Something went wrong";
            return;
        }

        // Store who is verifying so the verification page can ask the server
        localStorage.setItem("userIdentifier", result.emailPhone);
        localStorage.setItem("maskedContact", result.maskedContact);
        localStorage.setItem("signupUser", JSON.stringify(userData));

        // Ask whether this browser should stay signed in permanently.
        // If user declines, verification flow keeps a 24h temporary session.
        const rememberChoice = window.confirm(
            "Save your sign-in on this device for next time?\n\n" +
            "OK = stay signed in on this browser\n" +
            "Cancel = sign in normally each time (temporary 24h keep-after-signup)"
        );
        localStorage.setItem("rememberMePending", rememberChoice ? "true" : "false");

        window.location.replace("../pages/verification.html");

    } catch (error) {
        console.error("Signup failed:", error);
        document.getElementById('email_phone-error').textContent =
            "Could not reach the server. Is it running?";
    }
}

form.addEventListener("submit", (e) => {
    e.preventDefault();
    handleSignup();
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        handleSignup();
    }
});