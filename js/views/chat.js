// ============================================================
//  VIEWS/CHAT.JS — LightWatch community chat. Its own routed view
//  (#view-chat, path /chat) — no longer embedded in the Home view.
//
//  Wrapped in an IIFE only to avoid top-level name collisions now
//  that every view's script coexists in one document (this file
//  and lightstatus.js both declare their own formatRelativeTime,
//  for instance). Everything else runs exactly as before — it
//  already had its own pause/resume logic for tab visibility
//  (search "Pause poll when tab is hidden" below), so this just
//  hooks the SAME pollInterval/typingPollInterval pause/resume into
//  the router's view-changed event too, so the 1.5s/800ms polling
//  loops stop while some other view (Areas, Reports, Account) is on
//  screen instead of Home.
//
//  Deep links (chatId/chatScope/chatLocation) are read from the URL
//  twice: once at script load for a cold launch straight into
//  /chat?chatId=..., and again on every 'lw:route-changed' event
//  (see applyIncomingChatDeepLink near the bottom) for a push
//  notification tapped while the app is already running — that case
//  goes through navigateFromPushUrl() (services/push.js) updating
//  the router's URL instead of a fresh page load, which this file
//  would otherwise never notice.
// ============================================================

(function () {
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
let targetChatLocation = (initialChatParams.get('chatLocation') || '').trim();

let pendingFocusChatId = targetChatIdFromNotification;
// Dedupes applyIncomingChatDeepLink() below so the 'lw:route-changed'
// fired by the app's own cold-boot activate() doesn't immediately
// re-process the same chatId this file already picked up from
// initialChatParams above.
let lastHandledChatIdFromUrl = targetChatIdFromNotification;

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
    const latest = chats.find(c => {
        const userId = resolveUserId(c);
        return userId && userId === myId;
    });
    if (!latest) return null;
    return String(latest._id || latest.id || '');
}

// Read-receipt bookkeeping: which message ids we've already told the
// server we've seen, so polling every 5s doesn't re-POST the same ids
// forever.
const markedSeenIds = new Set();

// A message being *loaded* (fetched into memory so the thread is ready)
// is not the same as a message being *seen* (actually on the user's
// screen). Chat is inline on the page on every screen size now, so
// "on the page" isn't "on screen" — it can be below the fold, or the
// window itself might not even have focus. Just loading the home page
// must not count as seeing it.
let chatCardIntersecting = false;
let chatVisibilityObserver = null;
function setupChatVisibilityObserver() {
    const card = getVisibleChatCard();
    if (!card || !('IntersectionObserver' in window)) return;
    if (chatVisibilityObserver) chatVisibilityObserver.disconnect();
    chatVisibilityObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const wasIntersecting = chatCardIntersecting;
            chatCardIntersecting = entry.isIntersecting;
            if (chatCardIntersecting && !wasIntersecting) pollChatsOnce();
        });
    }, { threshold: 0.4 });
    chatVisibilityObserver.observe(card);
}

function isChatVisibleToUser() {
    if (document.hidden) return false;
    // NOTE: previously also required document.hasFocus(), but that API is
    // unreliable in installed/standalone contexts (this app is a PWA —
    // see manifest.json / apple-mobile-web-app-capable) where some Android
    // WebViews never report window focus at all. That silently made this
    // function return false permanently, so read receipts (seenBy) never
    // got sent for anyone, on any device. document.hidden + the
    // IntersectionObserver check below are enough on their own to know
    // the thread is actually on screen.
    // A second, separate bug also kept the "seen" eye from ever showing:
    // getVisibleChatCard() was targeting a stale selector that resolved
    // to the Home page's loading-skeleton placeholder instead of the
    // real #view-chat card, so the observer below was watching an
    // element that could never intersect — see getVisibleChatCard().
    const card = getVisibleChatCard();
    if (!card) return false;
    // Chat is always inline on the page now (no separate mobile popup
    // state to check), so "visible" means the same thing on every
    // screen size: actually scrolled into view, on a focused/visible
    // tab. Falls back to the old "on-page" assumption on browsers with
    // no IntersectionObserver support rather than never marking
    // anything seen.
    if (!('IntersectionObserver' in window)) return true;
    return chatCardIntersecting;
}

