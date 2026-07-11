// ============================================================
//  ACCOUNT.JS — Account page logic
//  Load this on account.html only, after auth.js / notification.js /
//  profile.js / nav.js. Handles everything specific to this page:
//  extra profile fields, locations, city-lock UI, notification
//  preference toggles, display preferences, and the compact-chat
//  preview popup.
//
//  Why a separate file: this logic doesn't belong on any other page,
//  so keeping it out of profile.js/auth.js keeps those files reusable
//  across the whole app, while everything account-only lives here in
//  one place.
// ============================================================

requireAuth(); // redirects to login if no session — defined in auth.js

const el = (id) => document.getElementById(id);

// ------------------------------------------------------------
// DISPLAY PREFERENCES
// A small shared store other pages can read from later — call
// window.LWDisplayPrefs.get() for the current values, or listen
// for the 'lw-display-prefs-changed' event to react live.
// ------------------------------------------------------------
const DISPLAY_PREF_KEYS = {
    compactChat:   'lw_pref_compact_chat',
    reduceMotion:  'lw_pref_reduce_motion',
    largeChatText: 'lw_pref_large_chat_text',
    density:       'lw_pref_density',   // 'comfortable' | 'compact'
    accent:        'lw_pref_accent'     // 'teal' | 'amber' | 'violet'
};

function readDisplayPrefs() {
    return {
        compactChat:   localStorage.getItem(DISPLAY_PREF_KEYS.compactChat) === '1',
        reduceMotion:  localStorage.getItem(DISPLAY_PREF_KEYS.reduceMotion) === '1',
        largeChatText: localStorage.getItem(DISPLAY_PREF_KEYS.largeChatText) === '1',
        density:       localStorage.getItem(DISPLAY_PREF_KEYS.density) || 'comfortable',
        accent:        localStorage.getItem(DISPLAY_PREF_KEYS.accent) || 'teal'
    };
}

function applyDisplayPrefsToDocument(prefs) {
    const root = document.documentElement;
    root.setAttribute('data-compact-chat', prefs.compactChat ? '1' : '0');
    root.setAttribute('data-reduce-motion', prefs.reduceMotion ? '1' : '0');
    root.setAttribute('data-large-chat-text', prefs.largeChatText ? '1' : '0');
    root.setAttribute('data-density', prefs.density);
    root.setAttribute('data-accent', prefs.accent);
}

function setDisplayPref(key, value) {
    localStorage.setItem(DISPLAY_PREF_KEYS[key], typeof value === 'boolean' ? (value ? '1' : '0') : value);
    const prefs = readDisplayPrefs();
    applyDisplayPrefsToDocument(prefs);
    window.dispatchEvent(new CustomEvent('lw-display-prefs-changed', { detail: prefs }));
    return prefs;
}

window.LWDisplayPrefs = {
    get: readDisplayPrefs,
    set: setDisplayPref
};

