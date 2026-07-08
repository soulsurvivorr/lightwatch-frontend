// ============================================================
//  NOTIFICATIONS.JS — Push subscription
//  Load on every protected page (home.html, account.html etc.)
//  Requires: auth.js and config.js loaded before this
// ============================================================

const VAPID_PUBLIC_KEY = 'BMEgZthyyCz4BER4r4Qbi7MuQrvG24AVNma_PEfFG47plgkaLumI25-UbfbIxShGExhUfw4k8GCas2JFuNh-ExI';
const APP_ICON_PATH = '/images/dev-logo.png';
const APP_ICON = new URL(APP_ICON_PATH, window.location.origin).href;
const BADGE_ICON = new URL('/icons/notify-badge.svg', window.location.origin).href;
const PUSH_WELCOME_KEY = 'lw_push_welcome_shown';
let pushInitPromise = null;

// Convert VAPID public key from base64 to Uint8Array (required by browser API)
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

// ── Main: register SW, request permission, subscribe ─────────
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

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            console.log('Push permission denied.');
            return;
        }

        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });

        await sendSubscriptionToServer(subscription);
        await maybeShowPushWelcome(registration);
        console.log('Push notifications enabled.');

    } catch (err) {
        console.error('Push subscription failed:', err);
    }
}

function ensurePushNotificationsInitialized() {
    if (!pushInitPromise) {
        pushInitPromise = initPushNotifications();
    }
    return pushInitPromise;
}

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
ensurePushNotificationsInitialized();

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
            badge: BADGE_ICON,
            tag: 'lw-notifications-on',
            renotify: false,
            data: { url: '/pages/home.html' }
        });
        localStorage.setItem(PUSH_WELCOME_KEY, '1');
    } catch (err) {
        console.error('Could not show welcome notification:', err);
    }
}