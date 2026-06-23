const storedUser = JSON.parse(localStorage.getItem("userData"));

if (storedUser) {
    const nameParts = storedUser.name.trim().split(" ");

    const displayName = nameParts.length > 1
        ? nameParts[nameParts.length - 1]
        : nameParts[0];

    const hour = new Date().getHours();

    let greeting = "Good Evening";

    if (hour < 12) {
        greeting = "Good Morning";
    } else if (hour < 18) {
        greeting  = "Good Afternoon"
    }

    document.getElementById("page__title").textContent = 
        `${greeting}, ${displayName}`;
    document.querySelector(".avatar-name").textContent = 
        storedUser.name;
}

const avatar = document.querySelector('.avatar');

    avatar.textContent = storedUser.name 
        .split(/\s+/)
        .map(word => word[0])
        .join("")
        .toUpperCase();
