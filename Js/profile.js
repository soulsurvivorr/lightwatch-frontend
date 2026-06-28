// profile.js
// Makes the profile sections (sidebar card + topbar avatar +
// the dedicated profile card on this page) interactive and
// driven by real signed-up user data — not hardcoded HTML.
//
// How the data gets here:
//   1. signup.js / login.js save "currentUserId" into
//      localStorage after a successful signup or sign-in.
//   2. This file reads that ID, then asks the backend
//      (GET /user/:id) for the full profile: name,
//      emailPhone, location.
//   3. Every profile-shaped element on the page gets filled
//      in from that one response, so the signup form data
//      automatically appears here with no extra wiring.


// HELPER: turn a name into initials for the avatar circle
// "Stephen Opoku" -> "SO"
// -----------------------------------------------------
function getInitials(name) {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    const first = parts[0]?.[0] || "";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (first + last).toUpperCase();
}


// -----------------------------------------------------
// HELPER: mask contact info for display
// (same logic as signup.js, kept in sync)
// -----------------------------------------------------
function maskContactDisplay(value) {
    if (!value) return "—";
    const isPhone = /^\d{10}$/.test(value);
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

    if (isPhone) {
        return "*".repeat(value.length - 2) + value.slice(-2);
    }
    if (isEmail) {
        const parts = value.split("@");
        return parts[0][0] + "****@" + parts[1];
    }
    return value;
}


// -----------------------------------------------------
// HELPER: fill in every element on the page that displays
// this user's info — topbar, profile card, sidebar panel.
// Each one is wrapped in a null-check, so it's safe even
// on pages that don't have every single element.
// -----------------------------------------------------
function renderUserEverywhere(user) {

    const initials = getInitials(user.name);
    const maskedContact = maskContactDisplay(user.emailPhone);
    const displayCity = user.city || user.location || user.region || "—";

    // --- chat handle display ---
    const chatHandleEl = document.getElementById("chatHandle");
    if (chatHandleEl) chatHandleEl.textContent = user.chatHandle || "anon";

    // --- topbar ---
    const topbarUserName = document.getElementById("topbarUserName");
    const topbarAvatar = document.getElementById("topbarAvatar");
    if (topbarUserName) topbarUserName.textContent = user.name || "Guest";
    if (topbarAvatar) topbarAvatar.textContent = initials;

    // --- main profile card on the page ---
    const profileName = document.getElementById("profileName");
    const profileAvatar = document.getElementById("profileAvatar");
    const profileContact = document.getElementById("profileContact");
    const profileRegion = document.getElementById("profileRegion");
    const profileLastLogin = document.getElementById("profileLastLogin");

    if (profileName) profileName.textContent = user.name || "Not signed in";
    if (profileAvatar) profileAvatar.textContent = initials;
    if (profileContact) profileContact.textContent = maskedContact;
    if (profileRegion) profileRegion.textContent = displayCity;
    if (profileLastLogin) profileLastLogin.textContent = "Logged in";

    // --- slide-out sidebar panel ---
    const sidebarName = document.getElementById("sidebarName");
    const sidebarAvatar = document.getElementById("sidebarAvatar");
    const sidebarContact = document.getElementById("sidebarContact");
    const sidebarRegion = document.getElementById("sidebarRegion");
    const sidebarLastLogin = document.getElementById("sidebarLastLogin");

    if (sidebarName) sidebarName.textContent = user.name || "Not signed in";
    if (sidebarAvatar) sidebarAvatar.textContent = initials;
    if (sidebarContact) sidebarContact.textContent = maskedContact;
    if (sidebarRegion) sidebarRegion.textContent = displayCity;
    if (sidebarLastLogin) {
        sidebarLastLogin.textContent = new Date().toLocaleString([], {
            hour: "2-digit",
            minute: "2-digit"
        });
    }
}


// -----------------------------------------------------
// HELPER: what to show when nobody is signed in
// (rather than leaving stale/placeholder HTML behind)
// -----------------------------------------------------
function getNameForGreeting(fullName) {
    if (!fullName) return "Guest";
    const parts = fullName.trim().split(/\s+/);
    return parts[parts.length - 1] || parts[0] || "Guest";
}

function getTimeGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
}

