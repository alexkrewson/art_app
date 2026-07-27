import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCachedRecords, cacheRecord, clearCache, getCacheStats } from './imageCache.js';

const CACHE_NAME = 'slowframe-images';

// Minimal in-memory stand-in for the browser Cache Storage API — jsdom
// doesn't implement it, and this module's whole job is bridging IndexedDB
// (real, via fake-indexeddb) with the Cache API (faked here).
class FakeCache {
  constructor() { this.store = new Map(); }
  async put(request, response) { this.store.set(this._key(request), response); }
  async match(request) { return this.store.get(this._key(request)); }
  _key(request) { return typeof request === 'string' ? request : request.url; }
}
class FakeCacheStorage {
  constructor() { this.named = new Map(); }
  async open(name) {
    if (!this.named.has(name)) this.named.set(name, new FakeCache());
    return this.named.get(name);
  }
  async delete(name) { return this.named.delete(name); }
}

function record(overrides = {}) {
  return { title: 'A', artist: '', date: '', department: '', image: 'https://x/img.jpg', source: 'met', ...overrides };
}

describe('imageCache', () => {
  beforeEach(async () => {
    vi.stubGlobal('caches', new FakeCacheStorage());
    vi.stubGlobal('fetch', vi.fn(async () => ({})));
    await clearCache(); // real IndexedDB persists across tests (fake-indexeddb, module-level connections never close) — clear its store rather than deleting the database, which would hang waiting on those open connections
  });

  it('caches a record and makes it retrievable by source', async () => {
    const r = record({ source: 'met' });
    await cacheRecord(r);
    const results = await getCachedRecords('met');
    expect(results).toEqual([r]);
  });

  it('only returns records for the requested source', async () => {
    await cacheRecord(record({ source: 'met', image: 'https://x/1.jpg' }));
    await cacheRecord(record({ source: 'aic', image: 'https://x/2.jpg' }));
    expect(await getCachedRecords('met')).toHaveLength(1);
    expect(await getCachedRecords('aic')).toHaveLength(1);
    expect(await getCachedRecords('nasa')).toEqual([]);
  });

  it('skips records with no image', async () => {
    await cacheRecord(record({ image: undefined }));
    await cacheRecord(record({ image: '' }));
    expect(fetch).not.toHaveBeenCalled();
    expect((await getCacheStats()).count).toBe(0);
  });

  it('is idempotent for the same record — a second call does not re-fetch', async () => {
    const r = record();
    await cacheRecord(r);
    await cacheRecord(r);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await getCacheStats()).count).toBe(1);
  });

  it('excludes a record whose image was independently evicted from the Cache API', async () => {
    const r = record({ source: 'met' });
    await cacheRecord(r);
    // Simulate the browser evicting the cached bytes without touching our
    // IndexedDB metadata row.
    const cache = await caches.open(CACHE_NAME);
    cache.store.delete(r.image);

    expect(await getCachedRecords('met')).toEqual([]);
  });

  it('swallows a fetch failure and leaves no metadata row behind', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(cacheRecord(record())).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    expect((await getCacheStats()).count).toBe(0);
  });

  it('reports the soft cap and stops caching once it is reached', async () => {
    expect((await getCacheStats()).cap).toBe(300);

    for (let i = 0; i < 300; i++) {
      await cacheRecord(record({ image: `https://x/${i}.jpg` }));
    }
    expect((await getCacheStats()).count).toBe(300);

    await cacheRecord(record({ image: 'https://x/over-cap.jpg' }));
    expect((await getCacheStats()).count).toBe(300);
    expect(await getCachedRecords('met')).toHaveLength(300);
  }, 20000);

  it('clearCache empties both the metadata store and the image cache', async () => {
    await cacheRecord(record());
    await clearCache();
    expect((await getCacheStats()).count).toBe(0);
    expect(await getCachedRecords('met')).toEqual([]);
  });
});
