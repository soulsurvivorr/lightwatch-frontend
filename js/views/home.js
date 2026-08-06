// ============================================================
//  VIEWS/HOME.JS — location autocomplete + secondary-location
//  panel. Lives inside the Home view alongside chat.js and
//  lightstatus.js.
//
//  Changed for the SPA:
//   - Dropped the requireAuth() call at the top — the router
//     (js/app.js) already refuses to show the home view at all
//     without a session, so this would never have anything to
//     protect against by the time it runs.
//   - Wrapped in an IIFE (name-collision hygiene, consistent with
//     the other files sharing this view) and now calls
//     initHomeReminder() (views/home-reminder.js) at the end,
//     since that file no longer wires its own DOMContentLoaded
//     listener.
// ============================================================

(function () {
// ------------------------------------------------------------
// SHARED: createLoopCarousel() — a small seamless infinite-loop
// carousel helper. Built for the risk carousel and the Did You Know
// card, both of which either had a jarring "snap back to the start"
// on loop (risk carousel) or weren't interactive at all (Did You
// Know). Exposed on window since weather-home.js (loaded after this
// file — see index.html's script order) needs it too, and this is
// the one shared piece of behavior between two otherwise unrelated
// cards rather than duplicating the same logic twice.
//
// How the "no jump" loop works: the real slides are rendered with a
// clone of the LAST slide prepended and a clone of the FIRST slide
// appended, so index 0 is a clone, 1..n are the real slides, and n+1
// is another clone. Advancing off the real last slide animates onto
// the trailing clone like normal, then the instant that transition
// finishes we jump (with transitions off) to the real first slide,
// which sits in the exact same visual position — so the "reset" is
// invisible instead of a hard cut backwards across the whole track.
//
// Swiping/dragging uses Pointer Events (not touchstart/touchend) so
// it works with touch AND mouse drag, which is also the "something
// for the user to swipe" affordance that was missing before.
// ------------------------------------------------------------
function createLoopCarousel({ viewport, track, autoplayMs, onChange }) {
    let realCount = 0;
    let total = 0;
    let posIndex = 0;
    let logicalIndex = 0;
    let autoplayTimer = null;
    let loopResetTimer = null;

    function setTransform(pos, animate) {
        if (!animate) track.style.transition = 'none';
        track.style.transform = `translateX(-${pos * 100}%)`;
        if (!animate) {
            // Force a reflow so the *next* transform change (which will
            // have transitions back on) actually animates, instead of
            // the browser coalescing this jump with it.
            void track.offsetHeight;
            track.style.transition = '';
        }
    }

    function clearLoopResetTimer() {
        if (loopResetTimer) {
            clearTimeout(loopResetTimer);
            loopResetTimer = null;
        }
    }

    function jumpToBoundaryIfNeeded() {
        if (realCount <= 1) return;
        if (posIndex === 0) {
            posIndex = realCount;
            setTransform(posIndex, false);
        } else if (posIndex === total - 1) {
            posIndex = 1;
            setTransform(posIndex, false);
        }
    }

    function scheduleLoopReset() {
        clearLoopResetTimer();
        const duration = parseFloat(getComputedStyle(track).transitionDuration) || 0.8;
        const delay = Math.max(25, Math.ceil(duration * 1000) + 25);
        loopResetTimer = setTimeout(() => {
            loopResetTimer = null;
            jumpToBoundaryIfNeeded();
        }, delay);
    }

    function handleTransitionEnd(event) {
        if (event.target !== track || realCount <= 1) return;
        clearLoopResetTimer();
        jumpToBoundaryIfNeeded();
    }
    track.addEventListener('transitionend', handleTransitionEnd);

    function render(slidesHtml) {
        clearLoopResetTimer();
        realCount = slidesHtml.length;
        if (realCount === 0) {
            track.innerHTML = '';
            total = 0;
            return;
        }
        logicalIndex = ((logicalIndex % realCount) + realCount) % realCount;
        if (realCount === 1) {
            track.innerHTML = slidesHtml[0];
            total = 1;
            posIndex = 0;
            setTransform(0, false);
            onChange?.(0, 1);
            return;
        }
        track.innerHTML = [slidesHtml[realCount - 1], ...slidesHtml, slidesHtml[0]].join('');
        total = realCount + 2;
        posIndex = logicalIndex + 1;
        setTransform(posIndex, false);
        onChange?.(logicalIndex, realCount);
    }

    function goTo(index, animate = true) {
        if (realCount === 0) return;
        logicalIndex = ((index % realCount) + realCount) % realCount;
        posIndex = logicalIndex + 1;
        setTransform(posIndex, animate);
        if (animate) scheduleLoopReset();
        onChange?.(logicalIndex, realCount);
    }

    function next() {
        if (realCount <= 1) return;
        logicalIndex = (logicalIndex + 1) % realCount;
        posIndex += 1;
        setTransform(posIndex, true);
        scheduleLoopReset();
        onChange?.(logicalIndex, realCount);
    }

    function prev() {
        if (realCount <= 1) return;
        logicalIndex = (logicalIndex - 1 + realCount) % realCount;
        posIndex -= 1;
        setTransform(posIndex, true);
        scheduleLoopReset();
        onChange?.(logicalIndex, realCount);
    }

    function stopAutoplay() {
        clearInterval(autoplayTimer);
        autoplayTimer = null;
    }

    function startAutoplay() {
        stopAutoplay();
        if (!autoplayMs || realCount <= 1) return;
        autoplayTimer = setInterval(next, autoplayMs);
    }

    if (viewport) {
        let dragging = false;
        let startX = 0;
        viewport.style.touchAction = 'pan-y';
        viewport.style.cursor = 'grab';

        viewport.addEventListener('pointerdown', (event) => {
            dragging = true;
            startX = event.clientX;
            viewport.style.cursor = 'grabbing';
            stopAutoplay();
            try { viewport.setPointerCapture(event.pointerId); } catch {}
        });

        const endDrag = (event) => {
            if (!dragging) return;
            dragging = false;
            viewport.style.cursor = 'grab';
            const delta = event.clientX - startX;
            if (Math.abs(delta) > 40) {
                delta < 0 ? next() : prev();
            }
            startAutoplay();
        };

        viewport.addEventListener('pointerup', endDrag);
        viewport.addEventListener('pointercancel', endDrag);
        viewport.addEventListener('pointerleave', (event) => { if (dragging) endDrag(event); });
    }

    return {
        render,
        goTo,
        next,
        prev,
        startAutoplay,
        stopAutoplay,
        get index() { return logicalIndex; },
        get count() { return realCount; }
    };
}
window.createLoopCarousel = createLoopCarousel;

// location-autocomplete.js
// Suggests addresses as the user types in the "Add a
// location" form. Right now this is a small hardcoded list
// of real Kumasi neighborhoods/landmarks — matches your plan
// to limit LightWatch to your city while it's starting out.
//
// SWAPPING IN GOOGLE PLACES LATER:
// When you're ready for real autocomplete, replace the
// `searchMockPlaces()` function's body with a call to the
// Google Places Autocomplete API (needs a billed Google Cloud
// API key). Everything else — the dropdown rendering, keyboard
// navigation, click-to-select — stays exactly the same, since
// it just expects an array of strings back.

// ------------------------------------------------------------
// DISPLAY PREFERENCES — applied here too, not just on Account.
// Account.js is the source of truth for these localStorage keys
// (see DISPLAY_PREF_KEYS there); this just re-applies them as
// data-attributes on <html> so home.css's [data-*] rules kick in,
// since a page load doesn't inherit another page's DOM state.
// ------------------------------------------------------------
(function applyDisplayPrefsOnHome() {
    const root = document.documentElement;
    const KEYS = {
        'data-compact-chat':     'lw_pref_compact_chat',
        'data-reduce-motion':    'lw_pref_reduce_motion',
        'data-large-chat-text':  'lw_pref_large_chat_text'
    };
    Object.entries(KEYS).forEach(([attr, key]) => {
        root.setAttribute(attr, localStorage.getItem(key) === '1' ? '1' : '0');
    });
    root.setAttribute('data-density', localStorage.getItem('lw_pref_density') || 'comfortable');
    root.setAttribute('data-accent', localStorage.getItem('lw_pref_accent') || 'teal');

    // Live-sync if the user flips a toggle on Account while Home stays
    // open in another tab.
    window.addEventListener('storage', (e) => {
        const attr = Object.keys(KEYS).find(a => KEYS[a] === e.key);
        if (attr) root.setAttribute(attr, e.newValue === '1' ? '1' : '0');
        if (e.key === 'lw_pref_density') root.setAttribute('data-density', e.newValue || 'comfortable');
        if (e.key === 'lw_pref_accent') root.setAttribute('data-accent', e.newValue || 'teal');
    });
})();

// ------------------------------------------------------------
// SECONDARY LOCATION CHIP — when the user adds a second location
// on Account, show a small clickable box for it here instead of
// forcing new content into the main layout. Reads the same
// currentUserData cache profile.js/account.js already keep fresh.
// ------------------------------------------------------------
function getCachedUserForSecondaryLocation() {
    try {
        return JSON.parse(localStorage.getItem('currentUserData') || sessionStorage.getItem('currentUserData') || '{}');
    } catch {
        return {};
    }
}

function renderSecondaryLocationChip() {
    const chip = document.getElementById('secondaryLocationChip');
    if (!chip) return;

    const sec = getCachedUserForSecondaryLocation().secondaryLocation;
    if (!sec?.city) {
        chip.hidden = true;
        return;
    }

    const label = sec.label || 'Second location';
    document.getElementById('secondaryLocationChipLabel').textContent = `${label} · ${sec.city}`;
    chip.hidden = false;

    document.getElementById('secondaryLocationPanelBadge').textContent = label;
    const titleEl = document.getElementById('secondaryLocationPanelTitle');
    if (titleEl) titleEl.textContent = sec.city || '—';
    // Region shown as a small line under the city so the panel reads as
    // a specific place ("Kumasi, Ashanti"), not just a bare town name.
    const regionEl = document.getElementById('secondaryLocationPanelRegion');
    if (regionEl) regionEl.textContent = sec.region || '';
}

// -----------------------------------------------------
// SECOND LOCATION DETAIL PANEL — real status data
// Fetches the same /lightstatus endpoint the primary location
// card uses, scoped to the second location's city/region, so
// the panel reflects genuine reports rather than placeholder
// text. If nobody has ever reported for that location, it just
// says so plainly instead of guessing.
// -----------------------------------------------------
function setSecondaryStatusDot(status) {
    const dot = document.getElementById('secondaryLocationStatusDot');
    if (!dot) return;
    dot.classList.remove('location-expand-status__dot--on', 'location-expand-status__dot--off');
    if (status === 'on') dot.classList.add('location-expand-status__dot--on');
    else if (status === 'off') dot.classList.add('location-expand-status__dot--off');
}

function applyStatusIconState(icon, status) {
    if (!icon) return;
    icon.classList.remove('status-hero__icon--on', 'status-hero__icon--off', 'status-hero__icon--unknown');
    icon.classList.add(status === 'on' ? 'status-hero__icon--on' : status === 'off' ? 'status-hero__icon--off' : 'status-hero__icon--unknown');
}
// (kept above for any code still calling it directly; the secondary
// panel itself no longer needs it now that it owns its own dot state)


function formatSecondaryDuration(ms) {
    if (ms == null) return '—';
    const totalMinutes = Math.round(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes}m`;
    return `${hours}h ${minutes}m`;
}

const SECONDARY_LOCATION_CACHE_PREFIX = 'lw_cache_secondary_status_';
const SECONDARY_LOCATION_CACHE_MAX_AGE_MS = 30 * 60 * 1000; // matches profile.js's light-status cache

// Set whenever the panel opens for a given second location — the
// toggle handler below (bound once, since the row itself never
// leaves the DOM) reads this rather than closing over a stale `sec`.
let currentSecondaryLoc = null;
let secondaryToggleInFlight = false;

function currentUserIdForReports() {
    return (typeof getSession === 'function' && getSession()?.user?.id)
        || localStorage.getItem('currentUserId')
        || getCachedUserForSecondaryLocation().id
        || null;
}

function paintSecondaryLocationStatus(data, loc) {
    const labelEl = document.getElementById('secondaryLocationStatusLabel');
    const subEl = document.getElementById('secondaryLocationStatusSub');
    const uptimeEl = document.getElementById('secondaryLocationUptime');
    const avgOutageEl = document.getElementById('secondaryLocationAvgOutage');
    const outageFreqEl = document.getElementById('secondaryLocationOutageFreq');
    const lastOutageRowEl = document.getElementById('secondaryLocationLastOutageRow');
    const lastOutageEl = document.getElementById('secondaryLocationLastOutage');
    const noteEl = document.getElementById('secondaryLocationNote');

    setSecondaryStatusDot(data.status);
    // NOTE: this used to also repaint #statusIcon/#statusPillText — the
    // PRIMARY location's status-hero elements — with the SECONDARY
    // location's data any time this panel loaded. That's gone now: the
    // primary card is its own tap-to-report control (see lightstatus.js)
    // with its own live state, and clobbering it with a different
    // location's data on every panel open just meant the two fought
    // over the same two DOM nodes. This panel has its own label/dot/sub
    // elements below and doesn't need the primary's at all.
    if (labelEl) {
        labelEl.textContent = data.status === 'on' ? 'Light is on now'
            : data.status === 'off' ? 'Light is off now'
            : 'No reports yet for this area';
    }
    if (subEl) {
        subEl.textContent = data.reportedAt
            ? `Last verified ${new Date(data.reportedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`
            : 'Be the first to report here — set it as your primary location to check in.';
    }

    // Real outage-history stats the backend already computes
    // (getLightStatusStats in server.js) — this is what actually
    // matters to someone deciding whether to head over to this
    // location, unlike a raw contributor/check count.
    const stats = data.stats;
    if (stats) {
        if (uptimeEl) uptimeEl.textContent = stats.uptimePercent != null ? `${stats.uptimePercent}%` : '—';
        if (avgOutageEl) avgOutageEl.textContent = stats.avgOutageMs != null ? formatSecondaryDuration(stats.avgOutageMs) : 'No data';
        if (outageFreqEl) outageFreqEl.textContent = stats.outageFreq != null ? String(stats.outageFreq) : '—';

        if (lastOutageRowEl && lastOutageEl && stats.lastOutageMs != null) {
            lastOutageEl.textContent = formatSecondaryDuration(stats.lastOutageMs);
            lastOutageRowEl.hidden = false;
        }
    } else {
        if (uptimeEl) uptimeEl.textContent = '—';
        if (avgOutageEl) avgOutageEl.textContent = '—';
        if (outageFreqEl) outageFreqEl.textContent = '—';
        if (lastOutageRowEl) lastOutageRowEl.hidden = true;
    }

    if (noteEl) {
        noteEl.textContent = stats && stats.totalChecks > 0
            ? `Based on ${stats.totalChecks} community report${stats.totalChecks === 1 ? '' : 's'} for ${loc.split(',')[0]}, separate from your primary location above.`
            : `No community reports for ${loc.split(',')[0]} yet — this is a second spot you're keeping an eye on, separate from your primary location above.`;
    }
}

async function loadSecondaryLocationStatus(sec) {
    const labelEl = document.getElementById('secondaryLocationStatusLabel');
    const subEl = document.getElementById('secondaryLocationStatusSub');

    const loc = `${sec.city}, ${sec.region || ''}`.replace(/,\s*$/, '');
    currentSecondaryLoc = loc;
    const cacheKey = SECONDARY_LOCATION_CACHE_PREFIX + loc.toLowerCase().trim();

    // Paint the last-known status/stats for this second location
    // instantly if we have them (same stale-while-revalidate pattern as
    // the primary location's hero card and the Locations list), instead of
    // forcing "Checking status…" every single time the panel reopens
    // for a location the user has already looked at this session.
    const cached = LWCache.read(cacheKey, SECONDARY_LOCATION_CACHE_MAX_AGE_MS);
    if (cached) {
        paintSecondaryLocationStatus(cached, loc);
    } else {
        setSecondaryStatusDot('unknown');
        if (labelEl) labelEl.textContent = 'Checking status…';
        if (subEl) subEl.textContent = '—';
    }

    try {
        const res = await fetch(`${API_URL}/lightstatus?location=${encodeURIComponent(loc)}`);
        if (!res.ok) throw new Error('bad response');
        const data = await res.json();

        paintSecondaryLocationStatus(data, loc);
        LWCache.write(cacheKey, {
            status: data.status || 'unknown',
            stats: data.stats || null,
            reportedAt: data.reportedAt || null
        });

        // (Status-change alerts are now handled server-side — see the
        // NOTIFY-ME-HERE section below — so there's nothing to record
        // here beyond the display update above.)
    } catch (err) {
        // A failed refresh shouldn't wipe out real (if slightly stale)
        // cached data that's already on screen — only fall back to the
        // error state if we never had anything to show at all.
        if (!cached) {
            setSecondaryStatusDot('unknown');
            if (labelEl) labelEl.textContent = 'Could not load status';
            if (subEl) subEl.textContent = 'Check your connection and try again.';
        }
    }
}

// Same "freeze the page in place" technique used for the mobile chat
// popup (see setMobileScrollLock in chat.js), but applied at every
// viewport width — this panel opens as a centered modal on desktop too,
// and the page behind it shouldn't scroll there either.
let lwLocationPanelLockedScrollY = 0;
function setLocationPanelScrollLock(locked) {
    if (locked) {
        lwLocationPanelLockedScrollY = window.scrollY || window.pageYOffset || 0;
        document.documentElement.classList.add('lw-location-panel-open');
        document.body.classList.add('lw-location-panel-open');
        document.body.style.position = 'fixed';
        document.body.style.top = `-${lwLocationPanelLockedScrollY}px`;
        document.body.style.left = '0';
        document.body.style.right = '0';
        document.body.style.width = '100%';
    } else {
        document.documentElement.classList.remove('lw-location-panel-open');
        document.body.classList.remove('lw-location-panel-open');
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.left = '';
        document.body.style.right = '';
        document.body.style.width = '';
        window.scrollTo(0, lwLocationPanelLockedScrollY);
    }
}

// -----------------------------------------------------
// SECONDARY LOCATION TOGGLE — same tap-to-report interaction as the
// primary status-hero__icon (see lightstatus.js), applied to this
// panel's own dot/status row instead of a second copy of the primary
// card's elements. Goes through window.LWLightStatus.report(), the
// exact same POST /lightstatus call, so a report made here shows up
// identically anywhere else that reads this location's status.
// -----------------------------------------------------
async function toggleSecondaryLightStatus() {
    if (secondaryToggleInFlight || !currentSecondaryLoc || !window.LWLightStatus) return;
    secondaryToggleInFlight = true;

    const labelEl = document.getElementById('secondaryLocationStatusLabel');
    const dot = document.getElementById('secondaryLocationStatusDot');
    const currentlyOn = dot?.classList.contains('location-expand-status__dot--on');
    const nextStatus = currentlyOn ? 'off' : 'on';

    dot?.classList.add('location-expand-status__dot--deciding');
    if (labelEl) labelEl.textContent = nextStatus === 'on' ? 'Reporting light on…' : 'Reporting light off…';

    try {
        const record = await window.LWLightStatus.report(currentSecondaryLoc, nextStatus, currentUserIdForReports());
        paintSecondaryLocationStatus({ status: record.status, reportedAt: record.reportedAt }, currentSecondaryLoc);
        LWCache.write(SECONDARY_LOCATION_CACHE_PREFIX + currentSecondaryLoc.toLowerCase().trim(), {
            status: record.status,
            stats: null,
            reportedAt: record.reportedAt || null
        });
    } catch (err) {
        if (labelEl) labelEl.textContent = currentlyOn ? 'Light is on now' : 'Light is off now';
    } finally {
        dot?.classList.remove('location-expand-status__dot--deciding');
        secondaryToggleInFlight = false;
    }
}

(function bindSecondaryStatusToggle() {
    const row = document.getElementById('secondaryLocationStatusRow');
    if (!row) return;
    row.classList.add('location-expand-status--interactive');
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-label', 'Tap to report the light status for this location');
    row.addEventListener('click', toggleSecondaryLightStatus);
    row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleSecondaryLightStatus();
        }
    });
})();

