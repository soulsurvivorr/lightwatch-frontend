// =========================================================
// chat.js — LightWatch community chat
// Live polling every 5s so all users see new messages.
// Reads API_URL from the shared config js file.
// =========================================================

const chatThread = document.getElementById('chatThread');
const chatForm   = document.getElementById('chatForm');
const chatInput  = document.getElementById('chatInput');
const chatHandleDisplay = document.getElementById('chatHandle');

const HANDLE_WORDS = [
    "fern","river","glow","cedar","amber","quartz",
    "willow","ember","harbor","maple","drift","stone"
];

function getOrCreateHandle() {
    const existing = localStorage.getItem("chatHandle");
    if (existing) return existing;
    const word   = HANDLE_WORDS[Math.floor(Math.random() * HANDLE_WORDS.length)];
    const number = Math.floor(Math.random() * 900) + 100;
    const handle = `anon-${word}-${number}`;
    localStorage.setItem("chatHandle", handle);
    return handle;
}

let myHandle = getOrCreateHandle();
if (chatHandleDisplay) chatHandleDisplay.textContent = myHandle;

async function loadUserChatHandle() {
    const userId = getCurrentUserId();
    if (!userId) return;
    try {
        const res = await fetch(`${API_URL}/user/${encodeURIComponent(userId)}`);
        if (!res.ok) return;
        const user = await res.json();
        if (user.chatHandle) {
            myHandle = user.chatHandle;
            localStorage.setItem('chatHandle', myHandle);
            if (chatHandleDisplay) chatHandleDisplay.textContent = myHandle;
        }
    } catch(e) {}
}
loadUserChatHandle();

// -------------------------------------------------------
// HELPERS
// -------------------------------------------------------
function getCurrentUserId() {
    const session = typeof getSession === 'function' ? getSession() : null;
    if (session?.user?.id) return session.user.id;
    return localStorage.getItem("currentUserId") || sessionStorage.getItem("currentUserId");
}

function getCurrentChatLocation() {
    // profile.js sets this global when the page loads
    if (window.currentChatLocation) return window.currentChatLocation;
    const raw = localStorage.getItem("currentUserData") || localStorage.getItem("signupUser");
    if (!raw) return null;
    try {
        const user = JSON.parse(raw);
        return user.city ? `${user.city}, ${user.region || ""}`.trim() : user.region || null;
    } catch { return null; }
}

function resolveUserId(chat) {
    // Server returns userId as a plain string (we fixed the populate issue).
    // toString() handles any edge cases where it might still be an ObjectId.
    if (!chat.userId) return null;
    if (typeof chat.userId === 'object') return String(chat.userId._id || chat.userId);
    return String(chat.userId);
}