function initDisplayPrefsUI() {
    const prefs = readDisplayPrefs();
    applyDisplayPrefsToDocument(prefs);

    const compactToggle = el('prefCompactChat');
    const reduceMotionToggle = el('prefReduceMotion');
    const largeTextToggle = el('prefLargeChatText');
    const densitySelect = el('prefDensity');
    const swatches = document.querySelectorAll('#accentSwatchRow .swatch');

    if (compactToggle) compactToggle.checked = prefs.compactChat;
    if (reduceMotionToggle) reduceMotionToggle.checked = prefs.reduceMotion;
    if (largeTextToggle) largeTextToggle.checked = prefs.largeChatText;
    if (densitySelect) densitySelect.value = prefs.density;
    swatches.forEach(btn => btn.setAttribute('aria-pressed', btn.dataset.accent === prefs.accent ? 'true' : 'false'));

    compactToggle?.addEventListener('change', () => {
        setDisplayPref('compactChat', compactToggle.checked);
        openChatPreviewPopup(compactToggle.checked);
    });

    reduceMotionToggle?.addEventListener('change', () => {
        setDisplayPref('reduceMotion', reduceMotionToggle.checked);
    });

    largeTextToggle?.addEventListener('change', () => {
        setDisplayPref('largeChatText', largeTextToggle.checked);
    });

    densitySelect?.addEventListener('change', () => {
        setDisplayPref('density', densitySelect.value);
    });

    swatches.forEach(btn => {
        btn.addEventListener('click', () => {
            setDisplayPref('accent', btn.dataset.accent);
            swatches.forEach(b => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
        });
    });
}

// ------------------------------------------------------------
// COMPACT CHAT PREVIEW POPUP
// Shell UI for now — placeholder bubbles, no live data yet.
// Wired up so chat.js can later drop real thread rendering in
// here (the toggle, overlay, and compact/normal sizing all
// already work end to end).
// ------------------------------------------------------------
const DUMMY_PREVIEW_MESSAGES = [
    { mine: false, text: "Light just came back on near the market." },
    { mine: true,  text: "Thanks for the update!" },
    { mine: false, text: "Still off on my street though." }
];

function openChatPreviewPopup(compact) {
    const overlay = el('chatPopupOverlay');
    const popup = el('chatPopup');
    const body = el('chatPopupBody');
    if (!overlay || !popup || !body) return;

    popup.classList.toggle('chat-popup--compact', Boolean(compact));
    body.innerHTML = DUMMY_PREVIEW_MESSAGES.map(m =>
        `<div class="chat-bubble${m.mine ? ' chat-bubble--mine' : ''}">${m.text}</div>`
    ).join('');

    overlay.classList.add('chat-popup-overlay--open');
    overlay.setAttribute('aria-hidden', 'false');
}

function closeChatPreviewPopup() {
    const overlay = el('chatPopupOverlay');
    if (!overlay) return;
    overlay.classList.remove('chat-popup-overlay--open');
    overlay.setAttribute('aria-hidden', 'true');
}

function initChatPreviewPopup() {
    el('chatPopupCloseBtn')?.addEventListener('click', closeChatPreviewPopup);
    el('chatPopupOverlay')?.addEventListener('click', (e) => {
        if (e.target === el('chatPopupOverlay')) closeChatPreviewPopup();
    });
}

// ------------------------------------------------------------
// NOTIFICATION PREFERENCE TOGGLES (mute everyone chat / mentions)
// ------------------------------------------------------------
function initNotificationPrefToggles() {
    const muteGlobalToggle = el('prefMuteGlobalChat');
    const chatMentionsToggle = el('prefChatMentions');

    // Seed from localStorage immediately (fast paint), then reconcile
    // with the server's saved state once the push subscription is ready.
    if (muteGlobalToggle) muteGlobalToggle.checked = localStorage.getItem('lw_mute_global_chat') === '1';
    if (chatMentionsToggle) chatMentionsToggle.checked = localStorage.getItem('lw_chat_mentions') !== '0'; // default ON

    (async () => {
        if (typeof window.getChatPushPreferences !== 'function') return;
        const prefs = await window.getChatPushPreferences();
        if (!prefs) return;
        if (muteGlobalToggle) {
            muteGlobalToggle.checked = Boolean(prefs.muteGlobalChat);
            localStorage.setItem('lw_mute_global_chat', muteGlobalToggle.checked ? '1' : '0');
        }
        if (chatMentionsToggle) {
            chatMentionsToggle.checked = prefs.chatMentionsEnabled !== false;
            localStorage.setItem('lw_chat_mentions', chatMentionsToggle.checked ? '1' : '0');
        }
    })();

    muteGlobalToggle?.addEventListener('change', async () => {
        if (typeof window.setGlobalChatMutePreference !== 'function') {
            window.lwToast?.('Notification service is not ready yet.');
            muteGlobalToggle.checked = !muteGlobalToggle.checked;
            return;
        }
        const result = await window.setGlobalChatMutePreference(muteGlobalToggle.checked);
        if (!result.success) {
            muteGlobalToggle.checked = !muteGlobalToggle.checked;
            window.lwToast?.(result.error || 'Could not save mute setting.');
            return;
        }
        localStorage.setItem('lw_mute_global_chat', muteGlobalToggle.checked ? '1' : '0');
        window.lwToast?.(muteGlobalToggle.checked
            ? 'Everyone chat alerts are muted. Replies and @mentions will still notify you if Community chat mentions is on.'
            : 'Everyone chat alerts are active.');
    });

    chatMentionsToggle?.addEventListener('change', async () => {
        if (typeof window.setChatMentionsPreference !== 'function') {
            window.lwToast?.('Notification service is not ready yet.');
            chatMentionsToggle.checked = !chatMentionsToggle.checked;
            return;
        }
        const result = await window.setChatMentionsPreference(chatMentionsToggle.checked);
        if (!result.success) {
            chatMentionsToggle.checked = !chatMentionsToggle.checked;
            window.lwToast?.(result.error || 'Could not save mentions setting.');
            return;
        }
        localStorage.setItem('lw_chat_mentions', chatMentionsToggle.checked ? '1' : '0');
        window.lwToast?.(chatMentionsToggle.checked
            ? 'You will be notified when someone replies to you or @mentions you, even with Everyone chat muted.'
            : 'Replies and @mentions will no longer send notifications.');
    });
}

// ------------------------------------------------------------
// CITY / TOWN EDIT — one-time only, with a real locked state
// once it's been used (no more disabled-looking form).
// ------------------------------------------------------------
function showCityLockedView(city, region, animate = true) {
    // The one-time edit has been used — there's nothing left for the user
    // to do here, so the whole card collapses out of the page rather than
    // sticking around in a disabled/locked state.
    const card = el('cityEditCard');
    if (!card) return;

    if (!animate) {
        card.hidden = true;
        return;
    }

    requestAnimationFrame(() => card.classList.add('card--collapsed'));
    setTimeout(() => { card.hidden = true; }, 320);
}

function initCityEditForm(user) {
    if (user?.cityChangeLocked) {
        showCityLockedView(user.city, user.region, false);
        return;
    }

    const input = el('cityEditInput');
    const toggleBtn = el('cityEditToggleBtn');
    if (input) input.value = user?.city || '';

    toggleBtn?.addEventListener('click', () => {
        if (!input || input.disabled === false) return;
        input.disabled = false;
        input.focus();
        input.select();
        const saveBtn = el('cityEditSaveBtn');
        if (saveBtn) saveBtn.disabled = false;
        toggleBtn.textContent = 'Editing…';
        toggleBtn.disabled = true;
    });

    el('cityEditForm')?.addEventListener('submit', async () => {
        const messageEl = el('cityEditMessage');
        const saveBtn = el('cityEditSaveBtn');
        const city = String(input?.value || '').trim();
        const userId = localStorage.getItem('currentUserId');
        if (!userId || !city) {
            if (messageEl) messageEl.textContent = 'Please enter a city/town first.';
            return;
        }

        saveBtn.disabled = true;
        if (messageEl) messageEl.textContent = 'Saving...';

        try {
            const res = await fetch(`${API_URL}/user/${userId}/city`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ city })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (messageEl) messageEl.textContent = data.error || 'Could not save city/town.';
                saveBtn.disabled = false;
                return;
            }

            const finalCity = data.user?.city || city;
            const finalRegion = data.user?.region || el('profileRegion')?.textContent;

            if (el('profileCity')) el('profileCity').textContent = finalCity;
            if (el('profileRegion')) el('profileRegion').textContent = finalRegion;

            const cachedUser = JSON.parse(localStorage.getItem('currentUserData') || '{}');
            cachedUser.city = finalCity;
            if (finalRegion) cachedUser.region = finalRegion;
            localStorage.setItem('currentUserData', JSON.stringify(cachedUser));

            window.lwToast?.('City/town updated successfully.');
            showCityLockedView(finalCity, finalRegion);
        } catch (err) {
            if (messageEl) messageEl.textContent = 'Could not save city/town right now.';
            saveBtn.disabled = false;
        }
    });
}

