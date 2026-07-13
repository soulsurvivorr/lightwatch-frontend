// ============================================================
//  NOTIFICATIONS.JS — Push subscription
//  Load on every protected page (home.html, account.html etc.)
//  Requires: auth.js and config.js loaded before this
// ============================================================

const VAPID_PUBLIC_KEY = 'BMEgZthyyCz4BER4r4Qbi7MuQrvG24AVNma_PEfFG47plgkaLumI25-UbfbIxShGExhUfw4k8GCas2JFuNh-ExI';
const APP_ICON_PATH = '/images/dev-logo.png?v=20260708';
const APP_ICON = new URL(APP_ICON_PATH, window.location.origin).href;
const PUSH_WELCOME_KEY = 'lw_push_welcome_shown';
let pushInitPromise = null;
let lwAudioCtx = null;
let lwAudioReady = false;
// Every tone's notes route through this single compressor rather than
// straight to the speakers. It exists because of the volume increase
// below (issue 4): once individual notes get louder and the "doom" +
// chime notes briefly overlap, that overlap could clip/distort at the
// top of the range. This gently caps the combined peak instead of us
// having to keep every tone quiet just to leave headroom for the worst
// case overlap.
let lwMasterBus = null;

function updateEnablePushButtonsVisibility() {
    const isEnabled = Notification.permission === 'granted';
    document.querySelectorAll('[data-enable-push-btn]').forEach((btn) => {
        // Keep the button visible either way — flip it into a settled
        // "Enabled" state rather than disappearing, so the page still
        // confirms notifications are on instead of the control just vanishing.
        btn.hidden = false;
        btn.setAttribute('aria-hidden', 'false');

        if (!btn.dataset.defaultLabel) {
            btn.dataset.defaultLabel = btn.innerHTML;
        }

        if (isEnabled) {
            btn.disabled = true;
            btn.classList.add('btn--enabled-state');
            btn.setAttribute('aria-disabled', 'true');
            btn.innerHTML = '<span class="btn__check" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:0.85em;height:0.85em;"><path d="M3 8.5 6.3 12 13 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span> Notifications enabled';
        } else {
            btn.disabled = false;
            btn.classList.remove('btn--enabled-state');
            btn.removeAttribute('aria-disabled');
            btn.innerHTML = btn.dataset.defaultLabel;
        }
    });
}

function ensureAudioContext() {
    if (lwAudioCtx) return lwAudioCtx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    lwAudioCtx = new Ctx();

    lwMasterBus = lwAudioCtx.createDynamicsCompressor();
    // Starts clamping fairly early (-18dB) and fairly hard (12:1) with a
    // near-instant attack — appropriate for short percussive blips like
    // these rather than sustained music, so it catches the very first
    // overlapping instant instead of letting a peak through before it
    // reacts.
    lwMasterBus.threshold.setValueAtTime(-18, lwAudioCtx.currentTime);
    lwMasterBus.knee.setValueAtTime(12, lwAudioCtx.currentTime);
    lwMasterBus.ratio.setValueAtTime(12, lwAudioCtx.currentTime);
    lwMasterBus.attack.setValueAtTime(0.002, lwAudioCtx.currentTime);
    lwMasterBus.release.setValueAtTime(0.15, lwAudioCtx.currentTime);
    lwMasterBus.connect(lwAudioCtx.destination);

    return lwAudioCtx;
}

function unlockForegroundAudio() {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    const resume = () => {
        ctx.resume().then(() => {
            lwAudioReady = true;
        }).catch(() => {});
    };
    resume();
}

function triggerForegroundSignal(tone) {
    unlockForegroundAudio();
    if (navigator.vibrate) {
        // Chat stays a light single tap; power changes get the slightly
        // heavier double-pulse so they read as "more important" by feel
        // alone, even before the sound registers.
        navigator.vibrate(tone === 'chat' ? [70] : [90, 40, 90]);
    }
    playToneForType(tone);
}

// ── LightWatch sound identity ─────────────────────────────────
// One shared "instrument" (soft sine/triangle blips, quick fade
// in, exponential fade out) across all three tones so they read
// as one family — but each event is still tellable apart:
//
//   ⚡ Power ON:  low pulse → bright chime      "doom … ting"
//   🌑 Power OFF: same low pulse → dull low tone "doom … dum"
//   💬 Chat:      single soft glass "plink"
//
// playDewDropsTone() is kept as the fallback for any push that
// arrives without a recognized `tone` (e.g. an older cached
// service worker, or an admin test push that didn't set one).
function playToneForType(tone) {
    switch (tone) {
        case 'power-on':  playPowerOnTone();  break;
        case 'power-off': playPowerOffTone(); break;
        case 'chat':      playChatPlinkTone(); break;
        default:          playDewDropsTone();
    }
}

