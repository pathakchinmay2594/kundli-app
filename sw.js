const CACHE = "kundli-ai-v1";
const ASSETS = [
  "./",
  "index.html",
  "app.js",
  "kundli.js",
  "manifest.webmanifest",
  "lib/tz.js",
  "lib/src/swisseph.js",
  "lib/wasm/swisseph.js",
  "lib/wasm/swisseph.wasm",
  "lib/wasm/swisseph.data",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(
      (cached) => cached ||
        fetch(event.request).then((response) => {
          if (response.ok && event.request.method === "GET") {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
    )
  );
});