// ------------------------------------------------------------
// MY LOCATIONS — primary (read-only) + one optional secondary
// location the user can add, edit, or remove (e.g. "Work").
// ------------------------------------------------------------
function renderLocationsList(user) {
    const listEl = el('myLocationsList');
    if (!listEl) return;

    const rows = [];
    const primary = user.city ? `${user.city}, ${user.region || ''}`.replace(/,\s*$/, '') : user.region || null;
    if (primary) {
        rows.push(`
            <div class="location-row">
                <span class="location-row__dot"></span>
                <div class="location-row__body">
                    <div class="location-row__name">${primary}</div>
                    <div class="location-row__badge">Primary</div>
                </div>
            </div>`);
    }

    const sec = user.secondaryLocation;
    if (sec?.city) {
        const secLabel = [sec.city, sec.region].filter(Boolean).join(', ');
        rows.push(`
            <div class="location-row">
                <span class="location-row__dot location-row__dot--secondary"></span>
                <div class="location-row__body">
                    <div class="location-row__name">${secLabel}</div>
                    <div class="location-row__badge">${sec.label || 'Second location'}</div>
                </div>
                <div class="location-row__actions">
                    <button type="button" id="secondaryLocationEditBtn">Edit</button>
                    <button type="button" id="secondaryLocationRemoveBtn">Remove</button>
                </div>
            </div>`);
    }

    listEl.innerHTML = rows.length
        ? rows.join('')
        : `<div style="color:var(--text-faint);font-size:0.85rem;padding:8px 0;">No locations set yet.</div>`;

    wireSecondaryLocationActions(sec);
}

