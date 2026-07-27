import { describe, it, expect, vi, beforeEach } from 'vitest';
import { localManifestSource } from './localManifest.js';

describe('localManifestSource', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('fetches the bundled manifest and stamps every record with source "local"', async () => {
    const manifest = [{ title: 'A', image: 'images/a.jpg' }, { title: 'B', image: 'images/b.jpg', source: 'whatever' }];
    const fetchMock = vi.fn(async (url) => {
      expect(url).toBe('images.json');
      return { ok: true, json: async () => manifest };
    });
    vi.stubGlobal('fetch', fetchMock);
    const results = await localManifestSource.fetchBatch();
    expect(results).toHaveLength(2);
    expect(results.every(r => r.source === 'local')).toBe(true);
    expect(results[0].title).toBe('A');
  });

  it('exposes no configurable filters', () => {
    expect(localManifestSource.listFilters()).toEqual([]);
  });
});
