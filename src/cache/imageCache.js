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
const DB_VERSION = 2;
const STORE = 'images';
const CACHE_NAME = 'slowframe-images';

// Cap for INCIDENTAL caching only — images cached as a side effect of being
// shown. Once hit, that caching stops; nothing is evicted. Explicit offline
// downloads (`pinned: true`) ignore this entirely and answer to the storage
// budget below instead, because a user who deliberately asked for a category
// offline should not have that silently refused by a quota that filled up on
// its own.
const SOFT_CAP = 300;

// A count cap is a bad fit once real payloads are known: 300 images is ~18 MB
// of Met but over 1 GB of NPS (measured 2026-08-08, a 55x spread). Downloads
// are therefore bounded by bytes, and the ceiling is asked of the device rather
// than hardcoded — a dedicated wall tablet and a phone that's nearly full
// should not get the same answer.
//
// Note on accuracy: image bytes are stored as *opaque* responses (see the
// header comment), and browsers deliberately pad opaque entries in quota
// accounting, so `usage` reads higher than the real byte total. That's the
// right number to budget against anyway — it's the one the browser will
// enforce a QuotaExceededError against.
const BUDGET_SHARE = 0.5;                      // of the quota offered to this origin
const BUDGET_CEILING = 4 * 1024 * 1024 * 1024; // a 500 GB desktop quota shouldn't imply a 250 GB budget
const BUDGET_FLOOR = 200 * 1024 * 1024;        // still allow a modest download on a cramped device

export async function getStorageBudget() {
  let usage = 0;
  let quota = 0;
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      usage = est.usage || 0;
      quota = est.quota || 0;
    }
  } catch {
    /* Storage Manager unavailable (older WebView, private mode) — fall through
       to the floor, so downloads still work rather than being refused. */
  }
  const budget = quota
    ? Math.min(Math.max(quota * BUDGET_SHARE, BUDGET_FLOOR), BUDGET_CEILING)
    : BUDGET_FLOOR;
  return { usage, quota, budget, available: Math.max(0, budget - usage) };
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = req.result;
      const store = db.objectStoreNames.contains(STORE)
        ? req.transaction.objectStore(STORE)
        : (() => {
            const s = db.createObjectStore(STORE, { keyPath: 'id' });
            s.createIndex('sourceId', 'sourceId', { unique: false });
            return s;
          })();
      // v1 -> v2: offline downloads need to be listable and removable as a
      // unit. Rows written by v1 have no `collection`, so they simply don't
      // appear in this index — which is correct, they were incidental caching.
      //
      // multiEntry because one image can belong to several downloads at once:
      // Commons' "Landscapes" and "Mountains" categories genuinely overlap, and
      // so do two Openverse subject searches. Keying a row to a single
      // collection would mean removing one download could delete bytes another
      // still needs.
      if (e.oldVersion < 2 && !store.indexNames.contains('collections')) {
        store.createIndex('collections', 'collections', { multiEntry: true });
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
//
// `pinned` marks a record as part of an explicit offline download: it bypasses
// SOFT_CAP and is bounded by the storage budget instead, and `collection` is
// what lets it be listed and removed as a unit later. Returns a short status
// string so a download loop can report why it stopped rather than appearing to
// succeed while doing nothing — the failure mode this whole area keeps hitting.
export async function cacheRecord(record, { pinned = false, collection = null, label = null } = {}) {
  if (!record?.image) return 'skipped';
  if (pinned) {
    const { available } = await getStorageBudget();
    if (available <= 0) return 'budget-full';
  } else if (await isCacheFull()) {
    return 'cap-full';
  }

  const id = cacheKey(record);
  const db = await openDB();
  const already = await new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  // An image already cached still needs its collection membership recorded when
  // it turns up in a download — whether it was cached incidentally (so it's
  // unpinned and evictable) or as part of a different, overlapping collection.
  // The bytes are already there, so this is a metadata-only update.
  if (already) {
    const collections = already.collections || [];
    if (!pinned || collections.includes(collection)) return 'already';
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({
        ...already,
        collections: [...collections, collection],
        labels: { ...(already.labels || {}), [collection]: label },
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    return 'promoted';
  }

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
      tx.objectStore(STORE).put({
        id, sourceId: record.source, record, cachedAt: Date.now(),
        // Only set on pinned rows: an undefined `collection` keeps incidental
        // caching out of the collection index, which is what makes
        // listDownloads() mean "things the user actually asked for".
        ...(pinned ? { collections: [collection], labels: { [collection]: label } } : {}),
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    return 'cached';
  } catch (err) {
    console.warn('[SlowFrame] failed to cache image:', record.image, err);
    return 'failed';
  }
}

// Everything the user has explicitly taken offline, grouped for display.
export async function listDownloads() {
  const db = await openDB();
  const rows = await new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });

  const groups = new Map();
  for (const row of rows) {
    for (const collection of row.collections || []) {
      const g = groups.get(collection) || {
        collection,
        label: row.labels?.[collection] || collection,
        sourceId: row.sourceId,
        count: 0,
        newestAt: 0,
      };
      g.count += 1;
      g.newestAt = Math.max(g.newestAt, row.cachedAt || 0);
      groups.set(collection, g);
    }
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}

// Removes one downloaded collection: its metadata rows and its image bytes.
// An image that's also in another collection keeps its bytes — deleting a
// "Mountains" download shouldn't blank out half of "Landscapes".
export async function removeDownload(collection) {
  const db = await openDB();
  const rows = await new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });

  const affected = rows.filter(r => (r.collections || []).includes(collection));
  const cache = await caches.open(CACHE_NAME);

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const row of affected) {
      const remaining = row.collections.filter(c => c !== collection);
      if (remaining.length) {
        // Still wanted by another download — drop this membership, keep the
        // bytes. Removing "Mountains" must not blank out half of "Landscapes".
        const labels = { ...(row.labels || {}) };
        delete labels[collection];
        store.put({ ...row, collections: remaining, labels });
      } else {
        store.delete(row.id);
      }
    }
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });

  // Bytes are deleted only for rows that are now gone entirely.
  for (const row of affected) {
    if (row.collections.filter(c => c !== collection).length === 0) {
      await cache.delete(row.record.image);
    }
  }

  return affected.length;
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
