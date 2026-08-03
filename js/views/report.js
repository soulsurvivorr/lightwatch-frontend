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
//  hooks the SAME pollInterval pause/resume into the router's
//  view-changed event too, so the 1.5s polling loop stops while
//  some other view (Areas, Reports, Account) is on screen instead
//  of Home.
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
function isNativeApp() {
    return Boolean(
        window.Capacitor &&
        typeof window.Capacitor.isNativePlatform === 'function' &&
        window.Capacitor.isNativePlatform()
    );
}

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
const statusOnBtn = document.getElementById('statusOnBtn');
const statusOffBtn = document.getElementById('statusOffBtn');
const statusMediaBtn = document.getElementById('statusMediaBtn');
const communityFabBtn = document.getElementById('communityFabBtn');
const communitySearchBtn = document.getElementById('communitySearchBtn');
const communitySortBtn = document.getElementById('communitySortBtn');
const communityNearbyBtn = document.getElementById('communityNearbyBtn');
const viewChat = document.getElementById('view-chat');
const reportPanelCommunityEl = document.querySelector('#view-chat .report-panel[data-panel="community"]');
const communityBanner = reportPanelCommunityEl?.querySelector('.community-banner');
let activePostSearchQuery = '';

const pullRefreshEl = document.createElement('div');
pullRefreshEl.className = 'community-pull-refresh';
pullRefreshEl.setAttribute('aria-hidden', 'true');
pullRefreshEl.innerHTML = '<div class="community-pull-refresh__orb"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.2-5.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 5v3.7h-3.7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>';
if (communityBanner && communityBanner.parentElement) {
    communityBanner.insertAdjacentElement('afterend', pullRefreshEl);
}

let pullStartY = 0;
let pullDistance = 0;
let pullActive = false;
let pullLocked = false;
let pullRefreshing = false;
const PULL_REFRESH_TRIGGER = 80;
const PULL_REFRESH_MAX = 116;

// Keep Post inline with the textarea on Community Report (requested
// mobile-native composer layout) even though the static markup places
// it in the lower row.
const communityComposerTop = document.querySelector('#chatForm .community-composer__top');
if (communityComposerTop && chatSendBtn && chatSendBtn.parentElement !== communityComposerTop) {
    communityComposerTop.appendChild(chatSendBtn);
}

const CHAT_SCOPE_KEY = 'lw_chat_scope_pref';
const CHAT_SCOPE_LOCAL = 'local';
const CHAT_SCOPE_GLOBAL = 'global';
const CHAT_EDIT_DELETE_WINDOW_MS = 15 * 60 * 1000;
const MUTED_REPORT_HANDLES_KEY = 'lw_muted_report_handles';
const MUTED_REPORT_POST_IDS_KEY = 'lw_muted_report_posts';
const BOOKMARKED_REPORT_IDS_KEY = 'lw_bookmarked_report_posts';

function readStoredList(key) {
    try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
    } catch {
        return [];
    }
}

function writeStoredList(key, values) {
    try {
        localStorage.setItem(key, JSON.stringify([...new Set(values.map((v) => String(v)))]));
    } catch {}
}

function getReportId(chat) {
    return String(chat?._id || chat?.id || '');
}

function isHandleMuted(handle) {
    if (!handle) return false;
    return readStoredList(MUTED_REPORT_HANDLES_KEY).includes(String(handle));
}

function isReportMuted(chat) {
    const id = getReportId(chat);
    if (!id) return false;
    return readStoredList(MUTED_REPORT_POST_IDS_KEY).includes(id);
}

function shouldHideReport(chat) {
    return isHandleMuted(chat?.handle) || isReportMuted(chat);
}

function setHandleMuted(handle, muted) {
    const key = String(handle || '').trim();
    if (!key) return;
    const list = readStoredList(MUTED_REPORT_HANDLES_KEY);
    const next = muted ? [...list, key] : list.filter((item) => item !== key);
    writeStoredList(MUTED_REPORT_HANDLES_KEY, next);
}

function setReportMuted(chatId, muted) {
    const key = String(chatId || '').trim();
    if (!key) return;
    const list = readStoredList(MUTED_REPORT_POST_IDS_KEY);
    const next = muted ? [...list, key] : list.filter((item) => item !== key);
    writeStoredList(MUTED_REPORT_POST_IDS_KEY, next);
}

function isReportBookmarked(chatId) {
    const key = String(chatId || '').trim();
    if (!key) return false;
    return readStoredList(BOOKMARKED_REPORT_IDS_KEY).includes(key);
}

function setReportBookmarked(chatId, bookmarked) {
    const key = String(chatId || '').trim();
    if (!key) return;
    const list = readStoredList(BOOKMARKED_REPORT_IDS_KEY);
    const next = bookmarked ? [...list, key] : list.filter((item) => item !== key);
    writeStoredList(BOOKMARKED_REPORT_IDS_KEY, next);
}

function closeAllReportCardMenus(exceptWrap) {
    document.querySelectorAll('#view-chat .report-card__menu-wrap.is-open').forEach((wrap) => {
        if (exceptWrap && wrap === exceptWrap) return;
        wrap.classList.remove('is-open');
        const card = wrap.closest('.chat-message.report-card');
        if (card) card.classList.remove('report-card--menu-open');
    });
}

function closeAllRepostMenus(exceptWrap) {
    document.querySelectorAll('#view-chat .report-card__repost-wrap.is-open').forEach((wrap) => {
        if (exceptWrap && wrap === exceptWrap) return;
        wrap.classList.remove('is-open');
        wrap.querySelector('.report-card__stat--repost')?.setAttribute('aria-expanded', 'false');
    });
}

function getRemainingEditWindowMs(chat) {
    const created = safeParseDate(chat?.createdAt);
    if (!created) return 0;
    const elapsed = Date.now() - created.getTime();
    return Math.max(0, CHAT_EDIT_DELETE_WINDOW_MS - elapsed);
}

function canManageOwnPost(chat, isOwn) {
    if (!isOwn || chat?.isAdmin) return false;
    return getRemainingEditWindowMs(chat) > 0;
}

function formatWindowMinutesLeft(ms) {
    const mins = Math.max(1, Math.ceil(ms / 60000));
    return `${mins}m left`;
}

async function patchChatMessage(chatId, text) {
    const userId = getCurrentUserId();
    if (!userId || !chatId) return { ok: false };
    const res = await fetch(`${API_URL}/chats/${encodeURIComponent(chatId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, text })
    });
    if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        return { ok: false, error: payload?.error || 'Could not edit post.' };
    }
    return { ok: true, data: await res.json() };
}

async function removeChatMessage(chatId) {
    const userId = getCurrentUserId();
    if (!userId || !chatId) return { ok: false };
    const res = await fetch(`${API_URL}/chats/${encodeURIComponent(chatId)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
    });
    if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        return { ok: false, error: payload?.error || 'Could not delete post.' };
    }
    return { ok: true };
}

document.addEventListener('click', (e) => {
    const withinMenu = e.target && e.target.closest('#view-chat .report-card__menu-wrap');
    if (!withinMenu) closeAllReportCardMenus(null);
    const withinRepostMenu = e.target && e.target.closest('#view-chat .report-card__repost-wrap');
    if (!withinRepostMenu) closeAllRepostMenus(null);
});

function flashIconRing(btn) {
    if (!btn) return;
    btn.classList.remove('is-pressed');
    void btn.offsetWidth;
    btn.classList.add('is-pressed');
    setTimeout(() => btn.classList.remove('is-pressed'), 220);
}

// ---- Light status quick-tag ----
// There's no separate "status" field on a chat message server-side, so
// the ON/OFF quick-select in the composer is encoded as a small plain-
// text prefix on the message itself (LIGHTWATCH_STATUS_PREFIX below).
// Every card in the feed — not just the sender's own — reads this same
// prefix back out to show the ON/OFF badge, so it works consistently
// across users without any backend schema change. The prefix is
// stripped back off before the text is shown.
const LIGHT_STATUS_PREFIX = { on: '[Light is ON] ', off: '[Light is OFF] ' };
let selectedLightStatus = null; // 'on' | 'off' | null

function parseLightStatus(rawText) {
    const text = rawText || '';
    for (const key of ['on', 'off']) {
        const prefix = LIGHT_STATUS_PREFIX[key];
        if (text.startsWith(prefix)) {
            return { status: key, text: text.slice(prefix.length).replace(/\u200B/g, '') };
        }
    }
    return { status: null, text: text.replace(/\u200B/g, '') };
}

function setSelectedLightStatus(next) {
    selectedLightStatus = selectedLightStatus === next ? null : next;
    statusOnBtn?.classList.toggle('is-active', selectedLightStatus === 'on');
    statusOnBtn?.setAttribute('aria-pressed', selectedLightStatus === 'on' ? 'true' : 'false');
    statusOffBtn?.classList.toggle('is-active', selectedLightStatus === 'off');
    statusOffBtn?.setAttribute('aria-pressed', selectedLightStatus === 'off' ? 'true' : 'false');
}

statusOnBtn?.addEventListener('click', () => setSelectedLightStatus('on'));
statusOffBtn?.addEventListener('click', () => setSelectedLightStatus('off'));

communityFabBtn?.addEventListener('click', () => {
    chatInput?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    chatInput?.focus();
});

function applyPostSearchFilter(rawQuery) {
    activePostSearchQuery = String(rawQuery || '').trim().toLowerCase();
    if (!chatThread) return;

    const cards = [...chatThread.querySelectorAll(':scope > .chat-message.report-card')];
    let visibleCount = 0;

    cards.forEach((card) => {
        if (!activePostSearchQuery) {
            card.hidden = false;
            visibleCount += 1;
            return;
        }
        const haystack = [
            card.querySelector('.report-card__name')?.textContent || '',
            card.querySelector('.report-card__meta-location')?.textContent || '',
            card.querySelector('.report-card__text')?.textContent || '',
            card.querySelector('.report-card__quoted-text')?.textContent || ''
        ].join(' ').toLowerCase();
        const isMatch = haystack.includes(activePostSearchQuery);
        card.hidden = !isMatch;
        if (isMatch) visibleCount += 1;
    });

    if (activePostSearchQuery) {
        window.lwToast?.(`Found ${visibleCount} matching report${visibleCount === 1 ? '' : 's'}.`);
    }
}