function openSecondaryLocationPanel() {
    const overlay = document.getElementById('secondaryLocationOverlay');
    const panel = document.getElementById('secondaryLocationPanel');
    if (!overlay || !panel) return;

    overlay.classList.add('location-expand-overlay--open');
    overlay.setAttribute('aria-hidden', 'false');
    setLocationPanelScrollLock(true);

    const sec = getCachedUserForSecondaryLocation().secondaryLocation;
    if (sec?.city) {
        loadSecondaryLocationStatus(sec);
        initSecondaryLocationNotifyToggle(sec);
    }
}

function closeSecondaryLocationPanel() {
    const overlay = document.getElementById('secondaryLocationOverlay');
    if (!overlay) return;

    overlay.classList.remove('location-expand-overlay--open');
    overlay.setAttribute('aria-hidden', 'true');
    setLocationPanelScrollLock(false);
}

// -----------------------------------------------------
// NOTIFY-ME-HERE — lets the user opt in to a push alert whenever
// their second location's power status flips. This is real Web
// Push, not a client-side poll: the toggle just writes a
// secondaryLocationKey onto this device's push subscription
// (see setSecondaryLocationNotifyPreference in notification.js),
// and the server's POST /lightstatus handler looks up and pushes
// to anyone watching that key the moment a status actually
// changes — works even if this tab/app is closed, same as the
// primary-location and chat push notifications already do.
// -----------------------------------------------------
function secondaryLocationLabelFor(sec) {
    return `${sec.city || ''}, ${sec.region || ''}`.replace(/,\s*$/, '').replace(/^,\s*/, '');
}

