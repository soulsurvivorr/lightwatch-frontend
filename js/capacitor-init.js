const Keyboard = Capacitor.Plugins.Keyboard;

try {
    if (screen.orientation?.lock) screen.orientation.lock('portrait').catch(() => {});
} catch {}

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