communitySearchBtn?.addEventListener('click', () => {
    const next = window.prompt('Search reports by handle, location, or message text', activePostSearchQuery);
    if (next === null) return;
    applyPostSearchFilter(next);
    const isActive = next.trim().length > 0;
    communitySearchBtn.classList.toggle('is-active', isActive);
    communitySearchBtn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
});

communitySortBtn?.addEventListener('click', () => {
    const isOpen = communitySortBtn.getAttribute('aria-expanded') === 'true';
    communitySortBtn.setAttribute('aria-expanded', String(!isOpen));
});

communityNearbyBtn?.addEventListener('click', () => {
    const isActive = communityNearbyBtn.getAttribute('aria-pressed') === 'true';
    communityNearbyBtn.setAttribute('aria-pressed', String(!isActive));
    communityNearbyBtn.classList.toggle('is-active', !isActive);
});

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

function renderAvatarIntoEl(targetEl, seed, avatarImage) {
    if (!targetEl) return;
    if (avatarImage && /^data:image\//i.test(avatarImage)) {
        targetEl.innerHTML = '';
        const img = document.createElement('img');
        img.src = avatarImage;
        img.alt = '';
        img.loading = 'lazy';
        targetEl.appendChild(img);
        targetEl.classList.add('report-card__avatar--image');
        return;
    }
    targetEl.classList.remove('report-card__avatar--image');
    if (window.LWAvatar && seed) {
        window.LWAvatar.renderInto(targetEl, seed);
        return;
    }
    targetEl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 12.5a4.3 4.3 0 1 0 0-8.6 4.3 4.3 0 0 0 0 8.6Z" stroke="currentColor" stroke-width="1.6"/><path d="M4.2 20c1.1-3.6 3.9-5.8 7.8-5.8s6.7 2.2 7.8 5.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
}

let myHandle = getOrCreateHandle();
if (chatHandleDisplay) chatHandleDisplay.textContent = myHandle;
let myAvatarImage = null;

let composerMediaDataUrl = null;
let composerMediaKind = null;
const COMPOSER_MEDIA_MAX_DATA_URL_LENGTH = 1_100_000;
const COMPOSER_MEDIA_MAX_UPLOAD_BYTES = 24_000_000;
const COMPOSER_MEDIA_MAX_DIMENSION = 1400;
const mediaPickerInput = document.createElement('input');
mediaPickerInput.type = 'file';
mediaPickerInput.accept = 'image/*,video/*';
mediaPickerInput.hidden = true;
chatForm?.appendChild(mediaPickerInput);

const composerMediaPreview = document.createElement('div');
composerMediaPreview.className = 'community-composer__media-preview';
composerMediaPreview.hidden = true;
const composerMediaRemove = document.createElement('button');
composerMediaRemove.type = 'button';
composerMediaRemove.className = 'community-composer__media-remove';
composerMediaRemove.setAttribute('aria-label', 'Remove selected media');
composerMediaRemove.textContent = 'Remove';
composerMediaPreview.appendChild(composerMediaRemove);
if (communityComposerTop && communityComposerTop.parentElement) {
    communityComposerTop.insertAdjacentElement('afterend', composerMediaPreview);
} else {
    chatForm?.appendChild(composerMediaPreview);
}

try {
    const rawCachedUser = localStorage.getItem('currentUserData') || sessionStorage.getItem('currentUserData');
    const cachedUser = rawCachedUser ? JSON.parse(rawCachedUser) : null;
    if (cachedUser) {
        myAvatarImage = cachedUser.avatarImage || null;
        const avatarEl = document.querySelector('#chatForm .community-composer__avatar');
        const avatarSeed = cachedUser._id || cachedUser.id || cachedUser.chatHandle || myHandle;
        renderAvatarIntoEl(avatarEl, avatarSeed, myAvatarImage);
    }
} catch {}

function updateComposerMediaPreview() {
    if (!composerMediaPreview || !statusMediaBtn) return;
    const hasMedia = Boolean(composerMediaDataUrl);
    composerMediaPreview.hidden = !hasMedia;
    if (hasMedia) {
        if (composerMediaKind === 'video') {
            const videoEl = document.createElement('video');
            videoEl.src = composerMediaDataUrl;
            videoEl.controls = true;
            videoEl.playsInline = true;
            videoEl.preload = 'metadata';
            videoEl.className = 'community-composer__media-preview-video';
            composerMediaPreview.replaceChildren(videoEl, composerMediaRemove);
        } else {
            const imageEl = document.createElement('img');
            imageEl.src = composerMediaDataUrl;
            imageEl.alt = 'Selected media preview';
            imageEl.className = 'community-composer__media-preview-image';
            composerMediaPreview.replaceChildren(imageEl, composerMediaRemove);
        }
    } else {
        composerMediaPreview.replaceChildren(composerMediaRemove);
    }
    statusMediaBtn.classList.toggle('is-active', hasMedia);
    updateSendButtonState();
}

function clearComposerMedia() {
    composerMediaDataUrl = null;
    composerMediaKind = null;
    mediaPickerInput.value = '';
    updateComposerMediaPreview();
}

composerMediaRemove.addEventListener('click', clearComposerMedia);

function isCommunityPanelActive() {
    return Boolean(viewChat && !viewChat.hidden && reportPanelCommunityEl && !reportPanelCommunityEl.hidden);
}

function isLikelyTouchPhone() {
    const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
    return coarse || mobileUa;
}

function openMediaPicker(mode) {
    if (!mediaPickerInput) return;
    mediaPickerInput.value = '';
    if (mode === 'camera') {
        mediaPickerInput.setAttribute('capture', 'environment');
    } else {
        mediaPickerInput.removeAttribute('capture');
    }
    mediaPickerInput.click();
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('read-failed'));
        reader.readAsDataURL(file);
    });
}

function loadImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('image-decode-failed'));
        img.src = dataUrl;
    });
}

function fitImageWithinBounds(width, height, maxDimension) {
    if (!width || !height) return { width: maxDimension, height: maxDimension };
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale))
    };
}

async function prepareComposerMediaDataUrl(file) {
    if (!file || !(file.type.startsWith('image/') || file.type.startsWith('video/'))) {
        return { error: 'Please choose an image or video from camera or gallery.' };
    }

    const kind = file.type.startsWith('video/') ? 'video' : 'image';
    if (file.size > COMPOSER_MEDIA_MAX_UPLOAD_BYTES) {
        return { error: kind === 'video' ? 'Video is too large. Choose one under 24MB.' : 'Image is too large. Choose one under 24MB.' };
    }

    const originalDataUrl = await readFileAsDataUrl(file).catch(() => '');
    if (!originalDataUrl || !/^data:(image|video)\//i.test(originalDataUrl)) {
        return { error: kind === 'video' ? 'Could not read video. Try another one.' : 'Could not read image. Try another one.' };
    }

    if (kind === 'video') {
        return { dataUrl: originalDataUrl, kind };
    }

    const originalMime = (originalDataUrl.match(/^data:([^;]+);/i)?.[1] || '').toLowerCase();
    const backendSafeMime = /^image\/(png|jpe?g|webp|heic|heif)$/i.test(originalMime);
    const shouldNormalizeToJpeg = !backendSafeMime;

    if (!shouldNormalizeToJpeg && originalDataUrl.length <= COMPOSER_MEDIA_MAX_DATA_URL_LENGTH) {
        return { dataUrl: originalDataUrl, kind };
    }

    const image = await loadImageFromDataUrl(originalDataUrl).catch(() => null);
    if (!image) {
        return { error: 'Could not process image. Try another one.' };
    }

    const fitted = fitImageWithinBounds(image.naturalWidth, image.naturalHeight, COMPOSER_MEDIA_MAX_DIMENSION);
    const canvas = document.createElement('canvas');
    canvas.width = fitted.width;
    canvas.height = fitted.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return { error: 'Could not process image. Try another one.' };
    }
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    let best = '';
    for (const quality of [0.9, 0.82, 0.74, 0.66, 0.58]) {
        const candidate = canvas.toDataURL('image/jpeg', quality);
        if (!best || candidate.length < best.length) best = candidate;
        if (candidate.length <= COMPOSER_MEDIA_MAX_DATA_URL_LENGTH) {
            return { dataUrl: candidate, kind };
        }
    }

    // Last attempt: shrink dimensions further once if still above cap.
    const shrinkCanvas = document.createElement('canvas');
    shrinkCanvas.width = Math.max(1, Math.round(canvas.width * 0.8));
    shrinkCanvas.height = Math.max(1, Math.round(canvas.height * 0.8));
    const shrinkCtx = shrinkCanvas.getContext('2d');
    if (shrinkCtx) {
        shrinkCtx.drawImage(canvas, 0, 0, shrinkCanvas.width, shrinkCanvas.height);
        const finalAttempt = shrinkCanvas.toDataURL('image/jpeg', 0.62);
        if (!best || finalAttempt.length < best.length) best = finalAttempt;
    }

    if (best && best.length <= COMPOSER_MEDIA_MAX_DATA_URL_LENGTH) {
        return { dataUrl: best, kind };
    }

    return { error: 'Image is still too large after compression. Choose a smaller one.' };
}

function resetPullRefreshVisual() {
    pullDistance = 0;
    pullActive = false;
    if (!pullRefreshEl) return;
    pullRefreshEl.classList.remove('is-pulling');
    pullRefreshEl.style.setProperty('--pull-distance', '0px');
}

function setPullRefreshVisual(distance) {
    if (!pullRefreshEl) return;
    const clamped = Math.max(0, Math.min(PULL_REFRESH_MAX, distance));
    const progress = Math.max(0, Math.min(1, clamped / PULL_REFRESH_TRIGGER));
    pullRefreshEl.classList.add('is-pulling');
    pullRefreshEl.style.setProperty('--pull-distance', `${clamped}px`);
    pullRefreshEl.style.setProperty('--pull-progress', progress.toFixed(3));
    pullRefreshEl.classList.toggle('is-ready', clamped >= PULL_REFRESH_TRIGGER);
}

function endPullRefreshVisual() {
    if (!pullRefreshEl) return;
    pullRefreshEl.classList.remove('is-pulling', 'is-ready');
    pullRefreshEl.style.setProperty('--pull-distance', '0px');
    pullRefreshEl.style.setProperty('--pull-progress', '0');
}