async function initSecondaryLocationNotifyToggle(sec) {
    const toggle = document.getElementById('secondaryLocationNotifyToggle');
    const subEl = document.getElementById('secondaryLocationNotifySub');
    if (!toggle) return;

    // Replace the node rather than tracking a "was this already bound"
    // flag — the panel can reopen for a different second location across
    // a session, so we always want a fresh listener bound to the current
    // `sec`, not one closed over a stale value from an earlier open.
    const freshToggle = toggle.cloneNode(true);
    toggle.parentNode.replaceChild(freshToggle, toggle);

    // Read the real current state from the server rather than assuming —
    // this device's subscription is the source of truth, not localStorage.
    freshToggle.disabled = true;
    if (typeof window.getChatPushPreferences === 'function') {
        try {
            const prefs = await window.getChatPushPreferences();
            freshToggle.checked = Boolean(prefs?.secondaryLocationKey);
        } catch {
            freshToggle.checked = false;
        }
    }
    freshToggle.disabled = false;

    freshToggle.addEventListener('change', async () => {
        freshToggle.disabled = true;

        if (freshToggle.checked) {
            if (typeof Notification !== 'undefined' && Notification.permission !== 'granted' && typeof window.enableLightWatchPush === 'function') {
                await window.enableLightWatchPush();
            }
            if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
                // Permission wasn't granted — don't silently claim it's on.
                freshToggle.checked = false;
                freshToggle.disabled = false;
                if (subEl) subEl.textContent = 'Notifications are blocked for this browser — enable them in your device settings.';
                return;
            }

            const result = typeof window.setSecondaryLocationNotifyPreference === 'function'
                ? await window.setSecondaryLocationNotifyPreference(secondaryLocationLabelFor(sec))
                : { success: false };

            freshToggle.disabled = false;
            if (result.success) {
                if (subEl) subEl.textContent = "You'll get a push alert here if this location's status changes.";
            } else {
                freshToggle.checked = false;
                if (subEl) subEl.textContent = result.error || 'Could not save this preference — try again.';
            }
        } else {
            const result = typeof window.setSecondaryLocationNotifyPreference === 'function'
                ? await window.setSecondaryLocationNotifyPreference(null)
                : { success: false };

            freshToggle.disabled = false;
            if (!result.success) {
                freshToggle.checked = true;
                if (subEl) subEl.textContent = result.error || 'Could not save this preference — try again.';
                return;
            }
            if (subEl) subEl.textContent = "Get an alert if this location's power status changes";
        }
    });
}

