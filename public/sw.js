// Minimal hand-written service worker (no Workbox — keeps this consistent
// with the rest of the project's "no heavy framework" approach). Two jobs:
//
// 1. Make the app shell itself reloadable with zero connectivity (e.g.
//    reopening a previously-visited tab in airplane mode).
// 2. Serve cached artwork images (from src/cache/imageCache.js's
//    'slowframe-images' Cache API store) when there's no connection. This
//    part has to live here, not in page JS: most museum image CDNs don't
//    send CORS headers, so imageCache.js can only cache them via a
//    `no-cors` fetch, which yields an opaque Response whose body page JS
//    can never read back out. A service worker can still hand that same
//    opaque Response to the browser's own image loader, though — which is
//    exactly what the cross-origin branch below does.
const SHELL_CACHE = 'slowframe-shell-v1';
const IMAGE_CACHE = 'slowframe-images'; // must match CACHE_NAME in src/cache/imageCache.js

// Relative to this file's scope (the site root), so this works both at `/`
// (dev/kiosk) and under a GitHub Pages project subpath.
const SHELL_ASSETS = [
  './',
  './index.html',
  './images.json',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(async cache => {
        await cache.addAll(SHELL_ASSETS);
        // Vite's built JS/CSS filenames are content-hashed and change every
        // build, so they can't be hardcoded above. Instead, read the
        // index.html we just cached and precache whatever it actually
        // references — without this, those hashed assets would only get
        // cached opportunistically on a *second* online visit (the fetch
        // handler's cache-as-you-go path below never runs on the very first
        // load, since a page is never controlled by the service worker that
        // installed during that same load). Confirmed by testing: going
        // offline immediately after a single fresh visit left the shell
        // broken until this was added.
        const htmlRes = await cache.match('./index.html');
        const html = await htmlRes.text();
        const assetUrls = [...html.matchAll(/(?:src|href)="(\.\/[^"]+\.(?:js|css))"/g)].map(m => m[1]);
        if (assetUrls.length) await cache.addAll(assetUrls);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== SHELL_CACHE && k.startsWith('slowframe-shell'))
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // ignoreVary: true on both matches below — confirmed by testing that this
  // matters, not just theoretical: the dev/preview server sends `Vary:
  // Origin` on these assets, and a `<script crossorigin>`/`<link
  // crossorigin>` tag's real request carries an Origin header that the
  // plain fetch() this module used to precache them during `install` did
  // not. Per spec, Cache.match() then correctly refuses to treat those as
  // the same variant and returns nothing — even though the exact URL is
  // sitting right there in the cache. There's no way to make the precache
  // fetch's headers perfectly replicate every real request's headers, so
  // telling match() to ignore Vary entirely is the standard fix (also
  // Workbox's default behavior for this exact situation).
  const matchOptions = { ignoreVary: true };

  if (url.origin === self.location.origin) {
    // Cache-first for same-origin build output (hashed Vite assets, the
    // built index.html, the bundled starter-set manifest/images).
    event.respondWith(
      caches.match(event.request, matchOptions).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then(cache => cache.put(event.request, copy));
          }
          return res;
        }).catch(() => cached);
      })
    );
    return;
  }

  // Cross-origin artwork images: imageCache.js populates this cache
  // proactively while online (paired with each image's metadata record).
  // Serve straight from it when present — required for offline playback,
  // since these are opaque no-cors responses that only the network layer
  // (not page JS) can render. If we've never cached this exact URL, fall
  // through to the network as normal.
  event.respondWith(
    caches.open(IMAGE_CACHE)
      .then(cache => cache.match(event.request, matchOptions))
      .then(cached => cached || fetch(event.request))
  );
});
