// =========================================================
// nav.js
// At 768px and below, the dropdown nav menu (the one behind
// the hamburger icon) should only show Home and Reports —
// Alerts and the in-menu Account link drop out, since the
// bottom nav bar already covers Home / Reports / You at that
// size. This keeps the same HTML for both desktop and mobile,
// just hides what's redundant on small screens via JS.
// =========================================================

const MOBILE_BREAKPOINT = 720;
const ACTIVE_NAV_KEY = 'lw_active_nav';

function applyNavVisibility() {

    const isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
    const navLinks = document.querySelectorAll('#primaryNav .nav__link');

    navLinks.forEach(link => {
        const section = link.dataset.nav;

        if (isMobile) {
            // on mobile, only Home and Reports stay in the
            // dropdown nav (Account/You is reachable via the
            // bottom nav bar instead, so it's not duplicated here)
            const allowedOnMobile = section === "home" || section === "reports";
            link.style.display = allowedOnMobile ? "" : "none";
        } else {
            // full desktop nav — show everything
            link.style.display = "";
        }
    });
}

// run once on load, and again any time the window is resized
// (e.g. rotating a tablet, or resizing a browser window)
applyNavVisibility();
window.addEventListener('resize', applyNavVisibility);


// -----------------------------------------------------
// ACTIVE LINK HIGHLIGHTING
// Marks whichever nav link matches the current page as
// active, in both the dropdown nav and the bottom nav bar.
// -----------------------------------------------------
function highlightActiveNav() {

    const currentFile = window.location.pathname.split('/').pop() || 'home.html';

    const pageToSection = {
        'home.html': 'home',
        'reports.html': 'reports',
        'alerts.html': 'alerts',
        'account.html': 'account'
    };

    const currentSection = pageToSection[currentFile] || sessionStorage.getItem(ACTIVE_NAV_KEY) || 'home';

    function applyActive(section) {
        document.querySelectorAll('#primaryNav .nav__link').forEach(link => {
            link.classList.toggle('nav__link--active', link.dataset.nav === section);
        });

        document.querySelectorAll('.bottom-nav-link[data-nav]').forEach(link => {
            link.classList.toggle('bottom-nav-link--active', link.dataset.nav === section);
        });
    }

    applyActive(currentSection);

    // Instant visual feedback on click, even before navigation completes.
    document.querySelectorAll('#primaryNav .nav__link, .bottom-nav-link[data-nav]').forEach(link => {
        if (link.dataset.navBound === '1') return;
        link.dataset.navBound = '1';
        link.addEventListener('click', () => {
            const nextSection = link.dataset.nav;
            if (!nextSection) return;
            sessionStorage.setItem(ACTIVE_NAV_KEY, nextSection);
            applyActive(nextSection);
        });
    });
}

highlightActiveNav();