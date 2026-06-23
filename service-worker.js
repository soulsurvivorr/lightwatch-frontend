if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js")
    .then(() => console.log("SW registered"))
    .catch(err => console.log("SW failed:", err));
}