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
    nasa: {
      id: 'nasa',
      label: 'NASA',
      curated: true,
      listFilters: () => [
        { key: 'subjects', type: 'checkboxGroup', label: 'Subjects', options: [{ value: 'nebula', label: 'Nebulae' }] },
      ],
      fetchBatch: (...a) => fetchBatch(...a),
    },
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
  // The bundled blocklist is fetched once and cached for the session, which
  // across tests means whichever case ran first decides what every later one
  // sees.
  lib.resetBundledBlocklist();
  lib.resetApproved();
  delete globalThis.fetch;
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

  it('flags exhaustion when the source runs dry, distinctly from failure', async () => {
    fetchBatch.mockResolvedValue(recs('a', 'b'));
    const short = await lib.downloadCategory({ ...LANDSCAPE, count: 100 });
    // Ran out, but nothing went wrong — the UI shows "all available" for this
    // rather than a count that looks like a stalled download.
    expect(short).toMatchObject({ added: 2, exhausted: true, reason: 'source-returned-fewer' });

    fetchBatch.mockResolvedValue(recs('c', 'd'));
    const full = await lib.downloadCategory({ ...MOUNTAIN, count: 2 });
    expect(full.exhausted).toBe(false);
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

describe('bundled blocklist', () => {
  // public/blocklist.json is what curate/ produces: images Alex rejected on a
  // monitor rather than one at a time on a tablet. It has to behave exactly
  // like a thumbs-down that happened on every device at once.
  const serve = urls => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: 1, blocked: urls }),
    }));
  };

  it('stops a rejected image being downloaded at all', async () => {
    serve(['https://x/b.jpg']);
    fetchBatch.mockResolvedValue(recs('a', 'b', 'c'));

    const result = await lib.downloadCategory({ ...LANDSCAPE, count: 3 });

    expect(result.added).toBe(2);
    const playlist = await lib.playlistFor(['openverse::landscape']);
    expect(playlist.map(p => p.url)).toEqual(['https://x/a.jpg', 'https://x/c.jpg']);
  });

  it('deletes images already downloaded before the rejection shipped', async () => {
    fetchBatch.mockResolvedValue(recs('a', 'b', 'c'));
    await lib.downloadCategory({ ...LANDSCAPE, count: 3 });
    expect(stored.size).toBe(3);

    // Curation happens later, and has to reach back to what's already on disk —
    // otherwise a rejected image sits on the tablet until its category is next
    // refreshed, which for a settled library is never.
    lib.resetBundledBlocklist();
    serve(['https://x/a.jpg', 'https://x/c.jpg']);

    expect(await lib.reconcileBundledBlocklist()).toEqual({ deleted: 2 });
    expect(stored.size).toBe(1); // the files, not just the rows
    const playlist = await lib.playlistFor(['openverse::landscape']);
    expect(playlist.map(p => p.url)).toEqual(['https://x/b.jpg']);
  });

  it('rejects an upvoted image too', async () => {
    fetchBatch.mockResolvedValue(recs('a'));
    await lib.downloadCategory({ ...LANDSCAPE, count: 1 });
    await lib.setVote('https://x/a.jpg', 1);

    lib.resetBundledBlocklist();
    serve(['https://x/a.jpg']);

    // Both signals are Alex's, but the rejection is the later and more
    // considered one — made at full size, on a monitor, with the image in
    // front of him rather than glimpsed on a wall.
    expect(await lib.reconcileBundledBlocklist()).toEqual({ deleted: 1 });
  });

  it('behaves like an empty list when the file is missing', async () => {
    // The web preview, a build made before curate/ existed, and the test
    // environment all have to keep working.
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404 }));
    fetchBatch.mockResolvedValue(recs('a', 'b'));

    expect(await lib.downloadCategory({ ...LANDSCAPE, count: 2 })).toMatchObject({ added: 2 });
    expect(await lib.reconcileBundledBlocklist()).toEqual({ deleted: 0 });
  });

  it('survives fetch throwing outright', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('no network'); });
    expect(await lib.blockedUrls()).toEqual(new Set());
  });

  it('unions with the device\'s own downvotes rather than replacing them', async () => {
    serve(['https://x/bundled.jpg']);
    await lib.blockUrl('https://x/thumbed-down.jpg');

    expect(await lib.blockedUrls())
      .toEqual(new Set(['https://x/thumbed-down.jpg', 'https://x/bundled.jpg']));
  });
});

