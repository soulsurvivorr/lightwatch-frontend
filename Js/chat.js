// =========================================================
// chat.js — LightWatch community chat
// Live polling every 5s so all users see new messages.
// Reads API_URL from the shared config js file.
// =========================================================

const chatThread = document.getElementById('chatThread');
const chatScrollBottomBtn = document.getElementById('chatScrollBottomBtn');
const chatForm   = document.getElementById('chatForm');
const chatInput  = document.getElementById('chatInput');
const chatHandleDisplay = document.getElementById('chatHandle');
const chatReplyPreview = document.getElementById('chatReplyPreview');
const chatReplyHandle = document.getElementById('chatReplyHandle');
const chatReplyText = document.getElementById('chatReplyText');
const chatReplyCancel = document.getElementById('chatReplyCancel');
const chatScopeLocalBtn = document.getElementById('chatScopeLocalBtn');
const chatScopeGlobalBtn = document.getElementById('chatScopeGlobalBtn');

const CHAT_SCOPE_KEY = 'lw_chat_scope_pref';
const CHAT_SCOPE_LOCAL = 'local';
const CHAT_SCOPE_GLOBAL = 'global';

const initialChatParams = new URLSearchParams(window.location.search);
const targetChatIdFromNotification = initialChatParams.get('chatId') || '';
const targetChatScope = initialChatParams.get('chatScope') === CHAT_SCOPE_GLOBAL ? CHAT_SCOPE_GLOBAL : CHAT_SCOPE_LOCAL;
const targetChatLocation = (initialChatParams.get('chatLocation') || '').trim();

let pendingFocusChatId = targetChatIdFromNotification;

window.__lwChatReady = false;

function markChatReady() {
    if (window.__lwChatReady) return;
    window.__lwChatReady = true;
    window.dispatchEvent(new CustomEvent('lw-chat-ready'));
}

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

let chatScope = (() => {
    if (targetChatIdFromNotification) {
        return targetChatScope;
    }
    const saved = localStorage.getItem(CHAT_SCOPE_KEY);
    return saved === CHAT_SCOPE_GLOBAL ? CHAT_SCOPE_GLOBAL : CHAT_SCOPE_LOCAL;
})();

if (targetChatIdFromNotification) {
    localStorage.setItem(CHAT_SCOPE_KEY, chatScope);
}

function getLocationNameOnly() {
    const loc = window.currentChatLocation || getCurrentChatLocation();
    if (!loc) return 'your location';
    return String(loc).split(',')[0].trim() || 'your location';
}

function updateScopeButtons() {
    const isLocal = chatScope === CHAT_SCOPE_LOCAL;
    if (chatScopeLocalBtn) {
        chatScopeLocalBtn.classList.toggle('is-active', isLocal);
        chatScopeLocalBtn.setAttribute('aria-selected', isLocal ? 'true' : 'false');
        chatScopeLocalBtn.textContent = `Only ${getLocationNameOnly()}`;
    }
    if (chatScopeGlobalBtn) {
        chatScopeGlobalBtn.classList.toggle('is-active', !isLocal);
        chatScopeGlobalBtn.setAttribute('aria-selected', !isLocal ? 'true' : 'false');
    }
}

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

    const reply = chat.replyTo;
    if (reply && (reply.handle || reply.text)) {
        const replyEl = document.createElement('div');
        replyEl.className = 'chat-message__reply';

        const replyHandleEl = document.createElement('span');
        replyHandleEl.className = 'chat-message__reply-handle';
        replyHandleEl.textContent = `Reply to ${reply.handle || 'someone'}`;

        const replyTextEl = document.createElement('span');
        replyTextEl.className = 'chat-message__reply-text';
        replyTextEl.textContent = (reply.text || '').slice(0, 120);

        replyEl.appendChild(replyHandleEl);
        replyEl.appendChild(replyTextEl);
        el.appendChild(replyEl);
    }

    const time = document.createElement('span');
    time.className   = "chat-message__time";
    time.textContent = formatRelativeTime(chat.createdAt);

    const actions = document.createElement('div');
    actions.className = 'chat-message__actions';
    const replyBtn = document.createElement('button');
    replyBtn.type = 'button';
    replyBtn.className = 'chat-message__reply-btn';
    replyBtn.textContent = 'Reply';
    replyBtn.addEventListener('click', () => {
        replyTarget = {
            chatId: chat._id || chat.id || '',
            handle: chat.handle || 'someone',
            text: chat.text || ''
        };
        if (chatReplyHandle) chatReplyHandle.textContent = replyTarget.handle;
        if (chatReplyText) chatReplyText.textContent = replyTarget.text;
        if (chatReplyPreview) chatReplyPreview.hidden = false;
        chatInput?.focus();
    });
    actions.appendChild(replyBtn);

    el.appendChild(author);
    el.appendChild(body);
    el.appendChild(time);
    el.appendChild(actions);
    return el;
}

