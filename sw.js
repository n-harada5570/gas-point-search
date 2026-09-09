const CACHE = "gas-point-search-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(async cache => {
      await Promise.all(APP_SHELL.map(async path => {
        const request = new Request(path, { cache: "reload" });
        const response = await fetch(request);
        if (!response.ok) throw new Error(`Failed to cache: ${path}`);
        await cache.put(path, response);
      }));
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith("gas-point-search-") && key !== CACHE)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);

    try {
      const fresh = await fetch(request, { cache: "no-store" });
      if (fresh.ok) await cache.put(request, fresh.clone());
      return fresh;
    } catch {
      const cached = await cache.match(request);
      if (cached) return cached;

      if (request.mode === "navigate") {
        const index = await cache.match("./index.html");
        if (index) return index;
      }

      return new Response("Offline", { status: 503, statusText: "Offline" });
    }
  })());
});
