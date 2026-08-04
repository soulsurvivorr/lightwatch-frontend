// ============================================================
//  VIEWS/PROFILE.JS
//  Shared authenticated-app chrome: topbar avatar/name, the slide-
//  out sidebar panel, and (via renderLocationPage) the Home view's
//  light-status hero card. Despite the name, this isn't a single
//  routed view — it's cross-cutting UI that every protected view
//  shares, so it's initialized once via window.LWProfile.init(),
//  called by js/app.js the first time any authenticated view mounts
//  — not per-view mount/show/hide like views/areas.js or
//  views/reports.js.
//
//  Two small navigation fixes for the SPA:
//   - The mobile bottom-nav "You" button now calls
//     window.LWRouter.navigate('account') instead of
//     window.location.replace('../pages/account.html').
//   - The "this user no longer exists" fallback now calls
//     window.LWRouter.navigate('login', { replace: true }) instead
//     of window.location.replace('../index.html').
//  Everything else is unchanged.//  This file is shared chrome and no longer relies on the old
//  views/areas.js route-specific logic.// ============================================================

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
    const uploadedAvatar = typeof user.avatarImage === 'string' && /^data:image\//i.test(user.avatarImage)
        ? user.avatarImage
        : null;

    function setAvatar(el) {
        if (!el) return;
        if (uploadedAvatar) {
            el.setAttribute("aria-label", hasIdentity ? `Avatar for ${initials}` : "Guest avatar");
            el.innerHTML = `<img src="${uploadedAvatar}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block;"/>`;
            return;
        }
        el.setAttribute("aria-label", hasIdentity ? `Avatar for ${initials}` : "Guest avatar");
        el.innerHTML = avatarMarkup;
    }

    // --- chat handle display ---
    const chatHandleEl = document.getElementById("chatHandle");
    if (chatHandleEl) chatHandleEl.textContent = user.chatHandle || localStorage.getItem("chatHandle") || "anon";

    // --- desktop nav "Account" link (avatar + last name) ---
    // Replaces the old #profileMenuButton (topbarUserName/topbarAvatar),
    // which was removed — its dropdown target (#userSidebarPanel) is
    // commented out in the HTML, so the button had nothing left to do.
    // Last name only (not the full name profileMenuButton used to show):
    // same split getInitials() uses, just keeping the last token instead
    // of first+last initials.
    const navAccountName = document.getElementById("navAccountName");
    const navAccountAvatar = document.getElementById("navAccountAvatar");
    if (navAccountName) {
        const nameParts = (user.name || "").trim().split(/\s+/).filter(Boolean);
        navAccountName.textContent = nameParts.length ? nameParts[nameParts.length - 1] : "Account";
    }
    setAvatar(navAccountAvatar);

    // --- main profile card on the page ---
    // profileName/profileAvatar/profileContact now exist in TWO places
    // in the document (Home's compact card + Account's bigger one) —
    // update every match via querySelectorAll, not just the first one
    // getElementById would find.
    const profileNameEls = document.querySelectorAll('#profileName');
    const profileAvatarEls = document.querySelectorAll('#profileAvatar');
    const profileContactEls = document.querySelectorAll('#profileContact');
    const profileRegion = document.getElementById("profileRegion");
    const profileCity = document.getElementById("profileCity");
    const profileLastLogin = document.getElementById("profileLastLogin");

    profileNameEls.forEach(el => { el.textContent = user.name || "Not signed in"; });
    profileAvatarEls.forEach(el => setAvatar(el));
    profileContactEls.forEach(el => { el.textContent = contactValue; });
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

// Tracks the two intervals renderLocationPage() creates, so calling it
// again (e.g. once with cached data, then again with fresh data) clears
// the previous timers instead of stacking up duplicate pollers.
let lightStatusPollInterval = null;
let lastVerifiedRefreshInterval = null;

