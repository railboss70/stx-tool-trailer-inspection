// Offline support: caches the app so it opens with no cell signal.
// Bump VERSION whenever you change any file so phones pick up the update.
const VERSION = "stx-tti-v10";
const FILES = [
  "./", "index.html", "css/style.css", "manifest.webmanifest",
  "js/items.js", "js/signature.js", "js/pdf.js", "js/app.js",
  "vendor/jspdf.umd.min.js", "assets/logo.js", "assets/stx-logo.jpg",
  "assets/icon-180.png", "assets/icon-192.png", "assets/icon-512.png",
  "assets/icon-maskable-512.png", "assets/favicon-32.png", "assets/icon.svg",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
// Network first (so updates show up), fall back to cache when offline.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