function setSecondaryFormVisible(visible, sec) {
    const addBtn = el('secondaryLocationAddBtn');
    const form = el('secondaryLocationForm');
    if (!addBtn || !form) return;
    addBtn.hidden = visible;
    form.hidden = !visible;
    if (visible) {
        el('secondaryLocationLabel').value = sec?.label && sec.label !== 'Second location' ? sec.label : (sec ? sec.label || '' : '');
        el('secondaryLocationCity').value = sec?.city || '';
        el('secondaryLocationRegion').value = sec?.region || '';
        el('secondaryLocationMessage').textContent = '';
    }
}

function wireSecondaryLocationActions(sec) {
    const addBtn = el('secondaryLocationAddBtn');
    const cancelBtn = el('secondaryLocationCancelBtn');
    const editBtn = el('secondaryLocationEditBtn');
    const removeBtn = el('secondaryLocationRemoveBtn');

    // Show the "+ Add" button only when there's no secondary location yet.
    if (addBtn) addBtn.hidden = Boolean(sec?.city);

    addBtn?.addEventListener('click', () => setSecondaryFormVisible(true, null), { once: true });
    cancelBtn?.addEventListener('click', () => setSecondaryFormVisible(false));
    editBtn?.addEventListener('click', () => setSecondaryFormVisible(true, sec));

    removeBtn?.addEventListener('click', async () => {
        const userId = localStorage.getItem('currentUserId');
        if (!userId) return;
        removeBtn.disabled = true;
        try {
            const res = await fetch(`${API_URL}/user/${userId}/secondary-location`, { method: 'DELETE' });
            if (!res.ok) throw new Error('failed');
            const cachedUser = JSON.parse(localStorage.getItem('currentUserData') || '{}');
            cachedUser.secondaryLocation = null;
            localStorage.setItem('currentUserData', JSON.stringify(cachedUser));
            window.lwToast?.('Location removed.');
            renderLocationsList({ ...cachedUser });
        } catch {
            window.lwToast?.('Could not remove that location right now.');
            removeBtn.disabled = false;
        }
    });
}

function initSecondaryLocationForm() {
    el('secondaryLocationForm')?.addEventListener('submit', async () => {
        const userId = localStorage.getItem('currentUserId');
        const label = String(el('secondaryLocationLabel')?.value || '').trim();
        const city = String(el('secondaryLocationCity')?.value || '').trim();
        const region = String(el('secondaryLocationRegion')?.value || '').trim();
        const messageEl = el('secondaryLocationMessage');
        const saveBtn = el('secondaryLocationSaveBtn');

        if (!city || !region) {
            if (messageEl) messageEl.textContent = 'City and region are both required.';
            return;
        }
        if (!userId) return;

        saveBtn.disabled = true;
        if (messageEl) messageEl.textContent = 'Saving...';

        try {
            const res = await fetch(`${API_URL}/user/${userId}/secondary-location`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label, city, region })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (messageEl) messageEl.textContent = data.error || 'Could not save that location.';
                saveBtn.disabled = false;
                return;
            }

            const cachedUser = JSON.parse(localStorage.getItem('currentUserData') || '{}');
            cachedUser.secondaryLocation = data.secondaryLocation;
            localStorage.setItem('currentUserData', JSON.stringify(cachedUser));

            window.lwToast?.('Location saved.');
            setSecondaryFormVisible(false);
            renderLocationsList({ ...cachedUser });
        } catch {
            if (messageEl) messageEl.textContent = 'Could not reach the server — try again.';
        } finally {
            saveBtn.disabled = false;
        }
    });
}

