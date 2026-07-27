import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rijksmuseumSource } from './rijksmuseum.js';

describe('rijksmuseumSource', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('returns an empty array without calling fetch when no API key is set', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const results = await rijksmuseumSource.fetchBatch({ filters: {}, count: 24 });
    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps art objects, extracting a year from the long title, and skips missing images', async () => {
    const artObjects = [
      { title: 'The Night Watch', principalOrFirstMaker: 'Rembrandt', longTitle: 'The Night Watch, Rembrandt van Rijn, 1642', webImage: { url: 'https://x/nightwatch.jpg' } },
      { title: 'No image', webImage: {} },
    ];
    const fetchMock = vi.fn(async (url) => {
      expect(url).toContain('key=mykey');
      return { ok: true, json: async () => ({ artObjects }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const results = await rijksmuseumSource.fetchBatch({ filters: { apiKey: 'mykey' }, count: 24 });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: 'The Night Watch', artist: 'Rembrandt', date: '1642',
      image: 'https://x/nightwatch.jpg', source: 'rijksmuseum',
    });
  });

  it('throws when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    await expect(rijksmuseumSource.fetchBatch({ filters: { apiKey: 'k' }, count: 24 })).rejects.toThrow('HTTP 500');
  });
});
