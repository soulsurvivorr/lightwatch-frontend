// =========================================================
// chat.js — LightWatch community chat
// Live polling every 5s so all users see new messages.
// Reads API_URL from the shared config js file.
// =========================================================

const chatThread = document.getElementById('chatThread');
const chatScrollBottomBtn = document.getElementById('chatScrollBottomBtn');
const chatForm   = document.getElementById('chatForm');
const chatInput  = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');
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

// Deterministic accent per handle, used to tint message cards in both
// the "Only <location>" (local) and "Everyone" (global) audiences so a
// busy multi-user feed is easy to scan by author at a glance. Same
// handle -> same color, every time. Fixed, widely-spaced hue steps
// (not a continuous 0-360 range) so two different handles never hash
// close enough together to look like the same color — a real rainbow
// of distinct, evenly-separated hues rather than a near-miss.
const MESSAGE_ACCENT_HUES = [4, 28, 48, 96, 152, 176, 200, 224, 262, 292, 322, 344]; // degrees, evenly spread
function handleAccentColor(handle) {
    const str = handle || '';
    let hash = 0;
    for (let i = 0; i < str.length; i += 1) {
        hash = (hash * 31 + str.charCodeAt(i)) | 0;
    }
    const hue = MESSAGE_ACCENT_HUES[Math.abs(hash) % MESSAGE_ACCENT_HUES.length];
    return `hsl(${hue}, 62%, 52%)`;
}

// Ids of messages that already have at least one reply pointed at them.
// Once a message has been replied to, its "seen" eye disappears — the
// reply itself is the stronger signal, so we don't keep both.
function computeRepliedToIds(chats) {
    const ids = new Set();
    chats.forEach(c => {
        if (c.replyTo && c.replyTo.chatId) ids.add(String(c.replyTo.chatId));
    });
    return ids;
}

// The "seen" eye is only ever eligible to appear on ONE bubble at a time:
// the user's most recently sent message. Older own-messages never show
// it, even if they were seen too — otherwise every bubble down the
// thread ends up with an eye and it stops meaning "this is where the
// conversation currently stands". `chats` is newest-first (API order),
// so the first own message we hit IS the latest one.
function getLatestOwnMessageId(chats, myId) {
    if (!myId) return null;
    const latest = chats.find(c => resolveUserId(c) === myId);
    if (!latest) return null;
    return String(latest._id || latest.id || '');
}