// -----------------------------------------------------
// LIGHT STATUS CACHE
// Lets renderLocationPage() paint the last-known status/stats for a
// location INSTANTLY on repeat visits, instead of always forcing a
// blank "loading" state until the network round-trip finishes. This
// is what lets loadCurrentUserProfile() skip the skeleton on repeat
// opens (see hideProfileLoader() call sites below) — the fix is
// deliberately NOT "skip the skeleton and show nothing" (that was
// tried before and reverted, see the note in showProfileLoader()),
// it's "skip the skeleton because there's real cached data to show
// immediately instead." The network fetch still always runs in the
// background and overwrites this the moment it lands, so nobody is
// ever stuck looking at stale data for more than a beat.
// -----------------------------------------------------
const LIGHT_STATUS_CACHE_PREFIX = 'lw_cache_lightstatus_';
const LIGHT_STATUS_CACHE_MAX_AGE_MS = 30 * 60 * 1000; // 30 min — stale past this, treat as no cache

function lightStatusCacheKey(location) {
    return LIGHT_STATUS_CACHE_PREFIX + location.toLowerCase().trim();
}

// Now backed by services/cache.js's LWCache (memory + localStorage)
// instead of a bespoke inline localStorage read/write. Behavior for
// existing callers is identical — read still returns null once past
// LIGHT_STATUS_CACHE_MAX_AGE_MS — the difference is invisible from
// here: repeat calls within the same running app instance no longer
// need a localStorage round trip at all, since LWCache already has it
// warm in memory.
function readLightStatusCache(location) {
    return LWCache.read(lightStatusCacheKey(location), LIGHT_STATUS_CACHE_MAX_AGE_MS);
}

function writeLightStatusCache(location, data) {
    LWCache.write(lightStatusCacheKey(location), {
        status: data.status || 'unknown',
        stats: data.stats || null,
        reportedAt: data.reportedAt || null
    });
}

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
    if (locationSubtitle) locationSubtitle.textContent = `Here's what's happening in ${location}`;
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
                if (data.reportedAt) {
                    lastReportedAtMs = new Date(data.reportedAt).getTime();
                    refreshLastVerifiedLabel();
                }
                renderLightStats(data.stats);
                writeLightStatusCache(location, data);
            })
            .catch(() => {
                // Only fall back to 'unknown' if we never managed to paint
                // anything at all (no cache existed either) — if a cached
                // value is already on screen, a failed refresh shouldn't
                // wipe out real (if slightly stale) data with a blank state.
                if (!cachedLightStatus) {
                    renderLightStats(null);
                }
            });
    }

    // Paint the last-known status/stats immediately if we have them —
    // this is what lets a repeat page open skip straight to real content
    // instead of a forced 'loading' placeholder. The fetch below always
    // still runs and overwrites this with the live value.
    const cachedLightStatus = readLightStatusCache(location);
    if (cachedLightStatus) {
        if (cachedLightStatus.reportedAt) {
            lastReportedAtMs = new Date(cachedLightStatus.reportedAt).getTime();
            refreshLastVerifiedLabel();
        }
        renderLightStats(cachedLightStatus.stats);
    }

    const initialStatsLoad = loadLocationStats();

    // Poll light status every 30s so all users stay in sync
    lightStatusPollInterval = setInterval(() => {
        fetch(`${API_URL}/lightstatus?location=${encodeURIComponent(location)}`)
            .then(r => r.json())
            .then(data => {
                if (data.reportedAt) {
                    lastReportedAtMs = new Date(data.reportedAt).getTime();
                    refreshLastVerifiedLabel();
                }
                renderLightStats(data.stats);
                writeLightStatusCache(location, data);
            })
            .catch(() => {});
    }, 10000);

    // So the caller (loadCurrentUserProfile) can await this and only
    // hide the loading overlay once there's real data on screen. If we
    // had a cache to paint from, that already happened synchronously
    // above — no reason to keep the skeleton up for a network round
    // trip that's just going to refresh numbers that are already
    // visible. Only a genuine first-ever load (no cache) still waits on
    // the real fetch, since there's nothing else to show yet.
    return cachedLightStatus ? Promise.resolve() : initialStatsLoad;
}

function renderSignedOutEverywhere() {
    const guestUser = { name: "Guest", emailPhone: "", location: "" };
    renderUserEverywhere(guestUser);

    const sidebarContact = document.getElementById("sidebarContact");
    document.querySelectorAll('#profileContact').forEach(el => { el.textContent = "Not signed in"; });
    if (sidebarContact) sidebarContact.textContent = "Not signed in";
}