// Single oscillator "note" — the shared building block every
// LightWatch tone is made from, so they all share one timbre.
function playNote(ctx, { freq, start, duration, type = 'sine', peakGain = 0.32, attack = 0.015 }) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.value = freq;

    const end = start + duration;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peakGain, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(gain);
    // Through the shared compressor bus (see ensureAudioContext), not
    // straight to destination — that's what lets these run louder
    // without overlapping notes clipping. Falls back to destination
    // directly only if something upstream failed to set the bus up.
    gain.connect(lwMasterBus || ctx.destination);

    osc.start(start);
    osc.stop(end + 0.02);
}

function canPlayTone(ctx) {
    return ctx && (lwAudioReady || ctx.state === 'running');
}

// ⚡ Power ON — low pulse resolving UP into a bright two-note chime.
function playPowerOnTone() {
    const ctx = ensureAudioContext();
    if (!canPlayTone(ctx)) return;
    const now = ctx.currentTime;

    playNote(ctx, { freq: 165, start: now, duration: 0.16, type: 'sine', peakGain: 0.34 }); // "doom"
    // "ting" — fundamental + a quiet high overtone for sparkle
    playNote(ctx, { freq: 1318.5, start: now + 0.20, duration: 0.24, type: 'sine', peakGain: 0.30, attack: 0.008 });
    playNote(ctx, { freq: 1975.5, start: now + 0.20, duration: 0.18, type: 'sine', peakGain: 0.10, attack: 0.008 });
}

// 🌑 Power OFF — same low pulse, resolving DOWN into a duller low tone.
function playPowerOffTone() {
    const ctx = ensureAudioContext();
    if (!canPlayTone(ctx)) return;
    const now = ctx.currentTime;

    playNote(ctx, { freq: 165, start: now, duration: 0.16, type: 'sine', peakGain: 0.34 }); // "doom"
    // "dum" — was 116Hz, which sits below the range most phone speakers
    // can reproduce at any real volume (small speakers typically roll
    // off sharply under ~150-200Hz). That's very likely why this tone
    // read as "no sound at all": the note meant to make power-off
    // recognizable was probably inaudible on real hardware even though
    // it plays correctly in code. Raised to 196Hz — still clearly lower
    // than the "ting" in the power-on tone (keeps the duller/lower
    // feel), but comfortably inside typical phone speaker range. Gain
    // raised to match the shared "doom" note so this note doesn't trail
    // off quieter than its counterpart in the on-tone.
    playNote(ctx, { freq: 196, start: now + 0.20, duration: 0.28, type: 'triangle', peakGain: 0.34, attack: 0.02 });
}

// 💬 Chat — a single soft glass "plink", no second note.
function playChatPlinkTone() {
    const ctx = ensureAudioContext();
    if (!canPlayTone(ctx)) return;
    const now = ctx.currentTime;

    playNote(ctx, { freq: 1568, start: now, duration: 0.13, type: 'sine', peakGain: 0.26, attack: 0.005 });
    playNote(ctx, { freq: 3136, start: now, duration: 0.08, type: 'sine', peakGain: 0.07, attack: 0.005 }); // glassy overtone
}

// Legacy/unrecognized-tone fallback — the original three-note run-up.
function playDewDropsTone() {
    const ctx = ensureAudioContext();
    if (!canPlayTone(ctx)) return;

    const now = ctx.currentTime;
    const notes = [880, 1046, 1174];

    notes.forEach((freq, i) => {
        playNote(ctx, { freq, start: now + (i * 0.12), duration: 0.16, type: 'sine', peakGain: 0.28, attack: 0.02 });
    });
}

// Convert VAPID public key from base64 to Uint8Array (required by browser API)
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