async function triggerManualRefresh() {
    if (pullRefreshing) return;
    pullRefreshing = true;
    if (pullRefreshEl) pullRefreshEl.classList.add('is-refreshing');
    try {
        await Promise.resolve(loadChatHistory());
        window.lwToast?.('Refreshing reports...');
    } catch {}
    finally {
        setTimeout(() => {
            if (pullRefreshEl) pullRefreshEl.classList.remove('is-refreshing');
            pullRefreshing = false;
        }, 220);
    }
}

function shouldStartPullRefresh(target) {
    if (!isCommunityPanelActive() || pullRefreshing) return false;
    if ((window.scrollY || window.pageYOffset || 0) > 2) return false;
    const t = target && target.nodeType === 1 ? target : null;
    if (t && t.closest('textarea, input, button, a, [contenteditable="true"]')) return false;
    return true;
}

window.addEventListener('touchstart', (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    if (!shouldStartPullRefresh(e.target)) {
        resetPullRefreshVisual();
        return;
    }
    pullStartY = e.touches[0].clientY;
    pullDistance = 0;
    pullActive = true;
    pullLocked = false;
}, { passive: true });

window.addEventListener('touchmove', (e) => {
    if (!pullActive || !e.touches || e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - pullStartY;
    if (dy <= 0) {
        endPullRefreshVisual();
        return;
    }
    pullDistance = dy;
    if (dy > 8) pullLocked = true;
    setPullRefreshVisual(dy);
    if (pullLocked) e.preventDefault();
}, { passive: false });

window.addEventListener('touchend', async () => {
    if (!pullActive) return;
    const shouldRefresh = pullDistance >= PULL_REFRESH_TRIGGER;
    endPullRefreshVisual();
    pullActive = false;
    pullLocked = false;
    if (shouldRefresh) await triggerManualRefresh();
});

window.addEventListener('touchcancel', () => {
    endPullRefreshVisual();
    pullActive = false;
    pullLocked = false;
});

statusMediaBtn?.addEventListener('click', () => {
    // Open the user's photos directly; no camera/gallery confirm step.
    openMediaPicker('gallery');
});

mediaPickerInput.addEventListener('change', async () => {
    const [file] = mediaPickerInput.files || [];
    if (!file) return;

    const prepared = await prepareComposerMediaDataUrl(file);
    if (!prepared.dataUrl) {
        window.lwToast?.(prepared.error || 'Could not process media. Try another one.');
        clearComposerMedia();
        return;
    }

    composerMediaDataUrl = String(prepared.dataUrl);
    composerMediaKind = prepared.kind || 'image';
    updateComposerMediaPreview();
});

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
        const label = chatScopeLocalBtn.querySelector('.chat-scope-option__label');
        const locName = getLocationNameOnly();
        if (label) label.textContent = locName === 'your location' ? 'Your Location' : `Your Location (${locName})`;
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
            sessionStorage.setItem('chatHandle', myHandle);
            if (chatHandleDisplay) chatHandleDisplay.textContent = myHandle;
        }
        myAvatarImage = user.avatarImage || null;
        try {
            const rawCached = localStorage.getItem('currentUserData') || sessionStorage.getItem('currentUserData');
            const cached = rawCached ? JSON.parse(rawCached) : {};
            const merged = { ...cached, chatHandle: myHandle, avatarImage: myAvatarImage };
            localStorage.setItem('currentUserData', JSON.stringify(merged));
            sessionStorage.setItem('currentUserData', JSON.stringify(merged));
        } catch {}
        const avatarEl = document.querySelector('#chatForm .community-composer__avatar');
        const avatarSeed = user._id || user.id || user.chatHandle || myHandle;
        renderAvatarIntoEl(avatarEl, avatarSeed, myAvatarImage);
    } catch(e) {}
}
loadUserChatHandle();
window.addEventListener('lw-session-changed', loadUserChatHandle);

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
    const counts = new Map();
    chats.forEach(c => {
        if (c.replyTo && c.replyTo.chatId) {
            const key = String(c.replyTo.chatId);
            counts.set(key, (counts.get(key) || 0) + 1);
        }
    });
    return counts;
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

