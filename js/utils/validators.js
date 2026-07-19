// ============================================================
//  VALIDATORS.JS
//  Email/phone shape checks — previously copy-pasted (identically)
//  into login.js and signup.js. Classic script, plain globals.
// ============================================================

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidPhone(value) {
  return /^[0-9]{10}$/.test(value);
}
