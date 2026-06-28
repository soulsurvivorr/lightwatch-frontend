// ============================================================
//  NOTIFICATIONS.JS — Push subscription
//  Load on every protected page (home.html, account.html etc.)
//  Requires: auth.js and config.js loaded before this
// ============================================================

const VAPID_PUBLIC_KEY = 'BMEgZthyyCz4BER4r4Qbi7MuQrvG24AVNma_PEfFG47plgkaLumI25-UbfbIxShGExhUfw4k8GCas2JFuNh-ExI';

// Convert VAPID public key from base64 to Uint8Array (required by browser API)
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

// ── Main: register SW, request permission, subscribe ─────────
async function initPushNotifications() {
    // Check browser support
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.log('Push notifications not supported on this browser.');
        return;
    }

    try {
        // Register the service worker
        const registration = await navigator.serviceWorker.register('/service-worker.js');
        await navigator.serviceWorker.ready;

        // Check if already subscribed
        const existing = await registration.pushManager.getSubscription();
        if (existing) {
            // Already subscribed — make sure server has it
            await sendSubscriptionToServer(existing);
            return;
        }

        // Ask user for permission (browser shows its own prompt)
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            console.log('Push permission denied.');
            return;
        }

        // Subscribe to push
        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });

        await sendSubscriptionToServer(subscription);
        console.log('Push notifications enabled.');

    } catch (err) {
        console.error('Push subscription failed:', err);
    }
}

// ── Send subscription + user location to backend ─────────────
async function sendSubscriptionToServer(subscription) {
    const session = getSession(); // from auth.js
    const userId  = session?.user?.id || localStorage.getItem('currentUserId');
    if (!userId) return;

    // Get user's location from the page (set by profile.js)
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

// ── Run after profile.js has set window.currentChatLocation ──
// We wait for the locationReady event fired by profile.js
window.addEventListener('locationReady', () => {
    initPushNotifications();
});

// Fallback: if locationReady already fired before this script ran
if (window.currentChatLocation) {
    initPushNotifications();
}