// Updates the comment (reply) AND like counts on every card currently
// in the thread, based on the latest poll. Needed on every tick (not
// just when a message is first added) because both can change on
// messages that are already rendered — someone else replying to or
// liking a post you're currently looking at should update live,
// exactly the same way your own click already does optimistically.
function syncLiveStatCounts(chats) {
    const repliedCounts = computeRepliedToIds(chats);
    const byId = new Map(chats.map(c => [String(c._id || c.id || ''), c]));

    chatThread?.querySelectorAll('.chat-message').forEach(el => {
        const id = el.dataset.chatId;
        if (!id) return;

        const commentCountEl = el.querySelector('.report-card__stat--comment .report-card__stat-count');
        if (commentCountEl) commentCountEl.textContent = String(repliedCounts.get(id) || 0);

        const chat = byId.get(id);
        if (!chat) return;
        const likeStatEl = el.querySelector('.report-card__stat--like');
        const likeCountEl = likeStatEl?.querySelector('.report-card__stat-count');
        if (likeCountEl) {
            likeCountEl.textContent = String(Math.max(0, Number(chat.likeCount || 0)));
        }
        if (likeStatEl) {
            const myUserId = getCurrentUserId();
            const isLiked = Boolean(myUserId) && Array.isArray(chat.likedBy) &&
                chat.likedBy.some((likedId) => String(likedId) === String(myUserId));
            likeStatEl.classList.toggle('is-liked', isLiked);
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

function formatMessageTextWithMentions(text) {
    return window.LWHelpers?.formatMessageTextWithMentions(text) || text;
}

// -------------------------------------------------------
// MENTION SUGGESTIONS
// -------------------------------------------------------
let mentionSuggestionsEl = null;
let currentMentionTrigger = null; // { textarea, startIdx }

function initMentionSuggestions() {
    if (mentionSuggestionsEl) return;
    mentionSuggestionsEl = document.createElement('div');
    mentionSuggestionsEl.className = 'mention-suggestions';
    mentionSuggestionsEl.hidden = true;
    document.body.appendChild(mentionSuggestionsEl);

    document.addEventListener('mousedown', (e) => {
        if (mentionSuggestionsEl && !mentionSuggestionsEl.contains(e.target)) {
            hideMentionSuggestions();
        }
    });
}

function hideMentionSuggestions() {
    if (!mentionSuggestionsEl) return;
    mentionSuggestionsEl.hidden = true;
    currentMentionTrigger = null;
}

function showMentionSuggestions(textarea, startIdx, filter) {
    initMentionSuggestions();
    const handles = Array.from(knownHandles)
        .filter(h => h.toLowerCase().includes(filter.toLowerCase()))
        .sort()
        .slice(0, 8);

    if (handles.length === 0) {
        hideMentionSuggestions();
        return;
    }

    currentMentionTrigger = { textarea, startIdx };
    mentionSuggestionsEl.innerHTML = '';

    handles.forEach((handle, idx) => {
        const item = document.createElement('div');
        item.className = 'mention-suggestions__item';
        if (idx === 0) item.classList.add('is-selected');

        const avatar = document.createElement('span');
        avatar.className = 'mention-suggestions__avatar';
        renderAvatarIntoEl(avatar, handle, null);

        const label = document.createElement('span');
        label.className = 'mention-suggestions__label';
        label.innerHTML = `<span class="mention-suggestions__at">@</span>${handle}`;

        item.appendChild(avatar);
        item.appendChild(label);

        item.addEventListener('click', () => {
            insertMention(handle);
        });

        mentionSuggestionsEl.appendChild(item);
    });

    // Position near the cursor if possible, or just above/below the textarea
    const rect = textarea.getBoundingClientRect();
    mentionSuggestionsEl.style.left = `${rect.left}px`;
    mentionSuggestionsEl.style.width = `${rect.width}px`;

    // Check if there is space below
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow > 220) {
        mentionSuggestionsEl.style.top = `${rect.bottom + 4}px`;
        mentionSuggestionsEl.style.bottom = 'auto';
    } else {
        mentionSuggestionsEl.style.bottom = `${window.innerHeight - rect.top + 4}px`;
        mentionSuggestionsEl.style.top = 'auto';
    }

    mentionSuggestionsEl.hidden = false;
}

function insertMention(handle) {
    if (!currentMentionTrigger) return;
    const { textarea, startIdx } = currentMentionTrigger;
    const text = textarea.value;
    const before = text.substring(0, startIdx);
    const after = text.substring(textarea.selectionStart);

    textarea.value = `${before}@${handle} ${after}`;
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = before.length + handle.length + 2;

    hideMentionSuggestions();
    updateSendButtonState();
    autoGrowChatInput();
}

function handleMentionTyping(e) {
    const ta = e.target;
    const cursor = ta.selectionStart;
    const text = ta.value.substring(0, cursor);
    const lastAt = text.lastIndexOf('@');

    if (lastAt !== -1 && (lastAt === 0 || /\s/.test(text[lastAt - 1]))) {
        const filter = text.substring(lastAt + 1);
        if (!/\s/.test(filter)) {
            showMentionSuggestions(ta, lastAt, filter);
            return;
        }
    }
    hideMentionSuggestions();
}

chatInput?.addEventListener('input', handleMentionTyping);
chatInput?.addEventListener('keydown', (e) => {
    if (!mentionSuggestionsEl || mentionSuggestionsEl.hidden) return;

    const items = mentionSuggestionsEl.querySelectorAll('.mention-suggestions__item');
    let selectedIdx = Array.from(items).findIndex(item => item.classList.contains('is-selected'));

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        items[selectedIdx].classList.remove('is-selected');
        selectedIdx = (selectedIdx + 1) % items.length;
        items[selectedIdx].classList.add('is-selected');
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        items[selectedIdx].classList.remove('is-selected');
        selectedIdx = (selectedIdx - 1 + items.length) % items.length;
        items[selectedIdx].classList.add('is-selected');
    } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const handle = items[selectedIdx].querySelector('span:last-child').textContent.substring(1);
        insertMention(handle);
    } else if (e.key === 'Escape') {
        hideMentionSuggestions();
    }
});

// -------------------------------------------------------
// BUILD A MESSAGE ELEMENT
// -------------------------------------------------------
function buildMessageEl(chat, isOwn, enterAnimationClass, replyCount, isLatestOwn) {
    if (shouldHideReport(chat)) return null;
    const hasReply = Boolean(replyCount);
    const el = document.createElement('div');
    el.className = isOwn ? "chat-message report-card chat-message--own" : "chat-message report-card";
    if (enterAnimationClass) el.classList.add(enterAnimationClass);
    el.dataset.chatId   = chat._id || chat.id || "";
    el.dataset.createdAt = chat.createdAt;

    // Both audiences (Local and Global) mix multiple people in one feed,
    // so give each handle its own consistent card color to tell authors
    // apart at a glance. Own messages keep the existing teal styling.
    el.style.setProperty('--msg-accent', handleAccentColor(chat.handle || 'user'));
    if (!isOwn) {
        el.classList.add('chat-message--tinted');
    }
    if (chat.isAdmin) el.classList.add('chat-message--admin');

    const { status: lightStatus, text: cleanText } = parseLightStatus(chat.text);
    if (lightStatus) el.classList.add(`report-card--${lightStatus}`);

    // ---- Repost strapline, if this card is a repost of someone else's
    // report. The card's main content (author/status/text below) still
    // belongs to the ORIGINAL post — chat.repost.handle — while
    // chat.handle is whoever reposted it, called out in the strapline.
    const repost = chat.repost && chat.repost.chatId ? chat.repost : null;
    let repostTagEl = null;
    if (repost) {
        el.classList.add('report-card--reposted');
        repostTagEl = document.createElement('div');
        repostTagEl.className = 'report-card__repost-tag';
        repostTagEl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M7 7h8a3 3 0 0 1 3 3v2M17 17H9a3 3 0 0 1-3-3v-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="m5 9 2-2 2 2M19 15l-2 2-2-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span></span>';
        repostTagEl.querySelector('span').textContent = `${chat.handle || 'Someone'} reposted`;
    }
    const displayHandle = (repost && repost.handle) ? repost.handle : chat.handle;

    // ---- Head row: avatar, name + location/time, status badge, menu ----
    const head = document.createElement('div');
    head.className = 'report-card__head';

    const avatar = document.createElement('span');
    avatar.className = 'report-card__avatar';
    avatar.setAttribute('aria-hidden', 'true');
    const avatarSeed = resolveUserId(chat) || displayHandle || chat.handle;
    renderAvatarIntoEl(avatar, avatarSeed, chat.avatarImage || null);
    if (chat.handle) knownHandles.add(chat.handle);
    if (displayHandle) knownHandles.add(displayHandle);

    const who = document.createElement('div');
    who.className = 'report-card__who';

    const author = document.createElement('span');
    author.className   = "report-card__name";
    author.textContent = chat.isAdmin ? `📢 ${displayHandle}` : displayHandle;

    const meta = document.createElement('span');
    meta.className = 'report-card__meta';
    const locLabel = chatScope === CHAT_SCOPE_GLOBAL ? (chat.location || 'Everyone') : (chat.location || getLocationNameOnly());
    const metaLoc = document.createElement('span');
    metaLoc.className = 'report-card__meta-location';
    metaLoc.textContent = locLabel;
    const time = document.createElement('span');
    time.className   = "chat-message__time report-card__meta-time";
    time.textContent = formatRelativeTime(chat.createdAt);
    meta.appendChild(metaLoc);
    meta.appendChild(time);

    who.appendChild(author);
    who.appendChild(meta);

    const headActions = document.createElement('div');
    headActions.className = 'report-card__head-actions';

    if (lightStatus) {
        const badge = document.createElement('span');
        badge.className = `report-card__status-badge report-card__status-badge--${lightStatus}`;
        badge.innerHTML = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
        const badgeLabel = document.createElement('span');
        badgeLabel.textContent = lightStatus === 'on' ? 'Light is ON' : 'Light is OFF';
        badge.appendChild(badgeLabel);
        headActions.appendChild(badge);
    }

    // "More options" only now — actually replying lives in the Reply
    // stat button below (see commentStat), which opens an inline box
    // right under this card instead of jumping up to the page's main
    // composer.
    const menuWrap = document.createElement('div');
    menuWrap.className = 'report-card__menu-wrap';
    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'report-card__menu-btn';
    menuBtn.setAttribute('aria-label', 'More options');
    menuBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="12" cy="5" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="19" r="1.6" fill="currentColor"/></svg>';
    menuWrap.appendChild(menuBtn);

    const menuPanel = document.createElement('div');
    menuPanel.className = 'report-card__menu';
    const canManage = canManageOwnPost(chat, isOwn);
    const remainingMs = getRemainingEditWindowMs(chat);
    const ownActions = isOwn
        ? (canManage
            ? `<button type="button" class="report-card__menu-item" data-action="edit">Edit post (${formatWindowMinutesLeft(remainingMs)})</button><button type="button" class="report-card__menu-item report-card__menu-item--danger" data-action="delete">Delete post</button>`
            : '<button type="button" class="report-card__menu-item" disabled>Your edit/delete window has ended</button>')
        : '';
    menuPanel.innerHTML = `${ownActions}<button type="button" class="report-card__menu-item" data-action="share">Share post link</button><button type="button" class="report-card__menu-item" data-action="mute-user">Mute this person</button><button type="button" class="report-card__menu-item" data-action="mute-post">Mute this post</button><button type="button" class="report-card__menu-item" data-action="bookmark">Save as bookmark</button>`;
    menuWrap.appendChild(menuPanel);
    headActions.appendChild(menuWrap);

    menuBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const nextOpen = !menuWrap.classList.contains('is-open');
        closeAllReportCardMenus(nextOpen ? menuWrap : null);
        menuWrap.classList.toggle('is-open', nextOpen);
        el.classList.toggle('report-card--menu-open', nextOpen);
        flashIconRing(menuBtn);
    });

    menuPanel.addEventListener('click', async (ev) => {
        const btn = ev.target && ev.target.closest('.report-card__menu-item');
        if (!btn) return;
        const action = btn.getAttribute('data-action');
        const reportId = getReportId(chat);

        if (action === 'edit') {
            const latestRemainingMs = getRemainingEditWindowMs(chat);
            if (latestRemainingMs <= 0) {
                window.lwToast?.('Edit window expired (15 minutes).');
                menuWrap.classList.remove('is-open');
                el.classList.remove('report-card--menu-open');
                return;
            }

            const parsed = parseLightStatus(chat.text || '');
            const nextText = window.prompt('Edit your post', parsed.text || cleanText || '') ;
            if (nextText === null) {
                menuWrap.classList.remove('is-open');
                el.classList.remove('report-card--menu-open');
                return;
            }
            const normalized = String(nextText).trim();
            const nextRawText = parsed.status ? `${LIGHT_STATUS_PREFIX[parsed.status] || ''}${normalized || '\u200B'}` : normalized;

            const updated = await patchChatMessage(reportId, nextRawText);
            if (!updated.ok) {
                window.lwToast?.(updated.error || 'Could not edit post.');
            } else {
                window.lwToast?.('Post updated.');
                await loadChatHistory();
            }
        }

        if (action === 'delete') {
            const latestRemainingMs = getRemainingEditWindowMs(chat);
            if (latestRemainingMs <= 0) {
                window.lwToast?.('Delete window expired (15 minutes).');
                menuWrap.classList.remove('is-open');
                el.classList.remove('report-card--menu-open');
                return;
            }
            const confirmed = window.confirm('Delete this post? This cannot be undone.');
            if (!confirmed) {
                menuWrap.classList.remove('is-open');
                el.classList.remove('report-card--menu-open');
                return;
            }
            const deleted = await removeChatMessage(reportId);
            if (!deleted.ok) {
                window.lwToast?.(deleted.error || 'Could not delete post.');
            } else {
                window.lwToast?.('Post deleted.');
                await loadChatHistory();
            }
        }

        if (action === 'share') {
            const base = new URL(window.location.href);
            const shareUrl = new URL('/chat', base.origin || window.location.origin);
            if (reportId) shareUrl.searchParams.set('chatId', reportId);
            if (chat.scope) shareUrl.searchParams.set('chatScope', chat.scope);
            if (chat.location && chat.scope !== 'global') shareUrl.searchParams.set('chatLocation', chat.location);
            const urlText = shareUrl.toString();
            try {
                if (navigator.share) {
                    await navigator.share({ title: 'LightWatch community report', text: (cleanText || '').slice(0, 120), url: urlText });
                } else if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(urlText);
                    window.lwToast?.('Post URL copied.');
                }
            } catch {}
        }

        if (action === 'mute-user') {
            setHandleMuted(chat.handle || '', true);
            window.lwToast?.(`Muted ${displayHandle || 'this user'}.`);
            el.remove();
        }

        if (action === 'mute-post') {
            setReportMuted(reportId, true);
            window.lwToast?.('Post muted.');
            el.remove();
        }

        if (action === 'bookmark') {
            const next = !isReportBookmarked(reportId);
            setReportBookmarked(reportId, next);
            btn.textContent = next ? 'Saved as bookmark' : 'Save as bookmark';
            window.lwToast?.(next ? 'Saved to bookmarks.' : 'Removed from bookmarks.');
        }

        menuWrap.classList.remove('is-open');
        el.classList.remove('report-card--menu-open');
    });

    if (isReportBookmarked(getReportId(chat))) {
        const bookmarkBtn = menuPanel.querySelector('[data-action="bookmark"]');
        if (bookmarkBtn) bookmarkBtn.textContent = 'Saved as bookmark';
    }

    head.appendChild(avatar);
    head.appendChild(who);
    head.appendChild(headActions);

    // ---- Body text ----
    const body = document.createElement('p');
    body.className   = "chat-message__text report-card__text";
    body.innerHTML = formatMessageTextWithMentions(cleanText);

    let mediaEl = null;
    const media = chat.media && chat.media.url ? chat.media : null;
    if (media && (media.kind === 'image' || media.kind === 'video')) {
        mediaEl = document.createElement('figure');
        mediaEl.className = 'report-card__media';
        if (media.kind === 'video') {
            const mediaVideo = document.createElement('video');
            mediaVideo.src = media.url;
            mediaVideo.controls = true;
            mediaVideo.playsInline = true;
            mediaVideo.preload = 'metadata';
            mediaVideo.loading = 'lazy';
            mediaEl.appendChild(mediaVideo);
        } else {
            const mediaImg = document.createElement('img');
            mediaImg.src = media.url;
            mediaImg.alt = `Image shared by ${displayHandle || 'community member'}`;
            mediaImg.loading = 'lazy';
            mediaEl.appendChild(mediaImg);
        }
    }

    const reply = chat.replyTo;

    // ---- Quoted preview, if this card quotes another report ----
    let quotedEl = null;
    let quoteLeadEl = null;
    const quote = chat.quote && (chat.quote.handle || chat.quote.text) ? chat.quote : null;
    if (quote) {
        if (quote.chatId) {
            el.dataset.quoteSourceId = String(quote.chatId);
        }
        quotedEl = document.createElement('div');
        quotedEl.className = 'report-card__quoted';
        quoteLeadEl = document.createElement('p');
        quoteLeadEl.className = 'report-card__quote-lead';
        quoteLeadEl.textContent = cleanText;
        const qHead = document.createElement('div');
        qHead.className = 'report-card__quoted-head';
        qHead.textContent = `Quoted from ${quote.handle || 'someone'}`;
        const qText = document.createElement('p');
        qText.className = 'report-card__quoted-text';
        qText.innerHTML = formatMessageTextWithMentions((quote.text || '').slice(0, 180));
        quotedEl.appendChild(qHead);
        quotedEl.appendChild(qText);

        const quoteMedia = quote.media && quote.media.url ? quote.media : null;
        if (quoteMedia && (quoteMedia.kind === 'image' || quoteMedia.kind === 'video')) {
            const qMedia = document.createElement('figure');
            qMedia.className = 'report-card__media report-card__media--quoted';
            if (quoteMedia.kind === 'video') {
                const qVideo = document.createElement('video');
                qVideo.src = quoteMedia.url;
                qVideo.controls = true;
                qVideo.playsInline = true;
                qVideo.preload = 'metadata';
                qVideo.loading = 'lazy';
                qMedia.appendChild(qVideo);
            } else {
                const qImg = document.createElement('img');
                qImg.src = quoteMedia.url;
                qImg.alt = `Quoted image from ${quote.handle || 'community member'}`;
                qImg.loading = 'lazy';
                qMedia.appendChild(qImg);
            }
            quotedEl.appendChild(qMedia);
        }
    }

    // ---- Footer row: location/area tags on the left, comment/like stats on the right ----
    const footer = document.createElement('div');
    footer.className = 'report-card__footer';

    const tags = document.createElement('div');
    tags.className = 'report-card__tags';

    const locTag = document.createElement('span');
    locTag.className = 'report-card__tag report-card__tag--location';
    locTag.innerHTML = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 21s7-7.02 7-12a7 7 0 1 0-14 0c0 4.98 7 12 7 12Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="9" r="2.2" stroke="currentColor" stroke-width="1.7"/></svg>';
    const locTagLabel = document.createElement('span');
    locTagLabel.textContent = locLabel;
    locTag.appendChild(locTagLabel);

    tags.appendChild(locTag);

    const stats = document.createElement('div');
    stats.className = 'report-card__stats';

    const commentStat = document.createElement('button');
    commentStat.type = 'button';
    commentStat.className = 'report-card__stat report-card__stat--comment';
    commentStat.setAttribute('aria-label', 'Reply');
    commentStat.innerHTML = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 17L3.5 20V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 9H16M8 13H13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span class="report-card__stat-count">' + (replyCount || 0) + '</span>';
    // Reply now opens a small composer right under THIS card instead of
    // scrolling up to the page's main input (see toggleInlineReplyBox).
    commentStat.addEventListener('click', () => toggleInlineReplyBox(el, chat, cleanText, { mode: 'reply' }));
    commentStat.addEventListener('click', () => flashIconRing(commentStat));

    // Repost — a single trigger that opens a small "Repost" / "Quote"
    // menu (X/Twitter-style), instead of two separate stat buttons.
    // Picking "Repost" duplicates the original report as a new
    // top-level post credited to the current user, with a "reposted"
    // strapline (see repostTagEl above) pointing back at the original
    // author. Picking "Quote" opens the same inline composer as Reply,
    // but the result posts as a new top-level report with the original
    // embedded below the quoting user's own commentary. The old
    // dedicated Quote button is gone — this trigger now uses that
    // button's icon instead of the old repost swirl icon.
    const myUserId = getCurrentUserId();
    const reportId = getReportId(chat);

    const initialRepostCount = Math.max(0, Number(chat.repostCount || 0) + Number(chat.quoteCount || 0));
    const alreadyReposted = Boolean(myUserId) && Array.isArray(chat.repostedBy) &&
        chat.repostedBy.some((id) => String(id) === String(myUserId));

    const repostWrap = document.createElement('div');
    repostWrap.className = 'report-card__repost-wrap';

    const repostStat = document.createElement('button');
    repostStat.type = 'button';
    repostStat.className = 'report-card__stat report-card__stat--repost';
    if (alreadyReposted) repostStat.classList.add('is-reposted');
    repostStat.setAttribute('aria-label', 'Repost or quote');
    repostStat.setAttribute('aria-haspopup', 'true');
    repostStat.setAttribute('aria-expanded', 'false');
    repostStat.innerHTML = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline points="17 1 21 5 17 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 11V9a4 4 0 0 1 4-4h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><polyline points="7 23 3 19 7 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 13v2a4 4 0 0 1-4 4H3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="report-card__stat-count">${initialRepostCount}</span>`;

    const repostMenu = document.createElement('div');
    repostMenu.className = 'report-card__repost-menu';
    repostMenu.innerHTML = '<button type="button" class="report-card__menu-item" data-repost-action="repost">Repost</button><button type="button" class="report-card__menu-item" data-repost-action="quote">Quote</button><button type="button" class="report-card__menu-item" data-repost-action="view-quotes">View quotes</button>';

    async function doRepost() {
        if (repostStat.classList.contains('is-reposted') || repostStat.disabled) return;
        repostStat.disabled = true;
        const saved = await postChat({
            text: chat.text || '', // original raw text (light-status prefix included), so the repost renders identically
            repost: {
                chatId: chat._id || chat.id || '',
                handle: displayHandle || 'someone',
                text: cleanText || ''
            }
        });
        repostStat.disabled = false;
        if (saved) {
            flashIconRing(repostStat);
            repostStat.classList.add('is-reposted');
            // Optimistic bump — the server persists the real count (see
            // POST /chats' repostCount/repostedBy update) so a refresh
            // or another user's feed will show the true, shared total.
            const countEl = repostStat.querySelector('.report-card__stat-count');
            if (countEl) countEl.textContent = String(Number(countEl.textContent || 0) + 1);
        }
    }

    repostStat.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const nextOpen = !repostWrap.classList.contains('is-open');
        closeAllRepostMenus(nextOpen ? repostWrap : null);
        repostWrap.classList.toggle('is-open', nextOpen);
        repostStat.setAttribute('aria-expanded', String(nextOpen));
        flashIconRing(repostStat);
    });

    repostMenu.addEventListener('click', (ev) => {
        const btn = ev.target && ev.target.closest('[data-repost-action]');
        if (!btn) return;
        const action = btn.getAttribute('data-repost-action');
        repostWrap.classList.remove('is-open');
        repostStat.setAttribute('aria-expanded', 'false');
        if (action === 'repost') doRepost();
        if (action === 'quote') toggleInlineReplyBox(el, chat, cleanText, { mode: 'quote' });
        if (action === 'view-quotes') {
            const sourceId = String(chat._id || chat.id || '');
            const quoteMatches = sourceId
                ? [...chatThread.querySelectorAll(`.report-card[data-quote-source-id="${sourceId}"]`)]
                : [];
            if (quoteMatches.length === 0) {
                window.lwToast?.('No quoted replies for this report yet.');
                return;
            }
            quoteMatches[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
            quoteMatches.forEach((match, idx) => {
                match.classList.add('report-card--quote-highlight');
                setTimeout(() => match.classList.remove('report-card--quote-highlight'), 2200 + idx * 120);
            });
            window.lwToast?.(`Found ${quoteMatches.length} quoted ${quoteMatches.length === 1 ? 'reply' : 'replies'}.`);
        }
    });

    repostWrap.appendChild(repostStat);
    repostWrap.appendChild(repostMenu);

    // Likes are persisted server-side now (Chat.likeCount/likedBy — see
    // POST /chats/:chatId/like), so every viewer sees the same count
    // and a user's own like state survives a refresh or a different
    // device, instead of resetting to 0 the moment the tab reloads.
    const initialLikeCount = Math.max(0, Number(chat.likeCount || 0));
    const alreadyLiked = Boolean(myUserId) && Array.isArray(chat.likedBy) &&
        chat.likedBy.some((id) => String(id) === String(myUserId));

    const likeStat = document.createElement('button');
    likeStat.type = 'button';
    likeStat.className = 'report-card__stat report-card__stat--like';
    if (alreadyLiked) likeStat.classList.add('is-liked');
    likeStat.innerHTML = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 20.2s-7.6-4.7-9.9-9.3A5.7 5.7 0 0 1 12 5.6a5.7 5.7 0 0 1 9.9 5.3c-2.3 4.6-9.9 9.3-9.9 9.3Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg><span class="report-card__stat-count">${initialLikeCount}</span>`;

    let likeRequestInFlight = false;
    likeStat.addEventListener('click', async () => {
        if (likeRequestInFlight) return;
        if (!myUserId || !reportId) {
            window.lwToast?.('Sign in to like posts.');
            return;
        }

        flashIconRing(likeStat);
        const countEl = likeStat.querySelector('.report-card__stat-count');
        const previousCount = Math.max(0, Number(countEl?.textContent || 0));
        const wasLiked = likeStat.classList.contains('is-liked');
        const nextLiked = !wasLiked;

        // Optimistic UI so the tap feels instant; reconciled with the
        // server's response (or rolled back on failure) below.
        likeStat.classList.toggle('is-liked', nextLiked);
        if (nextLiked) {
            likeStat.classList.remove('is-liked-pop');
            void likeStat.offsetWidth;
            likeStat.classList.add('is-liked-pop');
            setTimeout(() => likeStat.classList.remove('is-liked-pop'), 460);
        }
        if (countEl) countEl.textContent = String(Math.max(0, previousCount + (nextLiked ? 1 : -1)));

        likeRequestInFlight = true;
        try {
            const res = await fetch(`${API_URL}/chats/${encodeURIComponent(reportId)}/like`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: myUserId, notify: true })
            });
            if (!res.ok) throw new Error('like-request-failed');
            const data = await res.json();
            likeStat.classList.toggle('is-liked', Boolean(data.liked));
            if (countEl) countEl.textContent = String(Math.max(0, Number(data.likeCount || 0)));
        } catch {
            likeStat.classList.toggle('is-liked', wasLiked);
            if (countEl) countEl.textContent = String(previousCount);
            window.lwToast?.('Could not update like. Try again.');
        } finally {
            likeRequestInFlight = false;
        }
    });

    stats.appendChild(commentStat);
    stats.appendChild(repostWrap);
    stats.appendChild(likeStat);

    footer.appendChild(tags);
    footer.appendChild(stats);

    // ---- Threaded replies ----
    // Every reply to THIS card renders nested here (see addToThread)
    // instead of appearing as its own row in the main feed. Replies
    // (chat.replyTo set) don't get their own nested section — one
    // level of nesting keeps the thread readable.
    let repliesToggle = null;
    let repliesContainer = null;
    if (!reply) {
        repliesToggle = document.createElement('button');
        repliesToggle.type = 'button';
        repliesToggle.className = 'report-card__replies-toggle';
        repliesToggle.hidden = !hasReply;
        repliesToggle.setAttribute('aria-expanded', 'false');
        const initialCount = replyCount || 0;
        repliesToggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span></span>';
        repliesToggle.querySelector('span').textContent = `${initialCount} ${initialCount === 1 ? 'reply' : 'replies'}`;

        repliesContainer = document.createElement('div');
        repliesContainer.className = 'report-card__replies';
        repliesContainer.hidden = true;

        repliesToggle.addEventListener('click', () => {
            const expanded = repliesToggle.getAttribute('aria-expanded') === 'true';
            repliesToggle.setAttribute('aria-expanded', String(!expanded));
            repliesContainer.hidden = expanded;
        });
    }

    el.appendChild(head);
    if (repostTagEl) el.insertBefore(repostTagEl, head);
    if (cleanText && !quote) el.appendChild(body);
    if (quoteLeadEl) el.appendChild(quoteLeadEl);
    if (mediaEl) el.appendChild(mediaEl);
    if (quotedEl) el.appendChild(quotedEl);
    el.appendChild(footer);
    if (repliesToggle) el.appendChild(repliesToggle);
    if (repliesContainer) el.appendChild(repliesContainer);

    // Stashed directly on the node (not dataset — these are live
    // references, not strings) so addToThread can find where to nest
    // an incoming reply without re-querying the DOM every time.
    el._repliesContainer = repliesContainer;
    el._repliesToggle = repliesToggle;

    return el;
}

