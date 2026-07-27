import { describe, it, expect, vi, beforeEach } from 'vitest';
import { smithsonianSource } from './smithsonian.js';

function row({ title = 'Bowl', hasImage = true } = {}) {
  return {
    content: {
      descriptiveNonRepeating: {
        title: { content: title },
        unit_code: 'NMAH',
        online_media: { media: hasImage ? [{ type: 'Images', content: 'https://x/bowl.jpg' }] : [] },
      },
      indexedStructured: { name: ['Jane Potter'], date: ['1900s'] },
      freetext: {},
    },
  };
}

describe('smithsonianSource', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('returns an empty array without calling fetch when no API key is set', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const results = await smithsonianSource.fetchBatch({ filters: {}, count: 24 });
    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps rows to records and filters out rows with no image', async () => {
    const data = { response: { rows: [row(), row({ title: 'No image', hasImage: false })] } };
    const fetchMock = vi.fn(async (url) => {
      expect(url).toContain('api_key=secret123');
      return { ok: true, json: async () => data };
    });
    vi.stubGlobal('fetch', fetchMock);
    const results = await smithsonianSource.fetchBatch({ filters: { apiKey: 'secret123' }, count: 24 });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: 'Bowl', artist: 'Jane Potter', date: '1900s', department: 'NMAH',
      image: 'https://x/bowl.jpg', source: 'smithsonian',
    });
  });

  it('throws when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403 })));
    await expect(smithsonianSource.fetchBatch({ filters: { apiKey: 'k' }, count: 24 })).rejects.toThrow('HTTP 403');
  });
});