function formatRelativeTime(iso) {
    const diff = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (diff < 60)   return diff < 5 ? "Just now" : `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

function refreshChatTimestamps() {
    chatThread?.querySelectorAll('.chat-message').forEach(msg => {
        const el = msg.querySelector('.chat-message__time');
        if (el && msg.dataset.createdAt) el.textContent = formatRelativeTime(msg.dataset.createdAt);
    });
}
setInterval(refreshChatTimestamps, 30000);

// -------------------------------------------------------
// BUILD A MESSAGE ELEMENT
// -------------------------------------------------------
function buildMessageEl(chat, isOwn) {
    const el = document.createElement('div');
    el.className = isOwn ? "chat-message chat-message--own" : "chat-message";
    el.dataset.chatId   = chat._id || chat.id || "";
    el.dataset.createdAt = chat.createdAt;

    const author = document.createElement('span');
    author.className   = "chat-message__author";
    author.textContent = chat.handle;

    const body = document.createElement('p');
    body.className   = "chat-message__text";
    body.textContent = chat.text;

    const time = document.createElement('span');
    time.className   = "chat-message__time";
    time.textContent = formatRelativeTime(chat.createdAt);

    el.appendChild(author);
    el.appendChild(body);
    el.appendChild(time);
    return el;
}

// -------------------------------------------------------
// THREAD STATE
// -------------------------------------------------------
// Only real server IDs go in here — never temp IDs.
// This is the single source of truth for deduplication.
const knownIds  = new Set();
let pollInterval  = null;
let chatLocation  = null; // set once on load, reused by poll
let isNearBottom  = true;

chatThread?.addEventListener('scroll', () => {
    if (!chatThread) return;
    isNearBottom = (chatThread.scrollHeight - chatThread.scrollTop - chatThread.clientHeight) < 80;
});

function addToThread(chat, isOwn, scrollDown) {
    const el = buildMessageEl(chat, isOwn);
    chatThread.appendChild(el);
    if (scrollDown || isNearBottom) chatThread.scrollTop = chatThread.scrollHeight;
}

// -------------------------------------------------------
// INITIAL LOAD
// -------------------------------------------------------
function loadChatHistory() {
    const loc = window.currentChatLocation || getCurrentChatLocation();
    if (!loc || !chatThread) return;

    chatLocation = loc; // save for poll to reuse — same string, guaranteed consistent
    chatThread.innerHTML = "";
    knownIds.clear();

    fetch(`${API_URL}/chats?location=${encodeURIComponent(loc)}`)
        .then(r => r.json())
        .then(chats => {
            const myId = getCurrentUserId();
            // Reverse: API returns newest-first, we want oldest-first
            ;[...chats].reverse().forEach(chat => {
                const id = chat._id || chat.id;
                if (id) knownIds.add(id);
                addToThread(chat, resolveUserId(chat) === myId, false);
            });
            chatThread.scrollTop = chatThread.scrollHeight;
            startPolling();
        })
        .catch(err => console.error("Could not load chat history:", err));
}

// -------------------------------------------------------
// POLLING — every 5 seconds, fetch all chats for this
// location and display any IDs we haven't seen yet.
// Uses chatLocation (set at load) so the query string is
// identical between the initial load and all polls.
// -------------------------------------------------------
function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    if (!chatLocation) return;

    pollInterval = setInterval(async () => {
        try {
            const res = await fetch(`${API_URL}/chats?location=${encodeURIComponent(chatLocation)}`);
            if (!res.ok) return;
            const chats = await res.json();
            const myId  = getCurrentUserId();

            ;[...chats].reverse().forEach(chat => {
                const id = chat._id || chat.id;
                if (!id || knownIds.has(id)) return; // skip already-shown messages
                knownIds.add(id);
                addToThread(chat, resolveUserId(chat) === myId, false);
            });
        } catch(e) {
            // silent — retries next tick
        }
    }, 5000);
}

// Pause poll when tab is hidden (saves mobile data & battery)
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        clearInterval(pollInterval);
    } else if (chatLocation) {
        startPolling();
    }
});

// -------------------------------------------------------
// ENTRY POINTS: locationReady is fired by profile.js
// -------------------------------------------------------
window.addEventListener('locationReady', loadChatHistory);
if (window.currentChatLocation) loadChatHistory();

// -------------------------------------------------------
// MOBILE PANEL
// -------------------------------------------------------
document.getElementById('mobileChatToggle')?.addEventListener('click', () => {
    document.querySelector('.chat-card')?.classList.add('chat-card--mobile-open');
    document.body.classList.add('mobile-chat-open');
});
document.getElementById('mobileChatClose')?.addEventListener('click', () => {
    document.querySelector('.chat-card')?.classList.remove('chat-card--mobile-open');
    document.body.classList.remove('mobile-chat-open');
});

// Safety net: the mobile chat popup + its scroll-lock are only meant to
// exist below the 720px breakpoint. If the popup gets opened and the
// window is then resized past that point (dev tools, laptop window
// resizing, etc.), force both off immediately rather than trusting CSS
// alone to sort it out.
function closeMobileChatPopup() {
    document.querySelector('.chat-card')?.classList.remove('chat-card--mobile-open');
    document.body.classList.remove('mobile-chat-open');
}
const desktopBreakpoint = window.matchMedia('(min-width: 721px)');
desktopBreakpoint.addEventListener('change', (e) => {
    if (e.matches) closeMobileChatPopup();
});
if (desktopBreakpoint.matches) closeMobileChatPopup();

// -------------------------------------------------------
// SEND A MESSAGE
// No optimistic temp IDs. We POST to the server, get back
// the real _id, add it to knownIds, then display it.
// This way the poll can never show it again as "new".
// -------------------------------------------------------
chatForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const text = chatInput.value.trim();
    if (!text) return;

    const myId = getCurrentUserId();
    const loc  = chatLocation || getCurrentChatLocation();
    if (!myId || !loc) return;

    // Clear input immediately so it feels fast
    chatInput.value = "";
    chatInput.focus();

    try {
        const res = await fetch(`${API_URL}/chats`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: myId, handle: myHandle, text, location: loc })
        });

        if (!res.ok) {
            // Put text back so user can retry
            chatInput.value = text;
            return;
        }

        const saved = await res.json();
        const realId = saved._id || saved.id;

        if (realId && !knownIds.has(realId)) {
            knownIds.add(realId);           // tell poll: skip this one
            addToThread(saved, true, true); // show it now, scroll to it
        }
    } catch(err) {
        console.error("Failed to send:", err);
        chatInput.value = text; // restore on failure
    }
});