// ============================================================
//  COMPONENTS/REPORT-MODAL.JS
//  Backs the bottom nav's elevated "+" Report button (item 4/5 of
//  the redesign brief — Report is now a quick action available from
//  anywhere, separate from the Chats page). Posts straight to the
//  same /lightstatus endpoint views/profile.js's own Home-page light
//  switch uses, for whichever location the person has set as
//  primary, so a report made here shows up everywhere else in the
//  app right away.
// ============================================================

(function () {
    function getCurrentUserId() {
        const session = typeof getSession === 'function' ? getSession() : null;
        if (session?.user?.id) return session.user.id;
        return localStorage.getItem('currentUserId') || sessionStorage.getItem('currentUserId');
    }

    function getCurrentLocation() {
        if (window.currentChatLocation) return window.currentChatLocation;
        const raw = localStorage.getItem('currentUserData') || localStorage.getItem('signupUser');
        if (!raw) return null;
        try {
            const user = JSON.parse(raw);
            return user.city ? `${user.city}, ${user.region || ''}`.trim() : (user.region || null);
        } catch { return null; }
    }

    function toast(msg) {
        if (typeof window.lwToast === 'function') window.lwToast(msg);
    }

    function initReportModal() {
        const overlay = document.getElementById('reportModalOverlay');
        const openBtn = document.getElementById('bottomNavReportBtn');
        const closeBtn = document.getElementById('reportModalClose');
        const onBtn = document.getElementById('reportModalOnBtn');
        const offBtn = document.getElementById('reportModalOffBtn');
        const locationLabel = document.getElementById('reportModalLocation');
        if (!overlay || !openBtn) return;

        function open() {
            const loc = getCurrentLocation();
            if (locationLabel) {
                locationLabel.textContent = loc
                    ? `Reporting for ${loc.split(',')[0]}`
                    : 'Set your location in Account to report';
            }
            overlay.classList.add('is-open');
            overlay.setAttribute('aria-hidden', 'false');
        }

        function close() {
            overlay.classList.remove('is-open');
            overlay.setAttribute('aria-hidden', 'true');
        }

        function submit(status, btn) {
            const location = getCurrentLocation();
            if (!location) {
                toast('Add your location in Account first so reports know where to go.');
                return;
            }
            const userId = getCurrentUserId();
            [onBtn, offBtn].forEach(b => b && (b.disabled = true));

            const done = (ok) => {
                [onBtn, offBtn].forEach(b => b && (b.disabled = false));
                close();
                toast(ok
                    ? `Thanks — reported light ${status.toUpperCase()} in ${location.split(',')[0]}.`
                    : `Saved locally — couldn't reach the server just now.`);
                window.dispatchEvent(new CustomEvent('lw:light-status-reported', { detail: { location, status } }));
            };

            if (typeof API_URL === 'undefined') { done(false); return; }

            fetch(`${API_URL}/lightstatus`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ location, status, userId })
            })
                .then(r => r.json())
                .then(() => done(true))
                .catch(() => done(false));
        }

        openBtn.addEventListener('click', open);
        closeBtn?.addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        onBtn?.addEventListener('click', () => submit('on', onBtn));
        offBtn?.addEventListener('click', () => submit('off', offBtn));
        window.addEventListener('lw:route-changed', close);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initReportModal();
        });
    } else {
        initReportModal();
    }
})();