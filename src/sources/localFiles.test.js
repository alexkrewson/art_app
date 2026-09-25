import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Both halves of this source are mocked at the Capacitor boundary: the web
// half needs isNativePlatform() false, the Android half needs it true plus a
// stand-in for the FolderPicker plugin. Hoisted so the module under test sees
// the mock at import time.
const { mockCapacitor, mockPlugin } = vi.hoisted(() => ({
  mockCapacitor: {
    isNativePlatform: vi.fn(() => false),
    convertFileSrc: vi.fn(uri => uri.replace('content://', 'https://localhost/_capacitor_content_/')),
  },
  mockPlugin: { pickFolder: vi.fn(), listImages: vi.fn() },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: mockCapacitor,
  registerPlugin: () => mockPlugin,
}));

const { localFilesSource } = await import('./localFiles.js');

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
    kind: 'directory',
    name,
    async *entries() {
      for (const e of entries) yield [e.name, e];
    },
  };
}

// A folder the provider refuses to open — one bad subfolder shouldn't cost us
// the photos either side of it.
function unreadableDir(name) {
  return {
    kind: 'directory',
    name,
    entries() {
      throw new Error('EACCES');
    },
  };
}

// n folders nested one inside the next, with a single image at the bottom.
function nestedChain(depth, leaf) {
  let handle = dirHandle(`level${depth}`, [leaf]);
  for (let i = depth - 1; i >= 1; i--) handle = dirHandle(`level${i}`, [handle]);
  return handle;
}

describe('localFilesSource on the web', () => {
  beforeEach(() => {
    mockCapacitor.isNativePlatform.mockReturnValue(false);
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
      dirHandle('holiday', [fileHandle('beach.jpg'), fileHandle('readme.md')]),
    ];
    window.showDirectoryPicker = vi.fn(async () => dirHandle('My Photos', entries));

    const result = await localFilesSource.pickFolder();
    expect(result).toEqual({ count: 3, folderName: 'My Photos' });
    expect(localFilesSource.getPickedFolderName()).toBe('My Photos');
  });

  it('builds records from the picked files, using the filename as the title', async () => {
    const results = await localFilesSource.fetchBatch();
    expect(results).toHaveLength(3);
    expect(results.map(r => r.title).sort()).toEqual(['beach', 'cat', 'dog']);
    expect(results.every(r => r.source === 'localFiles' && r.image === 'blob:mock-url')).toBe(true);
  });

  it('walks subfolders and orders everything by relative path', async () => {
    window.showDirectoryPicker = vi.fn(async () => dirHandle('My Photos', [
      fileHandle('zebra.jpg'),
      dirHandle('alps', [fileHandle('peak.jpg'), fileHandle('lake.jpg')]),
      dirHandle('beach', [dirHandle('day2', [fileHandle('sunset.jpg')])]),
    ]));

    const { count } = await localFilesSource.pickFolder();
    expect(count).toBe(4);

    // alps/lake, alps/peak, beach/day2/sunset, zebra — stable across reboots,
    // which is the whole point for the sequential display mode.
    const results = await localFilesSource.fetchBatch();
    expect(results.map(r => r.title)).toEqual(['lake', 'peak', 'sunset', 'zebra']);
  });

  it('skips a subfolder it cannot open rather than losing the whole tree', async () => {
    window.showDirectoryPicker = vi.fn(async () => dirHandle('My Photos', [
      fileHandle('good.jpg'),
      unreadableDir('locked'),
      dirHandle('fine', [fileHandle('other.jpg')]),
    ]));

    const { count } = await localFilesSource.pickFolder();
    expect(count).toBe(2);
  });

  it('stops descending at the depth cap instead of following a cyclic tree', async () => {
    // 20 levels deep, image at the bottom — past the cap of 8, so it is not found.
    window.showDirectoryPicker = vi.fn(async () => nestedChain(20, fileHandle('deep.jpg')));
    expect((await localFilesSource.pickFolder()).count).toBe(0);

    // 4 levels deep is comfortably inside the cap, so it is.
    window.showDirectoryPicker = vi.fn(async () => nestedChain(4, fileHandle('shallow.jpg')));
    expect((await localFilesSource.pickFolder()).count).toBe(1);
  });

  it('is unsupported when the browser has no showDirectoryPicker', () => {
    const original = window.showDirectoryPicker;
    delete window.showDirectoryPicker;
    expect(localFilesSource.supported).toBe(false);
    window.showDirectoryPicker = original;
  });
});