// ── Auto-init on page load: registers the SW and silently
//    resubscribes IF the user already granted permission in a
//    past session. Does NOT call Notification.requestPermission()
//    here — see enableLightWatchPush() below for why.
// ───────────────────────────────────────────────────────────
async function initPushNotifications() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.log('Push notifications not supported on this browser.');
        return;
    }

    try {
        const registration = await navigator.serviceWorker.register('/service-worker.js');
        await registration.update();
        await navigator.serviceWorker.ready;

        const existing = await registration.pushManager.getSubscription();
        if (existing) {
            await sendSubscriptionToServer(existing);
            await maybeShowPushWelcome(registration);
            return;
        }

        // Only auto-subscribe if permission was already granted in a
        // previous session (e.g. returning user, or a browser that
        // allows silent re-subscription). If permission is still
        // 'default', we deliberately do NOT call requestPermission()
        // here — on iOS Safari, calling it outside a direct user
        // gesture (tap/click) is silently ignored: no prompt ever
        // shows, and the app never appears under iOS Settings >
        // Notifications, because iOS never received a real request.
        // That state is indistinguishable from "nothing to enable",
        // which is exactly the symptom this was causing.
        if (Notification.permission === 'granted') {
            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
            });
            await sendSubscriptionToServer(subscription);
            await maybeShowPushWelcome(registration);
            console.log('Push notifications enabled (resubscribed silently).');
        } else {
            console.log(`Push permission is "${Notification.permission}" — waiting for a user tap (enableLightWatchPush) before requesting.`);
        }

    } catch (err) {
        console.error('Push init failed:', err);
    }
}

function ensurePushNotificationsInitialized() {
    if (!pushInitPromise) {
        pushInitPromise = initPushNotifications();
    }
    return pushInitPromise;
}

// ── Call this from a real tap/click handler — e.g.
//    <button onclick="enableLightWatchPush()">Enable notifications</button>
//    This is the ONLY safe place to call Notification.requestPermission()
//    for iOS: it must run synchronously in response to a user gesture,
//    with no significant delay/await beforehand.
// ───────────────────────────────────────────────────────────
async function enableLightWatchPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        window.lwToast?.('Push notifications are not supported on this browser or device.');
        return;
    }

    try {
        const permission = await Notification.requestPermission();
        updateEnablePushButtonsVisibility();
        if (permission !== 'granted') {
            console.log('Push permission denied.');
            window.lwToast?.('Notifications permission was not granted.');
            return;
        }

        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        const subscription = existing || await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });

        await sendSubscriptionToServer(subscription);
        await maybeShowPushWelcome(registration);
        console.log('Push notifications enabled.');
        window.lwToast?.('Notifications are on.');
        updateEnablePushButtonsVisibility();
    } catch (err) {
        console.error('Push subscription failed:', err);
        window.lwToast?.('Could not enable notifications — please try again.');
        updateEnablePushButtonsVisibility();
    }
}

window.enableLightWatchPush = enableLightWatchPush;

