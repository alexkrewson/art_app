import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openverseSource } from './openverse.js';

function results(list) {
  return { results: list };
}

function image(overrides = {}) {
  return {
    title: 'A Mountain',
    creator: 'someone',
    url: 'https://live.staticflickr.com/1/a_b.jpg',
    license: 'cc0',
    license_version: '1.0',
    source: 'flickr',
    ...overrides,
  };
}

describe('openverseSource', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('maps a result onto the ImageRecord shape', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => results([image()]) })));
    const [record] = await openverseSource.fetchBatch({ filters: {}, count: 24 });
    expect(record).toEqual({
      title: 'A Mountain',
      artist: 'someone',
      date: '',
      department: 'flickr',
      image: 'https://live.staticflickr.com/1/a_b.jpg',
      source: 'openverse',
      attribution: '',
    });
  });

  it('always sends the commercial+modification licence gate', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => results([]) }));
    vi.stubGlobal('fetch', fetchMock);
    await openverseSource.fetchBatch({ filters: { query: 'glacier' }, count: 24 });
    for (const [url] of fetchMock.mock.calls) {
      expect(url).toContain('license_type=commercial%2Cmodification');
      expect(url).toContain('mature=false');
    }
  });

  it('sets attribution for CC BY/CC BY-SA but not for CC0 or the Public Domain Mark', async () => {
    const data = results([
      image({ url: 'https://x/1.jpg', license: 'by', license_version: '2.0' }),
      image({ url: 'https://x/2.jpg', license: 'by-sa', license_version: '4.0' }),
      image({ url: 'https://x/3.jpg', license: 'cc0', license_version: '1.0' }),
      image({ url: 'https://x/4.jpg', license: 'pdm', license_version: '1.0' }),
    ]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => data })));
    const records = await openverseSource.fetchBatch({ filters: {}, count: 24 });
    const byUrl = Object.fromEntries(records.map(r => [r.image, r.attribution]));
    expect(byUrl['https://x/1.jpg']).toBe('CC BY 2.0');
    expect(byUrl['https://x/2.jpg']).toBe('CC BY-SA 4.0');
    expect(byUrl['https://x/3.jpg']).toBe('');
    expect(byUrl['https://x/4.jpg']).toBe('');
  });

  it('drops results with no url, duplicates, and anything flagged mature', async () => {
    const data = results([
      image({ url: 'https://x/keep.jpg' }),
      image({ url: 'https://x/keep.jpg' }),   // duplicate
      image({ url: '' }),                      // no image
      image({ url: 'https://x/mature.jpg', mature: true }),
    ]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => data })));
    const records = await openverseSource.fetchBatch({ filters: {}, count: 24 });
    expect(records.map(r => r.image)).toEqual(['https://x/keep.jpg']);
  });

  it('queries each ticked subject and ignores the free-text field', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => results([]) }));
    vi.stubGlobal('fetch', fetchMock);
    await openverseSource.fetchBatch({
      filters: { subjects: ['landscape', 'forest'], query: 'ignored' },
      count: 4,
    });
    const urls = fetchMock.mock.calls.map(c => c[0]);
    expect(urls.some(u => u.includes('q=landscape'))).toBe(true);
    expect(urls.some(u => u.includes('q=forest'))).toBe(true);
    expect(urls.every(u => !u.includes('ignored'))).toBe(true);
  });

  it('falls back to the free-text field, then to "landscape"', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => results([]) }));
    vi.stubGlobal('fetch', fetchMock);
    await openverseSource.fetchBatch({ filters: { query: 'glacier' }, count: 4 });
    expect(fetchMock.mock.calls[0][0]).toContain('q=glacier');

    fetchMock.mockClear();
    await openverseSource.fetchBatch({ filters: {}, count: 4 });
    expect(fetchMock.mock.calls[0][0]).toContain('q=landscape');
  });

  it('applies the photographs-only category unless it is switched off', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => results([]) }));
    vi.stubGlobal('fetch', fetchMock);
    await openverseSource.fetchBatch({ filters: {}, count: 4 });
    expect(fetchMock.mock.calls[0][0]).toContain('category=photograph');

    fetchMock.mockClear();
    await openverseSource.fetchBatch({ filters: { photosOnly: false }, count: 4 });
    expect(fetchMock.mock.calls[0][0]).not.toContain('category=photograph');
  });

  it('never pages past the anonymous depth cap', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => results([]) }));
    vi.stubGlobal('fetch', fetchMock);
    // 600 would want 30 pages of 20; the anonymous ceiling is 12.
    await openverseSource.fetchBatch({ filters: {}, count: 600 });
    for (const [url] of fetchMock.mock.calls) {
      const page = Number(new URL(url).searchParams.get('page'));
      expect(page).toBeGreaterThanOrEqual(1);
      expect(page).toBeLessThanOrEqual(12);
    }
  });

  it('throws when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429 })));
    await expect(openverseSource.fetchBatch({ filters: {}, count: 24 })).rejects.toThrow('HTTP 429');
  });
});