function markVisibleMessagesSeen(chats) {
    if (!isChatVisibleToUser()) return;
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
        try {
            const id = el.dataset.chatId;
            if (!id) return;
            const seenEl = el.querySelector('.chat-message__seen');
            if (!seenEl) return;
            seenEl.classList.remove('is-visible');

            const chat = byId.get(id);
            const seenByIds = normalizeSeenByIds(chat);
            const hasBeenSeen = seenByIds.some(seenById => seenById && seenById !== myId);
            const hasReply = repliedToIds.has(id);
            const isLatestOwn = id === latestOwnId;
            seenEl.classList.toggle('is-visible', isLatestOwn && hasBeenSeen && !hasReply);
        } catch (syncErr) {
            // Don't let one malformed bubble stop the rest of the thread
            // from getting its eye state updated on this tick.
        }
    });
}

function resolveUserId(chat) {
    // Server returns userId as a plain string (we fixed the populate issue).
    // toString() handles any edge cases where it might still be an ObjectId.
    if (!chat.userId) return null;
    if (typeof chat.userId === 'object') return String(chat.userId._id || chat.userId);
    return String(chat.userId);
}

function normalizeSeenByIds(chat) {
    const seenBy = Array.isArray(chat?.seenBy) ? chat.seenBy : [];
    return seenBy
        .map(entry => {
            if (entry && typeof entry === 'object') return String(entry._id || entry.id || '');
            return String(entry || '');
        })
        .filter(Boolean);
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
    if (chat.isAdmin) el.classList.add('chat-message--admin');

    const author = document.createElement('span');
    author.className   = "chat-message__author";
    author.textContent = chat.isAdmin ? `📢 ${chat.handle}` : chat.handle;

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
    const loc = (targetChatLocation && pendingFocusChatId)
        ? targetChatLocation
        : (window.currentChatLocation || getCurrentChatLocation());
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
// POLLING — fetches all chats for this location and displays
// any IDs we haven't seen yet, plus keeps every existing
// bubble's "seen" eye current (a reply or a new seenBy entry
// can land on a message that's already on screen).
//
// Runs on a fast interval so seen/reply state basically never
// looks stale, AND fires immediately whenever the tab regains
// focus/visibility — mobile browsers throttle background
// setInterval timers hard (sometimes to once a minute), so
// without this a phone that was locked or tab-switched could
// sit showing an out-of-date eye for a long time even though
// the interval "should" have ticked.
// -------------------------------------------------------
async function pollChatsOnce() {
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
            // Isolated per-message: if rendering one new bubble throws for
            // any reason, it must not take down syncSeenIndicators/
            // markVisibleMessagesSeen below with it — those are what
            // actually clear a stale eye, and skipping them silently every
            // tick is exactly how an eye ends up looking permanently stuck
            // instead of just one tick behind.
            try {
                const id = chat._id || chat.id;
                if (!id || knownIds.has(id)) return; // skip already-shown messages
                knownIds.add(id);
                addToThread(chat, resolveUserId(chat) === myId, false, true, repliedToIds.has(id), String(id) === latestOwnId);
                focusTargetMessageIfPresent();
            } catch (renderErr) {
                // silent — this message gets another shot next tick
            }
        });

        // Existing bubbles can still change: a reply might land on an
        // older message, or someone else's seenBy might grow — keep
        // every own-message eye icon current, not just newly-added ones.
        // Always runs, independent of the per-message loop above.
        syncSeenIndicators(chats);
        markVisibleMessagesSeen(chats);
    } catch (e) {
        // silent — retries next tick
    }
}

function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    if (chatScope === CHAT_SCOPE_LOCAL && !chatLocation) return;

    pollInterval = setInterval(pollChatsOnce, 1500);
}

// Force a fresh fetch the instant the tab/app comes back into view,
// instead of waiting on a throttled background timer to eventually
// catch up — this is what makes the eye feel instant rather than
// stuck when you switch back to check it.
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pollChatsOnce();
});
window.addEventListener('focus', () => pollChatsOnce());

