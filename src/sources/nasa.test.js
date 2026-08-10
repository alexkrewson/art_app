import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nasaSource } from './nasa.js';

function collection(items) {
  return { collection: { items } };
}

describe('nasaSource', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('prefers the ~medium image variant when present', async () => {
    const data = collection([{
      data: [{ title: 'Nebula', date_created: '2020-05-01T00:00:00Z', center: 'JPL' }],
      links: [
        { href: 'https://x/orig.jpg' },
        { href: 'https://x/img~medium.jpg' },
      ],
    }]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => data })));
    const [record] = await nasaSource.fetchBatch({ filters: {}, count: 24 });
    expect(record.image).toBe('https://x/img~medium.jpg');
    expect(record.title).toBe('Nebula');
    expect(record.date).toBe('2020-05-01');
    expect(record.department).toBe('JPL');
    expect(record.source).toBe('nasa');
  });

  it('falls back to the first link when no ~medium variant exists', async () => {
    const data = collection([{ data: [{ title: 'Mars' }], links: [{ href: 'https://x/only.jpg' }] }]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => data })));
    const [record] = await nasaSource.fetchBatch({ filters: {}, count: 24 });
    expect(record.image).toBe('https://x/only.jpg');
  });

  it('excludes items with no usable image link', async () => {
    const data = collection([{ data: [{ title: 'No links' }], links: [] }]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => data })));
    const results = await nasaSource.fetchBatch({ filters: {}, count: 24 });
    expect(results).toEqual([]);
  });

  it('searches for the ticked subject, ignoring the free-text field', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => collection([]) }));
    vi.stubGlobal('fetch', fetchMock);
    await nasaSource.fetchBatch({ filters: { subjects: ['nebula'], keyword: 'ignored' }, count: 24 });
    expect(fetchMock.mock.calls[0][0]).toContain('q=nebula');
    expect(fetchMock.mock.calls[0][0]).not.toContain('ignored');
  });

  it('exposes curated subjects rather than one generic entry', () => {
    const spec = nasaSource.listFilters().find(f => f.type === 'checkboxGroup');
    expect(spec.options.length).toBeGreaterThanOrEqual(8);
    expect(spec.options.map(o => o.value)).toContain('nebula');
  });

  it('only adds q to params when a keyword is given', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => collection([]) }));
    vi.stubGlobal('fetch', fetchMock);
    await nasaSource.fetchBatch({ filters: {}, count: 24 });
    expect(fetchMock.mock.calls[0][0]).not.toContain('q=');

    await nasaSource.fetchBatch({ filters: { keyword: 'apollo' }, count: 24 });
    expect(fetchMock.mock.calls[1][0]).toContain('q=apollo');
  });

  it('throws when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    await expect(nasaSource.fetchBatch({ filters: {}, count: 24 })).rejects.toThrow('HTTP 500');
  });
});
