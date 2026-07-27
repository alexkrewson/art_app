import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { localFilesSource } from './localFiles.js';

function fileHandle(name, content = 'x') {
  return {
    kind: 'file',
    name,
    async getFile() {
      return new File([content], name);
    },
  };
}

function dirHandle(name, entries) {
  return {
    name,
    async *entries() {
      for (const e of entries) yield [e.name, e];
    },
  };
}

describe('localFilesSource', () => {
  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
  });
  afterEach(() => vi.restoreAllMocks());

  it('has no metadata filters', () => {
    expect(localFilesSource.listFilters()).toEqual([]);
  });

  it('returns an empty array before any folder has been picked', async () => {
    expect(await localFilesSource.fetchBatch()).toEqual([]);
  });

  it('picks a folder, keeps only image files, and reports the count/name', async () => {
    const entries = [
      fileHandle('cat.jpg'),
      fileHandle('notes.txt'),
      fileHandle('dog.PNG'),
      { kind: 'directory', name: 'subfolder' },
    ];
    window.showDirectoryPicker = vi.fn(async () => dirHandle('My Photos', entries));

    const result = await localFilesSource.pickFolder();
    expect(result).toEqual({ count: 2, folderName: 'My Photos' });
    expect(localFilesSource.getPickedFolderName()).toBe('My Photos');
  });

  it('builds records from the picked files, using the filename as the title', async () => {
    const results = await localFilesSource.fetchBatch();
    expect(results).toHaveLength(2);
    expect(results.map(r => r.title).sort()).toEqual(['cat', 'dog']);
    expect(results.every(r => r.source === 'localFiles' && r.image === 'blob:mock-url')).toBe(true);
  });
});
