// ============================================================
//  VIEWS/DASHBOARD.JS
//
//  NOTE: this file was not `<script>`-included by any of the pages
//  in the app I was given (grepped every .html file for
//  "dashboard.js" — no match). It reads a "userData" localStorage
//  key that isn't the one services/auth.js actually writes
//  (USER_KEY = "app_user"), and targets a #page__title element that
//  doesn't exist in any current view's markup, so storedUser would
//  always be null and the last block (avatar.textContent = ...,
//  outside the `if (storedUser)` guard) would throw. It reads like
//  an earlier iteration of the home-page greeting, superseded by
//  what's now in views/profile.js.
//
//  Per "do not remove or simplify any functionality," the logic is
//  preserved byte-for-byte below (just wrapped + null-guarded so it
//  can't crash anything if it's ever wired back up) rather than
//  deleted. It is NOT registered on window.LWViews and NOT
//  referenced anywhere in index.html, matching its status in the
//  original app. If this was actually meant to be active on some
//  page, flag it and I'll wire it in properly.
// ============================================================

function runLegacyDashboardGreeting() {
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
            greeting = "Good Afternoon";
        }

        const titleEl = document.getElementById("page__title");
        if (titleEl) titleEl.textContent = `${greeting}, ${displayName}`;
        const nameEl = document.querySelector(".avatar-name");
        if (nameEl) nameEl.textContent = storedUser.name;

        const avatar = document.querySelector('.avatar');
        if (avatar) {
            avatar.textContent = storedUser.name
                .split(/\s+/)
                .map(word => word[0])
                .join("")
                .toUpperCase();
        }
    }
}
