// A user-picked folder of images, via the File System Access API. Chromium
// only (not Firefox/Safari as of this writing) — `supported` lets the
// settings UI hide/disable the picker gracefully rather than showing a
// button that throws when clicked.
const IMAGE_RE = /\.(jpe?g|png|webp|gif|avif)$/i;

let pickedFiles = [];
let pickedFolderName = '';

export const localFilesSource = {
  id: 'localFiles',
  label: 'Local Folder',
  needsApiKey: false,
  description: 'Pick a folder of your own images from this device. Requires Chrome/Edge.',
  supported: typeof window !== 'undefined' && 'showDirectoryPicker' in window,

  // Must be called from a user gesture (button click) — browsers require
  // that for showDirectoryPicker().
  async pickFolder() {
    const dirHandle = await window.showDirectoryPicker();
    const files = [];
    for await (const [name, entry] of dirHandle.entries()) {
      if (entry.kind === 'file' && IMAGE_RE.test(name)) files.push(entry);
    }
    pickedFiles = files;
    pickedFolderName = dirHandle.name;
    return { count: files.length, folderName: dirHandle.name };
  },

  getPickedFolderName() {
    return pickedFolderName;
  },

  listFilters() {
    return [];
  },

  async fetchBatch() {
    if (!pickedFiles.length) return [];
    return Promise.all(pickedFiles.map(async fileHandle => {
      const file = await fileHandle.getFile();
      return {
        // No metadata for local files — fall back to the filename, per spec.
        title: file.name.replace(/\.[^.]+$/, ''),
        artist: '',
        date: '',
        department: '',
        image: URL.createObjectURL(file),
        source: 'localFiles',
      };
    }));
  },
};