// Read-receipt bookkeeping: which message ids we've already told the
// server we've seen, so polling every 5s doesn't re-POST the same ids
// forever.
const markedSeenIds = new Set();
function markVisibleMessagesSeen(chats) {
    const myId = getCurrentUserId();
    if (!myId) return;
    const toMark = chats
        .filter(c => resolveUserId(c) !== myId)
        .map(c => c._id || c.id)
        .filter(id => id && !markedSeenIds.has(id));
    if (!toMark.length) return;
    toMark.forEach(id => markedSeenIds.add(id));
    fetch(`${API_URL}/chats/seen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: myId, chatIds: toMark })
    }).catch(() => {}); // best-effort — a missed read receipt isn't worth retry noise
}

// Updates the little "seen" eye on every own-message bubble currently in
// the thread, based on the latest fetch. Needed on every poll (not just
// when a message is first added) because seenBy/replies both change on
// messages that are already rendered.
function syncSeenIndicators(chats) {
    const repliedToIds = computeRepliedToIds(chats);
    const myId = getCurrentUserId();
    const latestOwnId = getLatestOwnMessageId(chats, myId);
    const byId = new Map(chats.map(c => [String(c._id || c.id || ''), c]));
    chatThread?.querySelectorAll('.chat-message--own').forEach(el => {
        const id = el.dataset.chatId;
        if (!id) return;
        const seenEl = el.querySelector('.chat-message__seen');
        if (!seenEl) return;
        const chat = byId.get(id);
        const hasBeenSeen = Boolean(chat?.seenBy && chat.seenBy.length > 0);
        const hasReply = repliedToIds.has(id);
        const isLatestOwn = id === latestOwnId;
        seenEl.classList.toggle('is-visible', isLatestOwn && hasBeenSeen && !hasReply);
    });
}

function resolveUserId(chat) {
    // Server returns userId as a plain string (we fixed the populate issue).
    // toString() handles any edge cases where it might still be an ObjectId.
    if (!chat.userId) return null;
    if (typeof chat.userId === 'object') return String(chat.userId._id || chat.userId);
    return String(chat.userId);
}

// iOS Safari's Date parser is much stricter than Chrome's: a timestamp
// missing a "T" separator or a timezone marker (e.g. "2024-05-21 10:11:00"
// instead of "2024-05-21T10:11:00Z") silently fails on Safari/iOS and
// returns an Invalid Date, even though Chrome (including its devtools
// device emulation, which still runs Chrome's engine) parses it fine.
// That mismatch is exactly why this could look fine in desktop dev tools
// but show nothing on a real phone. Normalize before parsing so both
// engines agree.
function safeParseDate(iso) {
    if (!iso) return null;
    let d = new Date(iso);
    if (!isNaN(d.getTime())) return d;
    if (typeof iso === 'string') {
        let normalized = iso.trim().replace(' ', 'T');
        if (!/[zZ]|[+-]\d\d:?\d\d$/.test(normalized)) normalized += 'Z';
        d = new Date(normalized);
        if (!isNaN(d.getTime())) return d;
    }
    return null;
}

function formatRelativeTime(iso) {
    const date = safeParseDate(iso);
    if (!date) return '';
    const diff = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
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
function buildMessageEl(chat, isOwn, enterAnimationClass, hasReply, isLatestOwn) {
    const el = document.createElement('div');
    el.className = isOwn ? "chat-message chat-message--own" : "chat-message";
    if (enterAnimationClass) el.classList.add(enterAnimationClass);
    el.dataset.chatId   = chat._id || chat.id || "";
    el.dataset.createdAt = chat.createdAt;

    // Both audiences (Local and Global) mix multiple people in one feed,
    // so give each handle its own consistent card color to tell authors
    // apart at a glance. Own messages keep the existing teal styling.
    if (!isOwn) {
        el.classList.add('chat-message--tinted');
        el.style.setProperty('--msg-accent', handleAccentColor(chat.handle));
    }

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

    const footer = document.createElement('div');
    footer.className = 'chat-message__footer';
    footer.appendChild(time);

    // "Seen" eye — lives OUTSIDE the bubble (bottom-left, overhanging the
    // card) rather than inline with the timestamp, so it reads as a
    // status pinned to the message rather than another piece of its
    // content. Only ever shown on the single most recent own message
    // (isLatestOwn), and only until someone replies to it — see
    // syncSeenIndicators, which keeps this in sync as new seenBy/reply
    // data comes in from polling, including moving it off this bubble
    // onto a newer one once one exists.
    if (isOwn) {
        const seenEl = document.createElement('span');
        seenEl.className = 'chat-message__seen';
        seenEl.title = 'Seen';
        seenEl.setAttribute('aria-hidden', 'true');
        seenEl.textContent = '👀';
        const hasBeenSeen = Boolean(chat.seenBy && chat.seenBy.length > 0);
        seenEl.classList.toggle('is-visible', Boolean(isLatestOwn) && hasBeenSeen && !hasReply);
        el.appendChild(seenEl);
    }

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
    el.appendChild(footer);
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

// Typing indicator state — see the TYPING INDICATOR section further
// down for the actual ping/poll/render logic.
let typingPollInterval = null;
let typingStopTimer    = null;
let lastTypingPingAt   = 0;
let isSelfTyping       = false;
let typingIndicatorEl  = null;

function updateChatPlaceholder() {
    if (!chatInput) return;
    chatInput.placeholder = chatScope === CHAT_SCOPE_GLOBAL
        ? 'Message everyone...'
        : 'Share an update...';
}

// Send stays visible at all times — it just looks "off" (dimmed,
// not-allowed cursor, via the :disabled CSS) until there's real text
// to send, instead of vanishing or looking broken when the chat is empty.
function updateSendButtonState() {
    if (!chatSendBtn || !chatInput) return;
    chatSendBtn.disabled = chatInput.value.trim().length === 0;
}

chatInput?.addEventListener('input', updateSendButtonState);
updateSendButtonState();

// -------------------------------------------------------
// AUTO-GROW INPUT — expands the textarea's height as the
// user types past one line (WhatsApp-style), instead of the
// browser's default single-line input scrolling sideways.
// -------------------------------------------------------
const CHAT_INPUT_MAX_HEIGHT = 120; // px — keep in sync with .chat-form__input max-height in CSS

function autoGrowChatInput() {
    if (!chatInput) return;
    chatInput.style.height = 'auto';
    const nextHeight = Math.min(chatInput.scrollHeight, CHAT_INPUT_MAX_HEIGHT);
    chatInput.style.height = `${nextHeight}px`;
    chatInput.classList.toggle('is-maxed', chatInput.scrollHeight > CHAT_INPUT_MAX_HEIGHT);
}

function resetChatInputHeight() {
    if (!chatInput) return;
    chatInput.style.height = '';
    chatInput.classList.remove('is-maxed');
}

chatInput?.addEventListener('input', autoGrowChatInput);

// Enter sends the message; Shift+Enter drops to a new line, same as
// WhatsApp/most chat apps. Needed now that chatInput is a <textarea>.
chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (chatSendBtn && !chatSendBtn.disabled) {
            chatForm?.requestSubmit ? chatForm.requestSubmit() : chatForm?.dispatchEvent(new Event('submit', { cancelable: true }));
        }
    }
});

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

function addToThread(chat, isOwn, scrollDown, animate, hasReply, isLatestOwn) {
    // "Rise" for a message you just sent, "arrive" for one that just
    // came in from someone else — same idea (flows in from the bottom),
    // slightly different feel so sent vs. received still reads distinctly.
    const enterAnimationClass = animate ? (isOwn ? 'chat-message--sent-in' : 'chat-message--received-in') : null;
    const el = buildMessageEl(chat, isOwn, enterAnimationClass, hasReply, isLatestOwn);
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
    typingIndicatorEl = null; // the node above was just wiped out with the thread

    const url = buildChatsUrl();
    if (!url) {
        markChatReady();
        return;
    }

    fetch(url)
        .then(r => r.json())
        .then(chats => {
            const myId = getCurrentUserId();
            const repliedToIds = computeRepliedToIds(chats);
            const latestOwnId = getLatestOwnMessageId(chats, myId);
            // Reverse: API returns newest-first, we want oldest-first
            ;[...chats].reverse().forEach(chat => {
                const id = chat._id || chat.id;
                if (id) knownIds.add(id);
                addToThread(chat, resolveUserId(chat) === myId, false, false, repliedToIds.has(id), String(id) === latestOwnId);
            });
            chatThread.scrollTop = chatThread.scrollHeight;
            focusTargetMessageIfPresent();
            markChatReady();
            markVisibleMessagesSeen(chats);
            startPolling();
            startTypingPoll();
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
            const repliedToIds = computeRepliedToIds(chats);
            const latestOwnId = getLatestOwnMessageId(chats, myId);

            ;[...chats].reverse().forEach(chat => {
                const id = chat._id || chat.id;
                if (!id || knownIds.has(id)) return; // skip already-shown messages
                knownIds.add(id);
                addToThread(chat, resolveUserId(chat) === myId, false, true, repliedToIds.has(id), String(id) === latestOwnId);
                focusTargetMessageIfPresent();
            });

            // Existing bubbles can still change: a reply might land on an
            // older message, or someone else's seenBy might grow — keep
            // every own-message eye icon current, not just newly-added ones.
            syncSeenIndicators(chats);
            markVisibleMessagesSeen(chats);
        } catch(e) {
            // silent — retries next tick
        }
    }, 5000);
}

// -------------------------------------------------------
// TYPING INDICATOR
// No sockets in this app, so this rides the same polling
// model as everything else: a heartbeat while you type,
// and a fast poll to pick up everyone else's heartbeats.
// Rendered as the last bubble in the thread (see render
// function below) rather than as a separate UI element.
// -------------------------------------------------------
const TYPING_PING_INTERVAL_MS = 2000; // min gap between our own heartbeats
const TYPING_POLL_INTERVAL_MS = 2000; // how often we check who else is typing
const TYPING_STOP_DELAY_MS    = 3000; // no keystrokes for this long = "stopped"
const TYPING_MAX_HANDLES_SHOWN = 3;

function buildTypingHeartbeatBody() {
    const myId = getCurrentUserId();
    const loc  = chatLocation || getCurrentChatLocation();
    if (!myId) return null;
    if (chatScope === CHAT_SCOPE_LOCAL && !loc) return null;
    return {
        userId: myId,
        handle: myHandle,
        scope: chatScope,
        location: chatScope === CHAT_SCOPE_GLOBAL ? 'All areas' : loc
    };
}

function pingTyping() {
    const body = buildTypingHeartbeatBody();
    if (!body) return;
    isSelfTyping = true;
    fetch(`${API_URL}/chats/typing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    }).catch(() => { /* silent — next keystroke retries */ });
}