document.getElementById('secondaryLocationChip')?.addEventListener('click', openSecondaryLocationPanel);
document.getElementById('secondaryLocationClose')?.addEventListener('click', closeSecondaryLocationPanel);
// The panel now sits INSIDE the overlay backdrop (so it can be centered
// over the page), so only close on a click that lands on the backdrop
// itself — not one that bubbles up from inside the panel.
document.getElementById('secondaryLocationOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'secondaryLocationOverlay') closeSecondaryLocationPanel();
});

// Cached data may still be stale on first paint — re-render once profile.js
// has fetched the fresh copy and revealed the real page.
renderSecondaryLocationChip();
window.addEventListener('lw-page-revealed', renderSecondaryLocationChip);

// Live update if a location is added/edited/removed on Account in another tab.
window.addEventListener('storage', (e) => {
    if (e.key === 'currentUserData') renderSecondaryLocationChip();
});

const addressInput = document.getElementById('newLocationAddress');
const autocompleteList = document.getElementById('autocompleteList');
const addLocationForm = document.getElementById('addLocationForm');
const newLocationNameInput = document.getElementById('newLocationName');
const newLocationStatusInput = document.getElementById('newLocationStatus');


// -----------------------------------------------------
// MOCK PLACE DATA — Kumasi only, on purpose
// -----------------------------------------------------
const KUMASI_PLACES = [
    "Bantama, Kumasi, Ghana",
    "Bantama Market, Kumasi, Ghana",
    "Adum, Kumasi, Ghana",
    "Asafo, Kumasi, Ghana",
    "Asokwa, Kumasi, Ghana",
    "Ahodwo, Kumasi, Ghana",
    "Suame, Kumasi, Ghana",
    "Suame Magazine, Kumasi, Ghana",
    "Tafo, Kumasi, Ghana",
    "Kejetia, Kumasi, Ghana",
    "Kejetia Market, Kumasi, Ghana",
    "Nhyiaeso, Kumasi, Ghana",
    "Santasi, Kumasi, Ghana",
    "Bomso, Kumasi, Ghana",
    "Asuoyeboah, Kumasi, Ghana",
    "Kwadaso, Kumasi, Ghana",
    "Oforikrom, Kumasi, Ghana",
    "Ayigya, Kumasi, Ghana",
    "Patasi, Kumasi, Ghana",
    "Manhyia, Kumasi, Ghana"
];


