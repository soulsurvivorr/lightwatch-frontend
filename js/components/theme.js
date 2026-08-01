// ============================================================
//  THEME.JS — Light/Dark mode + desktop toggle
//  Default: follow system theme unless user has chosen one.
// ============================================================

(function () {
    const THEME_KEY = 'lw_theme_pref';
    const DARK_QUERY = '(prefers-color-scheme: dark)';
    const LAPTOP_QUERY = '(min-width: 1024px)';
    const PHONE_QUERY = '(max-width: 1023px)';

    const root = document.documentElement;
    const darkMedia = window.matchMedia(DARK_QUERY);
    const laptopMedia = window.matchMedia(LAPTOP_QUERY);
    const phoneMedia = window.matchMedia(PHONE_QUERY);

    function getStoredTheme() {
        const value = localStorage.getItem(THEME_KEY);
        return value === 'light' || value === 'dark' || value === 'device' ? value : 'device';
    }

    function getResolvedTheme() {
        const stored = getStoredTheme();
        if (stored === 'light' || stored === 'dark') {
            return stored;
        }
        return darkMedia.matches ? 'dark' : 'light';
    }

    function setMetaThemeColor(theme) {
        const meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) return;
        meta.setAttribute('content', theme === 'dark' ? '#0B3D91' : '#FFFFFF');
    }

    function applyTheme(theme) {
        const resolvedTheme = theme === 'dark' ? 'dark' : 'light';
        root.setAttribute('data-theme', resolvedTheme);
        root.style.setProperty('color-scheme', resolvedTheme);
        setMetaThemeColor(resolvedTheme);
        syncToggleUI(resolvedTheme);
    }

    function syncToggleUI(theme) {
        const btn = document.getElementById('lwThemeToggle');
        if (!btn) return;

        const next = theme === 'dark' ? 'light' : 'dark';
        btn.setAttribute('aria-label', `Switch to ${next} mode`);
        btn.setAttribute('title', `Switch to ${next} mode`);

        const icon = btn.querySelector('.lw-theme-toggle__icon');
        const text = btn.querySelector('.lw-theme-toggle__label');

        if (icon) icon.textContent = theme === 'dark' ? '☀' : '◐';
        if (text) text.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
    }

    function toggleTheme() {
        const current = root.getAttribute('data-theme') || getResolvedTheme();
        const next = current === 'dark' ? 'light' : 'dark';
        localStorage.setItem(THEME_KEY, next);
        applyTheme(next);
    }

    function ensureToggleButton() {
        let btn = document.getElementById('lwThemeToggle');
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.id = 'lwThemeToggle';
            btn.className = 'lw-theme-toggle';
            btn.innerHTML = '<span class="lw-theme-toggle__icon" aria-hidden="true">◐</span><span class="lw-theme-toggle__label">Dark mode</span>';
            btn.addEventListener('click', toggleTheme);
            document.body.appendChild(btn);
        }

        // Always allow the theme toggle to be visible (mobile + desktop).
        // Users can pick the white/light theme on any device; account
        // settings will later provide a persisted preference.
        btn.hidden = false;
        syncToggleUI(root.getAttribute('data-theme') || getResolvedTheme());
    }

    function initTheme() {
        applyTheme(getResolvedTheme());
        ensureToggleButton();
    }

    function handleThemePreferenceChange() {
        applyTheme(getResolvedTheme());
        ensureToggleButton();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTheme);
    } else {
        initTheme();
    }

    window.addEventListener('lw-display-prefs-changed', handleThemePreferenceChange);

    darkMedia.addEventListener('change', () => {
        if (getStoredTheme() === 'device') {
            applyTheme(getResolvedTheme());
        }
    });

    laptopMedia.addEventListener('change', ensureToggleButton);
    laptopMedia.addEventListener('change', handleThemePreferenceChange);
    phoneMedia.addEventListener('change', handleThemePreferenceChange);
})();