function setLightStatus(status) {
    const statusBadge = document.getElementById("statusBadge");
    const statusPulse = document.getElementById("statusPulse");
    const statusPillText = document.getElementById("statusPillText");
    const lightSwitch = document.getElementById("lightSwitch");
    const lightSwitchState = document.getElementById("lightSwitchState");

    if (!statusBadge || !statusPulse || !statusPillText || !lightSwitch || !lightSwitchState) {
        return;
    }

    statusBadge.className = "badge";
    statusPulse.className = "pulse";

    if (status === "on") {
        statusBadge.classList.add("badge--on");
        statusBadge.textContent = "Light on";
        statusPulse.classList.add("pulse--on");
        statusPillText.textContent = "Light is on now";
        lightSwitch.classList.add("light-switch--on");
        lightSwitch.classList.remove("light-switch--off");
        lightSwitchState.textContent = "ON";
        lightSwitch.setAttribute("aria-checked", "true");
    } else if (status === "off") {
        statusBadge.classList.add("badge--off");
        statusBadge.textContent = "Light off";
        statusPulse.classList.add("pulse--off");
        statusPillText.textContent = "Light is off now";
        lightSwitch.classList.remove("light-switch--on");
        lightSwitch.classList.add("light-switch--off");
        lightSwitchState.textContent = "OFF";
        lightSwitch.setAttribute("aria-checked", "false");
    } else {
        statusBadge.classList.add("badge--low");
        statusBadge.textContent = "Unconfirmed";
        statusPulse.classList.add("pulse--low");
        statusPillText.textContent = "Flip if you can see the area";
        lightSwitch.classList.remove("light-switch--on", "light-switch--off");
        lightSwitchState.textContent = "CHECK";
        lightSwitch.setAttribute("aria-checked", "false");
    }
}

function renderLocationPage(user) {
    const pageGreeting = document.getElementById("pageGreeting");
    const locationName = document.getElementById("locationName");
    const locationNameCard = document.getElementById("locationNameCard");
    const locationMeta = document.getElementById("locationMeta");
    const locationSubtitle = document.getElementById("locationSubtitle");
    const locationMap = document.getElementById("locationMap");

    const name = user.name || "Guest";
    const displayName = getNameForGreeting(name);
    const greeting = `${getTimeGreeting()}, ${displayName}`;
    // Normalize location to "City, Region" — strip extra autocomplete suffixes
    // like ", Kumasi, Ghana" so all users at the same area share one chat room.
    let rawCity = user.city || "";
    // Remove trailing ", Kumasi, Ghana" or similar duplicates from autocomplete
    rawCity = rawCity.replace(/,\s*(kumasi|ghana|accra)\s*,?.*/gi, "").trim();
    const location = rawCity
        ? `${rawCity}, ${user.region || ""}`.replace(/,\s*$/, "").trim()
        : user.location || user.region || "your area";
    const mapQuery = encodeURIComponent(location + ", Ghana");
    const mapSrc = `https://maps.google.com/maps?q=${mapQuery}&t=&z=15&ie=UTF8&iwloc=&output=embed`;

    if (pageGreeting) pageGreeting.textContent = greeting;
    if (locationName) locationName.textContent = location;
    if (locationNameCard) locationNameCard.textContent = location;
    if (locationMeta) locationMeta.textContent = `${location} · LightWatch verified`;
    if (locationSubtitle) locationSubtitle.textContent = `Real-time grid and crowd-sourced reporting for ${location}.`;
    if (locationMap) locationMap.src = mapSrc;
    const locationMapLabel = document.getElementById("locationMapLabel");
    if (locationMapLabel) locationMapLabel.textContent = `${location} location map`;

    window.currentChatLocation = location;
    window.dispatchEvent(new CustomEvent('locationReady', { detail: { location } }));

    // Load shared light status from backend so all users see the same state
    fetch(`${API_URL}/lightstatus?location=${encodeURIComponent(location)}`)
        .then(r => r.json())
        .then(data => {
            setLightStatus(data.status || "unknown");
            const lastVerifiedEl = document.getElementById("lastVerified");
            if (lastVerifiedEl && data.reportedAt) {
                const diff = Math.floor((Date.now() - new Date(data.reportedAt).getTime()) / 60000);
                lastVerifiedEl.textContent = diff < 1 ? "Just now" : diff === 1 ? "1 minute ago" : `${diff} minutes ago`;
            }
        })
        .catch(() => setLightStatus("unknown"));

    // Poll light status every 30s so all users stay in sync
    const lightPoll = setInterval(() => {
        fetch(`${API_URL}/lightstatus?location=${encodeURIComponent(location)}`)
            .then(r => r.json())
            .then(data => {
                setLightStatus(data.status || "unknown");
                const lastVerifiedEl = document.getElementById("lastVerified");
                if (lastVerifiedEl && data.reportedAt) {
                    const diff = Math.floor((Date.now() - new Date(data.reportedAt).getTime()) / 60000);
                    lastVerifiedEl.textContent = diff < 1 ? "Just now" : diff === 1 ? "1 minute ago" : `${diff} minutes ago`;
                }
            })
            .catch(() => {});
    }, 10000);

    const lightSwitch = document.getElementById("lightSwitch");
    if (lightSwitch) {
        lightSwitch.addEventListener("click", () => {
            const currentState = lightSwitch.getAttribute("aria-checked") === "true" ? "on" : "off";
            const nextStatus = currentState === "on" ? "off" : "on";
            showLightConfirmPopup(nextStatus, () => {
                const userId = getSession()?.user?.id || localStorage.getItem("currentUserId");
                // Save to backend so ALL users see the update
                fetch(`${API_URL}/lightstatus`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ location, status: nextStatus, userId })
                })
                .then(r => r.json())
                .then(() => {
                    setLightStatus(nextStatus);
                    const lastVerifiedEl = document.getElementById("lastVerified");
                    if (lastVerifiedEl) {
                        lastVerifiedEl.textContent = "Just now";
                        let mins = 0;
                        const ticker = setInterval(() => {
                            mins++;
                            if (mins >= 60) { clearInterval(ticker); lastVerifiedEl.textContent = "Over an hour ago"; }
                            else lastVerifiedEl.textContent = mins === 1 ? "1 minute ago" : `${mins} minutes ago`;
                        }, 10000);
                    }
                    // Send a chat notification to the room
                    const myId = getSession()?.user?.id || localStorage.getItem("currentUserId");
                    const myHandle = getSession()?.user?.chatHandle || localStorage.getItem("chatHandle") || "someone";
                    if (myId) {
                        fetch(`${API_URL}/chats`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                userId: myId,
                                handle: myHandle,
                                text: `💡 ${myHandle} reported: Light is now ${nextStatus.toUpperCase()} in this area.`,
                                location
                            })
                        }).catch(() => {});
                    }
                })
                .catch(() => {
                    setLightStatus(nextStatus); // fallback local update
                });
            });
        });
    }
}

