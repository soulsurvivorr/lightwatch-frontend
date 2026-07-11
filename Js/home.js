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
    document.getElementById('secondaryLocationPanelLabel').textContent = label;
    document.getElementById('secondaryLocationPanelCity').textContent = sec.city || '—';
    document.getElementById('secondaryLocationPanelRegion').textContent = sec.region || '—';
}

function openSecondaryLocationPanel() {
    document.getElementById('secondaryLocationPanel')?.classList.add('user-sidebar-panel--open');
    document.getElementById('secondaryLocationOverlay')?.classList.add('sidebar-overlay--visible');
    document.getElementById('secondaryLocationPanel')?.setAttribute('aria-hidden', 'false');
}

function closeSecondaryLocationPanel() {
    document.getElementById('secondaryLocationPanel')?.classList.remove('user-sidebar-panel--open');
    document.getElementById('secondaryLocationOverlay')?.classList.remove('sidebar-overlay--visible');
    document.getElementById('secondaryLocationPanel')?.setAttribute('aria-hidden', 'true');
}

document.getElementById('secondaryLocationChip')?.addEventListener('click', openSecondaryLocationPanel);
document.getElementById('secondaryLocationClose')?.addEventListener('click', closeSecondaryLocationPanel);
document.getElementById('secondaryLocationOverlay')?.addEventListener('click', closeSecondaryLocationPanel);

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