function stopTyping() {
    clearTimeout(typingStopTimer);
    if (!isSelfTyping) return;
    isSelfTyping = false;
    const body = buildTypingHeartbeatBody();
    if (!body) return;
    fetch(`${API_URL}/chats/typing`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    }).catch(() => { /* silent — the TTL on the server cleans it up anyway */ });
}

chatInput?.addEventListener('input', () => {
    if (chatInput.value.trim().length === 0) {
        stopTyping();
        return;
    }

    const now = Date.now();
    if (now - lastTypingPingAt >= TYPING_PING_INTERVAL_MS) {
        lastTypingPingAt = now;
        pingTyping();
    }

    clearTimeout(typingStopTimer);
    typingStopTimer = setTimeout(stopTyping, TYPING_STOP_DELAY_MS);
});

chatInput?.addEventListener('blur', stopTyping);

function buildTypingPollUrl() {
    const myId = getCurrentUserId();
    const loc  = chatLocation || getCurrentChatLocation();
    if (!myId) return null;
    if (chatScope === CHAT_SCOPE_LOCAL && !loc) return null;
    const params = new URLSearchParams({
        scope: chatScope,
        location: chatScope === CHAT_SCOPE_GLOBAL ? 'All areas' : loc,
        userId: myId
    });
    return `${API_URL}/chats/typing?${params.toString()}`;
}