describe('approved list (curated sources)', () => {
  // Openverse, Commons and NASA download only what Alex approved in curate/,
  // from approved.json. Two copies exist — bundled and deployed to Pages — and
  // the newer one wins, so approving more reaches devices without a new APK.
  const NEBULA = { sourceId: 'nasa', subjectKey: 'subjects', subject: 'nebula', cat: 'nasa::nebula' };
  const manifest = (generated, names) => ({
    version: 1,
    generated,
    sources: { nasa: { nebula: names.map(n => ({ image: `https://x/${n}.jpg`, title: n, source: 'nasa' })) } },
  });
  // Routes by URL: `bundled` answers the relative path, `remote` the Pages URL,
  // and anything else (blocklist.json) is a 404. `null` means unreachable.
  const serve = ({ bundled = null, remote = null } = {}) => {
    globalThis.fetch = vi.fn(async url => {
      const body = url === 'approved.json' ? bundled : url === lib.APPROVED_REMOTE ? remote : null;
      return body ? { ok: true, json: async () => body } : { ok: false, status: 404 };
    });
  };
  const held = async () => (await lib.playlistFor(['nasa::nebula'])).map(p => p.url).sort();

  it('downloads only approved images and never searches the source', async () => {
    serve({ bundled: manifest('2026-10-16T00:00:00Z', ['a', 'b', 'c']) });

    const result = await lib.downloadCategory({ ...NEBULA, count: 10 });

    expect(fetchBatch).not.toHaveBeenCalled();
    expect(result).toMatchObject({ added: 3, exhausted: true });
    expect(await held()).toEqual(['https://x/a.jpg', 'https://x/b.jpg', 'https://x/c.jpg']);
  });

  it('stops at the requested count, and a top-up reaches the rest', async () => {
    serve({ bundled: manifest('2026-10-16T00:00:00Z', ['a', 'b', 'c', 'd']) });

    expect(await lib.downloadCategory({ ...NEBULA, count: 2 })).toMatchObject({ added: 2 });
    expect(await lib.downloadCategory({ ...NEBULA, count: 2 })).toMatchObject({ added: 2 });
    expect((await held()).length).toBe(4);
  });

  it('prefers the deployed copy when it is newer than the bundled one', async () => {
    serve({
      bundled: manifest('2026-10-16T00:00:00Z', ['old']),
      remote: manifest('2026-10-20T00:00:00Z', ['new']),
    });
    await lib.downloadCategory({ ...NEBULA, count: 5 });
    expect(await held()).toEqual(['https://x/new.jpg']);
  });

  it('keeps the bundled copy when the deployed one is older', async () => {
    // An APK built after the last push must not be dragged backwards.
    serve({
      bundled: manifest('2026-10-20T00:00:00Z', ['new']),
      remote: manifest('2026-10-16T00:00:00Z', ['old']),
    });
    await lib.downloadCategory({ ...NEBULA, count: 5 });
    expect(await held()).toEqual(['https://x/new.jpg']);
  });

  it('falls back to the bundled copy offline', async () => {
    serve({ bundled: manifest('2026-10-16T00:00:00Z', ['a']) });
    expect(await lib.downloadCategory({ ...NEBULA, count: 5 })).toMatchObject({ added: 1 });
  });

  it('says so when no approved list can be read at all', async () => {
    serve();
    expect(await lib.downloadCategory({ ...NEBULA, count: 5 }))
      .toMatchObject({ added: 0, reason: 'approved-list-unavailable' });
    expect(fetchBatch).not.toHaveBeenCalled(); // never quietly falls back to live search
  });

  it('downloads nothing for a category with no approvals yet', async () => {
    serve({ bundled: { version: 1, generated: '2026-10-16T00:00:00Z', sources: {} } });
    expect(await lib.downloadCategory({ ...NEBULA, count: 5 }))
      .toMatchObject({ added: 0, exhausted: true, reason: 'none-approved' });
  });

  it('searches live when the jailbreak setting is on', async () => {
    serve({ bundled: manifest('2026-10-16T00:00:00Z', ['approved']) });
    fetchBatch.mockResolvedValue(recs('live1', 'live2'));

    const result = await lib.downloadCategory({ ...NEBULA, count: 2, unvetted: true });

    expect(fetchBatch).toHaveBeenCalled();
    expect(result.added).toBe(2);
    expect(await held()).toEqual(['https://x/live1.jpg', 'https://x/live2.jpg']);
  });

  it('leaves uncurated sources like the Met searching live', async () => {
    serve({ bundled: manifest('2026-10-16T00:00:00Z', ['a']) });
    fetchBatch.mockResolvedValue(recs('met1'));
    await lib.downloadCategory({ sourceId: 'met', cat: 'met', count: 1 });
    expect(fetchBatch).toHaveBeenCalled();
  });
});
