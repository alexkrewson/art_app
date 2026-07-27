import { describe, it, expect, vi, beforeEach } from 'vitest';
import { europeanaSource } from './europeana.js';

describe('europeanaSource', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('returns an empty array without calling fetch when no API key is set', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const results = await europeanaSource.fetchBatch({ filters: {}, count: 24 });
    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prefers edmIsShownBy over edmPreview and maps fields', async () => {
    const items = [
      { title: ['Tapestry'], dcCreator: ['Unknown'], year: ['1500'], dataProvider: ['Rijksmuseum'], edmIsShownBy: ['https://x/full.jpg'], edmPreview: ['https://x/thumb.jpg'] },
      { title: ['No image'] },
    ];
    const fetchMock = vi.fn(async (url) => {
      expect(url).toContain('wskey=mykey');
      return { ok: true, json: async () => ({ items }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const results = await europeanaSource.fetchBatch({ filters: { apiKey: 'mykey' }, count: 24 });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: 'Tapestry', artist: 'Unknown', date: '1500', department: 'Rijksmuseum',
      image: 'https://x/full.jpg', source: 'europeana',
    });
  });

  it('falls back to edmPreview when edmIsShownBy is missing', async () => {
    const items = [{ title: ['T'], edmPreview: ['https://x/thumb.jpg'] }];
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ items }) })));
    const [record] = await europeanaSource.fetchBatch({ filters: { apiKey: 'k' }, count: 24 });
    expect(record.image).toBe('https://x/thumb.jpg');
  });

  it('throws when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })));
    await expect(europeanaSource.fetchBatch({ filters: { apiKey: 'k' }, count: 24 })).rejects.toThrow('HTTP 401');
  });
});