function startTypingPoll() {
    if (typingPollInterval) clearInterval(typingPollInterval);
    if (chatScope === CHAT_SCOPE_LOCAL && !chatLocation) return;

    typingPollInterval = setInterval(async () => {
        try {
            const url = buildTypingPollUrl();
            if (!url) return;
            const res = await fetch(url);
            if (!res.ok) return;
            renderTypingIndicator(await res.json());
        } catch (e) {
            // silent — retries next tick
        }
    }, TYPING_POLL_INTERVAL_MS);
}

// Builds/updates/removes the typing bubble, always keeping it pinned
// as the last child of the thread. Built with textContent (not
// innerHTML) throughout since handles are user-supplied strings.
function renderTypingIndicator(typers) {
    if (!chatThread) return;

    if (!typers || typers.length === 0) {
        typingIndicatorEl?.remove();
        typingIndicatorEl = null;
        return;
    }

    if (!typingIndicatorEl) {
        typingIndicatorEl = document.createElement('div');
        typingIndicatorEl.className = 'chat-message chat-message--typing';
        typingIndicatorEl.setAttribute('role', 'status');
        typingIndicatorEl.setAttribute('aria-live', 'polite');

        const handles = document.createElement('div');
        handles.className = 'typing-indicator__handles';

        const dots = document.createElement('div');
        dots.className = 'typing-indicator__dots';
        dots.setAttribute('aria-hidden', 'true');
        dots.appendChild(document.createElement('span'));
        dots.appendChild(document.createElement('span'));
        dots.appendChild(document.createElement('span'));

        typingIndicatorEl.appendChild(handles);
        typingIndicatorEl.appendChild(dots);
    }

    const shown = typers.slice(0, TYPING_MAX_HANDLES_SHOWN);
    const extraCount = typers.length - shown.length;
    const handlesEl = typingIndicatorEl.querySelector('.typing-indicator__handles');
    handlesEl.innerHTML = "";

    if (shown.length === 1) {
        // Single typist: "handle is typing" read as one line, same
        // spirit as WhatsApp/iMessage's single-person indicator.
        const text = document.createElement('span');
        text.className = 'typing-indicator__text';
        const strong = document.createElement('strong');
        strong.textContent = shown[0].handle;
        text.appendChild(strong);
        text.appendChild(document.createTextNode(' is typing'));
        handlesEl.appendChild(text);
    } else {
        // 2+ typists: up to 3 handle chips laid out horizontally,
        // with a "+N" chip if there are more than that.
        shown.forEach(t => {
            const chip = document.createElement('span');
            chip.className = 'typing-indicator__handle';
            chip.textContent = t.handle;
            handlesEl.appendChild(chip);
        });
        if (extraCount > 0) {
            const more = document.createElement('span');
            more.className = 'typing-indicator__more';
            more.textContent = `+${extraCount}`;
            handlesEl.appendChild(more);
        }
    }

    typingIndicatorEl.classList.toggle('chat-message--typing-single', shown.length === 1);

    if (chatThread.lastElementChild !== typingIndicatorEl) {
        chatThread.appendChild(typingIndicatorEl);
    }
    if (isNearBottom) {
        chatThread.scrollTop = chatThread.scrollHeight;
    }
}

