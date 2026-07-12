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

requireAuth(); // redirects to login if no session — defined in auth.js

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
    const secTitle = [sec.city, sec.region].filter(Boolean).join(', ');
    const titleEl = document.getElementById('secondaryLocationPanelTitle');
    if (titleEl) titleEl.textContent = secTitle || '—';
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

function formatSecondaryDuration(ms) {
    if (ms == null) return '—';
    const totalMinutes = Math.round(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes}m`;
    return `${hours}h ${minutes}m`;
}

async function loadSecondaryLocationStatus(sec) {
    const labelEl = document.getElementById('secondaryLocationStatusLabel');
    const subEl = document.getElementById('secondaryLocationStatusSub');
    const uptimeEl = document.getElementById('secondaryLocationUptime');
    const contributorsEl = document.getElementById('secondaryLocationContributors');
    const checksEl = document.getElementById('secondaryLocationChecks');
    const noteEl = document.getElementById('secondaryLocationNote');

    setSecondaryStatusDot('unknown');
    if (labelEl) labelEl.textContent = 'Checking status…';
    if (subEl) subEl.textContent = '—';
    if (uptimeEl) uptimeEl.textContent = '—';
    if (contributorsEl) contributorsEl.textContent = '—';
    if (checksEl) checksEl.textContent = '—';

    const loc = `${sec.city}, ${sec.region || ''}`.replace(/,\s*$/, '');

    try {
        const res = await fetch(`${API_URL}/lightstatus?location=${encodeURIComponent(loc)}`);
        if (!res.ok) throw new Error('bad response');
        const data = await res.json();

        setSecondaryStatusDot(data.status);
        if (labelEl) {
            labelEl.textContent = data.status === 'on' ? 'Light is on'
                : data.status === 'off' ? 'Light is off'
                : 'No reports yet for this area';
        }
        if (subEl) {
            subEl.textContent = data.reportedAt
                ? `Last verified ${new Date(data.reportedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`
                : 'Be the first to report here — set it as your primary location to check in.';
        }

        const stats = data.stats;
        if (stats) {
            if (uptimeEl) uptimeEl.textContent = stats.uptimePercent != null ? `${stats.uptimePercent}%` : '—';
            if (contributorsEl) contributorsEl.textContent = String(stats.uniqueContributors ?? '—');
            if (checksEl) checksEl.textContent = String(stats.totalChecks ?? '—');
        }

        if (noteEl) {
            noteEl.textContent = stats && stats.totalChecks > 0
                ? `Based on ${stats.totalChecks} community report${stats.totalChecks === 1 ? '' : 's'} for ${loc.split(',')[0]}, separate from your primary location above.`
                : `No community reports for ${loc.split(',')[0]} yet — this is a second spot you're keeping an eye on, separate from your primary location above.`;
        }

        // Feed the same status into the notify-on-change watcher so the
        // very first known status (whatever it is right now) is recorded
        // as the baseline instead of triggering a false "changed" alert
        // the next time the watcher runs.
        recordSecondaryLocationStatus(sec, data.status);
    } catch (err) {
        setSecondaryStatusDot('unknown');
        if (labelEl) labelEl.textContent = 'Could not load status';
        if (subEl) subEl.textContent = 'Check your connection and try again.';
    }
}

function openSecondaryLocationPanel() {
    const overlay = document.getElementById('secondaryLocationOverlay');
    const panel = document.getElementById('secondaryLocationPanel');
    if (!overlay || !panel) return;

    overlay.classList.add('location-expand-overlay--open');
    overlay.setAttribute('aria-hidden', 'false');

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
}

// -----------------------------------------------------
// NOTIFY-ME-HERE — lets the user opt in to a local alert
// whenever their second location's power status flips. This
// piggybacks on the same push permission/service worker
// notification.js already sets up (so we reuse
// enableLightWatchPush() for the permission prompt), but the
// "did it change" check itself just runs a lightweight poll of
// /lightstatus while the app is open, since there's no per-user
// server-side watch for secondary locations yet.
// -----------------------------------------------------
const SECONDARY_NOTIFY_PREF_PREFIX = 'lw_secondary_notify_';
const SECONDARY_LAST_STATUS_PREFIX = 'lw_secondary_last_status_';
const SECONDARY_WATCH_INTERVAL_MS = 60000;
let secondaryWatchTimer = null;