// ---- Inline reply / quote composer ----
// A small textarea + send button that opens directly under a report
// card — used by both the "Reply" and "Quote" stat buttons above.
// Only one can be open across the whole thread at a time, to keep
// things tidy on a long feed.
function createInlineComposerBox(parentChat, parentText, mode) {
    const box = document.createElement('div');
    box.className = 'report-card__reply-box';
    box.dataset.mode = mode;

    const ta = document.createElement('textarea');
    ta.rows = 1;
    ta.maxLength = 240;
    ta.placeholder = mode === 'quote' ? 'Add your take on this report…' : `Reply to ${parentChat.handle || 'someone'}…`;

    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'report-card__reply-send';
    sendBtn.disabled = true;
    sendBtn.setAttribute('aria-label', mode === 'quote' ? 'Post quote' : 'Post reply');
    sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M4 12 20 4l-6 16-3-7-7-1Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';

    if (mode === 'quote') {
        const quoteLead = document.createElement('div');
        quoteLead.className = 'report-card__quote-lead report-card__quote-lead--composer';
        quoteLead.textContent = 'Your quote will show above this original report.';

        const quotePreview = document.createElement('div');
        quotePreview.className = 'report-card__quoted report-card__quoted--composer';

        const quoteHead = document.createElement('div');
        quoteHead.className = 'report-card__quoted-head';
        quoteHead.textContent = `Quoted from ${parentChat.handle || 'someone'}`;

        const quoteText = document.createElement('p');
        quoteText.className = 'report-card__quoted-text';
        quoteText.textContent = (parentText || '').slice(0, 180);

        quotePreview.appendChild(quoteHead);
        quotePreview.appendChild(quoteText);

        const quoteMedia = parentChat.media && parentChat.media.url ? parentChat.media : null;
        if (quoteMedia && (quoteMedia.kind === 'image' || quoteMedia.kind === 'video')) {
            const quoteMediaWrap = document.createElement('figure');
            quoteMediaWrap.className = 'report-card__media report-card__media--quoted';
            if (quoteMedia.kind === 'video') {
                const quoteMediaVideo = document.createElement('video');
                quoteMediaVideo.src = quoteMedia.url;
                quoteMediaVideo.controls = true;
                quoteMediaVideo.playsInline = true;
                quoteMediaVideo.preload = 'metadata';
                quoteMediaVideo.loading = 'lazy';
                quoteMediaWrap.appendChild(quoteMediaVideo);
            } else {
                const quoteMediaImg = document.createElement('img');
                quoteMediaImg.src = quoteMedia.url;
                quoteMediaImg.alt = `Quoted image from ${parentChat.handle || 'community member'}`;
                quoteMediaImg.loading = 'lazy';
                quoteMediaWrap.appendChild(quoteMediaImg);
            }
            quotePreview.appendChild(quoteMediaWrap);
        }

        box.appendChild(quoteLead);
        box.appendChild(quotePreview);
    }

    ta.addEventListener('input', () => {
        sendBtn.disabled = !ta.value.trim();
        handleMentionTyping({ target: ta });
    });
    ta.addEventListener('keydown', (e) => {
        if (!mentionSuggestionsEl || mentionSuggestionsEl.hidden) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!sendBtn.disabled) sendBtn.click();
            }
            return;
        }

        const items = mentionSuggestionsEl.querySelectorAll('.mention-suggestions__item');
        let selectedIdx = Array.from(items).findIndex(item => item.classList.contains('is-selected'));

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            items[selectedIdx].classList.remove('is-selected');
            selectedIdx = (selectedIdx + 1) % items.length;
            items[selectedIdx].classList.add('is-selected');
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            items[selectedIdx].classList.remove('is-selected');
            selectedIdx = (selectedIdx - 1 + items.length) % items.length;
            items[selectedIdx].classList.add('is-selected');
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            const handle = items[selectedIdx].querySelector('span:last-child').textContent.substring(1);
            insertMention(handle);
        } else if (e.key === 'Escape') {
            hideMentionSuggestions();
        }
    });

    sendBtn.addEventListener('click', async () => {
        const val = ta.value.trim();
        if (!val) return;
        sendBtn.disabled = true;
        ta.disabled = true;
        const parentRef = {
            chatId: parentChat._id || parentChat.id || '',
            handle: parentChat.handle || 'someone',
            text: parentText || ''
        };
        if (mode === 'quote' && parentChat.media && parentChat.media.url) {
            parentRef.media = { kind: parentChat.media.kind || 'image', url: parentChat.media.url };
        }
        const saved = await postChat(mode === 'quote'
            ? { text: val, quote: parentRef }
            : { text: val, replyTo: parentRef });
        if (saved) {
            removeComposerBox(box);
        } else {
            sendBtn.disabled = false;
            ta.disabled = false;
        }
    });

    box.appendChild(ta);
    box.appendChild(sendBtn);
    return box;
}

