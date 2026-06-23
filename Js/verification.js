// verification.js
// Now sends the code to the server. If 5687 is correct,
// the server FINALLY saves the user to users.json.

const userValue = localStorage.getItem("userIdentifier");
const maskedContact = localStorage.getItem("maskedContact");
const displayValue = maskedContact || maskValue(userValue);

document.getElementById("code-text").textContent =
    `Enter the code we sent to ${displayValue}`;

function maskValue(value) {
    if (!value) return "";
    if (value.includes("@")) {
        const [name, domain] = value.split("@");
        return name[0] + "*****@" + domain;
    }
    return value[0] + "*******" + value[value.length - 1];
}

const continueBtn = document.getElementById('continueBtn');
const errorMsg = document.getElementById('error-msg');
const otpInput = document.getElementById('otp-input');

async function checkOTP() {
    const otpValue = otpInput.value.trim();
    const emailPhone = localStorage.getItem("userIdentifier");

    errorMsg.textContent = "";

    if (!otpValue) {
        errorMsg.textContent = "Please enter the code";
        return;
    }

    try {
        const response = await fetch(`${API_URL}/verify`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                emailPhone: emailPhone,
                code: otpValue
            })
        });

        const result = await response.json();

        if (!response.ok) {
            errorMsg.textContent = result.error || "Incorrect code";
            return;
        }

        // Code correct — user is now saved in the database!
        localStorage.setItem("currentUserId", result.userId);
        localStorage.setItem("maskedContact", result.maskedContact);

        if (result.chatHandle) {
            localStorage.setItem("chatHandle", result.chatHandle);
        }

        const signupUser = localStorage.getItem("signupUser");
        if (signupUser) {
            const userData = JSON.parse(signupUser);
            if (result.chatHandle) {
                userData.chatHandle = result.chatHandle;
            }
            localStorage.setItem("currentUserData", JSON.stringify(userData));
        }

        localStorage.removeItem("userIdentifier");

        window.location.href = '../pages/home.html';

    } catch (error) {
        console.error("Verification failed:", error);
        errorMsg.textContent = "Server error. Please try again.";
    }
}

continueBtn.addEventListener('click', (event) => {
    event.preventDefault();
    checkOTP();
});

otpInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        checkOTP();
    }
});