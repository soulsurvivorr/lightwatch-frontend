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
    const contactValue = user.emailPhone || user.email || "—";
    const displayLocation = [user.city, user.region].filter(Boolean).join(", ") || user.location || "—";

    // --- chat handle display ---
    const chatHandleEl = document.getElementById("chatHandle");
    if (chatHandleEl) chatHandleEl.textContent = user.chatHandle || localStorage.getItem("chatHandle") || "anon";

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
    const profileCity = document.getElementById("profileCity");
    const profileLastLogin = document.getElementById("profileLastLogin");

    if (profileName) profileName.textContent = user.name || "Not signed in";
    if (profileAvatar) profileAvatar.textContent = initials;
    if (profileContact) profileContact.textContent = contactValue;
    if (profileRegion) profileRegion.textContent = displayLocation;
    if (profileCity) profileCity.textContent = user.city || "—";
    if (profileLastLogin) {
        if (user.createdAt) {
            const date = new Date(user.createdAt);
            const monthYear = date.toLocaleString('en-Us', { month: 'long', year: 'numeric' });
            profileLastLogin.textContent = monthYear;
        } else {
            profileLastLogin.textContent = "—";
        }
    }

    // --- slide-out sidebar panel ---
    const sidebarName = document.getElementById("sidebarName");
    const sidebarAvatar = document.getElementById("sidebarAvatar");
    const sidebarContact = document.getElementById("sidebarContact");
    const sidebarRegion = document.getElementById("sidebarRegion");
    const sidebarLastLogin = document.getElementById("sidebarLastLogin");

    if (sidebarName) sidebarName.textContent = user.name || "Not signed in";
    if (sidebarAvatar) sidebarAvatar.textContent = initials;
    if (sidebarContact) sidebarContact.textContent = contactValue;
    if (sidebarRegion) sidebarRegion.textContent = displayLocation;
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
    const statusIcon = document.getElementById("statusIcon");
    const lightSwitch = document.getElementById("lightSwitch");
    const lightSwitchState = document.getElementById("lightSwitchState");

    if (!statusBadge || !statusPulse || !statusPillText || !statusIcon || !lightSwitch || !lightSwitchState) {
        return;
    }

    statusBadge.className = "badge";
    statusPulse.className = "pulse";
    statusIcon.className = "status-hero__icon";

    if (status === "on") {
        statusBadge.classList.add("badge--on");
        statusBadge.textContent = "Light on";
        statusPulse.classList.add("pulse--on");
        statusIcon.classList.add("status-hero__icon--on");
        statusIcon.innerHTML = "<img src='/images/light-on.png' alt='Light on' style='width: 1.2em; height: 1.2em;'>";
        statusPillText.textContent = "Light is on now";
        lightSwitch.classList.add("light-switch--on");
        lightSwitch.classList.remove("light-switch--off");
        lightSwitchState.textContent = "ON";
        lightSwitch.setAttribute("aria-checked", "true");
    } else if (status === "off") {
        statusBadge.classList.add("badge--off");
        statusBadge.textContent = "Light off";
        statusPulse.classList.add("pulse--off");
        statusIcon.classList.add("status-hero__icon--off");
        statusIcon.innerHTML = "<img src='/images/light-off.png' alt='Light off' style='width: 1.2em; height: 1.2em;'>";
        statusPillText.textContent = "Light is off now";
        lightSwitch.classList.remove("light-switch--on");
        lightSwitch.classList.add("light-switch--off");
        lightSwitchState.textContent = "OFF";
        lightSwitch.setAttribute("aria-checked", "false");
    } else if (status === "loading") {
        statusBadge.classList.add("badge--low");
        statusBadge.textContent = "Checking status";
        statusPulse.classList.add("pulse--low");
        statusIcon.classList.add("status-hero__icon--unknown");
        statusIcon.textContent = "⏳";
        statusPillText.textContent = "Checking live status";
        lightSwitch.classList.remove("light-switch--on", "light-switch--off");
        lightSwitchState.textContent = "CHECK";
        lightSwitch.setAttribute("aria-checked", "false");
    } else {
        statusBadge.classList.add("badge--low");
        statusBadge.textContent = "Unconfirmed";
        statusPulse.classList.add("pulse--low");
        statusIcon.classList.add("status-hero__icon--unknown");
        statusIcon.textContent = "❔";
        statusPillText.textContent = "Flip if you can see the area";
        lightSwitch.classList.remove("light-switch--on", "light-switch--off");
        lightSwitchState.textContent = "CHECK";
        lightSwitch.setAttribute("aria-checked", "false");
    }
}

