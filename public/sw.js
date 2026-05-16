// Project Ares Service Worker (Sprint v0.9 / fix v0.9.3)
//
// Strategy:
//   - /api/*               : network-first, offline JSON fallback
//   - HTML navigations     : NETWORK-FIRST (revalidate every visit) so updates
//                            land immediately. Falls back to cache only when
//                            the network fails.
//   - other static assets  : cache-first with background revalidation.
//
// Fix history:
//   - v0.9.0 (2026-04-28a): cache-first for everything → caused stale UI
//     after subsequent deploys. Bumped to v0.9.3.
//   - v0.9.3 (2026-04-28b): HTML moved to network-first. Cache version bumped
//     to force eviction of the stale settings/today/etc pages.
//   - v0.9.4 (2026-05-16): bump to evict stale JS bundles serving old nutrition
//     totals (kollagen exclusion fix from compute-day-plan + template).
const CACHE_VERSION = "ares-v0.9.4-2026-05-16";
const APP_SHELL = [
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((e) =>
            console.warn("[sw] precache miss:", url, e),
          ),
        ),
      ),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isHtmlNavigation(request) {
  if (request.mode === "navigate") return true;
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/html");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // API: network-first with JSON offline fallback
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(req).catch(
        () =>
          new Response(JSON.stringify({ status: "offline" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    return;
  }

  // HTML pages: network-first so updates land immediately. Cache backup only.
  if (isHtmlNavigation(req)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches
              .open(CACHE_VERSION)
              .then((cache) => cache.put(req, copy))
              .catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches
            .match(req)
            .then((cached) => cached ?? caches.match("/today")),
        ),
    );
    return;
  }

  // Other static assets: cache-first with background revalidation.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res.ok && res.status === 200) {
            const copy = res.clone();
            caches
              .open(CACHE_VERSION)
              .then((cache) => cache.put(req, copy))
              .catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match("/today"));
    }),
  );
});
