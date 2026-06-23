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