// ============================================================
//  COMPONENTS/NOTIFICATION.JS
//  The little pill toast (#lw-toast) shown via window.lwToast(msg).
//
//  This used to be a copy-pasted inline <script> at the bottom of
//  home.html and location.html (identical in both). Consolidated here
//  and initialized once, globally, since the SPA only ever has one
//  #lw-toast element in the document now regardless of which view
//  is showing. views/account.js and services/push.js both call
//  window.lwToast(...) exactly as before — no call sites changed.
// ============================================================

function initToastComponent() {
    window.lwToast = function (msg, duration) {
        const el = document.getElementById('lw-toast');
        if (!el) return;
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(window.__lwToastTimer);
        window.__lwToastTimer = setTimeout(() => el.classList.remove('show'), duration || 3500);
    };
}
