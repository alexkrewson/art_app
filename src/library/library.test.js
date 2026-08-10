import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

// Exercises the real IndexedDB logic against a real (in-memory) IndexedDB —
// multi-category membership, dedupe, the removal rules, the downvote
// blocklist, refresh keeping upvotes. Only the filesystem and the network are
// stood in for.
//
// Written because Alex asked whether any of this had actually been run. It
// hadn't: the model was covered by mocks and a device test of the layer
// underneath it, which is not the same as the logic here ever executing.

const stored = new Map(); // path -> bytes, standing in for the device filesystem

vi.mock('../cache/fileStore.js', () => ({
  isNative: () => true,
  storeImage: vi.fn(async url => {
    if (url.includes('dead')) return { ok: false, reason: 'http-404', bytes: 0 };
    const path = `slowframe-images/${encodeURIComponent(url).slice(-40)}`;
    stored.set(path, 1000);
    return { ok: true, path, src: `file://${path}`, bytes: 1000 };
  }),
  deleteStored: vi.fn(async path => stored.delete(path)),
  resolveStored: vi.fn(async path => (stored.has(path) ? `file://${path}` : null)),
  usageBytes: vi.fn(async () => [...stored.values()].reduce((a, b) => a + b, 0)),
  freeBytes: vi.fn(async () => 1e9),
}));

const fetchBatch = vi.fn();
vi.mock('../sources/registry.js', () => ({
  SOURCES: {
    openverse: {
      id: 'openverse',
      label: 'Openverse',
      listFilters: () => [
        { key: 'subjects', type: 'checkboxGroup', label: 'Subjects',
          options: [{ value: 'landscape', label: 'Landscapes' }, { value: 'mountain', label: 'Mountains' }] },
      ],
      fetchBatch: (...a) => fetchBatch(...a),
    },
    met: { id: 'met', label: 'Met', listFilters: () => [{ key: 'keyword', type: 'text', label: 'Keyword' }], fetchBatch: (...a) => fetchBatch(...a) },
  },
}));

const lib = await import('./library.js');

const recs = (...names) => names.map(n => ({ image: `https://x/${n}.jpg`, title: n, source: 'openverse' }));
const LANDSCAPE = { sourceId: 'openverse', subjectKey: 'subjects', subject: 'landscape', cat: 'openverse::landscape' };
const MOUNTAIN = { sourceId: 'openverse', subjectKey: 'subjects', subject: 'mountain', cat: 'openverse::mountain' };

beforeEach(async () => {
  // A fresh database per test, or rows leak between them.
  globalThis.indexedDB = new IDBFactory();
  stored.clear();
  fetchBatch.mockReset();
});

describe('categoriesOf', () => {
  it('lists one entry per curated subject', async () => {
    const { SOURCES } = await import('../sources/registry.js');
    expect(lib.categoriesOf('openverse', SOURCES.openverse).map(c => c.label))
      .toEqual(['Landscapes', 'Mountains']);
  });

  it('treats a source with no subjects as a single tickable entry', async () => {
    const { SOURCES } = await import('../sources/registry.js');
    const cats = lib.categoriesOf('met', SOURCES.met);
    expect(cats).toHaveLength(1);
    expect(cats[0].cat).toBe('met');
  });
});