// -------------------------------------------------------
// TYPING INDICATOR
// No sockets in this app, so this rides the same polling
// model as everything else: a heartbeat while you type,
// and a fast poll to pick up everyone else's heartbeats.
// Rendered as the last bubble in the thread (see render
// function below) rather than as a separate UI element.
// -------------------------------------------------------
const TYPING_PING_INTERVAL_MS = 900;  // min gap between our own heartbeats
const TYPING_POLL_INTERVAL_MS = 800;  // how often we check who else is typing
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
    setupChatVisibilityObserver();
});
setupChatVisibilityObserver();

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
// INLINE CHAT (formerly a mobile popup)
// -------------------------------------------------------
// Chat used to live in a fixed-position popup below 720px, toggled
// open/closed by a floating "Report" button, with its own scroll-lock
// and on-screen-keyboard-aware repositioning. It's inline on the page
// on every screen size now — no popup, no toggle button, no scroll
// lock — so all of that machinery is gone. setMobileChatOpen is kept
// as a thin compatibility shim (still exported on window below) since
// other code may call it to "jump to" the chat, e.g. from a deep link
// or a button elsewhere in the app; it now just scrolls the card into
// view instead of opening an overlay.
function getVisibleChatCard() {
    return document.querySelector('#view-chat .chat-card');
}

function setMobileChatOpen(open) {
    const card = getVisibleChatCard();
    if (!card || !open) return;

    card.scrollIntoView({ block: 'start', behavior: 'smooth' });
    pollChatsOnce();

    if (!pendingFocusChatId) {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => scrollChatToBottom(false));
        });
    }
}

// index.html's viewport meta stays on interactive-widget=resizes-
// content globally (login/signup are tuned against it, so it can't
// change) — meaning window.innerHeight reliably shrinks when the
// on-screen keyboard opens. CSS's dvh unit is *supposed* to track
// that same shrink, but doesn't reliably on every mobile browser/
// WebView; on ones where it doesn't, #view-chat .page's height never
// changed and nothing in the chat card floated up at all. So instead
// of trusting dvh, this measures window.innerHeight directly and
// publishes it as --lw-vh, which chat.css uses for #view-chat .page's
// height — the same reliable measurement the nav-offset fix below
// already uses.
const KB_OFFSET_VAR = '--lw-kb-offset';
const PAGE_VH_VAR = '--lw-vh';
const PAGE_BOTTOM_PAD_VAR = '--lw-page-bottom-pad';
const MOBILE_CHAT_BREAKPOINT = 720;
// How much window.innerHeight has to have shrunk from baseline before
// we'll believe the on-screen keyboard is actually open. Needs to be
// comfortably bigger than browser-chrome show/hide jitter (a few tens
// of px) and comfortably smaller than a real keyboard (150px+), so a
// good chunk of the gap between those two is fair game.
const KEYBOARD_OPEN_THRESHOLD = 100;
let baselineInnerHeight = window.innerHeight;

function updateKeyboardOffset() {
    document.documentElement.style.setProperty(PAGE_VH_VAR, `${window.innerHeight}px`);

    const isMobile = window.innerWidth <= MOBILE_CHAT_BREAKPOINT;
    const shrink = baselineInnerHeight - window.innerHeight;

    // Whether the keyboard is actually open right now, judged by how
    // much the viewport has shrunk from baseline — not by focus state.
    // Pressing Android's back button dismisses the keyboard without
    // firing blur on the still-focused textarea, so activeElement alone
    // can't tell open from closed; a measured shrink can, since the
    // browser reliably resizes window.innerHeight back up once the
    // keyboard is actually gone, focus or no focus.
    const isKeyboardOpen = isMobile && shrink > KEYBOARD_OPEN_THRESHOLD;
    const pageEl = document.querySelector('#view-chat .page');

    if (!isKeyboardOpen) {
        if (shrink <= 0) {
            // Genuinely back at (or above) baseline height: safe to
            // resync the baseline here too (covers rotation /
            // browser-chrome show-hide, and a keyboard dismissed via
            // the back button while the textarea stayed focused).
            baselineInnerHeight = window.innerHeight;
        }
        document.documentElement.style.setProperty(KB_OFFSET_VAR, '0px');
        document.documentElement.style.removeProperty(PAGE_BOTTOM_PAD_VAR);
        // Same back-button case that motivated the KB_OFFSET_VAR reset
        // above: the textarea can still be focused with the keyboard
        // actually gone, so this has to key off the measured shrink
        // (not blur) or the card is left floated with nothing to
        // bring it back down.
        pageEl?.classList.remove('is-composing');
        return;
    }

    // #bottom_nav_wrapper's containing block shrinks right along with
    // window.innerHeight under resizes-content, which is what makes
    // it ride up with the keyboard; nudging it back down by exactly
    // that shrink cancels the ride-up.
    document.documentElement.style.setProperty(KB_OFFSET_VAR, `${shrink}px`);

    // The nav is covered by the keyboard while it's open (see the
    // transform above), so #view-chat .page doesn't need its full
    // footprint reserved below the composer anymore — just a small
    // flat gap, so the shrunk keyboard-open height goes to the thread
    // and composer instead of an empty reservation nothing needs.
    document.documentElement.style.setProperty(PAGE_BOTTOM_PAD_VAR, '12px');
    pageEl?.classList.add('is-composing');
}

