import { describe, it, expect, vi, beforeEach } from 'vitest';
import { metSource } from './met.js';

const OBJECTS = {
  1: { objectID: 1, title: 'Sunflowers', artistDisplayName: 'Van Gogh', primaryImageSmall: 'https://img/1.jpg', isPublicDomain: true },
  2: { objectID: 2, title: 'Starry Night', artistDisplayName: 'Van Gogh', primaryImageSmall: 'https://img/2.jpg', isPublicDomain: true },
  3: { objectID: 3, title: 'Not Public', primaryImageSmall: 'https://img/3.jpg', isPublicDomain: false },
  4: { objectID: 4, title: 'No Image', isPublicDomain: true },
  5: { objectID: 5, title: 'Also Public', primaryImage: 'https://img/5.jpg', isPublicDomain: true },
};

function makeFetch({ objectIDs = [1, 2, 3, 4, 5], departments = [{ departmentId: 1, displayName: 'Paintings' }] } = {}) {
  return vi.fn(async (url) => {
    if (url.includes('/departments')) {
      return { ok: true, json: async () => ({ departments }) };
    }
    if (url.includes('/search')) {
      return { ok: true, json: async () => ({ objectIDs }) };
    }
    const match = url.match(/\/objects\/(\d+)/);
    if (match) {
      const obj = OBJECTS[match[1]];
      return obj ? { ok: true, json: async () => obj } : { ok: false, status: 404 };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

describe('metSource', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches, filters to public-domain + has-image, and maps records by default', async () => {
    vi.stubGlobal('fetch', makeFetch());
    const results = await metSource.fetchBatch({ filters: {}, count: 24 });
    expect(results).toHaveLength(3); // ids 1, 2, 5 — 3 and 4 excluded
    expect(results.every(r => r.source === 'met')).toBe(true);
    expect(results.map(r => r.title).sort()).toEqual(['Also Public', 'Starry Night', 'Sunflowers']);
  });

  it('includes non-public-domain items when publicDomainOnly is false', async () => {
    vi.stubGlobal('fetch', makeFetch());
    const results = await metSource.fetchBatch({ filters: { publicDomainOnly: false }, count: 24 });
    // id 3 (not public domain, has image) now included; id 4 (no image) still excluded
    expect(results).toHaveLength(4);
  });

  it('sends q=* when no keyword is given (search 502s on an empty q)', async () => {
    const fetchMock = makeFetch();
    vi.stubGlobal('fetch', fetchMock);
    await metSource.fetchBatch({ filters: {}, count: 1 });
    const searchCall = fetchMock.mock.calls.find(([url]) => url.includes('/search'));
    expect(searchCall[0]).toContain('q=*');
  });

  it('passes keyword through to the q param', async () => {
    const fetchMock = makeFetch();
    vi.stubGlobal('fetch', fetchMock);
    await metSource.fetchBatch({ filters: { keyword: 'sunflowers' }, count: 1 });
    const searchCall = fetchMock.mock.calls.find(([url]) => url.includes('/search'));
    expect(searchCall[0]).toContain('q=sunflowers');
  });

  it('returns an empty array when the search has no results', async () => {
    vi.stubGlobal('fetch', makeFetch({ objectIDs: [] }));
    const results = await metSource.fetchBatch({ filters: {}, count: 24 });
    expect(results).toEqual([]);
  });

  it('throws when the search request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502 })));
    await expect(metSource.fetchBatch({ filters: {}, count: 24 })).rejects.toThrow('HTTP 502');
  });

  it('lists a department filter populated from the live /departments endpoint', async () => {
    vi.stubGlobal('fetch', makeFetch({ departments: [{ departmentId: 11, displayName: 'European Paintings' }] }));
    const filters = await metSource.listFilters();
    const dept = filters.find(f => f.key === 'departmentId');
    expect(dept.options).toContainEqual({ value: '11', label: 'European Paintings' });
  });
});