// -------------------------------------------------------
// LIGHT STATUS CONFIRMATION POPUP
// Shows an overlay asking the user to confirm accuracy
// before their toggle is applied.
// -------------------------------------------------------
function showLightConfirmPopup(nextStatus, onConfirm) {
    // Remove any existing popup first
    const existing = document.getElementById("lw-confirm-overlay");
    if (existing) existing.remove();

    const isOn = nextStatus === "on";
    const overlay = document.createElement("div");
    overlay.id = "lw-confirm-overlay";
    overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 9999;
        background: rgba(0,0,0,0.55); backdrop-filter: blur(4px);
        display: flex; align-items: center; justify-content: center;
        padding: 24px; animation: lw-fade-in 0.15s ease;
    `;

    overlay.innerHTML = `
        <style>
            @keyframes lw-fade-in { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
            #lw-confirm-card { background: #fff; border-radius: 16px; padding: 28px 24px; max-width: 340px; width: 100%; text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,0.25); }
            #lw-confirm-card .lw-icon { font-size: 2.4rem; margin-bottom: 12px; }
            #lw-confirm-card h3 { font-family: "Space Grotesk", sans-serif; font-size: 1.1rem; margin: 0 0 8px; color: #111; }
            #lw-confirm-card p { font-size: 0.88rem; color: #555; margin: 0 0 22px; line-height: 1.5; }
            .lw-confirm-btns { display: flex; gap: 10px; }
            .lw-confirm-btns button { flex: 1; padding: 12px; border-radius: 10px; border: none; font-size: 0.92rem; font-weight: 600; cursor: pointer; transition: opacity 0.15s; }
            .lw-confirm-btns button:hover { opacity: 0.88; }
            .lw-btn-confirm { background: ${isOn ? "#3DD9C2" : "#E5484D"}; color: ${isOn ? "#06241f" : "#fff"}; }
            .lw-btn-cancel { background: #f0f0f4; color: #444; }
        </style>
        <div id="lw-confirm-card">
            <div class="lw-icon">${isOn ? "💡" : "🌑"}</div>
            <h3>${isOn ? "Reporting light ON?" : "Reporting light OFF?"}</h3>
            <p>Please only confirm if you can <strong>actually see</strong> this area right now. Your report helps others in ${window.currentChatLocation || "this location"}.</p>
            <div class="lw-confirm-btns">
                <button class="lw-btn-cancel" id="lw-cancel-btn">Cancel</button>
                <button class="lw-btn-confirm" id="lw-confirm-btn">Yes, I can confirm</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById("lw-confirm-btn").addEventListener("click", () => {
        overlay.remove();
        onConfirm();
    });

    document.getElementById("lw-cancel-btn").addEventListener("click", () => {
        overlay.remove();
    });

    // Tap outside to cancel
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) overlay.remove();
    });
}