chatInput?.addEventListener('focus', () => {
    if (window.innerWidth <= MOBILE_CHAT_BREAKPOINT) {
        // Capture the baseline right before the keyboard starts
        // animating in, not after — once it's open window.innerHeight
        // is already the shrunk value and there'd be nothing to diff
        // against.
        baselineInnerHeight = window.innerHeight;
        // Purely visual: floats the chat-card up over the (now
        // collapsed) page header while composing, so the thread and
        // form get that space instead of sitting under a static
        // header with the keyboard still eating the bottom. See the
        // ".page.is-composing" rules in chat.css. Applied here for an
        // immediate response on focus, before the keyboard has
        // actually animated in and shrunk the viewport — 
        // updateKeyboardOffset() above is what keeps this in sync
        // with reality afterward (including clearing it again if the
        // keyboard closes without a blur event).
        document.querySelector('#view-chat .page')?.classList.add('is-composing');
        requestAnimationFrame(() => scrollChatToBottom(false));
    }
});

chatInput?.addEventListener('blur', () => {
    document.documentElement.style.setProperty(KB_OFFSET_VAR, '0px');
    document.documentElement.style.removeProperty(PAGE_BOTTOM_PAD_VAR);
    document.querySelector('#view-chat .page')?.classList.remove('is-composing');
});

updateKeyboardOffset();
window.addEventListener('resize', updateKeyboardOffset);
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateKeyboardOffset);
}

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
window.setMobileChatOpen = setMobileChatOpen;

// Picks up a chatId/chatScope/chatLocation that just landed in the URL
// via a warm navigation (navigateFromPushUrl() in services/push.js
// calling window.LWRouter.navigate('chat', {search}) while this script
// was already running) — the initialChatParams read at the top of this
// file only ever sees whatever the URL was at cold-boot script load.
function applyIncomingChatDeepLink(search) {
    const params = new URLSearchParams(search || window.location.search);
    const incomingChatId = params.get('chatId') || '';
    if (!incomingChatId) return;

    pendingFocusChatId = incomingChatId;
    const incomingLocation = (params.get('chatLocation') || '').trim();
    if (incomingLocation) targetChatLocation = incomingLocation;

    const incomingScope = params.get('chatScope') === CHAT_SCOPE_GLOBAL ? CHAT_SCOPE_GLOBAL : CHAT_SCOPE_LOCAL;

    if (incomingScope !== chatScope || (incomingLocation && incomingLocation !== chatLocation)) {
        // Switch audience/location and reload
        chatScope = incomingScope;
        if (incomingLocation) chatLocation = incomingLocation;
        setChatScope(incomingScope);
    } else {
        // Already on the right audience/location: the message may already
        // be sitting in the thread (jump now), or still on its way in —
        // poll right away instead of waiting out the regular interval.
        focusTargetMessageIfPresent();
        pollChatsOnce();
    }
}

// -------------------------------------------------------
// REPORT PAGE TABS — Official News (default) / Community Report
// -------------------------------------------------------
// The Report page (#view-chat) now hosts two panels instead of the
// chat-card alone. Switching just toggles which panel is visible and
// which report-mode-* class sits on #view-chat itself — chat.css keys
// its fixed-height "app panel" chat layout off that class, so
// Official News never inherits the chat's internal-scroll treatment;
// it behaves like a normal page instead.
const reportViewEl = document.getElementById('view-chat');
const reportTabButtons = Array.from(document.querySelectorAll('#view-chat .report-tab'));
const reportPanelNews = document.getElementById('reportPanelNews');
const reportPanelCommunity = document.getElementById('reportPanelCommunity');