// -----------------------------------------------------
// PROFILE LOADING STATE
// Keep only the page's lightning boot loader (lw-boot-loader).
// -----------------------------------------------------
let profileLoaderSafetyTimer = null;

// True once THIS running app instance has successfully painted the
// profile/light-status chrome at least once. Reset to false only by a
// real reload (a fresh page-load creates a fresh copy of this
// variable) — so switching Home -> Areas -> Home, or Account -> Home,
// never re-triggers the skeleton, satisfying "once the first skeleton
// shows, it never shows again while the app is still running."
let profileLoadedThisSession = false;
let profileLoaderPinned = false;

// Is there real, renderable data sitting in storage right now — a
// cached user snapshot AND (if we know their location) a light-status
// cache that hasn't expired? If so, loadCurrentUserProfile() below is
// about to paint it synchronously before any network call returns, so
// there's nothing for a blocking skeleton to usefully hide.
//
// This replaces the old FIRST_BOOT_DONE_KEY flag, which was a ONE-TIME
// localStorage marker: once set (which happened after literally the
// first successful load ever), the skeleton was skipped forever after
// — including on a cold reopen days later, once the 30-minute
// light-status cache had long since expired. That's what caused the
// bug: no skeleton to cover the gap, so the raw "—"/"Checking status"
// placeholders sat on screen and visibly filled in as the network
// calls landed. Checking real data freshness here instead of a
// permanent flag means the skeleton correctly comes back exactly when
// there's genuinely nothing current to show yet.
function hasReadyToPaintData() {
    try {
        const raw = localStorage.getItem('currentUserData')
            || sessionStorage.getItem('currentUserData')
            || localStorage.getItem('signupUser');
        if (!raw) return false;
        const user = JSON.parse(raw);
        if (!user) return false;

        let rawCity = (user.city || '').replace(/,\s*(kumasi|ghana|accra)\s*,?.*/gi, '').trim();
        const location = rawCity
            ? `${rawCity}, ${user.region || ''}`.replace(/,\s*$/, '').trim()
            : (user.location || user.region || '');

        // No location on file yet (e.g. mid-signup) — the name/avatar/
        // contact fields are still real data worth painting immediately.
        if (!location) return true;

        return Boolean(readLightStatusCache(location));
    } catch {
        return false;
    }
}

function showProfileLoader(maxDuration = 8000) {
    profileLoaderPinned = false;

    // On the very first successful reveal of this running app instance,
    // keep the full-page skeleton over the app instead of letting the
    // raw content snap into place. This avoids the visible refresh jolt
    // that users see when a signed-in open lands while the app is still
    // doing its initial mount/reveal sequence.
    if (!profileLoadedThisSession) {
        document.body?.classList.add('page-data-loading');
    }

    const connectionType = navigator?.connection?.effectiveType || '';
    const isSlowConnection = /(^|-)2g$|^3g$/.test(connectionType) || connectionType === 'slow-2g';
    const safetyDuration = Math.max(maxDuration, isSlowConnection ? 20000 : 12000);

    clearTimeout(profileLoaderSafetyTimer);
    profileLoaderSafetyTimer = setTimeout(() => {
        if (profileLoaderPinned) return;
        hideProfileLoader();
    }, safetyDuration);
}