// ---- Native app only: keep the inline reply/quote composer clear of
// the on-screen keyboard. The composer sits appended below the card's
// own text — potentially anywhere down a long, page-scrolling thread —
// so instead of a fixed-target transform (like login/signup's single
// known field) this scrolls the page itself: the card being replied to,
// and everything above it, scrolls up just enough to bring the
// composer's textarea above the keyboard. Eases back to where the
// thread was once the field loses focus. No-op outside the native app —
// a regular mobile browser already scrolls the focused field into view. ----
function attachComposerKeyboardScroll(box) {
    if (!isNativeApp() || !window.visualViewport) return () => {};
    const ta = box.querySelector('textarea');
    if (!ta) return () => {};

    const GAP = 16; // breathing room between the composer and the keyboard
    let originalScrollY = null;

    const reposition = () => {
        if (!ta.isConnected) return;
        const viewportBottom = window.visualViewport.height + window.visualViewport.offsetTop - GAP;
        const boxBottom = box.getBoundingClientRect().bottom;
        const delta = boxBottom - viewportBottom;
        if (delta > 0) {
            window.scrollBy({ top: delta, behavior: 'smooth' });
        }
    };

    const handleFocus = () => {
        if (originalScrollY === null) originalScrollY = window.scrollY;
        requestAnimationFrame(reposition);
        setTimeout(reposition, 180); // keyboard animates in — recheck once it's settled
        setTimeout(reposition, 400);
    };

    const handleBlur = () => {
        if (originalScrollY !== null) {
            window.scrollTo({ top: originalScrollY, behavior: 'smooth' });
            originalScrollY = null;
        }
    };

    const handleNativeKeyboardState = () => {
        handleFocus();
    };

    ta.addEventListener('focus', handleFocus);
    ta.addEventListener('blur', handleBlur);
    window.visualViewport.addEventListener('resize', reposition);
    window.addEventListener('lw-keyboard-show', handleNativeKeyboardState);
    window.addEventListener('lw-keyboard-hide', handleBlur);

    handleFocus(); // the textarea is focused as soon as the box opens

    return () => {
        ta.removeEventListener('focus', handleFocus);
        ta.removeEventListener('blur', handleBlur);
        window.visualViewport.removeEventListener('resize', reposition);
    };
}

function removeComposerBox(box) {
    box._kbCleanup?.();
    box.remove();
}

