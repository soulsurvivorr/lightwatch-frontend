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
// SVG AVATARS — every user gets a distinct generated avatar
// instead of a plain "initials on a gradient circle". It's
// deterministic (hashed from the user's id, falling back to
// their name) so the same person always gets the same avatar
// across sessions and devices, rather than it changing on
// every page load.
// -----------------------------------------------------
const AVATAR_PALETTES = [
    ['#3DD9C2', '#1C8C7A'], // teal
    ['#D6A24A', '#A66C14'], // amber
    ['#8B7CF6', '#5B4BC4'], // violet
    ['#F27A6B', '#C94C3D'], // coral
    ['#4FA3E3', '#2A6CB0'], // sky
    ['#6FCF6F', '#2E8B4F']  // emerald
];

// Small deterministic string hash (djb2 variant) — same input
// always produces the same output, no external calls needed.
function hashSeed(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
        hash = hash & hash; // keep it inside a 32-bit int
    }
    return Math.abs(hash);
}

// Each pattern draws on top of a gradient-filled circle base.
// Kept simple/abstract on purpose — these render at 24-56px,
// so fine detail would just turn to mush.
const AVATAR_PATTERNS = [
    (gradId, c2) => `
        <rect x="0" y="0" width="40" height="40" rx="8" fill="url(#${gradId})"/>
        <circle cx="20" cy="20" r="13" fill="none" stroke="${c2}" stroke-width="2" opacity="0.45"/>
        <circle cx="20" cy="20" r="7" fill="${c2}" opacity="0.55"/>
    `,
    (gradId, c2) => `
        <rect x="0" y="0" width="40" height="40" rx="8" fill="url(#${gradId})"/>
        <path d="M0 40 L40 0 L40 14 L14 40 Z" fill="${c2}" opacity="0.35"/>
    `,
    (gradId, c2) => `
        <rect x="0" y="0" width="40" height="40" rx="8" fill="url(#${gradId})"/>
        <circle cx="13" cy="13" r="2.4" fill="${c2}" opacity="0.55"/>
        <circle cx="27" cy="13" r="2.4" fill="${c2}" opacity="0.4"/>
        <circle cx="13" cy="27" r="2.4" fill="${c2}" opacity="0.4"/>
        <circle cx="27" cy="27" r="2.4" fill="${c2}" opacity="0.55"/>
    `,
    (gradId, c2) => `
        <rect x="0" y="0" width="40" height="40" rx="8" fill="url(#${gradId})"/>
        <path d="M4 26 L20 14 L36 26" fill="none" stroke="${c2}" stroke-width="2.4" opacity="0.5"/>
        <path d="M4 32 L20 20 L36 32" fill="none" stroke="${c2}" stroke-width="2.4" opacity="0.3"/>
    `,
    (gradId, c2) => `
        <rect x="0" y="0" width="40" height="40" rx="8" fill="url(#${gradId})"/>
        <path d="M20 8 L28 22 L12 22 Z" fill="${c2}" opacity="0.5"/>
        <path d="M12 24 L20 34 L6 34 Z" fill="${c2}" opacity="0.3"/>
    `,
    (gradId, c2) => `
        <rect x="0" y="0" width="40" height="40" rx="8" fill="url(#${gradId})"/>
        <path d="M0 24 Q10 16 20 24 T40 24 V40 H0 Z" fill="${c2}" opacity="0.4"/>
    `
];

// Returns a ready-to-insert <svg> string for a given seed
// (pass user.id when you have it — falls back to name, then
// a neutral "guest" look).
function getAvatarSVG(seed) {
    const safeSeed = String(seed || 'guest');
    const hash = hashSeed(safeSeed);
    const [c1, c2] = AVATAR_PALETTES[hash % AVATAR_PALETTES.length];
    const patternFn = AVATAR_PATTERNS[Math.floor(hash / AVATAR_PALETTES.length) % AVATAR_PATTERNS.length];
    const gradId = `lwAvatarGrad-${hash}`;

    return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="User avatar">` +
        `<defs><linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">` +
        `<stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>` +
        `</linearGradient></defs>${patternFn(gradId, c2)}</svg>`;
}


