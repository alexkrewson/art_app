import { describe, it, expect, vi, beforeEach } from 'vitest';
import { wikimediaSource } from './wikimedia.js';

function pages(list) {
  return { query: { pages: Object.fromEntries(list.map((p, i) => [i, p])) } };
}

describe('wikimediaSource', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('filters to image mime types with a usable url', async () => {
    const data = pages([
      { title: 'File:A.jpg', imageinfo: [{ url: 'https://x/a.jpg', mime: 'image/jpeg', extmetadata: { LicenseShortName: { value: 'Public domain' } } }] },
      { title: 'File:B.pdf', imageinfo: [{ url: 'https://x/b.pdf', mime: 'application/pdf', extmetadata: { LicenseShortName: { value: 'Public domain' } } }] },
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
        extmetadata: { Artist: { value: '<a href="#">Rodin</a>' }, LicenseShortName: { value: 'Public domain' } },
      }],
    }]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => data })));
    const [record] = await wikimediaSource.fetchBatch({ filters: {}, count: 24 });
    expect(record.title).toBe('Untitled Sculpture');
    expect(record.artist).toBe('Rodin');
  });

  it('excludes results with no license or a non-permissive license', async () => {
    const data = pages([
      { title: 'File:NoLicense.jpg', imageinfo: [{ url: 'https://x/a.jpg', mime: 'image/jpeg', extmetadata: {} }] },
      { title: 'File:Restricted.jpg', imageinfo: [{ url: 'https://x/b.jpg', mime: 'image/jpeg', extmetadata: { LicenseShortName: { value: 'Copyrighted' } } }] },
      { title: 'File:Fine.jpg', imageinfo: [{ url: 'https://x/c.jpg', mime: 'image/jpeg', extmetadata: { LicenseShortName: { value: 'CC0' } } }] },
    ]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => data })));
    const results = await wikimediaSource.fetchBatch({ filters: {}, count: 24 });
    expect(results).toHaveLength(1);
    expect(results[0].image).toBe('https://x/c.jpg');
  });

  it('sets attribution for CC BY/CC BY-SA but not for Public domain/CC0', async () => {
    const data = pages([
      { title: 'File:PD.jpg', imageinfo: [{ url: 'https://x/pd.jpg', mime: 'image/jpeg', extmetadata: { LicenseShortName: { value: 'Public domain' } } }] },
      { title: 'File:Free.jpg', imageinfo: [{ url: 'https://x/cc0.jpg', mime: 'image/jpeg', extmetadata: { LicenseShortName: { value: 'CC0' } } }] },
      { title: 'File:Credited.jpg', imageinfo: [{ url: 'https://x/ccby.jpg', mime: 'image/jpeg', extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' } } }] },
    ]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => data })));
    const results = await wikimediaSource.fetchBatch({ filters: {}, count: 24 });
    const byUrl = Object.fromEntries(results.map(r => [r.image, r.attribution]));
    expect(byUrl['https://x/pd.jpg']).toBe('');
    expect(byUrl['https://x/cc0.jpg']).toBe('');
    expect(byUrl['https://x/ccby.jpg']).toBe('CC BY-SA 4.0');
  });

  it('uses the categorymembers generator for a Category: query', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => pages([]) }));
    vi.stubGlobal('fetch', fetchMock);
    await wikimediaSource.fetchBatch({ filters: { query: 'Category:Science_fiction_art' }, count: 24 });
    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain('generator=categorymembers');
    expect(url).toContain('gcmtitle=Category');
  });

  it('browses and merges multiple |-separated categories', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => pages([]) }));
    vi.stubGlobal('fetch', fetchMock);
    await wikimediaSource.fetchBatch({
      filters: { query: 'Category:Science fiction art|Category:Fantasy art' },
      count: 24,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map(c => c[0]);
    expect(urls.some(u => u.includes('gcmtitle=Category') && u.includes('Science'))).toBe(true);
    expect(urls.some(u => u.includes('gcmtitle=Category') && u.includes('Fantasy'))).toBe(true);
  });

  it('browses checked category checkboxes, taking priority over the free-text field', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => pages([]) }));
    vi.stubGlobal('fetch', fetchMock);
    await wikimediaSource.fetchBatch({
      filters: { categories: ['Science fiction art', 'Fantasy art'], query: 'sunflowers' },
      count: 24,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map(c => c[0]);
    expect(urls.every(u => u.includes('generator=categorymembers'))).toBe(true);
    expect(urls.some(u => u.includes('Science'))).toBe(true);
    expect(urls.some(u => u.includes('Fantasy'))).toBe(true);
    expect(urls.some(u => u.includes('sunflowers'))).toBe(false);
  });

  it('pages 50 at a time, because extmetadata is truncated past that', async () => {
    // Commons returns licence metadata for only the first 50 pages of any
    // response, whatever limit is asked for — measured live: gcmlimit=200
    // returns 198 pages but only 50 carry a licence. Since this source refuses
    // anything it can't confirm a licence for, one big request can never yield
    // more than ~50 usable images. Paging is what lifts the ceiling: the same
    // category went from 49 usable to 100.
    const page = n => ({
      ok: true,
      json: async () => ({
        query: { pages: Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`${n}${i}`, {
          title: `File:${n}-${i}.jpg`,
          imageinfo: [{ url: `https://x/${n}-${i}.jpg`, thumburl: `https://x/t/${n}-${i}.jpg`, mime: 'image/jpeg',
            extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' } } }],
        }])) },
        ...(n < 3 ? { continue: { gcmcontinue: `tok${n}` } } : {}),
      }),
    });
    let call = 0;
    const fetchMock = vi.fn(async () => page(++call));
    vi.stubGlobal('fetch', fetchMock);

    const records = await wikimediaSource.fetchBatch({ filters: { categories: ['Fantasy art'] }, count: 100 });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('gcmlimit')).toBe('50');
    // The second request must carry the continuation token, or it just refetches
    // the same first 50 forever.
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('gcmcontinue')).toBe('tok1');
    expect(records).toHaveLength(100);
  });

  it('asks for a scaled thumbnail and prefers it over the original', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => pages([{
        title: 'File:Huge.jpg',
        imageinfo: [{
          url: 'https://upload.wikimedia.org/full/Huge.jpg',
          thumburl: 'https://upload.wikimedia.org/thumb/Huge.jpg/1920px-Huge.jpg',
          mime: 'image/jpeg',
          extmetadata: { LicenseShortName: { value: 'CC BY-SA 3.0' } },
        }],
      }]),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const [record] = await wikimediaSource.fetchBatch({ filters: { query: 'x' }, count: 24 });
    // A sample of Featured pictures averaged 20.5 MB as originals; the
    // thumbnails of the same files were ~0.5 MB. On a phone that is the whole
    // difference between a slideshow and a stall.
    expect(fetchMock.mock.calls[0][0]).toContain('iiurlwidth=1920');
    expect(record.image).toBe('https://upload.wikimedia.org/thumb/Huge.jpg/1920px-Huge.jpg');
  });

  it('falls back to the original when Commons rendered no thumbnail', async () => {
    const data = pages([{
      title: 'File:Odd.jpg',
      imageinfo: [{
        url: 'https://upload.wikimedia.org/full/Odd.jpg',
        mime: 'image/jpeg',
        extmetadata: { LicenseShortName: { value: 'Public domain' } },
      }],
    }]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => data })));
    const [record] = await wikimediaSource.fetchBatch({ filters: { query: 'x' }, count: 24 });
    expect(record.image).toBe('https://upload.wikimedia.org/full/Odd.jpg');
  });

  it('expands a single checkbox naming several |-separated categories', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => pages([]) }));
    vi.stubGlobal('fetch', fetchMock);
    // How the quality-tier options are defined: one tick, both Commons
    // review tiers, so the user never has to know the tiers exist.
    await wikimediaSource.fetchBatch({
      filters: { categories: ['Featured pictures of landscapes|Quality images of landscapes'] },
      count: 24,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const titles = fetchMock.mock.calls
      .map(c => new URL(c[0]).searchParams.get('gcmtitle'));
    expect(titles).toEqual([
      'Category:Featured pictures of landscapes',
      'Category:Quality images of landscapes',
    ]);
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