function hideProfileLoader(force = false) {
  if (profileLoaderPinned && !force) return;

  clearTimeout(profileLoaderSafetyTimer);
  profileLoadedThisSession = true;
  profileLoaderPinned = false;

  // Matches #pageSkeleton on Home and #accountSkeleton on Account
  // (whichever is actually on screen), so both views share this one
  // loader without needing view-specific fade logic here.
  //
  // FIX: this used to be document.querySelectorAll('[id$="Skeleton"]'),
  // a generic "any id ending in Skeleton" match. That was meant to
  // catch just these two, but it also matched #notifSkeleton,
  // #locationSkeleton, and #communityChatSkeleton — skeletons that are
  // NOT part of this shared first-boot loader and manage their own
  // independent loading state (see notifications.css's #notifSkeleton
  // comment). Whenever this ran, it stamped .lw-skel-fading onto those
  // unrelated skeletons too, and nothing ever cleaned that up for them
  // since their own hide flow doesn't know that class got added. Next
  // time one of those views legitimately showed its own skeleton, it
  // carried this stale class into a state its own JS never set —
  // exactly the "skeleton doesn't match / looks stuck over real
  // content" behavior seen on Notifications. Listing the two intended
  // ids explicitly keeps this loader from ever touching skeletons it
  // doesn't own.
  document.querySelectorAll('#pageSkeleton, #accountSkeleton').forEach(el => el.classList.add('lw-skel-fading'));

  // Force one final dark paint before reveal
  if (document.documentElement.classList.contains('lw-cold-boot')) {
    document.documentElement.style.background = '#1C1F26';
  }

  setTimeout(() => {
    document.body.classList.remove('page-data-loading', 'app-loading');
    const realContent = document.getElementById('realPageContent');
    if (realContent) realContent.classList.add('lw-content-reveal');

    // First successful reveal on this device — the full skeleton never
    // needs to show again after this (see app.js's boot()).
    try { localStorage.setItem(FIRST_BOOT_DONE_KEY, '1'); } catch {}

    window.dispatchEvent(new CustomEvent('lw-page-revealed'));
  }, 180);
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
    clearOfflineError();

    // ── Get user ID from the active session (set by auth.js) ──
    const session = getSession(); // defined in auth.js
    const userId = session?.user?.id || localStorage.getItem("currentUserId");

    // currentUserData is kept fresh on every profile save (see account.js's
    // identity/city-edit handlers); session.user is a snapshot taken at
    // login that nothing else updates. Merge with currentUserData winning
    // so a just-saved chat handle/avatar can't be overwritten by a stale
    // session copy the moment this repaints.
    const cachedUserData = JSON.parse(localStorage.getItem("currentUserData") || sessionStorage.getItem("currentUserData") || localStorage.getItem("signupUser") || "null");
    const fallbackUser = session?.user
        ? { ...session.user, ...(cachedUserData || {}) }
        : cachedUserData;
    const isLocalOnlySession =
        (session?.user?.role === 'admin') ||
        (session?.user?.email === 'sarkdev@yahoo.com') ||
        (typeof userId === 'string' && !/^[0-9a-fA-F]{24}$/.test(userId));

    // Stage cached profile data under the overlay.
    if (fallbackUser) {
        renderUserEverywhere(fallbackUser);
    }

    // Paint the location/status hero card from whatever's cached right
    // now, before the network round trip below even starts. This used
    // to only happen in the isLocalOnlySession/!userId/fetch-failed
    // branches further down — meaning the common case (valid session,
    // working network) left the hero card on its raw placeholder HTML
    // until /user/:id resolved. That's exactly the gap
    // showProfileLoader()'s hasReadyToPaintData() check assumes is
    // already filled when it decides to skip the skeleton, so leaving
    // it empty meant a reload with a fresh cache showed no skeleton
    // AND no real data for a beat — the flash this is fixing.
    // renderLocationPage() is safe to call twice (it clears its own
    // polling intervals on repeat calls) — this first call paints
    // instantly from cache if there is any, and the second call further
    // down repaints with the live data once it lands.
    let locationPaintedPromise = fallbackUser ? renderLocationPage(fallbackUser) : Promise.resolve();

    if (isLocalOnlySession) {
        if (!fallbackUser) renderSignedOutEverywhere();
        await locationPaintedPromise;
        hideProfileLoader();
        return;
    }

    if (!userId) {
        if (!fallbackUser) renderSignedOutEverywhere();
        await locationPaintedPromise;
        hideProfileLoader();
        return;
    }

    let profileLoadedSuccessfully = false;

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
            window.LWRouter.navigate('login', { replace: true });
            return;
        }

        if (!response.ok) {
            if (!fallbackUser) renderSignedOutEverywhere();
            showOfflineError();
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
        profileLoadedSuccessfully = true;

    } catch (error) {
        console.error("Could not load profile:", error);
        if (!fallbackUser) {
            document.querySelectorAll('#profileContact').forEach(el => { el.textContent = "Could not reach server"; });
        }
        showOfflineError();
    } finally {
        await waitForChatReady();
        if (profileLoadedSuccessfully || hasReadyToPaintData()) {
            hideProfileLoader();
        }
    }
}

