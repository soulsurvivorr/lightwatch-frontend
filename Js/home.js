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
    } catch (err) {
        setSecondaryStatusDot('unknown');
        if (labelEl) labelEl.textContent = 'Could not load status';
        if (subEl) subEl.textContent = 'Check your connection and try again.';
    }

    // Re-measure the panel body now that real content has landed, so the
    // "unfolding" expand animation ends at the right height instead of
    // whatever the loading placeholder measured at.
    const body = document.getElementById('secondaryLocationPanelBody');
    const overlay = document.getElementById('secondaryLocationOverlay');
    if (body && overlay?.classList.contains('location-expand-overlay--open')) {
        body.style.maxHeight = body.scrollHeight + 'px';
    }
}

function openSecondaryLocationPanel() {
    const overlay = document.getElementById('secondaryLocationOverlay');
    const body = document.getElementById('secondaryLocationPanelBody');
    const panel = document.getElementById('secondaryLocationPanel');
    if (!overlay || !body || !panel) return;

    overlay.classList.add('location-expand-overlay--open');
    overlay.setAttribute('aria-hidden', 'false');

    // Expand the body to its real content height — the "opens up" motion
    // that replaces the old side-drawer slide.
    requestAnimationFrame(() => {
        body.style.maxHeight = body.scrollHeight + 'px';
    });

    const sec = getCachedUserForSecondaryLocation().secondaryLocation;
    if (sec?.city) loadSecondaryLocationStatus(sec);
}

function closeSecondaryLocationPanel() {
    const overlay = document.getElementById('secondaryLocationOverlay');
    const body = document.getElementById('secondaryLocationPanelBody');
    if (!overlay || !body) return;

    body.style.maxHeight = '0px';
    overlay.classList.remove('location-expand-overlay--open');
    overlay.setAttribute('aria-hidden', 'true');
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