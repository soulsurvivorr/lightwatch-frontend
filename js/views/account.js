// ============================================================
//  VIEWS/ACCOUNT.JS
//  Already organized as a set of initX() helpers in the original
//  app — the only SPA-specific change is that the final call
//  sequence is now wrapped in mount(), called once by the router on
//  first visit instead of running at script-parse time.
// ============================================================

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
// UNIQUE USER AVATAR — deterministic colored SVG per user
// ------------------------------------------------------------
// FIX: profile/sidebar avatars used to just show a bare "?" — nothing
// ever generated a real per-user graphic. This builds a small colored
// "star burst" glyph purely from a seed string (the user's id, or
// their chat handle as a fallback), so the same user always gets the
// same avatar, but different users land on visibly different shapes
// and colors instead of everyone sharing one generic look.
// Exposed as window.LWAvatar so other views (e.g. the nav bar, chat
// message authors) can reuse it without duplicating this logic.
(function () {
    // Hue families spread around the wheel so colors read as distinct
    // from each other rather than clustering in one range.
    const HUES = [18, 32, 46, 88, 112, 156, 192, 208, 224, 242, 268, 296];
    const SHAPES = ['spark', 'diamond', 'burst', 'shield'];

    function seedHash(seed) {
        let hash = 0;
        const str = String(seed || 'anon');
        for (let i = 0; i < str.length; i++) {
            hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
        }
        return hash;
    }

    // Simple seeded PRNG (mulberry32) so a single hash can drive several
    // independent "random" choices (shape, point count, rotation,
    // second color) while staying fully deterministic per seed.
    function makeRng(seed) {
        let a = seedHash(seed) || 1;
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function starPoints(cx, cy, points, outerR, innerR, rotation) {
        const step = Math.PI / points;
        let d = '';
        for (let i = 0; i < points * 2; i++) {
            const r = i % 2 === 0 ? outerR : innerR;
            const angle = i * step - Math.PI / 2 + rotation;
            const x = cx + r * Math.cos(angle);
            const y = cy + r * Math.sin(angle);
            d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
        }
        return d + 'Z';
    }

    // Builds the actual <svg> markup for a given seed.
    function avatarSvg(seed) {
        const rng = makeRng(seed);
        const hue1 = HUES[Math.floor(rng() * HUES.length)];
        const hue2 = (hue1 + 40 + Math.floor(rng() * 60)) % 360;
        const shape = SHAPES[Math.floor(rng() * SHAPES.length)];
        const points = 4 + Math.floor(rng() * 4); // 4–7 points
        const rotation = rng() * Math.PI * 2;
        const gradId = 'lwav' + seedHash(seed).toString(36);

        const bgGradient = `<linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hue1},62%,30%)"/>
      <stop offset="100%" stop-color="hsl(${hue2},62%,20%)"/>
    </linearGradient>`;

        let glyph;
        if (shape === 'diamond') {
            glyph = `<rect x="18" y="18" width="28" height="28" rx="6" transform="rotate(${(rotation * 180 / Math.PI).toFixed(0)} 32 32)" fill="hsl(${hue1},85%,68%)"/>`;
        } else if (shape === 'shield') {
            glyph = `<path d="M32 12 47 17.5V29c0 9.4-6.2 17-15 20-8.8-3-15-10.6-15-20V17.5L32 12Z" fill="hsl(${hue1},86%,68%)"/>`;
            glyph += `<path d="M32 20v19" stroke="hsl(${hue2},82%,86%)" stroke-width="2.2" stroke-linecap="round" opacity="0.85"/>`;
        } else if (shape === 'burst') {
            glyph = `<path d="${starPoints(32, 32, points, 22, 8, rotation)}" fill="hsl(${hue1},90%,70%)"/>
      <circle cx="32" cy="32" r="6" fill="hsl(${hue2},90%,82%)"/>`;
        } else {
            // 'star' / 'spark' — same construction, spark just gets one
            // extra thin inner ring for a bit more sparkle.
            glyph = `<path d="${starPoints(32, 32, points, 21, shape === 'spark' ? 6 : 9, rotation)}" fill="hsl(${hue1},88%,70%)"/>`;
            if (shape === 'spark') {
                glyph += `<path d="${starPoints(32, 32, points + 1, 12, 4, rotation + 0.4)}" fill="hsl(${hue2},90%,84%)" opacity="0.85"/>`;
            }
        }

        return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="User avatar">
      <defs>${bgGradient}</defs>
      <circle cx="32" cy="32" r="32" fill="url(#${gradId})"/>
      ${glyph}
    </svg>`;
    }

    // Renders into any element (clears its content, e.g. the "?"
    // placeholder text) for the given seed.
    function renderInto(el, seed) {
        if (!el) return;
        el.innerHTML = avatarSvg(seed);
        el.classList.add('avatar--generated');
    }

    window.LWAvatar = { svg: avatarSvg, renderInto };
})();


// ------------------------------------------------------------
// SESSION-AWARE STORAGE READS
// saveSession() (services/auth.js) puts currentUserId/currentUserData in
// localStorage when "Remember me" was checked, but in sessionStorage
// otherwise. This file used to read localStorage only, so anyone signed
// in without "Remember me" saw every field below stay on its default
// "—" placeholder — the fetch never ran because userId came back empty.
// getSession() already knows which storage is in play; fall back to
// checking both directly in case getSession() isn't loaded yet.
// ------------------------------------------------------------
function getCurrentUserId() {
    const session = typeof getSession === 'function' ? getSession() : null;
    return session?.user?.id
        || localStorage.getItem('currentUserId')
        || sessionStorage.getItem('currentUserId')
        || null;
}

function getCurrentUserData() {
    try {
        const raw = localStorage.getItem('currentUserData') || sessionStorage.getItem('currentUserData');
        return JSON.parse(raw || '{}');
    } catch {
        return {};
    }
}

function applyAvatarToTargets(user) {
    const avatarSeed = user._id || user.id || user.chatHandle || localStorage.getItem('chatHandle');
    const avatarImage = user.avatarImage || null;
    // "profileAvatar" exists in TWO places in the document (Home's compact
    // card + Account's bigger hero avatar) — el()/getElementById only ever
    // returns the first one (Home's), so the visible avatar on the account
    // page itself never got updated here. Use querySelectorAll so every
    // match gets painted, same fix profile.js already applies elsewhere.
    const targets = [
        ...document.querySelectorAll('#profileAvatar'),
        el('sidebarAvatar'),
        el('navAccountAvatar')
    ].filter(Boolean);

    targets.forEach((target) => {
        if (avatarImage && /^(?:data:image\/|https?:\/\/)/i.test(avatarImage)) {
            target.innerHTML = '';
            const img = document.createElement('img');
            img.src = avatarImage;
            img.alt = '';
            img.loading = 'lazy';
            target.appendChild(img);
            target.classList.add('avatar--generated');
            return;
        }
        if (window.LWAvatar && avatarSeed) {
            window.LWAvatar.renderInto(target, avatarSeed);
        }
    });
}

function hydrateIdentityForm(user) {
    const handleInput = el('chatHandleEditInput');
    if (handleInput) {
        handleInput.value = String(user.chatHandle || '').replace(/^@+/, '');
    }
    const messageEl = el('chatHandleEditMessage');
    if (messageEl) messageEl.textContent = '';
}

function isValidHandleFormat(value) {
    return /^[a-z0-9](?:[a-z0-9_-]{1,22}[a-z0-9])$/.test(value);
}

// Shared PATCH /user/:id/profile call, used by BOTH the avatar picker
// (which now saves itself immediately — see avatarInput 'change' below)
// and the chat-handle form. Merges the confirmed server response into
// currentUserData (both storages, so it works whether or not "Remember
// me" is on) and repaints every avatar target. Returns { ok, data }.
async function saveProfileFields(body) {
    const userId = getCurrentUserId();
    if (!userId) return { ok: false, error: 'Not signed in.' };

    try {
        const res = await fetch(`${API_URL}/user/${userId}/profile`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            return { ok: false, error: data.error || 'Could not save right now.' };
        }

        const cached = getCurrentUserData();
        const merged = {
            ...cached,
            chatHandle: Object.prototype.hasOwnProperty.call(body, 'chatHandle')
                ? (data.user?.chatHandle || cached.chatHandle)
                : cached.chatHandle,
            avatarImage: Object.prototype.hasOwnProperty.call(data.user || {}, 'avatarImage')
                ? data.user.avatarImage
                : cached.avatarImage
        };
        localStorage.setItem('currentUserData', JSON.stringify(merged));
        sessionStorage.setItem('currentUserData', JSON.stringify(merged));
        if (merged.chatHandle) {
            localStorage.setItem('chatHandle', merged.chatHandle);
            sessionStorage.setItem('chatHandle', merged.chatHandle);
        }

        return { ok: true, merged };
    } catch {
        return { ok: false, error: 'Could not reach server. Try again.' };
    }
}

function initProfileIdentityForm() {
    const form = el('chatHandleEditForm');
    const avatarInput = el('profileAvatarInput');
    const cancelBtn = el('chatHandleEditCancelBtn');
    const editBtn = el('profileAvatarEditBtn');

    if (avatarInput) {
        avatarInput.removeAttribute('capture');
        avatarInput.setAttribute('accept', 'image/*');
    }

    editBtn?.addEventListener('click', () => avatarInput?.click());
    cancelBtn?.addEventListener('click', () => {
        const toggleBtn = el('chatHandleRowToggle');
        const panel = el('chatHandleExpand');
        if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
        if (panel) panel.hidden = true;
        hydrateIdentityForm(getCurrentUserData());
    });

    // FIX: picking a photo used to only paint it into the DOM and stash it
    // in pendingAvatarImageDataUrl, waiting for the person to separately
    // submit the chat-handle form's "Save changes" button before anything
    // reached the server. If they never did that (easy to miss — that
    // button lives inside the handle-edit panel, not next to the avatar),
    // the picture looked saved on Account but was never persisted: it
    // reverted on refresh and never appeared on posts in Community
    // Reports (POST /chats reads the user's avatarImage straight from the
    // DB when a post is made). The avatar picker now saves itself the
    // moment a valid image is picked, independent of the handle form.
    avatarInput?.addEventListener('change', async () => {
        const messageEl = el('chatHandleEditMessage');
        const [file] = avatarInput.files || [];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            if (messageEl) messageEl.textContent = 'Choose an image file (gallery or camera).';
            avatarInput.value = '';
            return;
        }
        // Capped below the old 4MB: this is the RAW file size, but the
        // server validates the base64-ENCODED data URL length, which runs
        // ~4/3 larger than the raw bytes. 3MB raw keeps the encoded string
        // safely under the server's cap (see sanitizeAvatarImageDataUrl in
        // server.js) so a photo that passes here never gets silently
        // rejected server-side.
        if (file.size > 3_000_000) {
            if (messageEl) messageEl.textContent = 'Image is too large. Use one under 3MB.';
            avatarInput.value = '';
            return;
        }

        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = reject;
            reader.readAsDataURL(file);
        }).catch(() => null);

        if (!dataUrl || !/^data:image\//i.test(String(dataUrl))) {
            if (messageEl) messageEl.textContent = 'Could not read image. Try another one.';
            avatarInput.value = '';
            return;
        }

        // Optimistic paint so the picker feels instant...
        const cached = getCurrentUserData();
        applyAvatarToTargets({ ...cached, avatarImage: dataUrl });
        if (messageEl) messageEl.textContent = 'Saving profile picture...';
        editBtn?.setAttribute('aria-busy', 'true');

        // ...then save it for real, right away.
        const { ok, merged, error } = await saveProfileFields({ avatarImage: dataUrl });

        editBtn?.removeAttribute('aria-busy');
        avatarInput.value = '';

        if (!ok) {
            // Roll the optimistic preview back — this device must never
            // show an avatar that isn't actually what's saved.
            applyAvatarToTargets(getCurrentUserData());
            if (messageEl) messageEl.textContent = error || 'Could not save profile picture.';
            return;
        }

        applyAvatarToTargets(merged);
        paintAccountExtras(merged);
        window.dispatchEvent(new CustomEvent('lw-session-changed'));
        window.lwToast?.('Profile picture updated.');
        if (messageEl) messageEl.textContent = 'Profile picture updated.';
    });

    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const handleInput = el('chatHandleEditInput');
        const messageEl = el('chatHandleEditMessage');
        const saveBtn = el('chatHandleEditSaveBtn');
        if (!handleInput) return;

        const nextHandle = String(handleInput.value || '').trim().toLowerCase().replace(/^@+/, '');
        const hasValidHandle = isValidHandleFormat(nextHandle);
        if (!hasValidHandle) {
            if (messageEl) messageEl.textContent = 'Use 3-24 chars: letters, numbers, - or _ (no symbols/spaces).';
            return;
        }

        saveBtn.disabled = true;
        if (messageEl) messageEl.textContent = 'Saving changes...';

        const { ok, merged, error } = await saveProfileFields({ chatHandle: nextHandle });

        if (!ok) {
            if (messageEl) messageEl.textContent = error || 'Could not save identity right now.';
            saveBtn.disabled = false;
            return;
        }

        hydrateIdentityForm(merged);
        paintAccountExtras(merged);
        window.dispatchEvent(new CustomEvent('lw-session-changed'));
        window.lwToast?.('Profile changed.');
        if (messageEl) messageEl.textContent = 'Profile changed.';
        saveBtn.disabled = false;
    });
}

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
    accent:        'lw_pref_accent',    // 'teal' | 'amber' | 'violet'
    theme:         'lw_theme_pref'      // 'device' | 'light' | 'dark'
};

function readDisplayPrefs() {
    return {
        compactChat:   localStorage.getItem(DISPLAY_PREF_KEYS.compactChat) === '1',
        reduceMotion:  localStorage.getItem(DISPLAY_PREF_KEYS.reduceMotion) === '1',
        largeChatText: localStorage.getItem(DISPLAY_PREF_KEYS.largeChatText) === '1',
        density:       localStorage.getItem(DISPLAY_PREF_KEYS.density) || 'comfortable',
        accent:        localStorage.getItem(DISPLAY_PREF_KEYS.accent) || 'teal',
        theme:         localStorage.getItem(DISPLAY_PREF_KEYS.theme) || 'device'
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
    const themeSelect = el('prefTheme');
    const swatches = document.querySelectorAll('#accentSwatchRow .swatch');

    if (compactToggle) compactToggle.checked = prefs.compactChat;
    if (reduceMotionToggle) reduceMotionToggle.checked = prefs.reduceMotion;
    if (largeTextToggle) largeTextToggle.checked = prefs.largeChatText;
    if (densitySelect) densitySelect.value = prefs.density;
    if (themeSelect) themeSelect.value = prefs.theme;
    swatches.forEach(btn => btn.setAttribute('aria-pressed', btn.dataset.accent === prefs.accent ? 'true' : 'false'));

    compactToggle?.addEventListener('change', () => {
        setDisplayPref('compactChat', compactToggle.checked);
        openChatPreviewPopup();
    });

    reduceMotionToggle?.addEventListener('change', () => {
        setDisplayPref('reduceMotion', reduceMotionToggle.checked);
    });

    largeTextToggle?.addEventListener('change', () => {
        setDisplayPref('largeChatText', largeTextToggle.checked);
        openChatPreviewPopup();
    });

    densitySelect?.addEventListener('change', () => {
        setDisplayPref('density', densitySelect.value);
    });

    themeSelect?.addEventListener('change', () => {
        setDisplayPref('theme', themeSelect.value);
    });

    swatches.forEach(btn => {
        btn.addEventListener('click', () => {
            setDisplayPref('accent', btn.dataset.accent);
            swatches.forEach(b => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
        });
    });
}

// ------------------------------------------------------------
// ACCORDION — generic expand/collapse for the "About & support"
// card (and anywhere else `.accordion-item` shows up). Panels
// expand to their real, measured content height rather than a
// guessed max-height, so long or short answers both animate
// cleanly and nothing gets clipped.
// ------------------------------------------------------------
function initAccordions() {
    document.querySelectorAll('.accordion-item__trigger').forEach(trigger => {
        trigger.addEventListener('click', () => {
            const panel = document.getElementById(trigger.getAttribute('aria-controls'));
            if (!panel) return;
            const isOpen = trigger.getAttribute('aria-expanded') === 'true';

            if (isOpen) {
                panel.style.maxHeight = panel.scrollHeight + 'px';
                requestAnimationFrame(() => { panel.style.maxHeight = '0px'; });
                trigger.setAttribute('aria-expanded', 'false');
            } else {
                trigger.setAttribute('aria-expanded', 'true');
                panel.style.maxHeight = panel.scrollHeight + 'px';
                // Once the open transition lands, let it track content
                // that changes size later (e.g. a window resize).
                panel.addEventListener('transitionend', function onEnd() {
                    if (trigger.getAttribute('aria-expanded') === 'true') {
                        panel.style.maxHeight = 'none';
                    }
                    panel.removeEventListener('transitionend', onEnd);
                });
            }
        });
    });

    // Re-measure any panel currently open when the viewport resizes
    // (text reflow changes scrollHeight at narrower widths).
    window.addEventListener('resize', () => {
        document.querySelectorAll('.accordion-item__trigger[aria-expanded="true"]').forEach(trigger => {
            const panel = document.getElementById(trigger.getAttribute('aria-controls'));
            if (panel) panel.style.maxHeight = panel.scrollHeight + 'px';
        });
    });
}

// ------------------------------------------------------------
// COMPACT CHAT PREVIEW POPUP
// Pulls real, recent messages for the signed-in user's location
// (same /chats endpoint the live community chat uses) instead of
// placeholder bubbles, with real loading/empty/error states —
// the same pattern notification.js uses for its network calls.
// Reuses the exact same markup/classes the live community chat
// renders with (.chat-message, .chat-message--own, etc.), driven
// by the same [data-compact-chat]/[data-large-chat-text]/
// [data-reduce-motion] attributes already applied to <html>, so
// toggling a preference here updates the preview exactly the way
// it'll actually look in chat, live.
// ------------------------------------------------------------
function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function openChatPreviewPopup() {
    const overlay = el('chatPopupOverlay');
    const popup = el('chatPopup');
    const body = el('chatPopupBody');
    if (!overlay || !popup || !body) return;

    overlay.classList.add('chat-popup-overlay--open');
    overlay.setAttribute('aria-hidden', 'false');
    body.innerHTML = `<div style="color:var(--text-faint);font-size:0.85rem;padding:14px 0;text-align:center;">Loading recent messages…</div>`;

    const userId = getCurrentUserId();
    const userObj = getCurrentUserData();
    const loc = userObj.city ? `${userObj.city}, ${userObj.region || ''}`.replace(/,\s*$/, '') : (userObj.region || userObj.location);
    const myHandle = userObj.chatHandle || localStorage.getItem('chatHandle') || null;

    if (!loc) {
        body.innerHTML = `<div style="color:var(--text-faint);font-size:0.85rem;padding:14px 0;text-align:center;">Set a city/town to preview your community chat.</div>`;
        return;
    }

    try {
        const res = await fetch(`${API_URL}/chats?location=${encodeURIComponent(loc)}`);
        if (!res.ok) throw new Error('bad response');
        const chats = await res.json();
        const recent = chats.slice(0, 8).reverse(); // oldest -> newest, like a real thread

        if (recent.length === 0) {
            body.innerHTML = `<div style="color:var(--text-faint);font-size:0.85rem;padding:14px 0;text-align:center;">No messages in ${escapeHtml(loc.split(',')[0])} yet — be the first to say something on Home.</div>`;
            return;
        }

        body.innerHTML = `<div class="chat-thread">${recent.map(m => {
            const isMine = myHandle && m.handle === myHandle;
            const time = m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
            return `
                <div class="chat-message${isMine ? ' chat-message--own' : ''}">
                  <span class="chat-message__author">${isMine ? 'You' : escapeHtml(m.handle || 'anon')}</span>
                  <span class="chat-message__text">${escapeHtml(m.text)}</span>
                  <span class="chat-message__time">${time}</span>
                </div>`;
        }).join('')}</div>`;
    } catch (err) {
        body.innerHTML = `<div style="color:var(--text-faint);font-size:0.85rem;padding:14px 0;text-align:center;">Could not load chat preview right now.</div>`;
    }
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
    const checkInToggle = el('prefCheckInAlerts');
    const outageNewsToggle = el('prefOutageNewsAlerts');

    // Seed from localStorage immediately (fast paint), then reconcile
    // with the server's saved state once the push subscription is ready.
    if (muteGlobalToggle) muteGlobalToggle.checked = localStorage.getItem('lw_mute_global_chat') === '1';
    if (chatMentionsToggle) chatMentionsToggle.checked = localStorage.getItem('lw_chat_mentions') !== '0'; // default ON
    if (checkInToggle) checkInToggle.checked = localStorage.getItem('lw_checkin_alerts') !== '0'; // default ON
    if (outageNewsToggle) outageNewsToggle.checked = localStorage.getItem('lw_outage_news_alerts') !== '0'; // default ON

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
        if (checkInToggle) {
            checkInToggle.checked = prefs.checkInAlertsEnabled !== false;
            localStorage.setItem('lw_checkin_alerts', checkInToggle.checked ? '1' : '0');
        }
        if (outageNewsToggle) {
            outageNewsToggle.checked = prefs.outageNewsAlertsEnabled !== false;
            localStorage.setItem('lw_outage_news_alerts', outageNewsToggle.checked ? '1' : '0');
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

    checkInToggle?.addEventListener('change', async () => {
        if (typeof window.setCheckInAlertsPreference !== 'function') {
            window.lwToast?.('Notification service is not ready yet.');
            checkInToggle.checked = !checkInToggle.checked;
            return;
        }
        const result = await window.setCheckInAlertsPreference(checkInToggle.checked);
        if (!result.success) {
            checkInToggle.checked = !checkInToggle.checked;
            window.lwToast?.(result.error || 'Could not save check-in reminder setting.');
            return;
        }
        localStorage.setItem('lw_checkin_alerts', checkInToggle.checked ? '1' : '0');
        window.lwToast?.(checkInToggle.checked
            ? 'You\u2019ll get a once-a-day "still got light?" reminder.'
            : 'Daily check-in reminders are off.');
    });

    outageNewsToggle?.addEventListener('change', async () => {
        if (typeof window.setOutageNewsAlertsPreference !== 'function') {
            window.lwToast?.('Notification service is not ready yet.');
            outageNewsToggle.checked = !outageNewsToggle.checked;
            return;
        }
        const result = await window.setOutageNewsAlertsPreference(outageNewsToggle.checked);
        if (!result.success) {
            outageNewsToggle.checked = !outageNewsToggle.checked;
            window.lwToast?.(result.error || 'Could not save outage news setting.');
            return;
        }
        localStorage.setItem('lw_outage_news_alerts', outageNewsToggle.checked ? '1' : '0');
        window.lwToast?.(outageNewsToggle.checked
            ? 'You\u2019ll be pushed when official news reports an outage anywhere in Ghana.'
            : 'Outage news alerts are off — you\u2019ll still get alerts for your own location.');
    });
}

// ------------------------------------------------------------
// PUSH PERMISSION STATUS ROW — small live indicator above the
// "Enable notifications" button so it's obvious at a glance whether
// this device can actually receive anything the toggles below
// promise. Re-checked whenever push state changes (enabling push,
// or the browser permission itself changing) via the same
// lw:push-state-changed event nav.js's badge dot already listens for.
// ------------------------------------------------------------
function refreshPushStatusRow() {
    const row = el('pushStatusRow');
    const text = el('pushStatusText');
    if (!row || !text) return;

    const enabled = typeof window.isLightWatchPushEnabled === 'function'
        ? window.isLightWatchPushEnabled()
        : false;

    row.classList.remove('pref-status--on', 'pref-status--off');
    if (enabled) {
        row.classList.add('pref-status--on');
        text.textContent = 'Notifications are on for this device.';
    } else {
        row.classList.add('pref-status--off');
        text.textContent = 'Notifications are off — tap below to enable them on this device.';
    }
}



// ------------------------------------------------------------
// CITY / TOWN EDIT — one-time only, with a real locked state
// once it's been used (no more disabled-looking form).
// ------------------------------------------------------------
function showCityLockedView(city, region, animate = true) {
    // The one-time edit has been used — there's nothing left for the user
    // to do here, so the whole panel collapses out of the page rather than
    // sticking around in a disabled/locked state. The City row itself also
    // loses its arrow/click affordance so it can't be tapped open onto an
    // empty panel afterward.
    const card = el('cityEditCard');
    const rowToggle = el('cityRowToggle');
    if (rowToggle) {
        rowToggle.classList.add('detail-row--locked');
        rowToggle.setAttribute('aria-expanded', 'false');
        rowToggle.setAttribute('aria-disabled', 'true');
    }
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
    const locateBtn = el('cityEditLocateBtn');
    if (input) input.value = user?.city || '';

    // initCityEditForm() can now run again after an account switch (see
    // the lw-session-changed listener near mount() below) — guard against
    // attaching a second set of listeners on top of the first.
    const cityEditForm = el('cityEditForm');
    if (toggleBtn?.dataset.bound === '1') return;
    if (toggleBtn) toggleBtn.dataset.bound = '1';
    if (cityEditForm) cityEditForm.dataset.bound = '1';

    // Same picker signup.js uses (search-as-you-type + "use my location"),
    // so editing a city here works identically to setting it at signup.
    // The account's region is fixed (not part of this form), so it's
    // passed as a plain getter rather than a live <select>.
    const locationPicker = window.LWLocationPicker?.attach({
        input,
        resultsEl: el('cityEditSearchResults'),
        locateBtn,
        hintEl: el('cityEditLocationHint'),
        getRegion: () => user?.region || ''
    }) || null;

    toggleBtn?.addEventListener('click', () => {
        if (!input || input.disabled === false) return;
        input.disabled = false;
        input.focus();
        input.select();
        const saveBtn = el('cityEditSaveBtn');
        if (saveBtn) saveBtn.disabled = false;
        if (locateBtn) locateBtn.disabled = false;
        toggleBtn.textContent = 'Editing…';
        toggleBtn.disabled = true;
    });

    cityEditForm?.addEventListener('submit', async () => {
        const messageEl = el('cityEditMessage');
        const saveBtn = el('cityEditSaveBtn');
        const city = String(input?.value || '').trim();
        const userId = getCurrentUserId();
        if (!userId || !city) {
            if (messageEl) messageEl.textContent = 'Please enter a city/town first.';
            return;
        }

        saveBtn.disabled = true;
        if (messageEl) messageEl.textContent = 'Saving...';

        try {
            const coords = locationPicker?.getCoords();
            const payload = coords ? { city, lat: coords.lat, lng: coords.lng } : { city };
            const res = await fetch(`${API_URL}/user/${userId}/city`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (messageEl) messageEl.textContent = data.error || 'Could not save city/town.';
                saveBtn.disabled = false;
                return;
            }

            const finalCity = data.user?.city || city;
            const finalRegion = data.user?.region || el('acctProfileRegion')?.textContent;

            if (el('profileCity')) el('profileCity').textContent = finalCity;
            if (el('acctProfileRegion')) el('acctProfileRegion').textContent = finalRegion;

            const cachedUser = getCurrentUserData();
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

    const pinIcon = `<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 18s6-5.686 6-10a6 6 0 1 0-12 0c0 4.314 6 10 6 10Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="10" cy="8" r="2.2" stroke="currentColor" stroke-width="1.6"/></svg>`;
    // A distinct flag icon (rather than the same pin recolored) so a saved
    // second spot is visually its own thing at a glance, not a muted
    // variant of the primary location.
    const flagIcon = `<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 17V3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M5 4.2c1.4-1 3-1 4.4 0 1.5 1 3.1 1 4.6 0v6.6c-1.5 1-3.1 1-4.6 0-1.4-1-3-1-4.4 0V4.2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
    const pencilIcon = `<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13.4 3.5 16.5 6.6 7 16.1H3.9v-3.1L13.4 3.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
    const trashIcon = `<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6M6 6v9a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    const rows = [];
    const primary = user.city ? `${user.city}, ${user.region || ''}`.replace(/,\s*$/, '') : user.region || null;
    if (primary) {
        rows.push(`
            <div class="location-row">
                <span class="location-row__icon" aria-hidden="true">${pinIcon}</span>
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
            <div class="location-row location-row--secondary">
                <span class="location-row__icon location-row__icon--secondary" aria-hidden="true">${flagIcon}</span>
                <div class="location-row__body">
                    <div class="location-row__name">${secLabel}</div>
                    <div class="location-row__badge location-row__badge--secondary">${sec.label || 'Second location'}</div>
                </div>
                <div class="location-row__actions">
                    <button type="button" id="secondaryLocationEditBtn" aria-label="Edit second location">${pencilIcon}<span>Edit</span></button>
                    <button type="button" id="secondaryLocationRemoveBtn" aria-label="Remove second location">${trashIcon}<span>Remove</span></button>
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
        const userId = getCurrentUserId();
        if (!userId) return;
        removeBtn.disabled = true;
        try {
            const res = await fetch(`${API_URL}/user/${userId}/secondary-location`, { method: 'DELETE' });
            if (!res.ok) throw new Error('failed');
            const cachedUser = getCurrentUserData();
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
        const userId = getCurrentUserId();
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

            const cachedUser = getCurrentUserData();
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
// Fills every account-extras field (region, chat handle, member-since
// date, greeting, badge) from a user object. Pulled out of
// loadAccountExtras() so it can run twice: once synchronously from
// whatever's already cached, so nothing on this page ever sits on a
// raw "—" placeholder while the network call below is in flight, and
// once again when the fresh response actually lands.
function paintAccountExtras(user) {
    if (el('profileCity')) el('profileCity').textContent = user.city || '—';
    if (el('acctProfileRegion')) el('acctProfileRegion').textContent = user.region || '—';

    // Prefer user's saved profile picture; fall back to generated SVG.
    applyAvatarToTargets(user);

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

    hydrateIdentityForm(user);

    if (user.createdAt && el('acctProfileLastLogin')) {
        el('acctProfileLastLogin').textContent = new Date(user.createdAt).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
    }

    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const firstName = (user.name || '').trim().split(/\s+/)[0] || 'there';
    if (el('acctPageEyebrow')) el('acctPageEyebrow').textContent = greeting;
    if (el('acctPageGreeting')) el('acctPageGreeting').textContent = firstName;
}

const RECENT_CHAT_ARCHIVE_KEY = 'lw_recent_chat_archive';
const RECENT_CHAT_HIDDEN_KEY = 'lw_recent_chat_hidden';

function readArchivedChats() {
    try {
        const raw = localStorage.getItem(RECENT_CHAT_ARCHIVE_KEY);
        const parsed = JSON.parse(raw || '[]');
        return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
        return [];
    }
}

function writeArchivedChats(ids) {
    localStorage.setItem(RECENT_CHAT_ARCHIVE_KEY, JSON.stringify(ids.map(String)));
}

function readHiddenChats() {
    try {
        const raw = localStorage.getItem(RECENT_CHAT_HIDDEN_KEY);
        const parsed = JSON.parse(raw || '[]');
        return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
        return [];
    }
}

function writeHiddenChats(ids) {
    localStorage.setItem(RECENT_CHAT_HIDDEN_KEY, JSON.stringify(ids.map(String)));
}

function renderRecentChatActivity(chats, userId) {
    const listEl = el('recentChatList');
    if (!listEl) return;

    const archived = readArchivedChats();
    const hidden = readHiddenChats();
    const visible = chats
        .filter(chat => chat && String(chat._id || chat.id))
        .filter(chat => !archived.includes(String(chat._id || chat.id)))
        .filter(chat => !hidden.includes(String(chat._id || chat.id)));

    if (visible.length === 0) {
        listEl.innerHTML = `<div style="color:var(--text-faint);font-size:0.85rem;padding:8px 0;">No recent chat activity to show.</div>`;
        return;
    }

    const slice = visible.slice(0, 20);
    listEl.innerHTML = slice.map((chat) => {
        const chatId = String(chat._id || chat.id || '');
        const canDelete = chat.createdAt && (Date.now() - new Date(chat.createdAt).getTime()) <= 15 * 60 * 1000;
        const createdAt = chat.createdAt
            ? new Date(chat.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
            : 'Unknown';
        const formattedText = window.LWHelpers?.formatMessageTextWithMentions(chat.text) || escapeHtml(chat.text);
        return `<div class="recent-chat-item" data-chat-id="${chatId}">
            <div class="recent-chat-item__body">
              <div class="recent-chat-item__text">${formattedText || '<span style="color:var(--text-faint);">(No text)</span>'}</div>
              <div class="recent-chat-item__meta">${escapeHtml(chat.location || '')} · ${createdAt}</div>
            </div>
            <div class="recent-chat-item__actions">
              <button type="button" class="btn btn--ghost btn--sm" data-action="hide" data-chat-id="${chatId}">Hide</button>
              <button type="button" class="btn btn--ghost btn--sm" data-action="archive" data-chat-id="${chatId}">Archive</button>
              <button type="button" class="btn btn--ghost btn--sm" data-action="delete" data-chat-id="${chatId}" ${canDelete ? '' : 'disabled title="Delete only allowed within 15 minutes of posting"'}>Delete</button>
            </div>
          </div>`;
    }).join('');

    if (visible.length > slice.length) {
        listEl.insertAdjacentHTML('beforeend', `<div style="font-size:0.78rem;color:var(--text-faint);padding-top:8px;">Showing ${slice.length} of ${visible.length} recent posts.</div>`);
    }
}

function archiveRecentChat(chatId) {
    if (!chatId) return;
    const archived = readArchivedChats();
    if (!archived.includes(chatId)) {
        writeArchivedChats([...archived, chatId]);
    }
    const item = document.querySelector(`.recent-chat-item[data-chat-id="${chatId}"]`);
    if (item) item.remove();
}

function hideRecentChat(chatId) {
    if (!chatId) return;
    const hidden = readHiddenChats();
    if (!hidden.includes(chatId)) {
        writeHiddenChats([...hidden, chatId]);
    }
    const item = document.querySelector(`.recent-chat-item[data-chat-id="${chatId}"]`);
    if (item) item.remove();
}

async function deleteRecentChat(chatId) {
    const userId = getCurrentUserId();
    if (!userId) return;

    const res = await fetch(`${API_URL}/chats/${chatId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        window.lwToast?.(data.error || 'Could not delete this post.');
        return;
    }

    const item = document.querySelector(`.recent-chat-item[data-chat-id="${chatId}"]`);
    if (item) item.remove();
    window.lwToast?.('Post deleted.');
}

function initRecentChatActivity() {
    const listEl = el('recentChatList');
    if (!listEl || listEl.dataset.bound === '1') return;
    listEl.dataset.bound = '1';
    listEl.addEventListener('click', async (event) => {
        const btn = event.target.closest('button[data-action]');
        if (!btn || !btn.dataset.chatId) return;
        const action = btn.dataset.action;
        const chatId = btn.dataset.chatId;

        if (action === 'hide') {
            hideRecentChat(chatId);
            window.lwToast?.('Post hidden.');
            return;
        }

        if (action === 'archive') {
            archiveRecentChat(chatId);
            window.lwToast?.('Post archived from recent activity.');
            return;
        }

        if (action === 'delete') {
            await deleteRecentChat(chatId);
        }
    });
}

async function loadAccountExtras() {
    const userId = getCurrentUserId();
    if (!userId) {
        if (document.body) delete document.body.dataset.accountExtrasLoading;
        document.body?.classList.remove('page-data-loading');
        return;
    }

    // Paint instantly from whatever's already cached for this user —
    // profile.js's own fetch (or a previous visit to this page) already
    // wrote region/chatHandle/city/createdAt into currentUserData, so
    // there's no reason to make every field on this page sit blank
    // while the network round trip below is in flight. The fetch still
    // always runs and overwrites this with the live copy the moment it
    // lands.
    const cachedSnapshot = getCurrentUserData();
    const hasCachedSnapshot = cachedSnapshot && Object.keys(cachedSnapshot).length > 0;
    if (hasCachedSnapshot) {
        paintAccountExtras(cachedSnapshot);
        renderLocationsList(cachedSnapshot);
        initCityEditForm(cachedSnapshot);
    }

    try {
        const res = await fetch(`${API_URL}/user/${userId}`);
        if (!res.ok) return;
        const user = await res.json();

        paintAccountExtras(user);
        renderLocationsList(user);
        initCityEditForm(user);

        // Cache the fuller object so the locations UI still has it after
        // an edit without needing another round trip.
        const cachedUser = getCurrentUserData();
        localStorage.setItem('currentUserData', JSON.stringify({ ...cachedUser, ...user }));
    } catch (e) { /* silent — page still works from profile.js's cached data */ }

    // Recent chat messages load independently and don't hold up anything else.
    try {
        const userObj = getCurrentUserData();
        const loc = userObj.city ? `${userObj.city}, ${userObj.region}` : userObj.region || userObj.location;
        if (loc) {
            const res = await fetch(`${API_URL}/chats?location=${encodeURIComponent(loc)}`);
            if (res.ok) {
                const chats = await res.json();
                const mineAll = chats.filter(c => String(c.userId?._id || c.userId) === String(userId));
                renderRecentChatActivity(mineAll, userId);
            }
        }
    } catch (e) { /* silent */ }

    // Whatever happened above (success or failure), the extras are done
    // loading now — release the flag profile.js's hideProfileLoader() was
    // respecting, and reveal the real content if the skeleton is still up.
    if (document.body) delete document.body.dataset.accountExtrasLoading;
    document.body?.classList.remove('page-data-loading', 'app-loading');
}

// ------------------------------------------------------------
// COLLAPSIBLE CARDS — chevron beside "My locations", "Notifications",
// and "Display" headers. Same measure-then-animate approach as
// initAccordions() above (max-height driven off scrollHeight), just
// applied to a whole card body instead of a single accordion panel.
//
// My Locations starts collapsed on every mobile page load (no memory
// of prior state) — the user opens it when they need it for that
// visit. Notifications and Display now always start open (mobile and
// desktop alike), since those are settings people tend to want to see
// right away. On desktop there's plenty of room regardless (these
// cards sit in their own right-hand column beside the profile card).
// ------------------------------------------------------------
// Cards that should always start collapsed on every page load, regardless
// of whether the user opened them last time. Mobile only — see the
// isMobileViewport() check below.
const COLLAPSE_BY_DEFAULT_IDS = ['myLocationsCollapseBtn'];

// Matches the mobile/desktop split used elsewhere in account.css
// (its "Tablet and standard Phone viewports" cutoff is 768px).
function isMobileViewport() {
    return window.matchMedia('(max-width: 768px)').matches;
}

function initCollapsibleCards() {
    document.querySelectorAll('.card__collapse-btn').forEach(btn => {
        const body = document.getElementById(btn.getAttribute('aria-controls'));
        if (!body) return;

        if (COLLAPSE_BY_DEFAULT_IDS.includes(btn.id) && isMobileViewport()) {
            // Collapse instantly on load — no shrink animation on first
            // paint, just start closed the way an already-collapsed card
            // normally would.
            body.style.transition = 'none';
            body.style.maxHeight = '0px';
            body.dataset.collapsed = 'true';
            btn.setAttribute('aria-expanded', 'false');
            btn.setAttribute('aria-label', btn.getAttribute('aria-label').replace('Collapse', 'Expand'));
            requestAnimationFrame(() => { body.style.transition = ''; });
        } else {
            // Start fully open at natural height so nothing clips on load.
            // (Covers both cards that are always open, and — on desktop —
            // the three COLLAPSE_BY_DEFAULT_IDS cards, whose markup hardcodes
            // aria-expanded="false"/"Expand ..." for the mobile-collapsed
            // case. Sync those attributes here so a desktop page load
            // doesn't show an open card with "expand" affordances.)
            body.style.maxHeight = 'none';
            body.dataset.collapsed = 'false';
            if (btn.getAttribute('aria-expanded') !== 'true') {
                btn.setAttribute('aria-expanded', 'true');
                btn.setAttribute('aria-label', btn.getAttribute('aria-label').replace('Expand', 'Collapse'));
            }
        }

        btn.addEventListener('click', () => {
            const isOpen = btn.getAttribute('aria-expanded') === 'true';

            if (isOpen) {
                body.style.maxHeight = body.scrollHeight + 'px';
                requestAnimationFrame(() => { body.style.maxHeight = '0px'; });
                body.dataset.collapsed = 'true';
                btn.setAttribute('aria-expanded', 'false');
                btn.setAttribute('aria-label', btn.getAttribute('aria-label').replace('Collapse', 'Expand'));
            } else {
                body.dataset.collapsed = 'false';
                btn.setAttribute('aria-expanded', 'true');
                btn.setAttribute('aria-label', btn.getAttribute('aria-label').replace('Expand', 'Collapse'));
                body.style.maxHeight = body.scrollHeight + 'px';
                body.addEventListener('transitionend', function onEnd() {
                    if (btn.getAttribute('aria-expanded') === 'true') body.style.maxHeight = 'none';
                    body.removeEventListener('transitionend', onEnd);
                });
            }
        });
    });

    // Re-measure open bodies on resize/content change (e.g. the locations
    // list re-rendering after a save) so they don't clip.
    window.addEventListener('resize', () => {
        document.querySelectorAll('.card__collapse-btn[aria-expanded="true"]').forEach(btn => {
            const body = document.getElementById(btn.getAttribute('aria-controls'));
            if (body && body.style.maxHeight !== 'none') body.style.maxHeight = body.scrollHeight + 'px';
        });
    });
}

// ------------------------------------------------------------
// ACCOUNT DETAILS — row expanders (Contact / City).
// A plain show/hide toggle, distinct from the animated
// card__collapse-btn pattern above since these panels live inline
// inside the details list rather than as their own cards.
// ------------------------------------------------------------
function initDetailRowExpanders() {
    document.querySelectorAll('.detail-row--action[aria-controls]').forEach((btn) => {
        const panel = document.getElementById(btn.getAttribute('aria-controls'));
        if (!panel || btn.dataset.expanderBound === '1') return;
        btn.dataset.expanderBound = '1';

        btn.addEventListener('click', () => {
            if (btn.getAttribute('aria-disabled') === 'true') return;
            const isOpen = btn.getAttribute('aria-expanded') === 'true';
            btn.setAttribute('aria-expanded', String(!isOpen));
            panel.hidden = isOpen;
        });
    });
}

// ------------------------------------------------------------
// SECONDARY CONTACT — lets someone note an extra email/phone people
// can reach them on. There's no backend field for this yet, so it's
// kept as a locally-stored list tied to this browser/device rather
// than synced to the account.
// ------------------------------------------------------------
const SECONDARY_CONTACT_KEY = 'lw_secondary_contacts';

function readSecondaryContacts() {
    try {
        const raw = localStorage.getItem(SECONDARY_CONTACT_KEY);
        const parsed = JSON.parse(raw || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeSecondaryContacts(list) {
    localStorage.setItem(SECONDARY_CONTACT_KEY, JSON.stringify(list));
}

function renderSecondaryContacts() {
    const listEl = el('secondaryContactList');
    if (!listEl) return;
    const contacts = readSecondaryContacts();

    listEl.innerHTML = '';
    contacts.forEach((value, index) => {
        const li = document.createElement('li');
        const span = document.createElement('span');
        span.textContent = value;
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => {
            const next = readSecondaryContacts();
            next.splice(index, 1);
            writeSecondaryContacts(next);
            renderSecondaryContacts();
        });
        li.appendChild(span);
        li.appendChild(removeBtn);
        listEl.appendChild(li);
    });
}

function initAddContactForm() {
    const form = el('addContactForm');
    const input = el('addContactInput');
    const messageEl = el('addContactMessage');
    if (!form || form.dataset.bound === '1') return;
    form.dataset.bound = '1';

    renderSecondaryContacts();

    form.addEventListener('submit', () => {
        const value = String(input?.value || '').trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const phoneRegex = /^[+0-9][0-9\s-]{6,}$/;

        if (!value || (!emailRegex.test(value) && !phoneRegex.test(value))) {
            if (messageEl) messageEl.textContent = 'Enter a valid email or phone number.';
            return;
        }

        const contacts = readSecondaryContacts();
        if (contacts.includes(value)) {
            if (messageEl) messageEl.textContent = 'That contact is already saved.';
            return;
        }

        contacts.push(value);
        writeSecondaryContacts(contacts);
        renderSecondaryContacts();
        if (input) input.value = '';
        if (messageEl) messageEl.textContent = 'Saved on this device.';
    });
}

// ------------------------------------------------------------
// KEYBOARD-AWARE INPUTS — native app only.
// Account has form fields scattered across several accordions/cards
// rather than one known field like login/signup, so instead of a
// fixed CSS-var shift on a single element, this delegates focus on
// the whole view: whichever input/textarea is currently focused gets
// checked against the keyboard-shrunk viewport, and the page only
// scrolls if that field would actually end up covered. Eases back to
// where it was on blur. No-op outside the native app — a regular
// mobile browser already scrolls the focused field into view itself.
// ------------------------------------------------------------
function isNativeApp() {
    return Boolean(
        window.Capacitor &&
        typeof window.Capacitor.isNativePlatform === 'function' &&
        window.Capacitor.isNativePlatform()
    );
}

function initKeyboardAwareInputs() {
    if (!isNativeApp() || !window.visualViewport) return;
    const view = document.getElementById('view-account');
    if (!view) return;

    const GAP = 16; // breathing room between the field and the keyboard
    let activeInput = null;
    let originalScrollY = null;

    const isTextField = (node) => node instanceof HTMLElement && (
        node.tagName === 'TEXTAREA' ||
        (node.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'range', 'file'].includes(node.type))
    );

    const reposition = () => {
        if (!activeInput || !activeInput.isConnected) return;
        const viewportBottom = window.visualViewport.height + window.visualViewport.offsetTop - GAP;
        const fieldBottom = activeInput.getBoundingClientRect().bottom;
        const delta = fieldBottom - viewportBottom;
        if (delta > 0) {
            window.scrollBy({ top: delta, behavior: 'smooth' });
        }
    };

    const handleNativeKeyboardState = () => {
        if (!activeInput) return;
        requestAnimationFrame(reposition);
        setTimeout(reposition, 180);
        setTimeout(reposition, 400);
    };

    view.addEventListener('focusin', (e) => {
        if (!isTextField(e.target)) return;
        activeInput = e.target;
        if (originalScrollY === null) originalScrollY = window.scrollY;
        requestAnimationFrame(reposition);
        setTimeout(reposition, 180); // keyboard animates in — recheck once it's settled
        setTimeout(reposition, 400);
    });

    view.addEventListener('focusout', (e) => {
        if (e.target !== activeInput) return;
        activeInput = null;
        if (originalScrollY !== null) {
            window.scrollTo({ top: originalScrollY, behavior: 'smooth' });
            originalScrollY = null;
        }
    });

    window.visualViewport.addEventListener('resize', reposition);
    window.addEventListener('lw-keyboard-show', handleNativeKeyboardState);
    window.addEventListener('lw-keyboard-hide', () => {
        if (activeInput) {
            if (originalScrollY !== null) {
                window.scrollTo({ top: originalScrollY, behavior: 'smooth' });
                originalScrollY = null;
            }
            activeInput = null;
        }
    });
}

// ------------------------------------------------------------
// DEEP LINK: the settings-gear icon on the Notifications view (top
// right corner there) routes here with data-panel="notifications" —
// nav.js stashes that in window.__lwPendingAccountPanel right before
// navigating (same pattern chat.js's report-panel deep link already
// uses). show() below checks for it on every visit to this view
// (not just the first) and scrolls straight to the Notifications
// settings card instead of leaving the user to hunt for it from the
// top of the account page.
// ------------------------------------------------------------
function scrollToNotificationSettings() {
    const card = document.getElementById('accountNotificationsCard');
    if (!card) return;

    // Make sure the card is actually expanded before scrolling to it —
    // no point landing on a collapsed panel.
    const collapseBtn = document.getElementById('notificationsCollapseBtn');
    if (collapseBtn && collapseBtn.getAttribute('aria-expanded') === 'false') {
        collapseBtn.click();
    }

    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    card.classList.remove('card--highlight');
    // Force reflow so re-triggering the animation on a second visit
    // (class was never removed in time) actually restarts it.
    void card.offsetWidth;
    card.classList.add('card--highlight');
    setTimeout(() => card.classList.remove('card--highlight'), 2200);
}

function consumePendingAccountPanel() {
    if (window.__lwPendingAccountPanel !== 'notifications') return;
    window.__lwPendingAccountPanel = null;
    // Give the view a beat to finish being un-hidden/laid out before
    // measuring scrollIntoView positions.
    requestAnimationFrame(() => setTimeout(scrollToNotificationSettings, 50));
}

// ------------------------------------------------------------
// INIT — called once by the router on first visit to this view.
// ------------------------------------------------------------
function mount() {
    initDisplayPrefsUI();
    initChatPreviewPopup();
    initNotificationPrefToggles();
    initSecondaryLocationForm();
    initProfileIdentityForm();
    initRecentChatActivity();
    initAccordions();
    initCollapsibleCards();
    initDetailRowExpanders();
    initAddContactForm();
    initKeyboardAwareInputs();
    loadAccountExtras();

    refreshPushStatusRow();
    window.addEventListener('lw:push-state-changed', refreshPushStatusRow);

    // mount() only runs once per page-load (see app.js's router), but a
    // person can sign out and a different person can sign in without the
    // page ever reloading. Re-run the data load whenever that happens so
    // this page reflects whoever is actually signed in now.
    window.addEventListener('lw-session-changed', () => {
        loadAccountExtras();
    });

    // Covers landing directly on /account with the panel already
    // pending (e.g. a very fast click before mount() finished).
    consumePendingAccountPanel();
}

// show() runs on every visit after the first (see app.js's router
// callHook(name, 'show')), which is what makes the deep link work on
// the 2nd/3rd/etc. tap of the gear icon, not just the first.
function show() {
    consumePendingAccountPanel();
}

window.LWViews = window.LWViews || {};
window.LWViews.account = { mount, show };