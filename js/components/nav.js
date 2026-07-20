// ============================================================
//  COMPONENTS/NAV.JS
//  Dropdown nav visibility (mobile hides Alerts/Account since the
//  bottom bar covers them) + active-link highlighting.
//
//  Changed vs. the original nav.js:
//   - The click-triggered boot-loader/"lightning transition" is
//     gone. That existed to paper over the blank gap while a real
//     new HTML document loaded. Switching views in the SPA is
//     synchronous DOM show/hide — there is no gap to paper over.
//   - Every nav link and bottom-nav link now carries
//     data-route="<view>" instead of href="somepage.html". Clicks
//     are handled here by calling window.LWRouter.navigate(); the
//     router itself fires the 'lw:route-changed' event this file
//     listens for to refresh which link is marked active (instead
//     of re-deriving it from location.pathname, which no longer
//     changes shape per page).
// ============================================================

const MOBILE_BREAKPOINT = 720;

function applyNavVisibility() {
    const isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
    const navLinks = document.querySelectorAll('#primaryNav .nav__link');

    navLinks.forEach(link => {
        const section = link.dataset.nav;
        if (isMobile) {
            const allowedOnMobile = section === "home" || section === "areas" || section === "reports" || section === "chat";
            link.style.display = allowedOnMobile ? "" : "none";
        } else {
            link.style.display = "";
        }
    });
}

function applyActiveNav(section) {
    document.querySelectorAll('#primaryNav .nav__link').forEach(link => {
        link.classList.toggle('nav__link--active', link.dataset.nav === section);
    });
    document.querySelectorAll('.bottom-nav-link[data-nav]').forEach(link => {
        link.classList.toggle('bottom-nav-link--active', link.dataset.nav === section);
    });
}

function bindRouteLinks() {
    document.querySelectorAll('[data-route]').forEach(link => {
        if (link.dataset.navBound === '1') return;
        link.dataset.navBound = '1';
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const view = link.dataset.route;
            if (!view) return;
            window.LWRouter.navigate(view);
        });
    });
}

function initNav() {
    applyNavVisibility();
    bindRouteLinks();
    window.addEventListener('resize', applyNavVisibility);
    window.addEventListener('lw:route-changed', (e) => {
        applyActiveNav(e.detail.view);
        bindRouteLinks(); // covers any nav links a newly-mounted view added
    });
}

window.LWNav = { initNav, applyActiveNav, bindRouteLinks };
