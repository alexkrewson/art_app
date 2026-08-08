import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flickrSource } from './flickr.js';

function ok(photos) {
  return { stat: 'ok', photos: { page: 1, pages: 1, photo: photos } };
}

function photo(overrides = {}) {
  return {
    id: '1',
    title: 'A Lake',
    ownername: 'someone',
    license: '9',
    datetaken: '2015-06-01 09:14:00',
    url_l: 'https://live.staticflickr.com/1/a_b.jpg',
    ...overrides,
  };
}

describe('flickrSource', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('returns nothing without an API key, and makes no request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await flickrSource.fetchBatch({ filters: {}, count: 24 })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a photo onto the ImageRecord shape', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ok([photo()]) })));
    const [record] = await flickrSource.fetchBatch({ filters: { apiKey: 'k' }, count: 24 });
    expect(record).toEqual({
      title: 'A Lake',
      artist: 'someone',
      date: '2015-06-01',
      department: '',
      image: 'https://live.staticflickr.com/1/a_b.jpg',
      source: 'flickr',
      attribution: '',
    });
  });

  it('requests only the redistributable licence IDs', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ok([]) }));
    vi.stubGlobal('fetch', fetchMock);
    await flickrSource.fetchBatch({ filters: { apiKey: 'k' }, count: 24 });
    const licenses = new URL(fetchMock.mock.calls[0][0]).searchParams.get('license').split(',');
    expect(licenses.sort()).toEqual(['10', '4', '5', '7', '8', '9']);
    // The NonCommercial (1,2,3), NoDerivatives (3,6) and All Rights
    // Reserved (0) IDs must never appear.
    for (const banned of ['0', '1', '2', '3', '6']) {
      expect(licenses).not.toContain(banned);
    }
  });

  it('narrows to the no-attribution licences when publicDomainOnly is set', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ok([]) }));
    vi.stubGlobal('fetch', fetchMock);
    await flickrSource.fetchBatch({ filters: { apiKey: 'k', publicDomainOnly: true }, count: 24 });
    const licenses = new URL(fetchMock.mock.calls[0][0]).searchParams.get('license').split(',');
    expect(licenses.sort()).toEqual(['10', '7', '8', '9']);
  });

  it('sets attribution only for the licences that require credit', async () => {
    const data = ok([
      photo({ license: '4', url_l: 'https://x/1.jpg' }),
      photo({ license: '5', url_l: 'https://x/2.jpg' }),
      photo({ license: '9', url_l: 'https://x/3.jpg' }),
      photo({ license: '10', url_l: 'https://x/4.jpg' }),
    ]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => data })));
    const records = await flickrSource.fetchBatch({ filters: { apiKey: 'k' }, count: 24 });
    const byUrl = Object.fromEntries(records.map(r => [r.image, r.attribution]));
    expect(byUrl['https://x/1.jpg']).toBe('CC BY 2.0');
    expect(byUrl['https://x/2.jpg']).toBe('CC BY-SA 2.0');
    expect(byUrl['https://x/3.jpg']).toBe('');
    expect(byUrl['https://x/4.jpg']).toBe('');
  });

  it('drops a photo whose licence ID is outside the allowlist', async () => {
    const data = ok([photo({ license: '2', url_l: 'https://x/nc.jpg' }), photo({ url_l: 'https://x/ok.jpg' })]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => data })));
    const records = await flickrSource.fetchBatch({ filters: { apiKey: 'k' }, count: 24 });
    expect(records.map(r => r.image)).toEqual(['https://x/ok.jpg']);
  });

  it('prefers the largest available size variant', async () => {
    const data = ok([photo({
      url_c: 'https://x/c.jpg', url_l: 'https://x/l.jpg',
      url_h: 'https://x/h.jpg', url_k: 'https://x/k.jpg',
    })]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => data })));
    const [record] = await flickrSource.fetchBatch({ filters: { apiKey: 'k' }, count: 24 });
    expect(record.image).toBe('https://x/k.jpg');
  });

  it('drops a photo with no usable size variant', async () => {
    const data = ok([{ id: '1', title: 'No sizes', license: '9' }]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => data })));
    expect(await flickrSource.fetchBatch({ filters: { apiKey: 'k' }, count: 24 })).toEqual([]);
  });

  it('throws on a stat:fail body even though the HTTP status is 200', async () => {
    const body = { stat: 'fail', code: 100, message: 'Invalid API Key' };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body })));
    await expect(flickrSource.fetchBatch({ filters: { apiKey: 'bad' }, count: 24 }))
      .rejects.toThrow('Invalid API Key');
  });

  it('retries at page 1 when the random deep page came back empty', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ok([]) })
      .mockResolvedValueOnce({ ok: true, json: async () => ok([photo()]) });
    vi.stubGlobal('fetch', fetchMock);
    // Pin the random page away from 1 so the fallback path is the one taken.
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const records = await flickrSource.fetchBatch({ filters: { apiKey: 'k' }, count: 24 });
    expect(records).toHaveLength(1);
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('page')).toBe('1');
    Math.random.mockRestore();
  });

  it('throws when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    await expect(flickrSource.fetchBatch({ filters: { apiKey: 'k' }, count: 24 })).rejects.toThrow('HTTP 500');
  });
});
