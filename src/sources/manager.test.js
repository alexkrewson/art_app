import { describe, it, expect, vi, beforeEach } from 'vitest';

// Rewritten 2026-08-09 for the download-first model. The old suite covered
// merging live fetchBatch() results from every enabled source — behaviour that
// no longer exists, because the slideshow now plays only what's on disk.

vi.mock('./registry.js', () => ({
  SOURCES: {
    local: { id: 'local', label: 'Local', fetchBatch: vi.fn(async () => []) },
    localFiles: { id: 'localFiles', label: 'Folder', fetchBatch: vi.fn(async () => []) },
    openverse: { id: 'openverse', label: 'Openverse', fetchBatch: vi.fn(async () => []) },
  },
}));

vi.mock('./localManifest.js', () => ({
  localManifestSource: { fetchBatch: vi.fn(async () => [{ image: 'bundled.jpg', source: 'local' }]) },
}));

vi.mock('../library/library.js', () => ({ playlistFor: vi.fn(async () => []) }));

const { SOURCES } = await import('./registry.js');
const { localManifestSource } = await import('./localManifest.js');
const { playlistFor } = await import('../library/library.js');
const { buildPlaylist, orderPlaylist } = await import('./manager.js');

const rec = (n, source = 'openverse') => ({ image: `${n}.jpg`, title: n, source });

describe('buildPlaylist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    playlistFor.mockResolvedValue([]);
    SOURCES.local.fetchBatch.mockResolvedValue([]);
    SOURCES.localFiles.fetchBatch.mockResolvedValue([]);
    localManifestSource.fetchBatch.mockResolvedValue([{ image: 'bundled.jpg', source: 'local' }]);
  });

  it('plays the downloaded library for the ticked categories', async () => {
    playlistFor.mockResolvedValue([rec('a'), rec('b')]);
    const playlist = await buildPlaylist({}, { categories: { 'openverse::landscape': { count: 100 } } });

    expect(playlistFor).toHaveBeenCalledWith(['openverse::landscape']);
    expect(playlist.map(r => r.image)).toEqual(['a.jpg', 'b.jpg']);
  });

  it('never calls a remote source at playback time', async () => {
    playlistFor.mockResolvedValue([rec('a')]);
    await buildPlaylist({ openverse: { enabled: true, filters: {} } }, { categories: {} });
    // The whole point of the redesign: playback must not spend data or block
    // on an API. Only the library and the two local sources are consulted.
    expect(SOURCES.openverse.fetchBatch).not.toHaveBeenCalled();
  });

  it('adds the bundled set and a local folder when those are enabled', async () => {
    playlistFor.mockResolvedValue([rec('downloaded')]);
    SOURCES.local.fetchBatch.mockResolvedValue([rec('starter', 'local')]);
    SOURCES.localFiles.fetchBatch.mockResolvedValue([rec('folder', 'localFiles')]);

    const playlist = await buildPlaylist(
      { local: { enabled: true }, localFiles: { enabled: true } },
      { categories: { 'x::y': {} } },
    );
    expect(playlist.map(r => r.image).sort()).toEqual(['downloaded.jpg', 'folder.jpg', 'starter.jpg']);
  });

  it('leaves out local sources that are switched off', async () => {
    playlistFor.mockResolvedValue([rec('a')]);
    await buildPlaylist({ local: { enabled: false } }, { categories: {} });
    expect(SOURCES.local.fetchBatch).not.toHaveBeenCalled();
  });

  it('falls back to the bundled set rather than handing over nothing', async () => {
    playlistFor.mockResolvedValue([]);
    const playlist = await buildPlaylist({}, { categories: {} });
    // A first run with nothing ticked must still show something.
    expect(playlist.map(r => r.image)).toEqual(['bundled.jpg']);
  });

  it('survives a library read failing', async () => {
    playlistFor.mockRejectedValue(new Error('idb exploded'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    SOURCES.local.fetchBatch.mockResolvedValue([rec('starter', 'local')]);

    const playlist = await buildPlaylist({ local: { enabled: true } }, { categories: { a: {} } });
    expect(playlist.map(r => r.image)).toEqual(['starter.jpg']);
  });

  it('survives a local source throwing', async () => {
    playlistFor.mockResolvedValue([rec('a')]);
    SOURCES.local.fetchBatch.mockRejectedValue(new Error('no manifest'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const playlist = await buildPlaylist({ local: { enabled: true } }, { categories: { a: {} } });
    expect(playlist.map(r => r.image)).toEqual(['a.jpg']);
  });
});

describe('orderPlaylist', () => {
  it('leaves order alone for sequential and permutes for shuffle', () => {
    const list = Array.from({ length: 30 }, (_, i) => rec(String(i)));
    expect(orderPlaylist(list, 'sequential')).toEqual(list);

    const shuffled = orderPlaylist(list, 'shuffle');
    expect(shuffled).toHaveLength(list.length);
    expect(new Set(shuffled.map(r => r.image))).toEqual(new Set(list.map(r => r.image)));
  });
});