describe('downloadCategory', () => {
  it('stores images and makes them playable', async () => {
    fetchBatch.mockResolvedValue(recs('a', 'b', 'c'));
    const result = await lib.downloadCategory({ ...LANDSCAPE, count: 3 });

    expect(result.added).toBe(3);
    const playlist = await lib.playlistFor(['openverse::landscape']);
    expect(playlist).toHaveLength(3);
    expect(playlist[0].image).toMatch(/^file:\/\//); // a local path, not the remote URL
  });

  it('builds the playlist without touching the filesystem', async () => {
    fetchBatch.mockResolvedValue(recs('a', 'b', 'c'));
    await lib.downloadCategory({ ...LANDSCAPE, count: 3 });
    const fs = await import('../cache/fileStore.js');
    fs.resolveStored.mockClear();

    await lib.playlistFor(['openverse::landscape']);
    // Verifying each file costs two native round trips per image. At 1,698
    // images that was 32 seconds to the first picture on a real tablet, so
    // the playlist must be built from stored metadata alone.
    expect(fs.resolveStored).not.toHaveBeenCalled();
  });

  it('narrows the fetch to the one subject being downloaded', async () => {
    fetchBatch.mockResolvedValue(recs('a'));
    await lib.downloadCategory({ ...LANDSCAPE, count: 1, filters: { subjects: ['landscape', 'mountain'], apiKey: 'k' } });

    const { filters } = fetchBatch.mock.calls[0][0];
    expect(filters.subjects).toEqual(['landscape']);
    expect(filters.apiKey).toBe('k');
  });

  it('stops at the requested count even when the source returns more', async () => {
    fetchBatch.mockResolvedValue(recs('a', 'b', 'c', 'd', 'e', 'f'));
    const result = await lib.downloadCategory({ ...LANDSCAPE, count: 2 });
    expect(result.added).toBe(2);
    expect((await lib.playlistFor(['openverse::landscape']))).toHaveLength(2);
  });

  it('skips a dead URL and keeps going', async () => {
    fetchBatch.mockResolvedValue(recs('a', 'dead', 'c'));
    const result = await lib.downloadCategory({ ...LANDSCAPE, count: 3 });
    expect(result.added).toBe(2);
    expect((await lib.playlistFor(['openverse::landscape'])).map(r => r.title).sort()).toEqual(['a', 'c']);
  });

  it('reports progress as it goes', async () => {
    fetchBatch.mockResolvedValue(recs('a', 'b'));
    const seen = [];
    await lib.downloadCategory({ ...LANDSCAPE, count: 2 }, p => seen.push(p.done));
    expect(seen).toEqual([1, 2]);
  });

  it('reuses an image already held under another category instead of refetching', async () => {
    fetchBatch.mockResolvedValue(recs('shared'));
    await lib.downloadCategory({ ...LANDSCAPE, count: 1 });
    const { storeImage } = await import('../cache/fileStore.js');
    storeImage.mockClear();

    fetchBatch.mockResolvedValue(recs('shared'));
    const result = await lib.downloadCategory({ ...MOUNTAIN, count: 1 });

    expect(result.added).toBe(1);
    expect(storeImage).not.toHaveBeenCalled(); // the bytes were already there
    expect(await lib.playlistFor(['openverse::mountain'])).toHaveLength(1);
  });

  it('reports a fetch failure rather than throwing', async () => {
    fetchBatch.mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(lib.downloadCategory({ ...LANDSCAPE, count: 5 }))
      .resolves.toMatchObject({ added: 0, reason: 'fetch-failed' });
  });
});

describe('removeCategory', () => {
  it('deletes images that belonged only to it', async () => {
    fetchBatch.mockResolvedValue(recs('a', 'b'));
    await lib.downloadCategory({ ...LANDSCAPE, count: 2 });

    await lib.removeCategory('openverse::landscape');
    expect(await lib.playlistFor(['openverse::landscape'])).toHaveLength(0);
    expect(stored.size).toBe(0); // the files are actually gone, not orphaned
  });

  it('keeps an image another category still wants', async () => {
    fetchBatch.mockResolvedValue(recs('shared'));
    await lib.downloadCategory({ ...LANDSCAPE, count: 1 });
    fetchBatch.mockResolvedValue(recs('shared'));
    await lib.downloadCategory({ ...MOUNTAIN, count: 1 });

    await lib.removeCategory('openverse::landscape');
    // Removing Landscapes must not blank out half of Mountains.
    expect(await lib.playlistFor(['openverse::mountain'])).toHaveLength(1);
    expect(stored.size).toBe(1);
  });

  it('keeps an upvoted image even when its last category goes', async () => {
    fetchBatch.mockResolvedValue(recs('loved'));
    await lib.downloadCategory({ ...LANDSCAPE, count: 1 });
    await lib.setVote('https://x/loved.jpg', 1);

    await lib.removeCategory('openverse::landscape');
    expect(stored.size).toBe(1); // still on disk
    expect(await lib.playlistFor(['__kept'])).toHaveLength(1);
  });
});

describe('votes', () => {
  it('a downvote deletes the file and blocks it from ever coming back', async () => {
    fetchBatch.mockResolvedValue(recs('bad'));
    await lib.downloadCategory({ ...LANDSCAPE, count: 1 });
    await lib.setVote('https://x/bad.jpg', -1);

    expect(stored.size).toBe(0);
    expect(await lib.playlistFor(['openverse::landscape'])).toHaveLength(0);

    // The promise a downvote makes: not from this category, not from any other.
    fetchBatch.mockResolvedValue(recs('bad'));
    const again = await lib.downloadCategory({ ...MOUNTAIN, count: 1 });
    expect(again.added).toBe(0);
  });

  it('an upvote is kept on the record and surfaced to the playlist', async () => {
    fetchBatch.mockResolvedValue(recs('good'));
    await lib.downloadCategory({ ...LANDSCAPE, count: 1 });
    await lib.setVote('https://x/good.jpg', 1);

    const [item] = await lib.playlistFor(['openverse::landscape']);
    expect(item.vote).toBe(1);
  });
});

describe('refreshCategory', () => {
  it('replaces the un-upvoted images and keeps the rest', async () => {
    fetchBatch.mockResolvedValue(recs('keep', 'drop1', 'drop2'));
    await lib.downloadCategory({ ...LANDSCAPE, count: 3 });
    await lib.setVote('https://x/keep.jpg', 1);

    fetchBatch.mockResolvedValue(recs('new1', 'new2'));
    const result = await lib.refreshCategory({ ...LANDSCAPE, count: 3 });

    expect(result.kept).toBe(1);
    expect(result.replaced).toBe(2);
    const titles = (await lib.playlistFor(['openverse::landscape'])).map(r => r.title).sort();
    expect(titles).toEqual(['keep', 'new1', 'new2']);
  });
});

describe('stats', () => {
  it('counts images per category and reports real bytes', async () => {
    fetchBatch.mockResolvedValue(recs('a', 'b'));
    await lib.downloadCategory({ ...LANDSCAPE, count: 2 });

    const s = await lib.stats();
    expect(s.count).toBe(2);
    expect(s.byCat['openverse::landscape']).toBe(2);
    expect(s.bytes).toBe(2000);
  });
});

describe('estimateBytes', () => {
  it('uses per-source averages rather than one number for everything', () => {
    // Met thumbnails and NPS hires files differ by ~55x; a single average
    // would badly mislead the size confirmation on exactly the sources where
    // the warning matters.
    expect(lib.estimateBytes('nps', 100)).toBeGreaterThan(lib.estimateBytes('met', 100) * 10);
  });
});
