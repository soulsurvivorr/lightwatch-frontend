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
let navTransitionFailSafe = null;

function ensureBootLoaderElement() {
    if (document.getElementById('lwBootLoader')) return;

    const loader = document.createElement('div');
    loader.className = 'lw-boot-loader';
    loader.id = 'lwBootLoader';
    loader.setAttribute('aria-hidden', 'true');
    loader.innerHTML = `
      <div class="lw-loader-orbit">
        <div class="lw-loader-halo"></div>
        <svg class="lw-loader-ring" viewBox="0 0 84 84" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <circle class="lw-loader-track" cx="42" cy="42" r="36" />
                    <circle class="lw-loader-arc lw-loader-arc--1" cx="42" cy="42" r="36" />
                    <circle class="lw-loader-arc lw-loader-arc--2" cx="42" cy="42" r="36" />
                    <circle class="lw-loader-arc lw-loader-arc--3" cx="42" cy="42" r="36" />
        </svg>
        <div class="lw-loader-core">
          <svg viewBox="0 0 24 24" fill="#D6A24A" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M13.3 2.7L5.8 13.1a1 1 0 0 0 .8 1.6h4l-.9 6.4a1 1 0 0 0 1.8.7l7.5-10.4a1 1 0 0 0-.8-1.6h-4l.9-6.4a1 1 0 0 0-1.8-.7z" />
          </svg>
        </div>
      </div>`;

    document.body.prepend(loader);
}

function triggerLightningTransition() {
    ensureBootLoaderElement();
    document.body?.classList.add('app-loading');

    // Failsafe: if navigation doesn't happen, release the overlay.
    clearTimeout(navTransitionFailSafe);
    navTransitionFailSafe = setTimeout(() => {
        document.body?.classList.remove('app-loading');
    }, 900);
}

window.addEventListener('pageshow', () => {
    clearTimeout(navTransitionFailSafe);
    navTransitionFailSafe = null;
    document.body?.classList.remove('app-loading');
});

window.addEventListener('beforeunload', () => {
    clearTimeout(navTransitionFailSafe);
    navTransitionFailSafe = null;
});

function isInternalNavigationHref(rawHref) {
    if (!rawHref) return false;
    if (rawHref.startsWith('#') || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) {
        return false;
    }

    try {
        const url = new URL(rawHref, window.location.href);
        return url.origin === window.location.origin;
    } catch {
        return false;
    }
}

function isSamePageNavigation(rawHref) {
    if (!rawHref) return false;
    try {
        const next = new URL(rawHref, window.location.href);
        return next.origin === window.location.origin
            && next.pathname === window.location.pathname
            && (next.search || '') === (window.location.search || '');
    } catch {
        return false;
    }
}

function bindNavigationLoader() {
    // Trigger loader only on confirmed navigation clicks.
    document.querySelectorAll('a[href]').forEach(link => {
        if (link.dataset.loaderBound === '1') return;
        link.dataset.loaderBound = '1';

        link.addEventListener('click', () => {
            const href = link.getAttribute('href') || '';
            if (!isInternalNavigationHref(href)) return;
            if (isSamePageNavigation(href)) return;
            triggerLightningTransition();
        });
    });

    // Handle existing inline button navigation like window.location.href='...'.
    document.querySelectorAll('button[onclick]').forEach(btn => {
        if (btn.dataset.loaderBound === '1') return;
        const inlineHandler = btn.getAttribute('onclick') || '';
        const navigates = /window\.location\.(href|assign|replace)\s*=|window\.location\.(assign|replace)\(/.test(inlineHandler);
        if (!navigates) return;

        btn.dataset.loaderBound = '1';
        btn.addEventListener('click', triggerLightningTransition);
    });
}

function applyNavVisibility() {

    const isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
    const navLinks = document.querySelectorAll('#primaryNav .nav__link');

    navLinks.forEach(link => {
        const section = link.dataset.nav;

        if (isMobile) {
            // on mobile, only Home and Reports stay in the
            // dropdown nav (Account/You is reachable via the
            // bottom nav bar instead, so it's not duplicated here)
            const allowedOnMobile = section === "home" || section === "areas" || section === "reports";
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
        'areas.html': 'areas',
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
bindNavigationLoader();