chatReplyCancel?.addEventListener('click', () => {
    replyTarget = null;
    if (chatReplyPreview) chatReplyPreview.hidden = true;
});

// -------------------------------------------------------
// THREAD STATE
// -------------------------------------------------------
// Only real server IDs go in here — never temp IDs.
// This is the single source of truth for deduplication.
const knownIds  = new Set();
let pollInterval  = null;
let chatLocation  = null; // set once on load, reused by poll
let isNearBottom  = true;
let replyTarget = null;

function updateChatPlaceholder() {
    if (!chatInput) return;
    chatInput.placeholder = chatScope === CHAT_SCOPE_GLOBAL
        ? 'Message everyone in LightWatch...'
        : 'Share an update about this location...';
}

function focusTargetMessageIfPresent() {
    if (!pendingFocusChatId || !chatThread) return;

    // If the skeleton is still covering the real page, acting now just
    // moves/opens elements nobody can see yet, and skips straight to the
    // "already open" state with no transition once the skeleton clears.
    // Wait for profile.js to actually reveal the page first.
    const stillBehindSkeleton = document.body?.classList.contains('page-data-loading')
        || document.body?.classList.contains('app-loading');
    if (stillBehindSkeleton) {
        window.addEventListener('lw-page-revealed', focusTargetMessageIfPresent, { once: true });
        return;
    }

    const target = [...chatThread.querySelectorAll('.chat-message')]
        .find(el => el.dataset.chatId === pendingFocusChatId);
    if (!target) return;

    if (window.matchMedia('(max-width: 720px)').matches) {
        setMobileChatOpen(true);
    }

    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.add('chat-message--highlight');
    setTimeout(() => target.classList.remove('chat-message--highlight'), 2600);
    pendingFocusChatId = '';
}

function buildChatsUrl() {
    if (chatScope === CHAT_SCOPE_GLOBAL) {
        return `${API_URL}/chats?scope=global`;
    }
    const loc = (targetChatLocation && pendingFocusChatId)
        ? targetChatLocation
        : (window.currentChatLocation || getCurrentChatLocation());
    if (!loc) return null;
    return `${API_URL}/chats?scope=local&location=${encodeURIComponent(loc)}`;
}

updateChatPlaceholder();
updateScopeButtons();

chatThread?.addEventListener('scroll', () => {
    if (!chatThread) return;
    isNearBottom = (chatThread.scrollHeight - chatThread.scrollTop - chatThread.clientHeight) < 80;
    chatScrollBottomBtn?.classList.toggle('is-visible', !isNearBottom);
});

function scrollChatToBottom(smooth) {
    if (!chatThread) return;
    chatThread.scrollTo({ top: chatThread.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    isNearBottom = true;
    chatScrollBottomBtn?.classList.remove('is-visible');
}

chatScrollBottomBtn?.addEventListener('click', () => scrollChatToBottom(true));

function addToThread(chat, isOwn, scrollDown) {
    const el = buildMessageEl(chat, isOwn);
    chatThread.appendChild(el);
    if (scrollDown || isNearBottom) {
        chatThread.scrollTop = chatThread.scrollHeight;
    } else {
        // A message arrived while the user has scrolled up to read
        // history — surface the jump-to-bottom button instead of
        // silently moving their view.
        chatScrollBottomBtn?.classList.add('is-visible');
    }
}

// -------------------------------------------------------
// INITIAL LOAD
// -------------------------------------------------------
function loadChatHistory() {
    const loc = window.currentChatLocation || getCurrentChatLocation();
    if (!chatThread) {
        markChatReady();
        return;
    }

    if (chatScope === CHAT_SCOPE_LOCAL && !loc) {
        markChatReady();
        return;
    }

    chatLocation = loc; // kept for local-scope send calls
    chatThread.innerHTML = "";
    knownIds.clear();

    const url = buildChatsUrl();
    if (!url) {
        markChatReady();
        return;
    }

    fetch(url)
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
            focusTargetMessageIfPresent();
            markChatReady();
            startPolling();
        })
        .catch(err => {
            console.error("Could not load chat history:", err);
            markChatReady();
        });
}