function activateReportTab(tab) {
    const nextTab = tab === 'community' ? 'community' : 'news';

    reportTabButtons.forEach((btn) => {
        const isActive = btn.dataset.tab === nextTab;
        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-selected', String(isActive));
    });

    if (reportPanelNews) reportPanelNews.hidden = nextTab !== 'news';
    if (reportPanelCommunity) reportPanelCommunity.hidden = nextTab !== 'community';

    reportViewEl?.classList.toggle('report-mode-community', nextTab === 'community');
    reportViewEl?.classList.toggle('report-mode-news', nextTab === 'news');

    // Belt-and-suspenders scroll lock: chat.css now locks html/body via
    // :has(#view-chat:not([hidden])) for BOTH tabs (News scrolls inside
    // .report-panel now too, same as Community), but :has() isn't
    // universal across every mobile WebView this app runs in. This
    // fallback class has to match that same both-tabs behavior — it's
    // set whenever the Report page is showing at all, not just for
    // Community, and only cleared on leaving /chat entirely (see the
    // lw:route-changed listener below). Keeping it tab-conditional here
    // would re-introduce exactly the "News behaves differently than
    // Community" mismatch this file's chat.css counterpart just fixed,
    // just scoped to :has()-unsupported browsers instead.
    document.documentElement.classList.add('lw-report-community-open');
    document.body.classList.add('lw-report-community-open');

    if (nextTab === 'community') {
        // The thread was unmeasurable (display:none via the panel's
        // `hidden` attribute) until just now — give layout a frame to
        // settle before snapping to the latest message, and refresh
        // in case it went stale while News was showing.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => scrollChatToBottom(false));
        });
        pollChatsOnce();
    }
}

reportTabButtons.forEach((btn) => {
    btn.addEventListener('click', () => activateReportTab(btn.dataset.tab));
});

// -------------------------------------------------------
// OFFICIAL NEWS — collapsible "read more" per article
// -------------------------------------------------------
// One delegated listener on the feed instead of one per item, so this
// keeps working unchanged if the articles are ever swapped out for
// server-rendered ones. Toggles aria-expanded (drives the chevron
// rotation in chat.css) and .is-expanded on the parent .news-item
// (drives the grid-based collapse/expand of .news-item__details-wrap).
const officialNewsFeed = document.getElementById('officialNewsFeed');
officialNewsFeed?.addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('[data-action="toggle-news"]');
    if (!toggleBtn) return;

    const newsItem = toggleBtn.closest('.news-item');
    const isExpanded = toggleBtn.getAttribute('aria-expanded') === 'true';

    toggleBtn.setAttribute('aria-expanded', String(!isExpanded));
    newsItem?.classList.toggle('is-expanded', !isExpanded);
});

// Small public hook — lets a "Report an issue" affordance elsewhere in
// the app (e.g. a future button on Home) jump straight to the
// Community Report tab instead of only ever landing on News.
window.LWReportTabs = { activate: activateReportTab };

// Same pause/resume the tab-visibility handler above already uses,
// triggered by view switches instead of (or in addition to) tab
// visibility — see file header.
//
// Also resets the Report page back to its default Official News tab
// on every FRESH arrival at /chat — a nav/bottom-nav tap, or a cold
// boot landing directly on /chat — per lastRouteView below tracking
// whatever view we were on last so this doesn't also fire on an
// in-place param update (e.g. a push notification's deep link landing
// while the Report page is already open — which should NOT yank
// someone already on Community Report back to News, unless that deep
// link points at a specific message, in which case Community Report
// is where that message actually lives).
let lastRouteView = null;
window.addEventListener('lw:route-changed', (e) => {
    const isChatView = e.detail.view === 'chat';
    const isFreshEntry = isChatView && lastRouteView !== 'chat';
    lastRouteView = e.detail.view;

    if (e.detail.view !== 'home' && !isChatView) {
        clearInterval(pollInterval);
        clearInterval(typingPollInterval);
    } else if (chatScope === CHAT_SCOPE_GLOBAL || chatLocation) {
        startPolling();
        startTypingPoll();
    }

    // The :has() CSS lock releases itself automatically once #view-chat
    // is hidden, but the JS fallback class (see activateReportTab)
    // won't unless we clear it here too — otherwise leaving the Report
    // page while Community Report was the active tab would leave every
    // other view permanently scroll-locked.
    if (!isChatView) {
        document.documentElement.classList.remove('lw-report-community-open');
        document.body.classList.remove('lw-report-community-open');
    }

    if (isChatView) {
        const hasDeepLinkedMessage = !!new URLSearchParams(e.detail.search || window.location.search).get('chatId');
        if (isFreshEntry) {
            activateReportTab(hasDeepLinkedMessage ? 'community' : 'news');
        } else if (hasDeepLinkedMessage) {
            activateReportTab('community');
        }
        applyIncomingChatDeepLink(e.detail.search);
    }
});
})();