describe('localFilesSource on Android', () => {
  beforeEach(() => {
    mockCapacitor.isNativePlatform.mockReturnValue(true);
    localStorage.clear();
    mockPlugin.pickFolder.mockReset();
    mockPlugin.listImages.mockReset();
  });
  afterEach(() => {
    mockCapacitor.isNativePlatform.mockReturnValue(false);
    localStorage.clear();
  });

  it('is supported even without showDirectoryPicker', () => {
    const original = window.showDirectoryPicker;
    delete window.showDirectoryPicker;
    expect(localFilesSource.supported).toBe(true);
    window.showDirectoryPicker = original;
  });

  it('persists the picked folder so it survives a restart', async () => {
    mockPlugin.pickFolder.mockResolvedValue({
      treeUri: 'content://tree/primary%3APictures',
      folderName: 'Pictures',
      images: [{ name: 'a.jpg', uri: 'content://doc/1' }],
    });

    const result = await localFilesSource.pickFolder();
    expect(result).toEqual({ count: 1, folderName: 'Pictures' });
    // Read back through the getter, which is what Settings renders from.
    expect(localFilesSource.getPickedFolderName()).toBe('Pictures');
  });

  it('re-reads the folder on each batch, so photos added later show up', async () => {
    mockPlugin.pickFolder.mockResolvedValue({
      treeUri: 'content://tree/primary%3APictures',
      folderName: 'Pictures',
      images: [{ name: 'a.jpg', uri: 'content://doc/1' }],
    });
    await localFilesSource.pickFolder();

    mockPlugin.listImages.mockResolvedValue({
      treeUri: 'content://tree/primary%3APictures',
      folderName: 'Pictures',
      images: [
        { name: 'a.jpg', uri: 'content://doc/1' },
        { name: 'b.png', uri: 'content://doc/2' },
      ],
    });

    const results = await localFilesSource.fetchBatch();
    // Ordering and the subfolder walk are the plugin's job; JS passes them through.
    expect(results.map(r => r.title)).toEqual(['a', 'b']);
    expect(results[0].image).toBe('https://localhost/_capacitor_content_/doc/1');
    expect(results.every(r => r.source === 'localFiles')).toBe(true);
  });

  it('returns nothing when no folder has been picked', async () => {
    expect(await localFilesSource.fetchBatch()).toEqual([]);
    expect(mockPlugin.listImages).not.toHaveBeenCalled();
  });

  it('forgets the folder when the grant is gone, rather than retrying forever', async () => {
    mockPlugin.pickFolder.mockResolvedValue({
      treeUri: 'content://tree/gone',
      folderName: 'SD Card',
      images: [],
    });
    await localFilesSource.pickFolder();

    mockPlugin.listImages.mockRejectedValue(Object.assign(new Error('nope'), { code: 'ACCESS_LOST' }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await localFilesSource.fetchBatch()).toEqual([]);
    expect(localFilesSource.getPickedFolderName()).toBe('');
    vi.restoreAllMocks();
  });

  it('keeps the folder on a transient read failure', async () => {
    mockPlugin.pickFolder.mockResolvedValue({
      treeUri: 'content://tree/primary%3APictures',
      folderName: 'Pictures',
      images: [],
    });
    await localFilesSource.pickFolder();

    mockPlugin.listImages.mockRejectedValue(Object.assign(new Error('busy'), { code: 'UNREADABLE' }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await localFilesSource.fetchBatch()).toEqual([]);
    expect(localFilesSource.getPickedFolderName()).toBe('Pictures');
    vi.restoreAllMocks();
  });

  it('tracks a folder that has been renamed since it was picked', async () => {
    mockPlugin.pickFolder.mockResolvedValue({
      treeUri: 'content://tree/primary%3APictures',
      folderName: 'Pictures',
      images: [],
    });
    await localFilesSource.pickFolder();

    mockPlugin.listImages.mockResolvedValue({
      treeUri: 'content://tree/primary%3APictures',
      folderName: 'Wall Art',
      images: [],
    });
    await localFilesSource.fetchBatch();

    expect(localFilesSource.getPickedFolderName()).toBe('Wall Art');
  });

  it('recognises a cancelled pick', () => {
    expect(localFilesSource.isCancellation({ code: 'CANCELLED' })).toBe(true);
    expect(localFilesSource.isCancellation({ name: 'AbortError' })).toBe(true);
    expect(localFilesSource.isCancellation(new Error('boom'))).toBe(false);
  });
});