function renderSignedOutEverywhere() {
    const guestUser = { name: "Guest", emailPhone: "", location: "" };
    renderUserEverywhere(guestUser);

    const profileContact = document.getElementById("profileContact");
    const sidebarContact = document.getElementById("sidebarContact");
    if (profileContact) profileContact.textContent = "Not signed in";
    if (sidebarContact) sidebarContact.textContent = "Not signed in";
}


// -----------------------------------------------------
// MAIN: load the current user from the backend and render
// them everywhere on the page.
// -----------------------------------------------------
async function loadCurrentUserProfile() {

    // ── Get user ID from the active session (set by auth.js) ──
    const session = getSession(); // defined in auth.js
    const userId = session?.user?.id || localStorage.getItem("currentUserId");
    const fallbackUser = session?.user || JSON.parse(localStorage.getItem("currentUserData") || localStorage.getItem("signupUser") || "null");

    if (!userId) {
        if (fallbackUser) {
            renderUserEverywhere(fallbackUser);
            renderLocationPage(fallbackUser);
            return;
        }
        renderSignedOutEverywhere();
        return;
    }

    try {
        const response = await fetch(`${API_URL}/user/${userId}`);

        if (!response.ok) {
            if (fallbackUser) {
                renderUserEverywhere(fallbackUser);
                return;
            }
            renderSignedOutEverywhere();
            return;
        }

        const user = await response.json();
        renderUserEverywhere(user);
        renderLocationPage(user);

    } catch (error) {
        console.error("Could not load profile:", error);
        if (fallbackUser) {
            renderUserEverywhere(fallbackUser);
            renderLocationPage(fallbackUser);
            return;
        }
        const profileContact = document.getElementById("profileContact");
        if (profileContact) profileContact.textContent = "Could not reach server";
    }
}


// -----------------------------------------------------
// SIGN OUT
// Clears everything this app stored locally and sends
// the user back to the sign-in page.
// -----------------------------------------------------
// signOut is defined in auth.js — no duplicate needed here.
// The buttons below just call it directly.

document.getElementById("profileSignOutBtn")?.addEventListener("click", signOut);
document.getElementById("sidebarSignOutBtn")?.addEventListener("click", signOut);


// -----------------------------------------------------
// SIDEBAR OPEN/CLOSE
// (kept from the original inline <script>, just moved
// into this file so all profile-related JS lives together)
// -----------------------------------------------------
const profileButton = document.getElementById('profileMenuButton');
const sidebarPanel = document.getElementById('userSidebarPanel');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const sidebarClose = document.getElementById('userSidebarClose');
const bottomNavUserBtn = document.getElementById('bottomNavUserBtn');

function openSidebar() {
    sidebarPanel.classList.add('user-sidebar-panel--open');
    sidebarOverlay.classList.add('sidebar-overlay--visible');
    sidebarPanel.setAttribute('aria-hidden', 'false');
    profileButton?.setAttribute('aria-expanded', 'true');
}

function closeSidebar() {
    sidebarPanel.classList.remove('user-sidebar-panel--open');
    sidebarOverlay.classList.remove('sidebar-overlay--visible');
    sidebarPanel.setAttribute('aria-hidden', 'true');
    profileButton?.setAttribute('aria-expanded', 'false');
}

profileButton?.addEventListener('click', () => {
    if (sidebarPanel.classList.contains('user-sidebar-panel--open')) {
        closeSidebar();
    } else {
        openSidebar();
    }
});

// the "You" button in the mobile bottom nav opens the same
// sidebar panel, so profile access works identically on
// desktop and mobile without duplicating the panel markup
bottomNavUserBtn?.addEventListener('click', () => {
    window.location.replace('../pages/account.html');
});

sidebarOverlay?.addEventListener('click', closeSidebar);
sidebarClose?.addEventListener('click', closeSidebar);


// -----------------------------------------------------
// RUN ON PAGE LOAD
// -----------------------------------------------------
loadCurrentUserProfile();