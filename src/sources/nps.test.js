import { describe, it, expect, vi, beforeEach } from 'vitest';
import { npsSource } from './nps.js';

function assets(list) {
  return { total: String(list.length), data: list };
}

function asset(overrides = {}) {
  return {
    id: 'abc',
    title: 'Boney Mountain',
    credit: 'NPS Photo',
    fileInfo: { url: 'https://www.nps.gov/npgallery/GetAsset/abc', fileType: 'image/jpeg' },
    relatedParks: [{ parkCode: 'samo', fullName: 'Santa Monica Mountains National Recreation Area' }],
    constraintsInfo: { constraint: 'Public domain', grantingRights: 'Full' },
    ...overrides,
  };
}

describe('npsSource', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('returns nothing without an API key, and makes no request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await npsSource.fetchBatch({ filters: {}, count: 24 })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps an asset onto the ImageRecord shape, using the scaled image variant', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => assets([asset()]) })));
    const [record] = await npsSource.fetchBatch({ filters: { apiKey: 'k' }, count: 24 });
    expect(record).toEqual({
      title: 'Boney Mountain',
      artist: 'NPS Photo',
      date: '',
      department: 'Santa Monica Mountains National Recreation Area',
      image: 'https://www.nps.gov/npgallery/GetAsset/abc/proxy/hires',
      source: 'nps',
      attribution: '',
    });
  });

  it('requires BOTH halves of constraintsInfo before using an asset', async () => {
    const data = assets([
      asset({ id: 'keep', fileInfo: { url: 'https://x/keep', fileType: 'image/jpeg' } }),
      asset({
        id: 'unknown-rights',
        fileInfo: { url: 'https://x/unknown', fileType: 'image/jpeg' },
        constraintsInfo: { constraint: 'Public domain', grantingRights: 'Unknown' },
      }),
      asset({
        id: 'restricted',
        fileInfo: { url: 'https://x/restricted', fileType: 'image/jpeg' },
        constraintsInfo: { constraint: 'Copyrighted', grantingRights: 'Full' },
      }),
      asset({ id: 'no-info', fileInfo: { url: 'https://x/none', fileType: 'image/jpeg' }, constraintsInfo: undefined }),
    ]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => data })));
    const records = await npsSource.fetchBatch({ filters: { apiKey: 'k' }, count: 24 });
    expect(records.map(r => r.image)).toEqual(['https://x/keep/proxy/hires']);
  });

  it('drops non-image assets and de-duplicates by URL', async () => {
    const data = assets([
      asset({ fileInfo: { url: 'https://x/a', fileType: 'image/jpeg' } }),
      asset({ fileInfo: { url: 'https://x/a', fileType: 'image/jpeg' } }),  // duplicate
      asset({ fileInfo: { url: 'https://x/v', fileType: 'video/mp4' } }),
      asset({ fileInfo: undefined }),
    ]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => data })));
    const records = await npsSource.fetchBatch({ filters: { apiKey: 'k' }, count: 24 });
    expect(records.map(r => r.image)).toEqual(['https://x/a/proxy/hires']);
  });

  it('queries each ticked subject and ignores the free-text field', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => assets([asset()]) }));
    vi.stubGlobal('fetch', fetchMock);
    await npsSource.fetchBatch({
      filters: { apiKey: 'k', subjects: ['landscape', 'wildlife'], query: 'ignored' },
      count: 8,
    });
    const urls = fetchMock.mock.calls.map(c => c[0]);
    expect(urls.some(u => u.includes('q=landscape'))).toBe(true);
    expect(urls.some(u => u.includes('q=wildlife'))).toBe(true);
    expect(urls.every(u => !u.includes('ignored'))).toBe(true);
  });

  it('retries at the top of the list when the random offset overshot', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => assets([]) })
      .mockResolvedValueOnce({ ok: true, json: async () => assets([asset()]) });
    vi.stubGlobal('fetch', fetchMock);
    const records = await npsSource.fetchBatch({ filters: { apiKey: 'k' }, count: 24 });
    expect(records).toHaveLength(1);
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('start')).toBe('0');
  });

  it('throws when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403 })));
    await expect(npsSource.fetchBatch({ filters: { apiKey: 'k' }, count: 24 })).rejects.toThrow('HTTP 403');
  });
});
