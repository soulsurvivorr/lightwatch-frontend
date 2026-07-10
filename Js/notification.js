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

function updateEnablePushButtonsVisibility() {
    const shouldShow = Notification.permission !== 'granted';
    document.querySelectorAll('[data-enable-push-btn]').forEach((btn) => {
        btn.hidden = !shouldShow;
        btn.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
    });
}

function ensureAudioContext() {
    if (lwAudioCtx) return lwAudioCtx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    lwAudioCtx = new Ctx();
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

function triggerForegroundSignal() {
    unlockForegroundAudio();
    if (navigator.vibrate) {
        navigator.vibrate([90, 40, 90]);
    }
    playDewDropsTone();
}

function playDewDropsTone() {
    const ctx = ensureAudioContext();
    if (!ctx || (!lwAudioReady && ctx.state !== 'running')) return;

    const now = ctx.currentTime;
    const notes = [880, 1046, 1174];

    notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.value = freq;

        const start = now + (i * 0.12);
        const end = start + 0.16;

        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(start);
        osc.stop(end + 0.01);
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
            triggerForegroundSignal();
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
            sound: 'default',
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