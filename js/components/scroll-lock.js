// ============================================================
//  COMPONENTS/SCROLL-LOCK.JS
//  Safeguard to prevent scroll locks from getting stuck.
//  If body.modal-open or .lw-location-panel-open stays set for
//  longer than expected (e.g., a modal failed to close), this
//  will unlock it and restore scroll automatically.
// ============================================================

(function () {
    const SCROLL_LOCK_TIMEOUT = 30 * 1000; // 30 seconds
    let scrollLockWarning = null;

    function hasScrollLock() {
        const body = document.body;
        return body.classList.contains('modal-open') || body.classList.contains('lw-location-panel-open');
    }

    function resetScrollLock() {
        const html = document.documentElement;
        const body = document.body;
        
        html.classList.remove('lw-location-panel-open');
        body.classList.remove('lw-location-panel-open');
        body.classList.remove('modal-open');
        body.style.top = '';
        
        try {
            window.scrollTo(0, 0);
        } catch (err) {
            console.warn('Could not restore scroll position:', err);
        }
    }

    function checkScrollLock() {
        if (!hasScrollLock()) {
            clearTimeout(scrollLockWarning);
            scrollLockWarning = null;
            return;
        }

        // Set a warning timer — if scroll is still locked in 30 seconds,
        // something went wrong with modal closure. Unlock it.
        if (!scrollLockWarning) {
            scrollLockWarning = setTimeout(() => {
                console.warn('Scroll was locked for too long — unlocking automatically.');
                resetScrollLock();
                scrollLockWarning = null;
            }, SCROLL_LOCK_TIMEOUT);
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        setInterval(checkScrollLock, 1000);
    });

    // Expose for manual emergency unlock
    window.LWScrollLock = { reset: resetScrollLock, check: checkScrollLock };
})();