// -----------------------------------------------------
// SEARCH FUNCTION
// Takes whatever the user typed and returns matching
// places. Swap this for a real API call later — keep the
// same input (a string) and output (array of strings).
// -----------------------------------------------------
function searchMockPlaces(query) {
    const lowerQuery = query.toLowerCase().trim();
    if (!lowerQuery) return [];

    return KUMASI_PLACES.filter(place =>
        place.toLowerCase().includes(lowerQuery)
    ).slice(0, 6); // cap at 6 suggestions, like a real autocomplete
}


// -----------------------------------------------------
// RENDER the dropdown list from an array of place strings
// -----------------------------------------------------
function renderSuggestions(places) {

    autocompleteList.innerHTML = "";

    if (places.length === 0) {
        const emptyItem = document.createElement('li');
        emptyItem.className = "autocomplete-list__empty";
        emptyItem.textContent = "No matches in Kumasi yet";
        autocompleteList.appendChild(emptyItem);
        autocompleteList.hidden = false;
        return;
    }

    places.forEach(place => {
        const item = document.createElement('li');
        item.textContent = place;
        item.addEventListener('click', () => {
            addressInput.value = place;
            autocompleteList.hidden = true;
            // Feeds the admin "most searched locations" analytics — see analytics.js
            window.LWAnalytics?.trackSearch(place, place.split(',')[0].trim());
        });
        autocompleteList.appendChild(item);
    });

    autocompleteList.hidden = false;
}