// ── Send subscription + user location to backend ─────────────
async function sendSubscriptionToServer(subscription) {
    const session = getSession(); // from auth.js
    const userId = session?.user?.id || localStorage.getItem('currentUserId');
    if (!userId) return;

    const location = window.currentChatLocation || null;

    try {
        await fetch(`${API_URL}/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, location, subscription })
        });
    } catch (err) {
        console.error('Could not save push subscription:', err);
    }
}

async function syncSubscriptionWithCurrentLocation() {
    if (!('serviceWorker' in navigator)) return;

    try {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        if (existing) {
            await sendSubscriptionToServer(existing);
        }
    } catch (err) {
        console.error('Could not sync existing subscription:', err);
    }
}

// Start immediately so mobile does not wait on location/profile calls.
// (Safe now — this no longer calls requestPermission() unprompted.)
ensurePushNotificationsInitialized();
updateEnablePushButtonsVisibility();

document.addEventListener('DOMContentLoaded', updateEnablePushButtonsVisibility);

// Prepare audio playback after first user interaction.
['click', 'touchstart', 'keydown'].forEach(evt => {
    window.addEventListener(evt, unlockForegroundAudio, { once: true, passive: true });
});

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event?.data?.type === 'LW_PUSH_RECEIVED') {
            triggerForegroundSignal(event.data.tone);
        }
    });
}

// Update backend with location as soon as profile data becomes ready.
window.addEventListener('locationReady', () => {
    syncSubscriptionWithCurrentLocation();
});

if (window.currentChatLocation) {
    syncSubscriptionWithCurrentLocation();
}

async function maybeShowPushWelcome(registration) {
    if (Notification.permission !== 'granted') return;
    if (localStorage.getItem(PUSH_WELCOME_KEY) === '1') return;

    try {
        await registration.showNotification('LightWatch notifications are on', {
            body: 'You will receive power updates for your area.',
            icon: APP_ICON,
            tag: 'lw-notifications-on',
            renotify: false,
            silent: false,
            vibrate: [120, 40, 120],
            data: { url: '/pages/home.html' }
        });
        localStorage.setItem(PUSH_WELCOME_KEY, '1');
    } catch (err) {
        console.error('Could not show welcome notification:', err);
    }
}

async function getCurrentPushEndpoint() {
    if (!('serviceWorker' in navigator)) return null;
    try {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        return existing?.endpoint || null;
    } catch {
        return null;
    }
}

async function setGlobalChatMutePreference(muteGlobalChat) {
    const session = typeof getSession === 'function' ? getSession() : null;
    const userId = session?.user?.id || localStorage.getItem('currentUserId');
    if (!userId) return { success: false, error: 'No signed-in user' };

    const endpoint = await getCurrentPushEndpoint();
    if (!endpoint) {
        return { success: false, error: 'No active push subscription on this device' };
    }

    try {
        const res = await fetch(`${API_URL}/subscribe/preferences`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, endpoint, muteGlobalChat: Boolean(muteGlobalChat) })
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            return { success: false, error: data.error || 'Could not save mute preference' };
        }
        const data = await res.json();
        return { success: true, muteGlobalChat: Boolean(data.muteGlobalChat) };
    } catch (err) {
        return { success: false, error: err.message || 'Could not save mute preference' };
    }
}

window.setGlobalChatMutePreference = setGlobalChatMutePreference;

async function setChatMentionsPreference(chatMentionsEnabled) {
    const session = typeof getSession === 'function' ? getSession() : null;
    const userId = session?.user?.id || localStorage.getItem('currentUserId');
    if (!userId) return { success: false, error: 'No signed-in user' };

    const endpoint = await getCurrentPushEndpoint();
    if (!endpoint) {
        return { success: false, error: 'No active push subscription on this device' };
    }

    try {
        const res = await fetch(`${API_URL}/subscribe/preferences`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, endpoint, chatMentionsEnabled: Boolean(chatMentionsEnabled) })
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            return { success: false, error: data.error || 'Could not save mentions preference' };
        }
        const data = await res.json();
        return { success: true, chatMentionsEnabled: Boolean(data.chatMentionsEnabled) };
    } catch (err) {
        return { success: false, error: err.message || 'Could not save mentions preference' };
    }
}

window.setChatMentionsPreference = setChatMentionsPreference;

// ── Secondary-location "notify me here" preference ───────────────────
// Stores which second location (if any) this device's push subscription
// should be alerted about when its status changes. Server-side, the
// /lightstatus report handler looks up subscriptions by
// secondaryLocationKey and pushes to them directly — this function just
// writes/clears that field on the current device's subscription.
// Pass a location string (e.g. "Bantama, Ashanti") to turn watching on,
// or null/empty to turn it off.
async function setSecondaryLocationNotifyPreference(secondaryLocation) {
    const session = typeof getSession === 'function' ? getSession() : null;
    const userId = session?.user?.id || localStorage.getItem('currentUserId');
    if (!userId) return { success: false, error: 'No signed-in user' };

    const endpoint = await getCurrentPushEndpoint();
    if (!endpoint) {
        return { success: false, error: 'No active push subscription on this device' };
    }

    try {
        const res = await fetch(`${API_URL}/subscribe/preferences`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, endpoint, secondaryLocation: secondaryLocation || null })
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            return { success: false, error: data.error || 'Could not save secondary location preference' };
        }
        const data = await res.json();
        return { success: true, secondaryLocationKey: data.secondaryLocationKey || null };
    } catch (err) {
        return { success: false, error: err.message || 'Could not save secondary location preference' };
    }
}

window.setSecondaryLocationNotifyPreference = setSecondaryLocationNotifyPreference;

// ── Fetch saved mute/mentions prefs for this device so the account
//    page can reflect the real server state instead of only localStorage.
// ───────────────────────────────────────────────────────────
async function getChatPushPreferences() {
    const session = typeof getSession === 'function' ? getSession() : null;
    const userId = session?.user?.id || localStorage.getItem('currentUserId');
    const endpoint = await getCurrentPushEndpoint();
    if (!userId || !endpoint) return null;

    try {
        const res = await fetch(`${API_URL}/subscribe/preferences?userId=${encodeURIComponent(userId)}&endpoint=${encodeURIComponent(endpoint)}`);
        if (!res.ok) return null;
        return await res.json(); // { muteGlobalChat, chatMentionsEnabled }
    } catch {
        return null;
    }
}

window.getChatPushPreferences = getChatPushPreferences;