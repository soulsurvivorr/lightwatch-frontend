// ============================================================
//  SERVICES/PUSH.JS
//  Push subscription, permission flow, native FCM bridging, and the
//  in-app tone playback for foreground pushes. Renamed from
//  notification.js to services/push.js per the requested structure
//  (the toast UI piece of the old "notification.js" name now lives
//  in components/notification.js instead — see that file).
//
//  Unchanged behavior-wise except for one thing: notification click-
//  through used to do a real `window.location.href = url` to a page
//  like /pages/home.html?chatId=... — that page doesn't exist as a
//  separate document anymore. navigateFromPushUrl() below translates
//  those legacy paths into an in-app route instead.
//
//  IMPORTANT — needs a matching update you'll need to make yourself:
//  service-worker.js (not part of the files given to me, so I
//  couldn't update it) almost certainly has its own notificationclick
//  handler that also does clients.openWindow('/pages/home.html?...')
//  for the case where the app was fully closed, not just backgrounded.
//  That needs the same translation — either have it open
//  '/home?chatId=...' directly (the router reads that on cold boot),
//  or open '/' and let this file's boot-time check pick up the query
//  string once the app finishes loading.
// ============================================================

function navigateFromPushUrl(url) {
    try {
        const parsed = new URL(url, window.location.origin);
        const legacyPathToView = {
            '/pages/home.html': 'home',
            '/pages/location.html': 'location',
            '/pages/reports.html': 'reports',
            '/pages/account.html': 'account',
            '/pages/verification.html': 'verification',
            '/pages/signup.html': 'signup',
            '/index.html': 'login',
            '/': 'login',
            '/home': 'home',
            '/chat': 'chat',
            '/location': 'location',
            '/areas': 'location',
            '/reports': 'reports',
            '/account': 'account'
        };
        const view = legacyPathToView[parsed.pathname] || 'home';
        window.LWRouter?.navigate(view, { search: parsed.search });
    } catch {
        window.location.href = url;
    }
}

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
    const isEnabled = isNativeAndroidApp() ? nativePushGranted : Notification.permission === 'granted';
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

    window.dispatchEvent(new CustomEvent('lw:push-state-changed', { detail: { enabled: isEnabled } }));
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
//   📰 News:      short, informative chime      "ting … ding"
//
// playDewDropsTone() is kept as the fallback for any push that
// arrives without a recognized `tone` (e.g. an older cached
// service worker, or an admin test push that didn't set one).
function playToneForType(tone) {
    switch (tone) {
        case 'power-on':  playPowerOnTone();  break;
        case 'power-off': playPowerOffTone(); break;
        case 'chat':      playChatPlinkTone(); break;
        case 'news':      playNewsTone(); break;
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

// ⚡ Power ON — bright ascending 3-note major arpeggio (C5→E5→G5).
// Same notes as lw_power_on.wav (see gen_sounds2.py) so foreground and
// backgrounded/killed-app notifications sound like the same event.
function playPowerOnTone() {
    const ctx = ensureAudioContext();
    if (!canPlayTone(ctx)) return;
    const now = ctx.currentTime;

    playNote(ctx, { freq: 523.25, start: now, duration: 0.20, type: 'sine', peakGain: 0.30, attack: 0.006 });
    playNote(ctx, { freq: 659.25, start: now + 0.11, duration: 0.20, type: 'sine', peakGain: 0.30, attack: 0.006 });
    playNote(ctx, { freq: 783.99, start: now + 0.22, duration: 0.32, type: 'sine', peakGain: 0.34, attack: 0.006 });
    playNote(ctx, { freq: 1567.98, start: now + 0.22, duration: 0.22, type: 'sine', peakGain: 0.10, attack: 0.006 }); // octave sparkle
}

// 🌑 Power OFF — descending 2-note resolution (G4→C4), darker timbre.
// Same notes as lw_power_off.wav.
function playPowerOffTone() {
    const ctx = ensureAudioContext();
    if (!canPlayTone(ctx)) return;
    const now = ctx.currentTime;

    playNote(ctx, { freq: 392.00, start: now, duration: 0.22, type: 'triangle', peakGain: 0.30, attack: 0.008 });
    playNote(ctx, { freq: 261.63, start: now + 0.16, duration: 0.42, type: 'triangle', peakGain: 0.34, attack: 0.010 });
}

// 💬 Chat — single bright "pop", short and unobtrusive for a busy chat.
// Same note as lw_chat.wav.
function playChatPlinkTone() {
    const ctx = ensureAudioContext();
    if (!canPlayTone(ctx)) return;
    const now = ctx.currentTime;

    playNote(ctx, { freq: 987.77, start: now, duration: 0.16, type: 'sine', peakGain: 0.30, attack: 0.004 });
    playNote(ctx, { freq: 1975.5, start: now, duration: 0.10, type: 'sine', peakGain: 0.09, attack: 0.004 }); // glassy overtone
}

// 📰 News — a gentle two-step chime that feels informative rather than chatty.
function playNewsTone() {
    const ctx = ensureAudioContext();
    if (!canPlayTone(ctx)) return;
    const now = ctx.currentTime;

    playNote(ctx, { freq: 659.25, start: now, duration: 0.18, type: 'sine', peakGain: 0.24, attack: 0.006 });
    playNote(ctx, { freq: 783.99, start: now + 0.12, duration: 0.22, type: 'sine', peakGain: 0.26, attack: 0.006 });
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

// ── Native Android push (FCM) ───────────────────────────────────
//    Android System WebView has no PushManager — the web-push path
//    below this block cannot work inside the Capacitor WebView on
//    ANY Android version, old or new (that's a WebView limitation,
//    not something POST_NOTIFICATIONS or targetSdk fixes). Native
//    Android instead registers for a real FCM token through the
//    @capacitor/push-notifications plugin, which talks to the OS
//    directly and bypasses the WebView entirely — this is the same
//    mechanism every other native Android app uses.
//
//    Accessed via window.Capacitor.Plugins.PushNotifications, same
//    bridge pattern already used elsewhere in this app (App,
//    SplashScreen) — no bundler/import needed, the native plugin
//    registers itself once it's present in the Android project.
let nativePushToken = null;
let nativePushGranted = false;
let nativeListenersBound = false;

function getPushNotificationsPlugin() {
    return window.Capacitor?.Plugins?.PushNotifications || null;
}

function bindNativePushListeners() {
    const plugin = getPushNotificationsPlugin();
    if (!plugin || nativeListenersBound) return;
    nativeListenersBound = true;

    plugin.addListener('registration', (token) => {
        console.log("Registration event fired");
        console.log("Token:", token?.value);

        nativePushToken = token?.value || null;

        if (nativePushToken) {
            console.log("Calling sendFcmTokenToServer()");
            sendFcmTokenToServer(nativePushToken);
        } else {
            console.log("No token received.");
        }
    });

    plugin.addListener('registrationError', (err) => {
        console.error('FCM registration failed:', err);
        window.lwToast?.('Could not enable notifications — please try again.');
    });

    // App was in the foreground when the push arrived — the OS won't
    // draw a system notification for that case on its own, so this is
    // where the in-app sound (same one web push uses) plays instead.
    plugin.addListener('pushNotificationReceived', (notification) => {
        triggerForegroundSignal(notification?.data?.tone);
    });

    // User tapped a notification while the app was backgrounded —
    // mirrors service-worker.js's notificationclick handler.
    plugin.addListener('pushNotificationActionPerformed', (action) => {
        const url = action?.notification?.data?.url;
        if (url) {
            navigateFromPushUrl(url);
        }
    });
}

async function sendFcmTokenToServer(fcmToken) {
    const session = getSession(); // from auth.js
    const userId = session?.user?.id || localStorage.getItem('currentUserId');
    if (!userId) return;

    const location = window.currentChatLocation || null;
    if (!location) {
        console.log("No location yet — bailing, waiting for locationReady");
        return; // locationReady sync below will retry
    }

    try {
        console.log("User ID:", userId);
        console.log("Location:", location);
        console.log("FCM Token:", fcmToken);

        await fetch(`${API_URL}/subscribe/fcm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, location, fcmToken })
        });
    } catch (err) {
        console.error('Could not save FCM token:', err);
    }
}

// Silent resubscribe path for native — mirrors initPushNotifications()'s
// "only auto-resubscribe if already granted" logic below, but there's
// no iOS-gesture concern on Android, so this also covers first-run
// (see maybePromptFirstLaunchPermission, which calls enableLightWatchPush
// -> this same native branch -> requestPermissions()).
async function initNativePushNotifications() {
    const plugin = getPushNotificationsPlugin();
    if (!plugin) return;

    bindNativePushListeners();

    try {
        const status = await plugin.checkPermissions();
        nativePushGranted = status?.receive === 'granted';
        updateEnablePushButtonsVisibility();
        if (nativePushGranted) {
            await plugin.register();
        }
    } catch (err) {
        console.error('Native push init failed:', err);
    }
}

async function enableNativeLightWatchPush() {
    const plugin = getPushNotificationsPlugin();
    if (!plugin) {
        window.lwToast?.('Push notifications are not available on this device.');
        return;
    }

    bindNativePushListeners();

    try {
        const status = await plugin.requestPermissions();
        nativePushGranted = status?.receive === 'granted';
        updateEnablePushButtonsVisibility();

        if (!nativePushGranted) {
            console.log('Native push permission denied.');
            window.lwToast?.('Notifications permission was not granted.');
            return;
        }

        await plugin.register();
        // The 'registration' listener (bound above) picks up the token
        // and posts it to the server the moment it arrives — nothing
        // further to do here.
        console.log('Push notifications enabled (native).');
        window.lwToast?.('Notifications are on.');
    } catch (err) {
        console.error('Native push registration failed:', err);
        window.lwToast?.('Could not enable notifications — please try again.');
        updateEnablePushButtonsVisibility();
    }
}

// ── First-launch native prompt ─────────────────────────────────
//    The comment below on initPushNotifications() explains why this
//    file otherwise never calls Notification.requestPermission()
//    without a tap: on iOS Safari, calling it without a direct user
//    gesture is silently ignored and never shows a prompt. That
//    restriction is an iOS/Safari thing, not an Android-native-app
//    thing — in this Capacitor Android build there's no such gesture
//    requirement, and the ask was for the OS permission dialog to
//    appear right after install, not buried behind a settings tap.
//
//    Gated three ways so this can never misfire:
//      1. Only runs on the native Android build (Capacitor), never in
//         a plain mobile/desktop browser tab — those keep the
//         tap-to-enable flow untouched.
//      2. Only runs once permission is still 'default' (never re-asks
//         after a grant OR a denial — Android has no way to re-prompt
//         after a denial anyway; the user would have to flip it in
//         system Settings, same as any other Android app).
//      3. Only runs once ever per install, via a localStorage flag —
//         a page refresh or revisiting home.html later in the same
//         install won't re-trigger it.
const FIRST_LAUNCH_PROMPT_KEY = 'lw_notif_first_launch_prompted';

function isNativeAndroidApp() {
    return Boolean(
        window.Capacitor &&
        typeof window.Capacitor.isNativePlatform === 'function' &&
        window.Capacitor.isNativePlatform() &&
        typeof window.Capacitor.getPlatform === 'function' &&
        window.Capacitor.getPlatform() === 'android'
    );
}

async function maybePromptFirstLaunchPermission() {
    if (!isNativeAndroidApp()) return;

    const plugin = getPushNotificationsPlugin();
    if (!plugin) return;

    try {
        const status = await plugin.checkPermissions();
        // 'prompt' (never asked) or 'prompt-with-rationale' — anything
        // other than an already-settled granted/denied state. Android
        // has no way to re-prompt after a real denial, same as any
        // other app; the user would have to flip it in system Settings.
        if (status?.receive !== 'prompt' && status?.receive !== 'prompt-with-rationale') return;
    } catch {
        return;
    }

    try {
        if (localStorage.getItem(FIRST_LAUNCH_PROMPT_KEY) === '1') return;
        localStorage.setItem(FIRST_LAUNCH_PROMPT_KEY, '1');
    } catch {
        // If storage is blocked we can't reliably guard against asking
        // again every launch — safer to skip the auto-prompt entirely
        // than to nag on every open.
        return;
    }

    // Small delay so this doesn't compete with the boot loader / splash
    // hide for a frame — same reasoning as onboarding.js's timing. Kept
    // short: this delay is UI pacing only, not the reason notifications
    // take a while to start working after install (see note below).
    setTimeout(() => {
        enableLightWatchPush();
    }, 350);
}

// ── Auto-init on page load: registers the SW and silently
//    resubscribes IF the user already granted permission in a
//    past session. Does NOT call Notification.requestPermission()
//    here — see enableLightWatchPush() below for why.
// ───────────────────────────────────────────────────────────
async function initPushNotifications() {
    if (isNativeAndroidApp()) {
        return initNativePushNotifications();
    }

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
    if (isNativeAndroidApp()) {
        return enableNativeLightWatchPush();
    }

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

// ── Simple read-only check other modules can use (e.g. nav badges)
//    without duplicating the native-vs-web branch themselves. ──
function isLightWatchPushEnabled() {
    if (isNativeAndroidApp()) return nativePushGranted;
    if (typeof Notification === 'undefined') return false;
    return Notification.permission === 'granted';
}

window.isLightWatchPushEnabled = isLightWatchPushEnabled;

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
    if (isNativeAndroidApp()) {
        if (nativePushToken) {
            await sendFcmTokenToServer(nativePushToken);
        }
        return;
    }

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
// (Safe now — this no longer calls requestPermission() unprompted,
// except for the guarded native-Android first-launch case below.)
ensurePushNotificationsInitialized();
updateEnablePushButtonsVisibility();
maybePromptFirstLaunchPermission();

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
            data: { url: '/home' }
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