// -----------------------------------------------------
// WIRE UP TYPING
// -----------------------------------------------------
addressInput?.addEventListener('input', () => {
    const results = searchMockPlaces(addressInput.value);

    if (addressInput.value.trim() === "") {
        autocompleteList.hidden = true;
        return;
    }

    renderSuggestions(results);
});


// -----------------------------------------------------
// CLOSE DROPDOWN when clicking elsewhere on the page
// -----------------------------------------------------
document.addEventListener('click', (e) => {
    if (!addressInput) return;
    const clickedInsideField = addressInput.contains(e.target) || autocompleteList.contains(e.target);
    if (!clickedInsideField) {
        autocompleteList.hidden = true;
    }
});


// -----------------------------------------------------
// FORM SUBMIT
// For now this just confirms the location was "added" —
// the natural next step is POSTing this to a backend
// /locations route once one exists, the same way signup.js
// posts to /signup.
// -----------------------------------------------------
addLocationForm?.addEventListener('submit', (e) => {
    e.preventDefault();

    const name = newLocationNameInput.value.trim();
    const address = addressInput.value.trim();
    const status = newLocationStatusInput.value;

    if (!name || !address) {
        alert("Please fill in both the location name and address.");
        return;
    }

    console.log("New location captured (not yet sent to a backend):", {
        name, address, status
    });

    alert(`Saved "${name}" at ${address} — status: ${status}`);

    addLocationForm.reset();
    autocompleteList.hidden = true;
});



initHomeReminder();
// -----------------------------------------------------
// TRENDING POST — fills the "Trending Stories" lw-live-card
// (#trendBanner / #trendBannerTitle / #trendBannerSub) with the
// most-engaged community report (likes + reposts + quotes +
// replies). If nothing has engagement yet, falls back to the
// latest post.
// -----------------------------------------------------
function normalizeHomeLocationText(rawText) {
    const text = String(rawText || '').trim();
    if (!text) return '';
    const normalized = text.toLowerCase();
    if (normalized.includes('your area') || normalized.includes('your neighborhood') || normalized.includes('your location')) {
        return '';
    }
    return text;
}

function renderTrendBannerAvatar(target, chat) {
    if (!target) return;
    target.innerHTML = '';
    target.classList.remove('avatar--generated', 'trend-banner__avatar--image', 'is-empty');

    const avatarImage = chat?.avatarImage || chat?.user?.avatarImage || '';
    const seed = chat?.userId || chat?.user?._id || chat?.user?.id || chat?.handle || chat?.user?.handle || chat?.chatHandle || chat?._id || chat?.id || '';

    if (avatarImage && /^data:image\//i.test(avatarImage)) {
        const img = document.createElement('img');
        img.src = avatarImage;
        img.alt = '';
        img.setAttribute('loading', 'lazy');
        target.appendChild(img);
        target.classList.add('trend-banner__avatar--image');
        return;
    }

    if (window.LWAvatar && seed) {
        window.LWAvatar.renderInto(target, seed);
        target.classList.add('avatar--generated');
        return;
    }

    target.textContent = '↗';
    target.classList.add('is-empty');
}

