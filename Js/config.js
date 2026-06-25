const API_URL = "https://lightwatch-backend.onrender.com";


// Prevent default touch behavior (shake/bounce)
document.addEventListener('touchmove', function(e) {
  e.preventDefault();
}, { passive: false });

document.addEventListener('touchstart', function(e) {
  e.preventDefault();
}, { passive: false });