// Neutral avatar shown when nobody is signed in yet. Kept visually
// distinct from the generated per-user avatars above (grayscale,
// geometric) so it never reads as "some user's real avatar" — it's a
// simple pyramid mark instead of a plain "?" glyph.
function getGuestAvatarSVG() {
    return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Guest avatar">` +
        `<defs><linearGradient id="lwGuestGrad" x1="0%" y1="0%" x2="100%" y2="100%">` +
        `<stop offset="0%" stop-color="#6B7280"/><stop offset="100%" stop-color="#3A404C"/>` +
        `</linearGradient></defs>` +
        `<rect x="0" y="0" width="40" height="40" rx="8" fill="url(#lwGuestGrad)"/>` +
        `<path d="M20 9 L31 29 H9 Z" fill="none" stroke="#E4E7EC" stroke-width="2" stroke-linejoin="round" opacity="0.9"/>` +
        `<path d="M20 9 L20 29 M14.5 19 H25.5" stroke="#E4E7EC" stroke-width="1.2" opacity="0.5"/>` +
        `</svg>`;
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

    // A signed-out/guest state gets the neutral pyramid mark instead of a
    // plain "?" glyph — the generated per-user SVG is reserved for an
    // actual identity (id or name present).
    const hasIdentity = Boolean(user.id || user.name);
    const avatarMarkup = hasIdentity ? getAvatarSVG(user.id || user.name) : getGuestAvatarSVG();

    function setAvatar(el) {
        if (!el) return;
        el.setAttribute("aria-label", hasIdentity ? `Avatar for ${initials}` : "Guest avatar");
        el.innerHTML = avatarMarkup;
    }

    // --- chat handle display ---
    const chatHandleEl = document.getElementById("chatHandle");
    if (chatHandleEl) chatHandleEl.textContent = user.chatHandle || localStorage.getItem("chatHandle") || "anon";

    // --- topbar ---
    const topbarUserName = document.getElementById("topbarUserName");
    const topbarAvatar = document.getElementById("topbarAvatar");
    if (topbarUserName) topbarUserName.textContent = user.name || "Guest";
    setAvatar(topbarAvatar);

    // --- main profile card on the page ---
    const profileName = document.getElementById("profileName");
    const profileAvatar = document.getElementById("profileAvatar");
    const profileContact = document.getElementById("profileContact");
    const profileRegion = document.getElementById("profileRegion");
    const profileCity = document.getElementById("profileCity");
    const profileLastLogin = document.getElementById("profileLastLogin");

    if (profileName) profileName.textContent = user.name || "Not signed in";
    setAvatar(profileAvatar);
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
    setAvatar(sidebarAvatar);
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
        statusIcon.innerHTML = "<svg viewBox='0 0 20 20' fill='none' xmlns='http://www.w3.org/2000/svg' style='width:1.1em;height:1.1em;' aria-hidden='true'><path d='M6 3h8M6 17h8M6.5 3c0 4 3 4.5 3.5 5-0.5 0.5-3.5 1-3.5 5M13.5 3c0 4-3 4.5-3.5 5 0.5 0.5 3.5 1 3.5 5' stroke='currentColor' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/></svg>";
        statusPillText.textContent = "Checking live status";
        lightSwitch.classList.remove("light-switch--on", "light-switch--off");
        lightSwitchState.textContent = "CHECK";
        lightSwitch.setAttribute("aria-checked", "false");
    } else {
        statusBadge.classList.add("badge--low");
        statusBadge.textContent = "Unconfirmed";
        statusPulse.classList.add("pulse--low");
        statusIcon.classList.add("status-hero__icon--unknown");
        statusIcon.innerHTML = "<svg viewBox='0 0 20 20' fill='none' xmlns='http://www.w3.org/2000/svg' style='width:1.1em;height:1.1em;' aria-hidden='true'><circle cx='10' cy='10' r='8.3' stroke='currentColor' stroke-width='1.4'/><path d='M7.6 8.1a2.4 2.4 0 1 1 3.3 2.2c-0.7 0.3-1 0.8-1 1.5v0.4' stroke='currentColor' stroke-width='1.4' stroke-linecap='round'/><circle cx='10' cy='14.6' r='0.9' fill='currentColor'/></svg>";
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
            #lw-confirm-card .lw-icon svg { width: 1em; height: 1em; }
            #lw-confirm-card h3 { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 1.1rem; margin: 0 0 8px; color: #111; }
            #lw-confirm-card p { font-size: 0.88rem; color: #555; margin: 0 0 22px; line-height: 1.5; }
            .lw-confirm-btns { display: flex; gap: 10px; }
            .lw-confirm-btns button { flex: 1; padding: 12px; border-radius: 10px; border: none; font-size: 0.92rem; font-weight: 600; cursor: pointer; transition: opacity 0.15s; }
            .lw-confirm-btns button:hover { opacity: 0.88; }
            .lw-btn-confirm { background: ${isOn ? "#3DD9C2" : "#E5484D"}; color: ${isOn ? "#06241f" : "#fff"}; }
            .lw-btn-cancel { background: #f0f0f4; color: #444; }
        </style>
        <div id="lw-confirm-card">
            <div class="lw-icon">${isOn
                ? "<svg viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'><path d='M12 3a7 7 0 0 0-4 12.7c.6.44 1 1.16 1 1.95V19h6v-1.35c0-.79.4-1.51 1-1.95A7 7 0 0 0 12 3Z' stroke='#D6A24A' stroke-width='1.6' stroke-linejoin='round'/><path d='M10 21.5h4' stroke='#D6A24A' stroke-width='1.6' stroke-linecap='round'/></svg>"
                : "<svg viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'><path d='M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11Z' fill='#5B6472' stroke='#5B6472' stroke-width='1.2' stroke-linejoin='round'/></svg>"
            }</div>
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
    // NOTE: this used to skip showing the loader entirely once a
    // "lw_skeleton_seen_<key>" flag was set from a prior visit — the
    // intent was to avoid re-flashing the skeleton for fast repeat
    // visits. In practice it meant the skeleton NEVER showed again
    // after the very first load: the raw/empty page painted instantly
    // and real data popped in 1-2s later once the fetch resolved,
    // which reads as broken/janky rather than fast. The loader is
    // cheap to show and gets cleared the moment cached data (or a
    // fresh fetch) is ready, so there's no real cost to always showing
    // it — just remove the skip.
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

  const skeleton = document.getElementById('pageSkeleton');
  const realContent = document.getElementById('realPageContent');

  if (skeleton) {
    skeleton.classList.add('lw-skel-fading');
    setTimeout(() => {
      document.body.classList.remove('page-data-loading', 'app-loading');
      if (realContent) realContent.classList.add('lw-content-reveal');
      window.dispatchEvent(new CustomEvent('lw-page-revealed'));
    }, 220);
  } else {
    document.body.classList.remove('page-data-loading', 'app-loading');
    window.dispatchEvent(new CustomEvent('lw-page-revealed'));
  }
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

    // auth.js runs requireAuth() the moment it parses, ahead of this
    // (deferred) script. If it already decided this visitor has no
    // session and is being sent to sign-in, don't render "Guest"
    // placeholders into the page at all — just let the redirect land.
    if (window.__lwAuthRedirecting) return;

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
// signOut is defined in auth.js. Both sign-out buttons carry
// data-action="signout" in the markup, so auth.js's single delegated
// listener wires them up — no duplicate bindings here. (Two separate
// listeners on the same button used to both fire on one click, racing
// against nav.js's link-loader overlay and making sign-out feel like
// it needed a second click.)


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