async function initHomeTrending() {
    try {
        const banner = document.getElementById('trendBanner');
        const titleEl = document.getElementById('trendBannerTitle');
        const subEl = document.getElementById('trendBannerSub');
        const avatarEl = document.getElementById('trendBannerAvatar');
        if (!banner || !titleEl || !subEl) return;

        // Build the fetch params (scope to current visible location when possible).
        // Ignore placeholder labels like "your area" so the feed query isn't
        // accidentally scoped to a non-location value.
        const rawLoc = document.getElementById('locationSubtitleArea')?.textContent || '';
        const loc = window.currentChatLocation || normalizeHomeLocationText(rawLoc);
        banner.dataset.homeTrending = '1';
        // For home trending we want the top community post across everyone,
        // not just the visitor's selected location. Request the backend's
        // trending aggregation which returns the best post for the scope.
        const res = await fetch(`${API_URL}/chats?trending=1&scope=global`, { cache: 'no-store' });
        if (!res.ok) throw new Error('chats fetch failed');
        const chats = await res.json();

        // Admin broadcasts aren't community posts — leave them out of the
        // trending computation.
        const posts = Array.isArray(chats) ? chats.filter(c => !c.isAdmin) : [];

        if (posts.length === 0) {
            titleEl.textContent = 'No community posts yet';
            subEl.textContent = '—';
            renderTrendBannerAvatar(avatarEl, null);
            banner.classList.remove('trend-banner--stable', 'trend-banner--warning');
            banner.dataset.homeTrending = '1';
            return;
        }

        // compute reply counts (comments)
        const repliedCounts = new Map();
        posts.forEach(c => {
            if (c.replyTo && c.replyTo.chatId) {
                const key = String(c.replyTo.chatId);
                repliedCounts.set(key, (repliedCounts.get(key) || 0) + 1);
            }
        });

        // score = likes + reposts + quotes + replies
        let best = null;
        let bestScore = -1;
        posts.forEach(c => {
            const id = String(c._id || c.id || '');
            const score = (Number(c.likeCount || 0) + Number(c.repostCount || 0) + Number(c.quoteCount || 0) + Number(repliedCounts.get(id) || 0));
            const createdAt = new Date(c.createdAt || 0).getTime();
            const currentBestCreatedAt = best ? new Date(best.createdAt || 0).getTime() : 0;
            if (score > bestScore || (score === bestScore && createdAt > currentBestCreatedAt)) {
                bestScore = score;
                best = c;
            }
        });

        // If no post has any engagement yet, fall back to the latest post
        // (GET /chats returns newest-first).
        if (!best || bestScore <= 0) best = posts[0];

        if (best) {
            console.debug('[home] trending selected post', {
                id: String(best._id || best.id || ''),
                score: bestScore,
                createdAt: best.createdAt,
                likes: best.likeCount,
                reposts: best.repostCount,
                quotes: best.quoteCount,
                replies: repliedCounts.get(String(best._id || best.id || '')) || 0,
                text: String(best.text || '').slice(0, 100)
            });
        }

        const text = (best.text || '').replace(/\s+/g, ' ').trim() || 'Shared an update';
        const short = text.length > 90 ? text.slice(0, 87).trim() + '...' : text;
        const handle = (best.handle || 'Community').trim();
        const time = new Date(best.createdAt || Date.now()).toLocaleString([], { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' });

        // .textContent (not innerHTML) — no manual escaping needed and none
        // of this can be interpreted as markup.
        titleEl.textContent = short;
        subEl.textContent = `${handle} • ${time}`;
        renderTrendBannerAvatar(avatarEl, best);
        banner.classList.remove('trend-banner--stable', 'trend-banner--warning');

        // Attach metadata and click behavior so tapping the banner opens
        // the full post in the Reports (Community) view.
        const postId = String(best._id || best.id || '');
        banner.dataset.homeTrending = '1';
        banner.dataset.chatId = postId;
        banner.dataset.chatScope = best.scope || 'global';
        banner.dataset.chatLocation = best.location || '';

        banner.setAttribute('role', 'button');
        banner.setAttribute('tabindex', '0');

        const openTrendingPost = (event) => {
            if (!banner.dataset.chatId) return;
            event?.preventDefault?.();
            try {
                const params = new URLSearchParams({
                    chatId: banner.dataset.chatId,
                    chatScope: banner.dataset.chatScope || 'global',
                    chatLocation: banner.dataset.chatLocation || ''
                });
                window.LWRouter?.navigate('chat', { search: `?${params.toString()}` });
            } catch (e) { console.error('[home] navigate to trending post failed', e); }
        };

        banner.onclick = openTrendingPost;
        banner.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTrendingPost(e); } };

    } catch (err) {
        console.error('[home] trending init failed', err);
    }
}

// Run after initial render — non-blocking.
setTimeout(initHomeTrending, 400);

if (!window.currentChatLocation) {
    window.addEventListener('locationReady', () => initHomeTrending());
    const locationReadyFallback = setInterval(() => {
        if (window.currentChatLocation) {
            clearInterval(locationReadyFallback);
            initHomeTrending();
        }
    }, 300);
    setTimeout(() => clearInterval(locationReadyFallback), 15000);
}

