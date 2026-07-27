import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./registry.js', () => ({
  SOURCES: {
    fake: { id: 'fake', fetchBatch: vi.fn() },
    other: { id: 'other', fetchBatch: vi.fn() },
    local: { id: 'local', fetchBatch: vi.fn() },
    localFiles: { id: 'localFiles', fetchBatch: vi.fn() },
  },
}));
vi.mock('./localManifest.js', () => ({
  localManifestSource: { id: 'local', fetchBatch: vi.fn() },
}));
vi.mock('../cache/imageCache.js', () => ({
  getCachedRecords: vi.fn(),
  cacheRecord: vi.fn(),
}));

import { buildPlaylist, orderPlaylist } from './manager.js';
import { SOURCES } from './registry.js';
import { localManifestSource } from './localManifest.js';
import { getCachedRecords, cacheRecord } from '../cache/imageCache.js';

function setOnline(value) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}

describe('buildPlaylist', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setOnline(true);
  });
  afterEach(() => setOnline(true));

  it('merges every enabled source and skips disabled ones', async () => {
    SOURCES.fake.fetchBatch.mockResolvedValue([{ title: 'F1' }]);
    SOURCES.other.fetchBatch.mockResolvedValue([{ title: 'O1' }]);

    const playlist = await buildPlaylist(
      { fake: { enabled: true, filters: {} }, other: { enabled: false, filters: {} } },
      { cacheEnabled: false },
    );

    expect(playlist).toEqual([{ title: 'F1' }]);
    expect(SOURCES.other.fetchBatch).not.toHaveBeenCalled();
  });

  it('ignores source ids with no config entry or that are not enabled', async () => {
    const playlist = await buildPlaylist({ nonexistent: { enabled: true, filters: {} } }, { cacheEnabled: false });
    // falls through to the absolute fallback since nothing contributed
    expect(localManifestSource.fetchBatch).toHaveBeenCalled();
    void playlist;
  });

  it('a single failing source is logged and treated as empty, not thrown', async () => {
    SOURCES.fake.fetchBatch.mockRejectedValue(new Error('network down'));
    SOURCES.other.fetchBatch.mockResolvedValue([{ title: 'O1' }]);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const playlist = await buildPlaylist(
      { fake: { enabled: true, filters: {} }, other: { enabled: true, filters: {} } },
      { cacheEnabled: false },
    );

    expect(playlist).toEqual([{ title: 'O1' }]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('a failing cacheable source falls back to its cached records when cacheEnabled', async () => {
    SOURCES.fake.fetchBatch.mockRejectedValue(new Error('network down'));
    getCachedRecords.mockResolvedValue([{ title: 'cached-fake' }]);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const playlist = await buildPlaylist({ fake: { enabled: true, filters: {} } }, { cacheEnabled: true });

    expect(getCachedRecords).toHaveBeenCalledWith('fake');
    expect(playlist).toEqual([{ title: 'cached-fake' }]);
  });

  it('falls back to the local starter set when every enabled source is empty', async () => {
    SOURCES.fake.fetchBatch.mockResolvedValue([]);
    localManifestSource.fetchBatch.mockResolvedValue([{ title: 'Starter' }]);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const playlist = await buildPlaylist({ fake: { enabled: true, filters: {} } }, { cacheEnabled: false });

    expect(playlist).toEqual([{ title: 'Starter' }]);
  });

  it('falls back to the local starter set when no sources are enabled at all', async () => {
    localManifestSource.fetchBatch.mockResolvedValue([{ title: 'Starter' }]);
    const playlist = await buildPlaylist({}, { cacheEnabled: false });
    expect(playlist).toEqual([{ title: 'Starter' }]);
  });

  it('serves cached records instead of fetching live when offline and caching is enabled', async () => {
    setOnline(false);
    getCachedRecords.mockResolvedValue([{ title: 'offline-cached' }]);

    const playlist = await buildPlaylist({ fake: { enabled: true, filters: {} } }, { cacheEnabled: true });

    expect(SOURCES.fake.fetchBatch).not.toHaveBeenCalled();
    expect(getCachedRecords).toHaveBeenCalledWith('fake');
    expect(playlist).toEqual([{ title: 'offline-cached' }]);
  });

  it('fetches live and fires off background cache writes when online and caching is enabled', async () => {
    const records = [{ title: 'Live', image: 'https://x/live.jpg', source: 'fake' }];
    SOURCES.fake.fetchBatch.mockResolvedValue(records);

    const playlist = await buildPlaylist({ fake: { enabled: true, filters: {} } }, { cacheEnabled: true });

    expect(playlist).toEqual(records);
    expect(cacheRecord).toHaveBeenCalledWith(records[0]);
  });

  it('never routes the local/localFiles sources through the cache wrapper', async () => {
    setOnline(false);
    SOURCES.local.fetchBatch.mockResolvedValue([{ title: 'Local' }]);

    const playlist = await buildPlaylist({ local: { enabled: true, filters: {} } }, { cacheEnabled: true });

    expect(SOURCES.local.fetchBatch).toHaveBeenCalled();
    expect(getCachedRecords).not.toHaveBeenCalled();
    expect(playlist).toEqual([{ title: 'Local' }]);
  });
});

describe('orderPlaylist', () => {
  it('leaves the playlist untouched in sequential mode', () => {
    const playlist = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(orderPlaylist(playlist, 'sequential')).toEqual(playlist);
  });

  it('returns every item, possibly reordered, in shuffle mode', () => {
    const playlist = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    const result = orderPlaylist(playlist, 'shuffle');
    expect([...result].sort((a, b) => a.id - b.id)).toEqual(playlist);
  });
});