// -------------------------------------------------------
// POLLING — every 5 seconds, fetch all chats for this
// location and display any IDs we haven't seen yet.
// Uses chatLocation (set at load) so the query string is
// identical between the initial load and all polls.
// -------------------------------------------------------
function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    if (chatScope === CHAT_SCOPE_LOCAL && !chatLocation) return;

    pollInterval = setInterval(async () => {
        try {
            const url = buildChatsUrl();
            if (!url) return;
            const res = await fetch(url);
            if (!res.ok) return;
            const chats = await res.json();
            const myId  = getCurrentUserId();

            ;[...chats].reverse().forEach(chat => {
                const id = chat._id || chat.id;
                if (!id || knownIds.has(id)) return; // skip already-shown messages
                knownIds.add(id);
                addToThread(chat, resolveUserId(chat) === myId, false);
                focusTargetMessageIfPresent();
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
    } else if (chatScope === CHAT_SCOPE_GLOBAL || chatLocation) {
        startPolling();
    }
});

// -------------------------------------------------------
// ENTRY POINTS: locationReady is fired by profile.js
// -------------------------------------------------------
window.addEventListener('locationReady', loadChatHistory);
if (window.currentChatLocation) loadChatHistory();

window.addEventListener('locationReady', () => {
    updateScopeButtons();
});

function setChatScope(nextScope) {
    const picked = nextScope === CHAT_SCOPE_GLOBAL ? CHAT_SCOPE_GLOBAL : CHAT_SCOPE_LOCAL;
    chatScope = picked;
    localStorage.setItem(CHAT_SCOPE_KEY, chatScope);
    updateChatPlaceholder();
    updateScopeButtons();
    replyTarget = null;
    if (chatReplyPreview) chatReplyPreview.hidden = true;
    loadChatHistory();
}

chatScopeLocalBtn?.addEventListener('click', () => setChatScope(CHAT_SCOPE_LOCAL));
chatScopeGlobalBtn?.addEventListener('click', () => setChatScope(CHAT_SCOPE_GLOBAL));

// -------------------------------------------------------
// MOBILE PANEL
// -------------------------------------------------------
function getVisibleChatCard() {
    return document.querySelector('#realPageContent .chat-card') || document.querySelector('.chat-card');
}

let lockedScrollY = 0;

function setMobileScrollLock(locked) {
    const onMobile = window.matchMedia('(max-width: 720px)').matches;
    if (!onMobile) locked = false;

    if (locked) {
        lockedScrollY = window.scrollY || window.pageYOffset || 0;
        document.documentElement.classList.add('mobile-chat-open');
        document.body.classList.add('mobile-chat-open');
        document.body.style.position = 'fixed';
        document.body.style.top = `-${lockedScrollY}px`;
        document.body.style.left = '0';
        document.body.style.right = '0';
        document.body.style.width = '100%';
    } else {
        document.documentElement.classList.remove('mobile-chat-open');
        document.body.classList.remove('mobile-chat-open');
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.left = '';
        document.body.style.right = '';
        document.body.style.width = '';
        window.scrollTo(0, lockedScrollY);
    }
}

function setMobileChatOpen(open) {
    const card = getVisibleChatCard();
    if (!card) return;
    card.classList.toggle('chat-card--mobile-open', open);
    setMobileScrollLock(open);

    const toggle = document.getElementById('mobileChatToggle');
    if (toggle) {
        const icon = toggle.querySelector('.mobile-chat-toggle__icon');
        const label = toggle.querySelector('.mobile-chat-toggle__label');
        if (icon) icon.textContent = open ? '✕' : '💬';
        if (label) label.textContent = open ? 'Close' : 'Chat';
        toggle.setAttribute('aria-label', open ? 'Close chat' : 'Open chat');
    }
}

document.getElementById('mobileChatToggle')?.addEventListener('click', () => {
    const card = getVisibleChatCard();
    if (!card) return;
    const isOpen = card.classList.contains('chat-card--mobile-open');
    setMobileChatOpen(!isOpen);
});
document.getElementById('mobileChatClose')?.addEventListener('click', () => {
    setMobileChatOpen(false);
});

// Safety net: the mobile chat popup + its scroll-lock are only meant to
// exist below the 720px breakpoint. If the popup gets opened and the
// window is then resized past that point (dev tools, laptop window
// resizing, etc.), force both off immediately rather than trusting CSS
// alone to sort it out.
function closeMobileChatPopup() {
    setMobileChatOpen(false);
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
    if (!myId) return;
    if (chatScope === CHAT_SCOPE_LOCAL && !loc) return;

    // Clear input immediately so it feels fast
    chatInput.value = "";
    chatInput.focus();

    try {
        const res = await fetch(`${API_URL}/chats`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                userId: myId,
                handle: myHandle,
                text,
                scope: chatScope,
                location: chatScope === CHAT_SCOPE_GLOBAL ? 'All areas' : loc,
                replyTo: replyTarget || undefined
            })
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

        replyTarget = null;
        if (chatReplyPreview) chatReplyPreview.hidden = true;
    } catch(err) {
        console.error("Failed to send:", err);
        chatInput.value = text; // restore on failure
    }
});