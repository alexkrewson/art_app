import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getCachedRecords, cacheRecord, clearCache, getCacheStats,
  listDownloads, removeDownload, getStorageBudget,
} from './imageCache.js';

const CACHE_NAME = 'slowframe-images';

// Minimal in-memory stand-in for the browser Cache Storage API — jsdom
// doesn't implement it, and this module's whole job is bridging IndexedDB
// (real, via fake-indexeddb) with the Cache API (faked here).
class FakeCache {
  constructor() { this.store = new Map(); }
  async put(request, response) { this.store.set(this._key(request), response); }
  async match(request) { return this.store.get(this._key(request)); }
  async delete(request) { return this.store.delete(this._key(request)); }
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

    // Still never throws — a failed cache write must not break playback. It
    // now reports the outcome instead of returning undefined, so a download
    // loop can say why it stopped rather than appearing to have worked.
    await expect(cacheRecord(record())).resolves.toBe('failed');
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

  describe('offline downloads (pinned collections)', () => {
    const pin = (collection, label, image) =>
      cacheRecord(record({ image }), { pinned: true, collection, label });

    it('groups pinned records into named collections', async () => {
      await pin('met::a', 'Met — A', 'https://x/1.jpg');
      await pin('met::a', 'Met — A', 'https://x/2.jpg');
      await pin('met::b', 'Met — B', 'https://x/3.jpg');
      await cacheRecord(record({ image: 'https://x/incidental.jpg' })); // unpinned

      const groups = await listDownloads();
      expect(groups.map(g => [g.label, g.count])).toEqual([['Met — A', 2], ['Met — B', 1]]);
    });

    it('leaves incidental caching out of the downloads list', async () => {
      await cacheRecord(record({ image: 'https://x/seen.jpg' }));
      expect(await listDownloads()).toEqual([]);
    });

    it('ignores the incidental soft cap when pinning', async () => {
      for (let i = 0; i < 300; i++) await cacheRecord(record({ image: `https://x/${i}.jpg` }));
      expect((await getCacheStats()).count).toBe(300);

      // The whole point: a deliberate download must not be refused because
      // background caching happened to fill the count cap first.
      expect(await pin('met::x', 'Met — X', 'https://x/pinned.jpg')).toBe('cached');
      expect((await listDownloads())[0].count).toBe(1);
    });

    it('promotes an already-cached image when it turns up in a download', async () => {
      await cacheRecord(record({ image: 'https://x/shared.jpg' }));
      expect(await listDownloads()).toEqual([]);

      expect(await pin('met::x', 'Met — X', 'https://x/shared.jpg')).toBe('promoted');
      expect((await listDownloads())[0].count).toBe(1);
    });

    it('removes one collection and its bytes', async () => {
      await pin('met::a', 'Met — A', 'https://x/1.jpg');
      await pin('met::b', 'Met — B', 'https://x/2.jpg');

      expect(await removeDownload('met::a')).toBe(1);
      expect((await listDownloads()).map(g => g.collection)).toEqual(['met::b']);
      const cache = await caches.open(CACHE_NAME);
      expect(await cache.match('https://x/1.jpg')).toBeUndefined();
      expect(await cache.match('https://x/2.jpg')).toBeDefined();
    });

    it('keeps bytes an image still shared with another collection needs', async () => {
      await pin('met::a', 'Met — A', 'https://x/shared.jpg');
      await pin('met::b', 'Met — B', 'https://x/shared.jpg');

      await removeDownload('met::a');
      const cache = await caches.open(CACHE_NAME);
      // Deleting "Mountains" must not blank out half of "Landscapes".
      expect(await cache.match('https://x/shared.jpg')).toBeDefined();
      expect((await listDownloads())[0].collection).toBe('met::b');
    });

    it('refuses a pinned write once the storage budget is spent', async () => {
      vi.stubGlobal('navigator', {
        storage: { estimate: async () => ({ usage: 9e9, quota: 10e9 }) },
      });
      // Budget is a share of quota (5e9 here), and usage is already past it.
      expect(await pin('met::x', 'Met — X', 'https://x/nope.jpg')).toBe('budget-full');
      expect(await listDownloads()).toEqual([]);
    });

    it('still allows a modest download when the device reports no quota', async () => {
      vi.stubGlobal('navigator', { storage: { estimate: async () => ({}) } });
      const { budget, available } = await getStorageBudget();
      // Falls back to the floor rather than refusing everything — an old
      // WebView with no Storage Manager should still be able to go offline.
      expect(budget).toBeGreaterThan(0);
      expect(available).toBeGreaterThan(0);
      expect(await pin('met::x', 'Met — X', 'https://x/ok.jpg')).toBe('cached');
    });
  });
});
