import { describe, it, expect, vi, beforeEach } from 'vitest';
import { wikimediaSource } from './wikimedia.js';

function pages(list) {
  return { query: { pages: Object.fromEntries(list.map((p, i) => [i, p])) } };
}

describe('wikimediaSource', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('filters to image mime types with a usable url', async () => {
    const data = pages([
      { title: 'File:A.jpg', imageinfo: [{ url: 'https://x/a.jpg', mime: 'image/jpeg', extmetadata: {} }] },
      { title: 'File:B.pdf', imageinfo: [{ url: 'https://x/b.pdf', mime: 'application/pdf', extmetadata: {} }] },
      { title: 'File:C.jpg', imageinfo: [] },
    ]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => data })));
    const results = await wikimediaSource.fetchBatch({ filters: { query: 'impressionism' }, count: 24 });
    expect(results).toHaveLength(1);
    expect(results[0].image).toBe('https://x/a.jpg');
    expect(results[0].source).toBe('wikimedia');
  });

  it('strips wiki HTML from metadata and falls back to the filename for the title', async () => {
    const data = pages([{
      title: 'File:Untitled Sculpture.jpg',
      imageinfo: [{
        url: 'https://x/s.jpg', mime: 'image/jpeg',
        extmetadata: { Artist: { value: '<a href="#">Rodin</a>' } },
      }],
    }]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => data })));
    const [record] = await wikimediaSource.fetchBatch({ filters: {}, count: 24 });
    expect(record.title).toBe('Untitled Sculpture');
    expect(record.artist).toBe('Rodin');
  });

  it('uses the categorymembers generator for a Category: query', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => pages([]) }));
    vi.stubGlobal('fetch', fetchMock);
    await wikimediaSource.fetchBatch({ filters: { query: 'Category:Science_fiction_art' }, count: 24 });
    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain('generator=categorymembers');
    expect(url).toContain('gcmtitle=Category');
  });

  it('uses the search generator for a plain-text query', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => pages([]) }));
    vi.stubGlobal('fetch', fetchMock);
    await wikimediaSource.fetchBatch({ filters: { query: 'sunflowers' }, count: 24 });
    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain('generator=search');
    expect(url).toContain('gsrsearch=sunflowers');
  });

  it('defaults to "illustration" when no query is given', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => pages([]) }));
    vi.stubGlobal('fetch', fetchMock);
    await wikimediaSource.fetchBatch({ filters: {}, count: 24 });
    expect(fetchMock.mock.calls[0][0]).toContain('gsrsearch=illustration');
  });

  it('throws when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    await expect(wikimediaSource.fetchBatch({ filters: {}, count: 24 })).rejects.toThrow('HTTP 500');
  });
});