function toggleInlineReplyBox(cardEl, parentChat, parentText, opts) {
    const mode = (opts && opts.mode) === 'quote' ? 'quote' : 'reply';
    const existing = cardEl.querySelector(':scope > .report-card__reply-box');
    if (existing) {
        const wasSameMode = existing.dataset.mode === mode;
        removeComposerBox(existing);
        if (wasSameMode) return; // same button tapped again — just close it
    } else {
        // Only one inline composer open across the feed at a time.
        document.querySelectorAll('#view-chat .report-card__reply-box').forEach(removeComposerBox);
    }
    const box = createInlineComposerBox(parentChat, parentText, mode);
    cardEl.appendChild(box);
    box.querySelector('textarea')?.focus();
    box._kbCleanup = attachComposerKeyboardScroll(box);
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
const knownHandles = new Set();
// Newest createdAt we've fetched so far — sent as ?since= on every poll
// after the first, so a tick with nothing new costs almost nothing
// instead of re-downloading the full (image-heavy) message list.
let lastPolledAt = null;
let pollInterval  = null;
let chatLocation  = null; // set once on load, reused by poll
let isNearBottom  = true;
let replyTarget = null;
const pendingRepliesByParent = new Map();

// Nests a reply under its parent card. Replies default to CLOSED —
// this only reveals the "N replies" toggle button (via repliesToggle
// .hidden) so the count is visible, it does NOT expand the container.
// That used to happen unconditionally here, which meant every card
// with any replies re-opened itself on every poll tick and even on
// the very first page load — "default closed" never actually held.
// Pass expandParent: true only when the reply being attached is one
// the current user just personally posted (see the addToThread call
// site below) — that's the one case where auto-opening the thread so
// they can see what they just sent is actually wanted.
function attachReplyToParent(parentEl, replyEl, expandParent = false) {
    if (!parentEl || !replyEl) return;

    const repliesContainer = parentEl._repliesContainer || parentEl.querySelector(':scope > .report-card__replies');
    const repliesToggle = parentEl._repliesToggle || parentEl.querySelector(':scope > .report-card__replies-toggle');

    if (!repliesContainer) return;

    replyEl.classList.add('report-card--nested-reply');
    repliesContainer.appendChild(replyEl);

    if (repliesToggle) {
        repliesToggle.hidden = false;
    }

    if (expandParent) {
        repliesToggle?.setAttribute('aria-expanded', 'true');
        repliesContainer.hidden = false;
    }
}

function flushPendingRepliesForParent(parentId) {
    if (!parentId || !chatThread) return;
    const queue = pendingRepliesByParent.get(String(parentId));
    if (!queue || queue.length === 0) return;

    const parentEl = [...chatThread.querySelectorAll('[data-chat-id]')]
        .find((candidate) => candidate.dataset.chatId === String(parentId));
    if (!parentEl) return;

    queue.forEach((replyEl) => attachReplyToParent(parentEl, replyEl));
    pendingRepliesByParent.delete(String(parentId));
}

function updateChatPlaceholder() {
    if (!chatInput) return;
    chatInput.placeholder = chatScope === CHAT_SCOPE_GLOBAL
        ? "What's happening with power, anywhere?"
        : "What's happening with power in your area?";
}

// Send stays visible at all times — it just looks "off" (dimmed,
// not-allowed cursor, via the :disabled CSS) until there's real text
// to send, instead of vanishing or looking broken when the chat is empty.
function updateSendButtonState() {
    if (!chatSendBtn || !chatInput) return;
    chatSendBtn.disabled = chatInput.value.trim().length === 0 && !composerMediaDataUrl;
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

// `sinceIso`, when given, is appended as ?since=... so the server only
// returns messages newer than that cursor (see GET /chats' `since`
// handling in server.js) instead of the full up-to-500-message list —
// used by the poll loop below once the initial full load has happened.
function buildChatsUrl(sinceIso) {
    const sinceParam = sinceIso ? `&since=${encodeURIComponent(sinceIso)}` : '';
    if (chatScope === CHAT_SCOPE_GLOBAL) {
        return `${API_URL}/chats?scope=global${sinceParam}`;
    }
    const loc = (targetChatLocation && pendingFocusChatId)
        ? targetChatLocation
        : (window.currentChatLocation || getCurrentChatLocation());
    if (!loc) return null;
    return `${API_URL}/chats?scope=local&location=${encodeURIComponent(loc)}${sinceParam}`;
}

// Companion to buildChatsUrl() that hits GET /chats/counts instead of
// GET /chats — same scope/location filter, but the response has no
// avatarImage/media at all (see server.js), just the like/reply-count
// fields syncLiveStatCounts() actually reads. This is what makes it
// safe to refresh every already-rendered bubble's counts on every poll
// tick without re-downloading images for up to 500 messages each time.
function buildChatsCountsUrl() {
    if (chatScope === CHAT_SCOPE_GLOBAL) {
        return `${API_URL}/chats/counts?scope=global`;
    }
    const loc = (targetChatLocation && pendingFocusChatId)
        ? targetChatLocation
        : (window.currentChatLocation || getCurrentChatLocation());
    if (!loc) return null;
    return `${API_URL}/chats/counts?scope=local&location=${encodeURIComponent(loc)}`;
}

updateChatPlaceholder();
updateScopeButtons();

chatThread?.addEventListener('scroll', () => {
    if (!chatThread) return;
    isNearBottom = chatThread.scrollTop < 80;
    chatScrollBottomBtn?.classList.toggle('is-visible', !isNearBottom);
});

function scrollChatToBottom(smooth) {
    if (!chatThread) return;
    chatThread.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
    isNearBottom = true;
    chatScrollBottomBtn?.classList.remove('is-visible');
}

chatScrollBottomBtn?.addEventListener('click', () => scrollChatToBottom(true));

function addToThread(chat, isOwn, scrollDown, animate, hasReply, isLatestOwn, expandParent = false) {
    // "Rise" for a message you just sent, "arrive" for one that just
    // came in from someone else — same idea (flows in from the bottom),
    // slightly different feel so sent vs. received still reads distinctly.
    const enterAnimationClass = animate ? (isOwn ? 'chat-message--sent-in' : 'chat-message--received-in') : null;
    const el = buildMessageEl(chat, isOwn, enterAnimationClass, hasReply, isLatestOwn);
    if (!el) return;

    // A reply nests under the card it replied to instead of taking its
    // own row in the main feed — see buildMessageEl's repliesContainer.
    // When the parent card is not on screen yet (history order or a
    // just-arrived reply on a newly-loaded parent), queue this reply and
    // attach it once the target parent card lands in the DOM. That keeps
    // the reply hierarchy stable for comment-reply style flows.
    const parentId = chat.replyTo && chat.replyTo.chatId ? String(chat.replyTo.chatId) : null;
    const parentEl = parentId
        ? [...chatThread.querySelectorAll('[data-chat-id]')]
            .find((candidate) => candidate.dataset.chatId === parentId)
        : null;

    if (parentEl && parentEl._repliesContainer) {
        // Replies default to closed. Only expand the parent's thread when
        // the caller explicitly says this reply is one the current user
        // just personally posted (see the addToThread('saved', …) call
        // below) — NOT for every reply that happens to arrive via poll,
        // and not on the initial history load either.
        attachReplyToParent(parentEl, el, expandParent);
        return;
    }

    if (parentId) {
        if (!pendingRepliesByParent.has(parentId)) {
            pendingRepliesByParent.set(parentId, []);
        }
        pendingRepliesByParent.get(parentId).push(el);
        return;
    }

    chatThread.insertBefore(el, chatThread.firstChild);
    applyPostSearchFilter(activePostSearchQuery);
    if (scrollDown || isNearBottom) {
        chatThread.scrollTop = 0;
    } else {
        // A message arrived while the user has scrolled up to read
        // history — surface the jump-to-bottom button instead of
        // silently moving their view.
        chatScrollBottomBtn?.classList.add('is-visible');
    }
    const chatId = getReportId(chat);
    if (chatId) {
        flushPendingRepliesForParent(chatId);
    }
}

// -------------------------------------------------------
// INITIAL LOAD
// -------------------------------------------------------
// Toggles the skeleton bubbles markup (#communityChatSkeleton, see
// index.html) that sit alongside #chatThread — shown while a fetch is
// in flight so the panel never shows a bare, suddenly-emptied thread
// mid-reload. Local to this function's own load cycle (not gated by
// markChatReady/window.__lwChatReady, which only ever fires once) so
// it also covers later reloads like a scope switch (setChatScope).
const chatThreadWrap = chatThread ? chatThread.closest('.chat-thread-wrap') : null;
function setChatThreadLoading(isLoading) {
    chatThreadWrap?.classList.toggle('is-loading', isLoading);
}

function loadChatHistory() {
    const loc = (targetChatLocation && pendingFocusChatId)
        ? targetChatLocation
        : (window.currentChatLocation || getCurrentChatLocation());
    if (!chatThread) {
        markChatReady();
        return Promise.resolve();
    }

    if (chatScope === CHAT_SCOPE_LOCAL && !loc) {
        markChatReady();
        return Promise.resolve();
    }

    chatLocation = loc; // kept for local-scope send calls
    setChatThreadLoading(true);
    chatThread.innerHTML = "";
    pendingRepliesByParent.clear();
    knownIds.clear();
    knownHandles.clear();
    lastPolledAt = null;

    const url = buildChatsUrl();
    if (!url) {
        setChatThreadLoading(false);
        markChatReady();
        return Promise.resolve();
    }

    return fetch(url)
        .then(r => r.json())
        .then(chats => {
            const myId = getCurrentUserId();
            const repliedCounts = computeRepliedToIds(chats);
            const latestOwnId = getLatestOwnMessageId(chats, myId);
            ;[...chats].reverse().forEach(chat => {
                if (shouldHideReport(chat)) return;
                const id = chat._id || chat.id;
                if (id) knownIds.add(id);
                addToThread(chat, resolveUserId(chat) === myId, false, false, repliedCounts.get(id) || 0, String(id) === latestOwnId);
            });
            // Every message this load just fetched is now "known" — start
            // the poll loop's delta cursor from the newest one of those
            // (chats is newest-first from the server), so the very first
            // poll tick already asks for just what's new since this load
            // rather than re-fetching everything again 1.5s later.
            if (chats.length > 0 && chats[0].createdAt) lastPolledAt = chats[0].createdAt;
            chatThread.scrollTop = 0;
            focusTargetMessageIfPresent();
            setChatThreadLoading(false);
            markChatReady();
            startPolling();
        })
        .catch(err => {
            console.error("Could not load chat history:", err);
            setChatThreadLoading(false);
            markChatReady();
        });
}

// -------------------------------------------------------
// POLLING — fetches all chats for this location and displays
// any IDs we haven't seen yet, plus keeps every existing
// card's comment/like counts current (a reply or a like from
// someone else can land on a message that's already on screen).
//
// Runs on a fast interval, AND fires immediately whenever the tab
// regains focus/visibility — mobile browsers throttle background
// setInterval timers hard (sometimes to once a minute), so without
// this a phone that was locked or tab-switched could sit showing
// stale counts for a long time even though the interval "should"
// have ticked.
// -------------------------------------------------------
async function pollChatsOnce() {
    try {
        // Two lightweight requests instead of one heavy one:
        //  - deltaUrl (?since=lastPolledAt) → only messages posted since
        //    the last tick, full fidelity (avatarImage/media included)
        //    since these are genuinely new bubbles that need to render.
        //    Almost always empty or near-empty on any given tick.
        //  - countsUrl → GET /chats/counts: like/reply counts for every
        //    message currently in the feed's window, with NO image data
        //    at all — this is what keeps already-rendered bubbles' stats
        //    current without re-downloading anything visual.
        // See server.js's GET /chats and GET /chats/counts for why this
        // split exists: re-fetching the full media-heavy list every
        // 1.5 seconds (the old behavior) is what was starving the
        // whole backend a few minutes into every deploy.
        const deltaUrl = buildChatsUrl(lastPolledAt);
        const countsUrl = buildChatsCountsUrl();
        if (!deltaUrl || !countsUrl) return;

        const [deltaRes, countsRes] = await Promise.all([fetch(deltaUrl), fetch(countsUrl)]);

        if (countsRes.ok) {
            try {
                const counts = await countsRes.json();
                syncLiveStatCounts(counts);
            } catch (e) {
                // silent — retries next tick
            }
        }

        if (!deltaRes.ok) return;
        const chats = await deltaRes.json();
        if (chats.length > 0 && chats[0].createdAt) lastPolledAt = chats[0].createdAt;
        if (chats.length === 0) return; // nothing new to render this tick

        const myId  = getCurrentUserId();
        const repliedCounts = computeRepliedToIds(chats);
        const latestOwnId = getLatestOwnMessageId(chats, myId);

        ;[...chats].reverse().forEach(chat => {
            // Isolated per-message: if rendering one new bubble throws for
            // any reason, it must not take down syncLiveStatCounts below
            // with it — that's what actually keeps comment/like counts
            // current, and skipping it silently every tick is exactly how
            // a count ends up looking permanently stuck instead of just
            // one tick behind.
            try {
                const id = chat._id || chat.id;
                if (shouldHideReport(chat)) {
                    if (id) knownIds.add(id);
                    return;
                }
                if (!id || knownIds.has(id)) return; // skip already-shown messages
                knownIds.add(id);
                addToThread(chat, resolveUserId(chat) === myId, false, true, repliedCounts.get(id) || 0, String(id) === latestOwnId);
                focusTargetMessageIfPresent();
            } catch (renderErr) {
                // silent — this message gets another shot next tick
            }
        });
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

chatInput?.addEventListener('focus', () => {
    requestAnimationFrame(() => scrollChatToBottom(false));
});

// -------------------------------------------------------
// SEND A MESSAGE
// No optimistic temp IDs. We POST to the server, get back
// the real _id, add it to knownIds, then display it.
// This way the poll can never show it again as "new".
//
// Shared by: the main composer submit handler below, each report
// card's inline reply/quote box (see buildMessageEl), and the repost
// action — all three just needed slightly different payload shapes
// around the same POST + "show it now" behavior.
// -------------------------------------------------------
async function postChat({ text, replyTo, repost, quote, media, mediaKind }) {
    const myId = getCurrentUserId();
    const loc  = chatLocation || getCurrentChatLocation();
    if (!myId) return null;
    if (chatScope === CHAT_SCOPE_LOCAL && !loc) return null;

    // Extract mentions from text
    const mentions = (text.match(/@([a-zA-Z0-9-]+)/g) || []).map(m => m.substring(1));
    const professionalMentionText = `@${myHandle} mentioned you in a post`;

    try {
        const res = await fetch(`${API_URL}/chats`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                userId: myId,
                handle: myHandle,
                text,
                scope: chatScope,
                location: chatScope === CHAT_SCOPE_GLOBAL ? 'All locations' : loc,
                replyTo: replyTo || undefined,
                repost: repost || undefined,
                quote: quote || undefined,
                media: media ? { kind: mediaKind || 'image', url: media } : undefined,
                mentions: mentions.length > 0 ? mentions : undefined,
                notify: true, // Tell backend to send push notifications
                notificationTitle: 'New Mention',
                notificationBody: professionalMentionText
            })
        });
        if (!res.ok) return null;

        const saved = await res.json();
        const realId = saved._id || saved.id;
        if (realId && !knownIds.has(realId)) {
            knownIds.add(realId);           // tell poll: skip this one
            addToThread(saved, true, true, true, false, true, true); // show it now, scroll to it, animate it in, expand its parent thread if it's a reply
        }
        return saved;
    } catch (err) {
        console.error("Failed to send:", err);
        return null;
    }
}

chatForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const rawText = chatInput.value.trim();
    if (!rawText && !composerMediaDataUrl) return;
    const baseText = rawText || (composerMediaDataUrl ? '\u200B' : '');
    const text = selectedLightStatus ? `${LIGHT_STATUS_PREFIX[selectedLightStatus]}${baseText}` : baseText;

    const myId = getCurrentUserId();
    const loc  = chatLocation || getCurrentChatLocation();
    if (!myId) return;
    if (chatScope === CHAT_SCOPE_LOCAL && !loc) return;

    // Clear input immediately so it feels fast
    chatInput.value = "";
    chatInput.focus();
    updateSendButtonState();
    resetChatInputHeight();
    const submittedMedia = composerMediaDataUrl;
    const submittedMediaKind = composerMediaKind;
    clearComposerMedia();

    // Quick tactile pop on the button itself the instant Send is hit.
    if (chatSendBtn) {
        chatSendBtn.classList.remove('is-sent-pulse');
        // Force reflow so the animation can replay on consecutive sends.
        void chatSendBtn.offsetWidth;
        chatSendBtn.classList.add('is-sent-pulse');
    }

    const saved = await postChat({ text, replyTo: replyTarget || undefined, media: submittedMedia || undefined, mediaKind: submittedMediaKind || 'image' });

    if (!saved) {
        // Put text back so user can retry
        chatInput.value = rawText;
        composerMediaDataUrl = submittedMedia;
        composerMediaKind = submittedMediaKind;
        updateComposerMediaPreview();
        updateSendButtonState();
        autoGrowChatInput();
        return;
    }

    replyTarget = null;
    if (chatReplyPreview) chatReplyPreview.hidden = true;
    setSelectedLightStatus(null);
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
// REPORT PAGE PANELS — Official News / Community Report
// -------------------------------------------------------
// News (bottom nav "News") and Report (elevated "Report" CTA) both
// land on #view-chat but each wants only its own panel visible — no
// in-page tab switcher anymore (see index.html). This just shows the
// requested panel and hides the other; the old fixed-height "app
// panel" chat layout it used to toggle a class for has been retired
// along with the popup-style CSS it depended on (chat.css), so
// #view-chat now behaves like a normal page at all times.
const reportPanelNews = document.querySelector('#view-chat .report-panel[data-panel="news"]');
const reportPanelCommunity = document.querySelector('#view-chat .report-panel[data-panel="community"]');
let currentReportPanel = 'news';

function activateReportTab(tab) {
    const nextTab = tab === 'community' ? 'community' : 'news';
    currentReportPanel = nextTab;
    const viewChat = document.getElementById('view-chat');
    viewChat?.classList.toggle('report-mode-community', nextTab === 'community');
    viewChat?.classList.toggle('report-mode-news', nextTab !== 'community');
    document.body.classList.toggle('lw-chat-community-mode', nextTab === 'community');

    if (typeof window.LWNav === 'object' && typeof window.LWNav.applyActiveNav === 'function') {
        window.LWNav.applyActiveNav(nextTab === 'news' ? 'news' : 'community');
    }

    if (reportPanelNews) reportPanelNews.hidden = nextTab !== 'news';
    if (reportPanelCommunity) reportPanelCommunity.hidden = nextTab !== 'community';

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

    // Lets components/nav-badges.js know which Report sub-page the
    // user is actually looking at, so it can clear that page's own
    // unread count/dot without wiping out the other one's — see that
    // file for why arriving on /chat alone isn't enough to mark
    // everything read.
    window.dispatchEvent(new CustomEvent('lw:report-tab-changed', { detail: { tab: nextTab } }));
}

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

// Elevated report CTA (from the bottom nav) requests an explicit
// compose/open action without auto-routing. Listen and open Community.
window.addEventListener('lw:report-elevated-click', () => {
    if (typeof window.LWNav === 'object' && typeof window.LWNav.applyActiveNav === 'function') {
        window.LWNav.applyActiveNav('community');
    }
    if (typeof window.LWRouter === 'object' && typeof window.LWRouter.navigate === 'function') {
        window.LWRouter.navigate('chat');
        setTimeout(() => {
            try {
                activateReportTab('community');
            } catch (e) { /* ignore */ }
        }, 120);
    } else {
        activateReportTab('community');
    }
});

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
    if (!isChatView) {
        document.body.classList.remove('lw-chat-community-mode');
        const viewChat = document.getElementById('view-chat');
        viewChat?.classList.remove('report-mode-community');
        viewChat?.classList.remove('report-mode-news');
    }
    lastRouteView = e.detail.view;
    if (isChatView && typeof window.LWNav === 'object' && typeof window.LWNav.applyActiveNav === 'function') {
        window.LWNav.applyActiveNav(currentReportPanel === 'news' ? 'news' : 'community');
    }

    if (e.detail.view !== 'home' && !isChatView) {
        clearInterval(pollInterval);
    } else if (chatScope === CHAT_SCOPE_GLOBAL || chatLocation) {
        startPolling();
    }

    if (isChatView) {
        const hasDeepLinkedMessage = !!new URLSearchParams(e.detail.search || window.location.search).get('chatId');
        const pendingPanel = window.__lwPendingReportPanel;
        if (pendingPanel === 'community' || pendingPanel === 'news') {
            console.debug('[chat] pending report panel:', pendingPanel);
            activateReportTab(pendingPanel);
            window.__lwPendingReportPanel = null;
        } else if (isFreshEntry) {
            const defaultPanel = 'community';
            console.debug('[chat] default report panel:', defaultPanel, 'freshEntry=', isFreshEntry, 'hasDeepLinkedMessage=', hasDeepLinkedMessage);
            activateReportTab(defaultPanel);
        } else if (hasDeepLinkedMessage) {
            console.debug('[chat] deep link forces community panel');
            activateReportTab('community');
        }
        applyIncomingChatDeepLink(e.detail.search);
    }
});
})();