function showOfflineError() {
    profileLoaderPinned = true;

    const container = document.getElementById('realPageContent') || document.getElementById('view-home');
    if (!container) return;

    // Check if error already exists
    if (document.getElementById('lwOfflineError')) return;

    const errorEl = document.createElement('div');
    errorEl.id = 'lwOfflineError';
    errorEl.style.cssText = 'padding: 24px 20px 28px; margin-top: 18px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 12px; color: var(--text-muted); background: rgba(255,255,255,0.04); border: 1px solid var(--border-soft); border-radius: var(--radius-md);';
    errorEl.innerHTML = `
        <div style="font-size: 2.2rem; opacity: 0.7;">📡</div>
        <div style="font-size: 1rem; font-weight: 700; color: var(--text-bright);">Something went wrong</div>
        <p style="font-size: 0.9rem; line-height: 1.5; margin: 0; max-width: 280px;">Please check your internet connection and try again. The page will continue loading once you’re back online.</p>
        <button type="button" class="btn btn--primary" id="lwRetryProfileBtn" style="margin-top: 6px; min-width: 120px;">Retry</button>
    `;

    const skeleton = document.getElementById('pageSkeleton');
    if (skeleton) skeleton.hidden = false;
    container.appendChild(errorEl);

    document.getElementById('lwRetryProfileBtn')?.addEventListener('click', () => {
        clearOfflineError();
        loadCurrentUserProfile();
    });
}

function clearOfflineError() {
    const errorEl = document.getElementById('lwOfflineError');
    if (errorEl) errorEl.remove();
    const skeleton = document.getElementById('pageSkeleton');
    if (skeleton) skeleton.hidden = false;
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
let profileButton, sidebarPanel, sidebarOverlay, sidebarClose, bottomNavUserBtn;

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

// -----------------------------------------------------
// INIT — called once by the router, the first time any
// authenticated ("app"-shell) view is shown. This chrome (topbar,
// sidebar, light-status hero card on Home) is shared by every
// protected view, so it isn't tied to a single view's mount/show —
// it's initialized once and just keeps running in the background,
// same lifetime as the app shell itself.
//
// KNOWN TRADE-OFF: the light-status polling intervals started
// inside renderLocationPage() (10s) and the "last verified" label
// refresh (15s) are NOT paused while, say, the Reports view is on
// screen instead of Home — they just keep ticking for as long as
// the app shell is up. That matches "this is one persistent widget,
// not a per-view thing," and the original multi-page app never had
// a way to pause them either (a real navigation away destroyed them
// entirely instead). If you want to trim background work further,
// the natural next step is gating both intervals on
// document.visibilityState.
// -----------------------------------------------------
function initProfileChrome() {
    profileButton = document.getElementById('profileMenuButton');
    sidebarPanel = document.getElementById('userSidebarPanel');
    sidebarOverlay = document.getElementById('sidebarOverlay');
    sidebarClose = document.getElementById('userSidebarClose');
    bottomNavUserBtn = document.getElementById('bottomNavUserBtn');

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
        window.LWRouter.navigate('account');
    });

    sidebarOverlay?.addEventListener('click', closeSidebar);
    sidebarClose?.addEventListener('click', closeSidebar);
    window.addEventListener('lw:route-changed', closeSidebar);
    window.addEventListener('online', () => {
        if (profileLoaderPinned) {
            clearOfflineError();
            loadCurrentUserProfile();
        }
    });

    // This chrome (topbar avatar/name, sidebar) is also only initialized
    // once per page-load. If someone signs out and a different person
    // signs in without the page reloading, re-render it for whoever is
    // actually signed in now instead of leaving the previous person's
    // name/avatar on screen.
    window.addEventListener('lw-session-changed', () => {
        loadCurrentUserProfile();
    });

    loadCurrentUserProfile();
}

window.LWProfile = { init: initProfileChrome };