// ============================================================
// DID YOU KNOW — interactive fact carousel. FIX: this card used to
// be entirely inert — #lwxDidYouKnowText held one hardcoded sentence
// forever, and the refresh button + dots were unwired decoration
// with nothing behind them to move. Now backed by a real slide
// track and the shared createLoopCarousel() helper (see the top of
// this file) so it auto-advances slowly, responds to the refresh
// button and dots, and is swipeable/draggable.
// ============================================================
(function initDidYouKnowCard() {
    const card = document.getElementById('lwxDidYouKnowCard');
    const viewport = document.getElementById('lwxDidYouKnowViewport');
    const track = document.getElementById('lwxDidYouKnowTrack');
    const dotsHost = document.getElementById('lwxDidYouKnowDots');
    const refreshBtn = document.getElementById('lwxDidYouKnowRefresh');
    const illustration = card?.querySelector('.lwx-didyouknow-card__illustration');
    if (!card || !viewport || !track || typeof window.createLoopCarousel !== 'function') return;

    // Small icon set, same 2-color style as the card's existing storm
    // illustration (gray #8C97AE base, amber #F2B33D accent) so a new
    // icon never looks bolted-on. Each fact below opts into whichever
    // one actually fits it; facts that don't get an explicit match
    // (e.g. a future fact added without one) fall back to `default`
    // instead of being forced into an unrelated icon.
    const ICONS = {
        storm: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M17 38a11 11 0 0 1 1.4-21.6A14 14 0 0 1 45 19.3a9.8 9.8 0 0 1-2 19.4H17Z" fill="#8C97AE"/><path d="M32 33 24 47h6l-4.5 11L38 43h-6l4.5-10Z" fill="#F2B33D"/></svg>`,
        report: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13 26v12a4 4 0 0 0 4 4h4l16 10V12L21 22h-4a4 4 0 0 0-4 4Z" fill="#8C97AE"/><path d="M40 20a14 14 0 0 1 0 24" stroke="#F2B33D" stroke-width="3.2" stroke-linecap="round"/><path d="M46 14a22 22 0 0 1 0 36" stroke="#F2B33D" stroke-width="3.2" stroke-linecap="round" opacity="0.55"/></svg>`,
        demand: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="34" r="18" fill="#8C97AE"/><path d="M32 34A18 18 0 0 1 47 41" stroke="#F2B33D" stroke-width="4" stroke-linecap="round" fill="none"/><path d="M32 23v11l8 5" stroke="#F5F7FA" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><rect x="27" y="9" width="10" height="5" rx="2.5" fill="#8C97AE"/></svg>`,
        fridge: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="19" y="9" width="26" height="46" rx="4" fill="#8C97AE"/><rect x="19" y="26" width="26" height="2.5" fill="#22160f" opacity="0.25"/><rect x="23" y="14" width="3" height="7" rx="1.5" fill="#F2B33D"/><rect x="23" y="31" width="3" height="7" rx="1.5" fill="#F2B33D"/></svg>`,
        surge: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M32 8 50 15v14c0 14-8 23-18 27C22 52 14 43 14 29V15Z" fill="#8C97AE"/><path d="M34 20 24 34h6l-3 12 15-17h-7l4-9Z" fill="#F2B33D"/></svg>`,
        community: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="8" fill="#8C97AE"/><path d="M10 48c0-9 6-15 14-15s14 6 14 15" fill="#8C97AE"/><circle cx="42" cy="22" r="6.5" fill="#F2B33D" opacity="0.85"/><path d="M32 47c1-7 6-12 13-12s12 5 13 12" fill="#F2B33D" opacity="0.85"/></svg>`,
        default: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M32 8a16 16 0 0 0-9 29 8 8 0 0 1 3.4 6v1h11.2v-1a8 8 0 0 1 3.4-6A16 16 0 0 0 32 8Z" fill="#8C97AE"/><path d="M26 50h12" stroke="#F2B33D" stroke-width="3" stroke-linecap="round"/><path d="M27.5 55h9" stroke="#F2B33D" stroke-width="3" stroke-linecap="round"/></svg>`
    };

    // Real, LightWatch-relevant tips — same spirit as the original
    // hardcoded sentence, just more than one of them.
    const FACTS = [
        { text: 'Most outages in Kumasi happen during heavy evening storms.', icon: 'storm' },
        { text: 'Reporting an outage the moment it starts helps power get restored faster.', icon: 'report' },
        { text: 'Electricity demand usually peaks between 6PM and 9PM.', icon: 'demand' },
        { text: 'Keeping your fridge closed during an outage keeps food cold for hours longer.', icon: 'fridge' },
        { text: 'A surge protector can save your appliances when power suddenly returns.', icon: 'surge' },
        { text: 'The more neighbors who report, the faster LightWatch can flag an outage.', icon: 'community' }
    ];

    function slideHtml(fact) {
        return `<div class="lwx-didyouknow-card__slide"><p class="lwx-didyouknow-card__text">${fact.text}</p></div>`;
    }

    function renderDots(count, activeIndex) {
        if (!dotsHost) return;
        dotsHost.innerHTML = Array.from({ length: count }, (_, i) =>
            `<span class="lwx-didyouknow-card__dot${i === activeIndex ? ' lwx-didyouknow-card__dot--active' : ''}" data-dot-index="${i}"></span>`
        ).join('');
    }

    function updateIllustration(activeIndex) {
        if (!illustration) return;
        illustration.innerHTML = ICONS[FACTS[activeIndex]?.icon] || ICONS.default;
    }

    // createLoopCarousel calls onChange as (activeIndex, count) — see
    // render()/goTo()/next()/prev() above. renderDots' own params were
    // named (count, activeIndex), the reverse, so wiring it in as
    // `onChange: renderDots` directly was quietly passing it the wrong
    // values (rendering `activeIndex` dots with the "active" one at an
    // out-of-range index, so none ever lit up). Routing through one
    // correctly-ordered handler fixes that and drives the illustration
    // swap from the same event.
    function handleSlideChange(activeIndex, count) {
        renderDots(count, activeIndex);
        updateIllustration(activeIndex);
    }

    const carousel = window.createLoopCarousel({
        viewport,
        track,
        autoplayMs: 7000, // slow, unhurried auto-advance
        onChange: handleSlideChange
    });

    carousel.render(FACTS.map(slideHtml));
    carousel.startAutoplay();

    dotsHost?.addEventListener('click', (event) => {
        const dot = event.target.closest('[data-dot-index]');
        if (!dot) return;
        carousel.goTo(Number(dot.dataset.dotIndex));
        carousel.startAutoplay();
    });

    refreshBtn?.addEventListener('click', () => {
        carousel.next();
        carousel.startAutoplay();
    });

    // Pause the slow auto-advance while a mouse user is reading;
    // touch/drag pausing is already handled inside createLoopCarousel.
    card.addEventListener('mouseenter', () => carousel.stopAutoplay());
    card.addEventListener('mouseleave', () => carousel.startAutoplay());
})();

})();