function secondaryLocationKey(sec) {
    return `${sec.city || ''}|${sec.region || ''}`.toLowerCase().trim();
}

function isSecondaryNotifyEnabled(sec) {
    return localStorage.getItem(SECONDARY_NOTIFY_PREF_PREFIX + secondaryLocationKey(sec)) === '1';
}

function setSecondaryNotifyEnabled(sec, enabled) {
    localStorage.setItem(SECONDARY_NOTIFY_PREF_PREFIX + secondaryLocationKey(sec), enabled ? '1' : '0');
}

function recordSecondaryLocationStatus(sec, status) {
    if (!status) return;
    const key = SECONDARY_LAST_STATUS_PREFIX + secondaryLocationKey(sec);
    const prev = localStorage.getItem(key);
    if (prev && prev !== status && prev !== 'unknown' && status !== 'unknown' && isSecondaryNotifyEnabled(sec)) {
        notifySecondaryLocationChanged(sec, status);
    }
    localStorage.setItem(key, status);
}

async function notifySecondaryLocationChanged(sec, status) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (!('serviceWorker' in navigator)) return;

    const cityLabel = sec.city || 'Your second location';
    const statusText = status === 'on' ? 'Light is back on' : 'Light just went off';

    try {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(`${cityLabel}: ${statusText}`, {
            body: `Power status for ${cityLabel} changed to "${status}".`,
            icon: new URL('/images/dev-logo.png', window.location.origin).href,
            tag: 'lw-secondary-location-change',
            renotify: true,
            vibrate: [140, 60, 140],
            data: { url: '/pages/home.html' }
        });
    } catch (err) {
        console.error('Could not show secondary location notification:', err);
    }
}

async function pollSecondaryLocationForChanges() {
    const sec = getCachedUserForSecondaryLocation().secondaryLocation;
    if (!sec?.city || !isSecondaryNotifyEnabled(sec)) return;

    const loc = `${sec.city}, ${sec.region || ''}`.replace(/,\s*$/, '');
    try {
        const res = await fetch(`${API_URL}/lightstatus?location=${encodeURIComponent(loc)}`);
        if (!res.ok) return;
        const data = await res.json();
        recordSecondaryLocationStatus(sec, data.status);
    } catch {
        // silent — retries next tick
    }
}

function startSecondaryLocationWatch() {
    clearInterval(secondaryWatchTimer);
    const sec = getCachedUserForSecondaryLocation().secondaryLocation;
    if (!sec?.city || !isSecondaryNotifyEnabled(sec)) return;
    secondaryWatchTimer = setInterval(pollSecondaryLocationForChanges, SECONDARY_WATCH_INTERVAL_MS);
}

function initSecondaryLocationNotifyToggle(sec) {
    const toggle = document.getElementById('secondaryLocationNotifyToggle');
    const subEl = document.getElementById('secondaryLocationNotifySub');
    if (!toggle) return;

    toggle.checked = isSecondaryNotifyEnabled(sec);

    // Replace the node rather than tracking a "was this already bound"
    // flag — the panel can reopen for a different second location across
    // a session, so we always want a fresh listener bound to the current
    // `sec`, not one closed over a stale value from an earlier open.
    const freshToggle = toggle.cloneNode(true);
    toggle.parentNode.replaceChild(freshToggle, toggle);

    freshToggle.addEventListener('change', async () => {
        if (freshToggle.checked) {
            if (typeof Notification !== 'undefined' && Notification.permission !== 'granted' && typeof window.enableLightWatchPush === 'function') {
                await window.enableLightWatchPush();
            }
            if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
                // Permission wasn't granted — don't silently claim it's on.
                freshToggle.checked = false;
                if (subEl) subEl.textContent = 'Notifications are blocked for this browser — enable them in your device settings.';
                return;
            }
            setSecondaryNotifyEnabled(sec, true);
            if (subEl) subEl.textContent = "You'll be alerted here if this location's status changes.";
            startSecondaryLocationWatch();
        } else {
            setSecondaryNotifyEnabled(sec, false);
            if (subEl) subEl.textContent = "Get an alert if this location's power status changes";
            clearInterval(secondaryWatchTimer);
        }
    });
}

// Kick the watcher off on page load too (not just while the panel is
// open) so a status flip is caught even if the user never reopens the
// panel this session.
window.addEventListener('lw-page-revealed', startSecondaryLocationWatch, { once: true });

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
            // Feeds the admin "most searched areas" analytics — see analytics.js
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