// Tracks the two intervals renderLocationPage() creates, so calling it
// again (e.g. once with cached data, then again with fresh data) clears
// the previous timers instead of stacking up duplicate pollers.
let lightStatusPollInterval = null;
let lastVerifiedRefreshInterval = null;

function renderLocationPage(user) {
    clearInterval(lightStatusPollInterval);
    clearInterval(lastVerifiedRefreshInterval);

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

    // ── Human-readable time since last report ──────────────────
    function timeAgo(dateStr) {
        const diffMs = Date.now() - new Date(dateStr).getTime();
        const mins   = Math.floor(diffMs / 60000);
        const hours  = Math.floor(diffMs / 3600000);
        const days   = Math.floor(diffMs / 86400000);
        if (mins  <  1) return "Just now";
        if (mins  < 60) return mins  === 1 ? "1 minute ago"  : `${mins} minutes ago`;
        if (hours < 24) return hours === 1 ? "1 hour ago"    : `${hours} hours ago`;
        return days === 1 ? "Yesterday" : `${days} days ago`;
    }

    const lastVerifiedEl = document.getElementById('lastVerified');
    let lastReportedAtMs = null;

    function refreshLastVerifiedLabel() {
        if (!lastVerifiedEl) return;
        if (!lastReportedAtMs) {
            lastVerifiedEl.textContent = '—';
            return;
        }
        lastVerifiedEl.textContent = timeAgo(new Date(lastReportedAtMs).toISOString());
    }

    // Keep relative timestamp accurate based on absolute report time.
    refreshLastVerifiedLabel();
    lastVerifiedRefreshInterval = setInterval(refreshLastVerifiedLabel, 15000);

    function formatDuration(ms) {
        if (ms == null) return '—';
        const totalMinutes = Math.round(ms / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        if (hours === 0) return `${minutes}m`;
        return `${hours}h ${minutes}m`;
    }

    function renderLightStats(stats) {
        const heroContributors = document.getElementById('heroContributors');
        const heroChecks = document.getElementById('heroChecks');
        const heroUptime = document.getElementById('heroUptime');
        const heroContributorsPill = document.getElementById('heroContributorsPill');
        const heroChecksPill = document.getElementById('heroChecksPill');
        const sourceConfidence = document.getElementById('sourceConfidence');
        const confirmedSources = document.getElementById('confirmedSources');
        const lightOnCount = document.getElementById('lightOnCount');
        const avgOutageEl = document.getElementById('avgOutage');
        const outageFreqEl = document.getElementById('outageFreq');
        const lastOutageLengthEl = document.getElementById('lastOutageLength');

        if (!stats) {
            if (heroContributors) heroContributors.textContent = '—';
            if (heroChecks) heroChecks.textContent = '—';
            if (heroUptime) heroUptime.textContent = '—';
            if (heroContributorsPill) heroContributorsPill.textContent = '— contributors';
            if (heroChecksPill) heroChecksPill.textContent = '— total checks';
            if (sourceConfidence) sourceConfidence.textContent = '—';
            if (confirmedSources) confirmedSources.textContent = '—';
            if (lightOnCount) lightOnCount.textContent = '—';
            if (avgOutageEl) avgOutageEl.textContent = '—';
            if (outageFreqEl) outageFreqEl.textContent = '—';
            if (lastOutageLengthEl) lastOutageLengthEl.textContent = '—';
            return;
        }

        if (heroContributors) heroContributors.textContent = stats.uniqueContributors.toString();
        if (heroChecks) heroChecks.textContent = stats.totalChecks.toString();
        if (heroUptime) heroUptime.textContent = stats.uptimePercent != null ? `${stats.uptimePercent}%` : '—';
        if (heroContributorsPill) heroContributorsPill.textContent = `${stats.uniqueContributors} contributors`;
        if (heroChecksPill) heroChecksPill.textContent = `${stats.totalChecks} total checks`;
        if (sourceConfidence) sourceConfidence.textContent = `${stats.sourceConfidence}%`;
        if (confirmedSources) confirmedSources.textContent = `${stats.uniqueContributors} contributors`;
        if (lightOnCount) lightOnCount.textContent = `${stats.onChecksThisWeek} of ${stats.checksThisWeek} checks`;
        if (avgOutageEl) avgOutageEl.textContent = formatDuration(stats.avgOutageMs);
        if (outageFreqEl) outageFreqEl.textContent = `${stats.outageFreq} this week`;
        if (lastOutageLengthEl) lastOutageLengthEl.textContent = formatDuration(stats.lastOutageMs);
    }

    function loadLocationStats() {
        return fetch(`${API_URL}/lightstatus?location=${encodeURIComponent(location)}`)
            .then(r => r.json())
            .then(data => {
                setLightStatus(data.status || 'unknown');
                if (data.reportedAt) {
                    lastReportedAtMs = new Date(data.reportedAt).getTime();
                    refreshLastVerifiedLabel();
                }
                renderLightStats(data.stats);
            })
            .catch(() => {
                setLightStatus('unknown');
                renderLightStats(null);
            });
    }

    setLightStatus('loading');
    const initialStatsLoad = loadLocationStats();

    // Poll light status every 30s so all users stay in sync
    lightStatusPollInterval = setInterval(() => {
        fetch(`${API_URL}/lightstatus?location=${encodeURIComponent(location)}`)
            .then(r => r.json())
            .then(data => {
                setLightStatus(data.status || 'unknown');
                if (data.reportedAt) {
                    lastReportedAtMs = new Date(data.reportedAt).getTime();
                    refreshLastVerifiedLabel();
                }
                renderLightStats(data.stats);
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
                    lastReportedAtMs = Date.now();
                    refreshLastVerifiedLabel();
                    loadLocationStats();
                })
                .catch(() => {
                    setLightStatus(nextStatus); // fallback local update
                });
            });
        });
    }

    // So the caller (loadCurrentUserProfile) can await this and only
    // hide the loading overlay once the FIRST light-status/stats load
    // has actually landed too — not just the user profile fetch.
    return initialStatsLoad;
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
        background: rgba(0,0,0,0.25); backdrop-filter: blur(1px);
        display: flex; align-items: center; justify-content: center;
        padding: 24px; animation: lw-fade-in 0.15s ease;
    `;

    overlay.innerHTML = `
        <style>
            @keyframes lw-fade-in { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
            #lw-confirm-card { background: #fff; border-radius: 16px; padding: 28px 24px; max-width: 340px; width: 100%; text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,0.25); }
            #lw-confirm-card .lw-icon { font-size: 2.4rem; margin-bottom: 12px; }
            #lw-confirm-card h3 { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 1.1rem; margin: 0 0 8px; color: #111; }
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
// PROFILE LOADING STATE
// Keep only the page's lightning boot loader (lw-boot-loader).
// -----------------------------------------------------
let profileLoaderSafetyTimer = null;

function showProfileLoader(maxDuration = 8000) {
    const skeletonKey = document.body?.dataset.skeletonKey;
    const seenKey = skeletonKey ? `lw_skeleton_seen_${skeletonKey}` : null;
    if (seenKey && localStorage.getItem(seenKey) === '1') {
        return;
    }

    const connectionType = navigator?.connection?.effectiveType || '';
    const isSlowConnection = /(^|-)2g$|^3g$/.test(connectionType) || connectionType === 'slow-2g';
    const safetyDuration = Math.max(maxDuration, isSlowConnection ? 20000 : 12000);

    if (document.body?.dataset.skeletonManaged === '1') {
        document.body?.classList.add('page-data-loading');
    } else {
        document.body?.classList.add('app-loading');
    }
    clearTimeout(profileLoaderSafetyTimer);
    profileLoaderSafetyTimer = setTimeout(() => {
        hideProfileLoader();
    }, safetyDuration);
}

function hideProfileLoader() {
    clearTimeout(profileLoaderSafetyTimer);
    const skeletonKey = document.body?.dataset.skeletonKey;
    if (skeletonKey) {
        localStorage.setItem(`lw_skeleton_seen_${skeletonKey}`, '1');
    }
    if (document.body?.dataset.accountExtrasLoading !== '1') {
        document.body?.classList.remove('page-data-loading');
    }
    document.body?.classList.remove('app-loading');
    document.getElementById('lwBootLoader')?.remove();
}

function waitForChatReady(maxWait = 700) {
    if (!document.getElementById('chatThread')) return Promise.resolve();
    if (window.__lwChatReady) return Promise.resolve();

    return new Promise(resolve => {
        let done = false;
        const cleanup = () => {
            if (done) return;
            done = true;
            window.removeEventListener('lw-chat-ready', onReady);
            clearTimeout(timeout);
            resolve();
        };

        const onReady = () => cleanup();
        const timeout = setTimeout(cleanup, maxWait);
        window.addEventListener('lw-chat-ready', onReady, { once: true });
    });
}


// -----------------------------------------------------
// MAIN: load the current user from the backend and render
// them everywhere on the page.
// -----------------------------------------------------
async function loadCurrentUserProfile() {

    showProfileLoader();

    // ── Get user ID from the active session (set by auth.js) ──
    const session = getSession(); // defined in auth.js
    const userId = session?.user?.id || localStorage.getItem("currentUserId");
    const fallbackUser = session?.user || JSON.parse(localStorage.getItem("currentUserData") || localStorage.getItem("signupUser") || "null");

    // Stage cached profile data under the overlay.
    if (fallbackUser) {
        renderUserEverywhere(fallbackUser);
    }

    if (!userId) {
        if (fallbackUser) {
            await renderLocationPage(fallbackUser);
        } else {
            renderSignedOutEverywhere();
        }
        hideProfileLoader();
        return;
    }

    try {
        const response = await fetch(`${API_URL}/user/${userId}`);

        // If admin deleted this user (or session became invalid), do not
        // continue with cached local data. End the session and send them
        // back to sign in on next open.
        if ([401, 403, 404, 410].includes(response.status)) {
            if (typeof signOut === 'function') {
                signOut();
                return;
            }
            window.location.replace('../index.html');
            return;
        }

        if (!response.ok) {
            if (!fallbackUser) renderSignedOutEverywhere();
            return;
        }

        const user = await response.json();

        // Keep the cache fresh for next time too — written to whichever
        // storage this session actually uses, so a non-"remember me"
        // session still correctly disappears when the browser closes
        // instead of accidentally becoming persistent.
        const cacheStorage = session?.remembered ? localStorage : sessionStorage;
        cacheStorage.setItem("currentUserData", JSON.stringify(user));

        renderUserEverywhere(user);
        await renderLocationPage(user);

    } catch (error) {
        console.error("Could not load profile:", error);
        if (fallbackUser) {
            await renderLocationPage(fallbackUser);
        } else {
            const profileContact = document.getElementById("profileContact");
            if (profileContact) profileContact.textContent = "Could not reach server";
        }
    } finally {
        await waitForChatReady();
        hideProfileLoader();
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
    if (typeof triggerLightningTransition === 'function') {
        triggerLightningTransition();
    } else {
        document.body?.classList.add('app-loading');
    }
    window.location.replace('../pages/account.html');
});

sidebarOverlay?.addEventListener('click', closeSidebar);
sidebarClose?.addEventListener('click', closeSidebar);


// -----------------------------------------------------
// RUN ON PAGE LOAD
// -----------------------------------------------------
loadCurrentUserProfile();