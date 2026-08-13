const Keyboard = Capacitor.Plugins.Keyboard;
const isAndroidNative = Boolean(
    window.Capacitor &&
    typeof window.Capacitor.getPlatform === 'function' &&
    window.Capacitor.getPlatform() === 'android'
);

try {
    if (screen.orientation?.lock) screen.orientation.lock('portrait').catch(() => {});
} catch {}

if (isAndroidNative) {
    const insetFixStyle = document.createElement('style');

    // FIX (3-button nav bar overlapping content): the old version tried
    // to derive the nav bar's height itself, in JS, by diffing
    // window.innerHeight against visualViewport.height (with a second,
    // dead branch trying screen.height that always resolved to `0`
    // either way — `statusInset > 0 ? 0 : 0` is `0` regardless). In an
    // edge-to-edge WebView, innerHeight and visualViewport.height both
    // already span the *entire* display — that's the point of
    // edge-to-edge, content draws behind the system bars — so that
    // diff is 0 whenever the keyboard isn't open, no matter whether the
    // device is using gesture or 3-button navigation. --lw-nav-bar-inset
    // was therefore always 0px, which is exactly why a real, opaque
    // 3-button nav bar had nothing padding it out of the way and sat on
    // top of the app's content.
    //
    // A follow-up attempt switched to reading env(safe-area-inset-*)
    // directly in CSS, on the assumption that an edge-to-edge WebView
    // populates those automatically. It doesn't: unlike iOS's
    // WKWebView, Chromium's Android WebView has no built-in path from
    // real WindowInsets to those CSS variables — something native has
    // to read them and hand them over. MainActivity.java now does
    // exactly that (see the OnApplyWindowInsetsListener added there),
    // writing the true, live inset sizes into --lw-inset-top /
    // --lw-inset-bottom as plain CSS custom properties on <html>. That
    // listener re-fires on its own whenever the insets change
    // (rotation, nav-mode switch), so nothing here needs to poll or
    // listen for resize either. env(safe-area-inset-*) is kept as a
    // secondary fallback (for a stray build without that native change,
    // or a platform where it happens to work) with 0 as the last resort.
    insetFixStyle.textContent = `
        :root {
            --lw-nav-bar-height: 60px;
            --lw-nav-surface-bg: var(--app-bg-solid, var(--bg-deep));
            --lw-nav-surface-border: var(--border-soft);
        }

        /* Status bar stays edge-to-edge — content keeps drawing behind
           it. This only keeps the topbar's own controls (title, bell,
           star) clear of the status bar's clock/icons above them. */
        body.lw-android-edge-edge .topbar {
            padding-top: var(--lw-inset-top, env(safe-area-inset-top, 0px));
        }

        /* Reserve room below the fixed nav bar so it never covers the
           last bit of a view's real content, whatever the current
           inset turns out to be. */
        body.lw-android-edge-edge {
            padding-bottom: var(--lw-inset-bottom, env(safe-area-inset-bottom, 0px));
        }

        /* Nav bar itself: solid, theme-matched background that extends
           down into the inset (instead of stopping at the icon row and
           leaving a gap), so gesture-nav devices get a slim bar and
           3-button-nav devices get a taller one that fully covers the
           system buttons' area — either way, no page background shows
           through and no icon sits under the system buttons. */
        body.lw-android-edge-edge #bottom_nav_wrapper {
            height: calc(var(--lw-nav-bar-height) + var(--lw-inset-bottom, env(safe-area-inset-bottom, 0px)));
            background: var(--lw-nav-surface-bg);
            border-top: 1px solid var(--lw-nav-surface-border);
            box-shadow: 0 -8px 18px rgba(0, 0, 0, 0.12);
            padding-bottom: var(--lw-inset-bottom, env(safe-area-inset-bottom, 0px));
            box-sizing: border-box;
        }

        body.lw-android-edge-edge #bottom_nav_wrapper .bottom-icons-container {
            width: 100%;
            max-width: none;
            height: var(--lw-nav-bar-height);
            background: transparent;
            border: none;
            border-radius: 0;
            box-shadow: none;
            backdrop-filter: none;
            -webkit-backdrop-filter: none;
            padding-bottom: 0;
            margin: 0;
        }
    `;

    document.head.appendChild(insetFixStyle);
    document.body.classList.add('lw-android-edge-edge');
}

document.documentElement.style.setProperty(
    '--login-keyboard-offset',
    '-120px'
);

document.documentElement.style.setProperty(
    '--signup-keyboard-offset',
    '-95px'
);

Keyboard.addListener('keyboardWillShow', () => {
    const loginBox = document.querySelector('.login-box');
    const signupWrap = document.querySelector('.signup-wrap');
    const cityInput = document.querySelector('#city');

    if (loginBox) {
        loginBox.classList.add('keyboard-open');
    }

    if (signupWrap && document.activeElement === cityInput) {
        signupWrap.classList.add('keyboard-open');
    }
});

Keyboard.addListener('keyboardWillHide', () => {
    const loginBox = document.querySelector('.login-box');
    const signupWrap = document.querySelector('.signup-wrap');

    if (loginBox) {
        loginBox.classList.remove('keyboard-open');
    }

    if (signupWrap) {
        signupWrap.classList.remove('keyboard-open');
    }
});