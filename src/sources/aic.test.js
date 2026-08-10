import { describe, it, expect, vi, beforeEach } from 'vitest';
import { aicSource } from './aic.js';

const ARTWORKS = [
  { id: 1, title: 'A', image_id: 'img-a', is_public_domain: true, date_start: 1800, date_end: 1810 },
  { id: 2, title: 'No image', image_id: null, is_public_domain: true },
  { id: 3, title: 'Not public', image_id: 'img-c', is_public_domain: false },
  { id: 4, title: 'Too early', image_id: 'img-d', is_public_domain: true, date_start: 1400, date_end: 1400 },
  { id: 5, title: 'Too late', image_id: 'img-e', is_public_domain: true, date_start: 2100, date_end: 2100 },
];

function makeFetch(data = ARTWORKS) {
  return vi.fn(async () => ({ ok: true, json: async () => ({ data }) }));
}

describe('aicSource', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('filters out missing images and non-public-domain items by default', async () => {
    vi.stubGlobal('fetch', makeFetch());
    const results = await aicSource.fetchBatch({ filters: {}, count: 24 });
    const titles = results.map(r => r.title).sort();
    expect(titles).toEqual(['A', 'Too early', 'Too late']);
    expect(results.every(r => r.source === 'aic')).toBe(true);
    expect(results.find(r => r.title === 'A').image).toBe('https://www.artic.edu/iiif/2/img-a/full/!843,843/0/default.jpg');
  });

  it('applies a date range filter client-side', async () => {
    vi.stubGlobal('fetch', makeFetch());
    const results = await aicSource.fetchBatch({ filters: { dateBegin: 1700, dateEnd: 1900 }, count: 24 });
    expect(results.map(r => r.title)).toEqual(['A']);
  });

  it('includes non-public-domain items when publicDomainOnly is false', async () => {
    vi.stubGlobal('fetch', makeFetch());
    const results = await aicSource.fetchBatch({ filters: { publicDomainOnly: false }, count: 24 });
    expect(results.map(r => r.title)).toContain('Not public');
  });

  it('sends q=* when no keyword is given', async () => {
    const fetchMock = makeFetch();
    vi.stubGlobal('fetch', fetchMock);
    await aicSource.fetchBatch({ filters: {}, count: 1 });
    expect(fetchMock.mock.calls[0][0]).toContain('q=*');
  });

  it('throws when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    await expect(aicSource.fetchBatch({ filters: {}, count: 24 })).rejects.toThrow('HTTP 500');
  });

  it('pages, but never past the offset cap AIC enforces', async () => {
    // total_pages reports 1,327 and that number is a trap: anything past page
    // 10 returns "You have requested too many results". Asking for a page
    // beyond it silently yielded nothing, which is how the cap hid itself.
    const mk = n => ({
      pagination: { total_pages: 1327 },
      data: Array.from({ length: 100 }, (_, i) => ({
        id: `${n}-${i}`, image_id: `img${n}-${i}`, title: `t${n}-${i}`,
        is_public_domain: true,
      })),
    });
    const seen = [];
    const fetchMock = vi.fn(async url => {
      const page = Number(new URL(url).searchParams.get('page') || 1);
      seen.push(page);
      return { ok: true, json: async () => mk(page) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const records = await aicSource.fetchBatch({ filters: {}, count: 250 });
    expect(records).toHaveLength(250);
    expect(seen.length).toBeGreaterThan(1);
    expect(Math.max(...seen)).toBeLessThanOrEqual(10);
  });
});