// ------------------------------------------------------------
// MAIN LOAD
// Fetches the extra fields this page needs beyond what profile.js
// already renders, and fills the locations / city-lock / chat-
// activity sections. Each section shows its own lightweight
// "Loading…" placeholder and fills in independently — none of
// this blocks or extends the full-page skeleton, which is
// controlled solely by profile.js now (core profile + light
// status data only). That's what used to make the page feel slow:
// the whole skeleton used to wait on these secondary fetches too.
// ------------------------------------------------------------
async function loadAccountExtras() {
    const userId = localStorage.getItem('currentUserId');
    if (!userId) return;

    try {
        const res = await fetch(`${API_URL}/user/${userId}`);
        if (!res.ok) return;
        const user = await res.json();

        if (el('profileCity')) el('profileCity').textContent = user.city || '—';
        if (el('profileRegion')) el('profileRegion').textContent = user.region || '—';

        // The badge used to say "Active contributor" for everyone, whether
        // or not they'd ever done anything — swap it for something true:
        // the area LightWatch is actually watching for them.
        const badgeTextEl = el('profileBadgeText');
        if (badgeTextEl) {
            badgeTextEl.textContent = user.city ? `Monitoring ${user.city}` : 'Community member';
        }

        const chatHandleValue = user.chatHandle || localStorage.getItem('chatHandle') || '—';
        if (el('profileChatHandle')) el('profileChatHandle').textContent = chatHandleValue;
        if (el('profileHandle')) el('profileHandle').textContent = user.chatHandle || localStorage.getItem('chatHandle') || '';

        if (user.createdAt && el('profileLastLogin')) {
            el('profileLastLogin').textContent = new Date(user.createdAt).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
        }

        const hour = new Date().getHours();
        const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
        const firstName = (user.name || '').trim().split(/\s+/)[0] || 'there';
        if (el('pageGreeting')) el('pageGreeting').textContent = `${greeting}, ${firstName}`;

        renderLocationsList(user);
        initCityEditForm(user);

        // Cache the fuller object so the locations UI still has it after
        // an edit without needing another round trip.
        const cachedUser = JSON.parse(localStorage.getItem('currentUserData') || '{}');
        localStorage.setItem('currentUserData', JSON.stringify({ ...cachedUser, ...user }));
    } catch (e) { /* silent — page still works from profile.js's cached data */ }

    // Recent chat messages load independently and don't hold up anything else.
    try {
        const userObj = JSON.parse(localStorage.getItem('currentUserData') || '{}');
        const loc = userObj.city ? `${userObj.city}, ${userObj.region}` : userObj.region || userObj.location;
        if (loc) {
            const res = await fetch(`${API_URL}/chats?location=${encodeURIComponent(loc)}`);
            if (res.ok) {
                const chats = await res.json();
                const mineAll = chats.filter(c => (c.userId?._id || c.userId) === userId);
                const mine = mineAll.slice(0, 5);
                const listEl = el('recentChatList');
                if (listEl) {
                    listEl.innerHTML = mine.length === 0
                        ? `<div style="color:var(--text-faint);font-size:0.85rem;padding:8px 0;">No chat messages yet.</div>`
                        : mine.map(c => `
                            <div style="padding:10px 0;border-bottom:1px solid var(--border-soft);">
                                <div style="font-size:0.84rem;color:var(--text-bright);">"${c.text}"</div>
                                <div style="font-size:0.74rem;color:var(--text-faint);margin-top:3px;">${c.location} · ${new Date(c.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</div>
                            </div>`).join('') + (mineAll.length > 5 ? `<div style="font-size:0.78rem;color:var(--text-faint);padding-top:8px;">Showing 5 most recent</div>` : '');
                }
            }
        }
    } catch (e) { /* silent */ }

    // Whatever happened above (success or failure), the extras are done
    // loading now — release the flag profile.js's hideProfileLoader() was
    // respecting, and reveal the real content if the skeleton is still up.
    if (document.body) delete document.body.dataset.accountExtrasLoading;
    document.body?.classList.remove('page-data-loading');
}

// ------------------------------------------------------------
// INIT
// ------------------------------------------------------------
initDisplayPrefsUI();
initChatPreviewPopup();
initNotificationPrefToggles();
initSecondaryLocationForm();
loadAccountExtras();