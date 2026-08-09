import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../sources/registry.js', () => ({
  SOURCES: {
    openverse: {
      id: 'openverse',
      label: 'Openverse',
      listFilters: () => [
        { key: 'subjects', label: 'Curated subjects', type: 'checkboxGroup',
          options: [{ value: 'landscape', label: 'Landscapes' }, { value: 'coast ocean', label: 'Coast & ocean' }] },
        { key: 'query', label: 'Search', type: 'text' },
      ],
      fetchBatch: vi.fn(),
    },
    met: {
      id: 'met',
      label: 'Met Museum',
      listFilters: () => [{ key: 'keyword', label: 'Keyword', type: 'text' }],
      fetchBatch: vi.fn(),
    },
  },
}));

vi.mock('./imageCache.js', () => ({
  cacheRecord: vi.fn(async () => 'cached'),
  getStorageBudget: vi.fn(async () => ({ usage: 0, quota: 1e9, budget: 5e8, available: 5e8 })),
}));

const { SOURCES } = await import('../sources/registry.js');
const { cacheRecord } = await import('./imageCache.js');
const { downloadableTargets, downloadTarget, collectionKey, formatBytes } = await import('./downloads.js');

const rec = i => ({ title: `#${i}`, image: `https://x/${i}.jpg`, source: 'openverse' });

describe('downloadableTargets', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists one target per curated subject', () => {
    const targets = downloadableTargets('openverse', SOURCES.openverse);
    expect(targets.map(t => t.label)).toEqual(['Openverse — Landscapes', 'Openverse — Coast & ocean']);
  });

  it('encodes subjects with spaces into a stable collection key', () => {
    const [, coast] = downloadableTargets('openverse', SOURCES.openverse);
    expect(coast.collection).toBe(collectionKey('openverse', 'coast ocean'));
    expect(coast.collection).not.toContain(' ');
  });

  it('falls back to a single whole-source target when there are no subjects', () => {
    const targets = downloadableTargets('met', SOURCES.met);
    expect(targets).toHaveLength(1);
    expect(targets[0].label).toBe('Met Museum');
    expect(targets[0].subject).toBeNull();
  });
});

describe('downloadTarget', () => {
  beforeEach(() => vi.clearAllMocks());

  it('narrows the fetch to just the subject being downloaded', async () => {
    SOURCES.openverse.fetchBatch.mockResolvedValue([rec(1)]);
    const [landscapes] = downloadableTargets('openverse', SOURCES.openverse);

    // The saved filters have two subjects ticked; downloading "Landscapes"
    // must not quietly pull the other one in too.
    await downloadTarget(landscapes, { subjects: ['landscape', 'coast ocean'], apiKey: 'k' }, 10);

    const { filters } = SOURCES.openverse.fetchBatch.mock.calls[0][0];
    expect(filters.subjects).toEqual(['landscape']);
    expect(filters.apiKey).toBe('k'); // other saved filters still carried through
  });

  it('pins everything it stores, under the target collection', async () => {
    SOURCES.openverse.fetchBatch.mockResolvedValue([rec(1), rec(2)]);
    const [landscapes] = downloadableTargets('openverse', SOURCES.openverse);

    const result = await downloadTarget(landscapes, {}, 2);

    expect(result.added).toBe(2);
    for (const call of cacheRecord.mock.calls) {
      expect(call[1]).toMatchObject({ pinned: true, collection: landscapes.collection });
    }
  });

  it('reports progress as it goes', async () => {
    SOURCES.openverse.fetchBatch.mockResolvedValue([rec(1), rec(2), rec(3)]);
    const [landscapes] = downloadableTargets('openverse', SOURCES.openverse);
    const seen = [];

    await downloadTarget(landscapes, {}, 3, p => seen.push(`${p.done}/${p.total}`));
    expect(seen).toEqual(['1/3', '2/3', '3/3']);
  });

  it('stops at the storage budget and says so', async () => {
    SOURCES.openverse.fetchBatch.mockResolvedValue([rec(1), rec(2), rec(3)]);
    cacheRecord.mockResolvedValueOnce('cached').mockResolvedValueOnce('budget-full');
    const [landscapes] = downloadableTargets('openverse', SOURCES.openverse);

    const result = await downloadTarget(landscapes, {}, 3);
    expect(result).toMatchObject({ added: 1, stoppedEarly: true, reason: 'budget-full' });
    expect(cacheRecord).toHaveBeenCalledTimes(2); // stopped, didn't grind through the rest
  });

  it('flags a short result when the source simply had fewer', async () => {
    SOURCES.openverse.fetchBatch.mockResolvedValue([rec(1)]);
    const [landscapes] = downloadableTargets('openverse', SOURCES.openverse);

    const result = await downloadTarget(landscapes, {}, 100);
    expect(result).toMatchObject({ added: 1, requested: 100, stoppedEarly: true, reason: 'source-returned-fewer' });
  });

  it('reports a failed fetch instead of throwing', async () => {
    SOURCES.openverse.fetchBatch.mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [landscapes] = downloadableTargets('openverse', SOURCES.openverse);

    await expect(downloadTarget(landscapes, {}, 10))
      .resolves.toMatchObject({ added: 0, stoppedEarly: true, reason: 'fetch-failed' });
  });

  it('reports an empty result distinctly from a failure', async () => {
    SOURCES.openverse.fetchBatch.mockResolvedValue([]);
    const [landscapes] = downloadableTargets('openverse', SOURCES.openverse);
    await expect(downloadTarget(landscapes, {}, 10))
      .resolves.toMatchObject({ added: 0, reason: 'no-results' });
  });
});

describe('formatBytes', () => {
  it('reads as MB below a gigabyte and GB above', () => {
    expect(formatBytes(0)).toBe('0 MB');
    expect(formatBytes(50 * 1024 * 1024)).toBe('50 MB');
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB');
  });
});
