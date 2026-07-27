// Offline image cache: the Cache API holds the actual image bytes, IndexedDB
// holds the metadata records that go with them.
//
// Most museum/archive image CDNs (confirmed for images.metmuseum.org by a
// real CORS error while building this) don't send
// Access-Control-Allow-Origin, so a normal `fetch()` of the image bytes is
// rejected by the browser even though a plain <img src> loads it fine
// (img loads don't require CORS; reading the bytes via fetch/blob does).
// The fix is a `no-cors` fetch, which succeeds but returns an "opaque"
// Response whose body can't be read from page JS (blob() on it is always
// empty) — so we can cache.put() it, but we can't turn it into a blob:
// URL ourselves. Instead, public/sw.js's fetch handler intercepts the
// <img> requests for these URLs and serves the cached opaque Response
// directly at the network layer, which the browser renders normally. That
// means offline playback of live-source images genuinely depends on the
// service worker being registered and active, not just this module.
const DB_NAME = 'slowframe-cache';
const DB_VERSION = 1;
const STORE = 'images';
const CACHE_NAME = 'slowframe-images';

// Global cap across all sources combined, not per-source — simplest thing
// that bounds tablet storage growth without an eviction policy. Once hit,
// caching just stops; existing cached images are unaffected.
const SOFT_CAP = 300;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('sourceId', 'sourceId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function cacheKey(record) {
  return `${record.source}::${record.image}`;
}

export async function getCacheStats() {
  const db = await openDB();
  const count = await new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return { count, cap: SOFT_CAP };
}

async function isCacheFull() {
  const { count } = await getCacheStats();
  return count >= SOFT_CAP;
}

export async function getCachedRecords(sourceId) {
  const db = await openDB();
  const rows = await new Promise((resolve, reject) => {
    const index = db.transaction(STORE, 'readonly').objectStore(STORE).index('sourceId');
    const req = index.getAll(IDBKeyRange.only(sourceId));
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });

  // Records keep their original network `image` URL — the service worker
  // is what serves it from cache when there's no connection, not this
  // function. We just confirm the Cache API entry is still there before
  // handing a record back, so we never offer up an image we can't serve.
  const cache = await caches.open(CACHE_NAME);
  const results = [];
  for (const row of rows) {
    const cached = await cache.match(row.record.image);
    if (!cached) continue; // evicted independently of our metadata row
    results.push(row.record);
  }
  return results;
}

// Fire-and-forget from the caller's perspective: downloads the image bytes
// (if not already cached) and records the metadata alongside them. Safe to
// call repeatedly for the same record — skips work once cached.
export async function cacheRecord(record) {
  if (!record?.image) return;
  if (await isCacheFull()) return;

  const id = cacheKey(record);
  const db = await openDB();
  const already = await new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (already) return;

  try {
    // `no-cors` is required for cross-origin image CDNs that don't send
    // Access-Control-Allow-Origin (the common case) — it always succeeds
    // as an opaque response rather than throwing, so a real network
    // failure is the only thing the catch below is left to handle. We
    // can't inspect an opaque response's status, so a 404 gets cached
    // same as a real image; acceptable tradeoff, there's no way to detect
    // it here without CORS.
    const res = await fetch(record.image, { mode: 'no-cors' });
    const cache = await caches.open(CACHE_NAME);
    await cache.put(record.image, res);

    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ id, sourceId: record.source, record, cachedAt: Date.now() });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[SlowFrame] failed to cache image:', record.image, err);
  }
}

export async function clearCache() {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  await caches.delete(CACHE_NAME);
}