// Pause poll when tab is hidden (saves mobile data & battery)
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        clearInterval(pollInterval);
        clearInterval(typingPollInterval);
    } else if (chatScope === CHAT_SCOPE_GLOBAL || chatLocation) {
        startPolling();
        startTypingPoll();
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
    resetChatInputHeight();
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

    // Jump straight to the latest message on open, unless we're mid a
    // deep-link to a specific message (focusTargetMessageIfPresent
    // handles that scroll itself). The popup's layout only settles
    // after the open transition/reflow, so wait a tick before scrolling.
    if (open && !pendingFocusChatId) {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => scrollChatToBottom(false));
        });
    }

    const toggle = document.getElementById('mobileChatToggle');
    if (toggle) {
        const icon = toggle.querySelector('.mobile-chat-toggle__icon');
        const label = toggle.querySelector('.mobile-chat-toggle__label');
        if (icon) icon.innerHTML = open
            ? '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:1em;height:1em;" aria-hidden="true"><path d="M3 3l10 10M13 3 3 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'
            : '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:1em;height:1em;" aria-hidden="true"><path d="M3 4.8h14a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H8.5L5 16.8V14H3a1 1 0 0 1-1-1V5.8a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
        if (label) label.textContent = open ? 'Close' : 'Chat';
        toggle.setAttribute('aria-label', open ? 'Close chat' : 'Open chat');
    }

    if (open) {
        // Wait for the same reflow the scroll-to-bottom logic waits for,
        // then measure the popup for real instead of guessing its height
        // via a static CSS bottom offset.
        requestAnimationFrame(() => {
            requestAnimationFrame(positionMobileChatToggle);
        });
        window.addEventListener('resize', positionMobileChatToggle);
        window.addEventListener('orientationchange', positionMobileChatToggle);
    } else {
        clearMobileChatTogglePosition();
        window.removeEventListener('resize', positionMobileChatToggle);
        window.removeEventListener('orientationchange', positionMobileChatToggle);
    }
}

// Docks the floating toggle just below the popup by reading the popup's
// actual on-screen bottom edge (getBoundingClientRect), rather than a
// static CSS px offset. A static offset kept landing wrong on some
// devices depending on their real dvh/safe-area values (it collided
// with the send button on iPhone 12 Pro) — measuring the real box
// guarantees the gap is correct no matter what the device reports.
const MOBILE_CHAT_TOGGLE_GAP = 12; // px of breathing room below the popup

function positionMobileChatToggle() {
    const toggle = document.getElementById('mobileChatToggle');
    const card = getVisibleChatCard();
    if (!toggle || !card) return;
    if (!card.classList.contains('chat-card--mobile-open')) return;
    if (!window.matchMedia('(max-width: 720px)').matches) {
        clearMobileChatTogglePosition();
        return;
    }

    const rect = card.getBoundingClientRect();
    toggle.style.bottom = 'auto';
    toggle.style.top = `${Math.round(rect.bottom + MOBILE_CHAT_TOGGLE_GAP)}px`;
}

function clearMobileChatTogglePosition() {
    const toggle = document.getElementById('mobileChatToggle');
    if (!toggle) return;
    toggle.style.top = '';
    toggle.style.bottom = '';
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
    updateSendButtonState();
    resetChatInputHeight();
    stopTyping(); // setting .value doesn't fire 'input', so this won't happen on its own

    // Quick tactile pop on the button itself the instant Send is hit.
    if (chatSendBtn) {
        chatSendBtn.classList.remove('is-sent-pulse');
        // Force reflow so the animation can replay on consecutive sends.
        void chatSendBtn.offsetWidth;
        chatSendBtn.classList.add('is-sent-pulse');
    }

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
            updateSendButtonState();
            autoGrowChatInput();
            return;
        }

        const saved = await res.json();
        const realId = saved._id || saved.id;

        if (realId && !knownIds.has(realId)) {
            knownIds.add(realId);           // tell poll: skip this one
            addToThread(saved, true, true, true, false, true); // show it now, scroll to it, animate it in; it's the newest own message so far
        }

        replyTarget = null;
        if (chatReplyPreview) chatReplyPreview.hidden = true;
    } catch(err) {
        console.error("Failed to send:", err);
        chatInput.value = text; // restore on failure
        updateSendButtonState();
        autoGrowChatInput();
    }
});