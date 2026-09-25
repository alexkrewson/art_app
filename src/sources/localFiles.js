// A user-picked folder of images from the device itself.
//
// Two implementations behind one source, because the platforms have nothing in
// common here:
//
//   web     — the File System Access API (showDirectoryPicker). Chromium
//             desktop only; Firefox and Safari have never shipped it.
//   Android — the Storage Access Framework, via our own FolderPicker plugin
//             (android/.../FolderPickerPlugin.java).
//
// The Android half exists because showDirectoryPicker is absent from Chrome on
// Android, so it was absent from our WebView too: `supported` came out false
// and the settings button rendered permanently disabled. On a tablet — the
// only device this app is actually for — "pick a folder of your own photos"
// was the one source that could never work.
//
// The two halves differ in one visible way, and it is the right way round. A
// web pick lasts as long as the tab, because file handles cannot be persisted
// usefully. An Android pick is persisted (takePersistableUriPermission) and
// re-read on every playlist rebuild, so it survives a reboot *and* notices
// photos added to the folder later — which is what you want from something
// hanging on a wall.
//
// Both halves walk subfolders and sort by relative path. The sort is not
// cosmetic: providers return children in no defined order, so without it the
// sequential display mode would pick a different order on every reboot.

import { Capacitor, registerPlugin } from '@capacitor/core';

const FolderPicker = registerPlugin('FolderPicker');

const IMAGE_RE = /\.(jpe?g|png|webp|gif|avif)$/i;
const STORE_KEY = 'slowframe.localFolder';

// Subfolders are walked on both platforms. The caps mirror the native side
// (FolderPickerPlugin.java) so a folder behaves the same whichever half reads
// it — they exist to bound a pathological tree, not to ration normal use.
const MAX_DEPTH = 8;
const MAX_IMAGES = 10000;

const isNative = () => Capacitor.isNativePlatform();

// Web-only state: handles die with the page, so there is nothing to persist.
let pickedFiles = [];
let pickedFolderName = '';

// Native state lives in localStorage instead, so a picked folder survives the
// app being killed — the tree URI is the whole of the grant.
function loadNativeFolder() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveNativeFolder(folder) {
  try {
    if (folder) localStorage.setItem(STORE_KEY, JSON.stringify(folder));
    else localStorage.removeItem(STORE_KEY);
  } catch {
    // A full or blocked localStorage costs us the folder on next launch, not
    // this session — not worth failing the pick over.
  }
}

function titleFrom(name) {
  return name.replace(/\.[^.]+$/, '');
}

export const localFilesSource = {
  id: 'localFiles',
  label: 'Local Folder',
  needsApiKey: false,

  get description() {
    return isNative()
      ? 'Pick a folder of your own images from this device.'
      : 'Pick a folder of your own images from this device. Requires Chrome or Edge on desktop.';
  },

  // A getter, not a constant: on Android this has to wait for Capacitor's
  // native bridge, which is not guaranteed to have been injected at the
  // moment this module is first evaluated.
  get supported() {
    return isNative() || (typeof window !== 'undefined' && 'showDirectoryPicker' in window);
  },

  // Must be called straight from a user gesture (button click) — the web half
  // requires it, and the native half inherits the same rule for free.
  async pickFolder() {
    if (isNative()) {
      const { treeUri, folderName, images } = await FolderPicker.pickFolder();
      saveNativeFolder({ treeUri, folderName });
      return { count: images.length, folderName };
    }

    const dirHandle = await window.showDirectoryPicker();
    pickedFiles = await walkDirectory(dirHandle);
    pickedFolderName = dirHandle.name;
    return { count: pickedFiles.length, folderName: dirHandle.name };
  },

  getPickedFolderName() {
    return isNative() ? (loadNativeFolder()?.folderName || '') : pickedFolderName;
  },

  // Cancelling the system picker is a normal outcome, not an error worth
  // logging or surfacing. The native side tags it so the caller can tell it
  // apart from a folder that genuinely failed to open.
  isCancellation(err) {
    return err?.code === 'CANCELLED' || err?.name === 'AbortError';
  },

  listFilters() {
    return [];
  },

  async fetchBatch() {
    if (isNative()) return fetchNativeBatch();

    if (!pickedFiles.length) return [];
    return Promise.all(pickedFiles.map(async ({ handle }) => {
      const file = await handle.getFile();
      return {
        // No metadata for local files — fall back to the filename, per spec.
        title: titleFrom(file.name),
        artist: '',
        date: '',
        department: '',
        image: URL.createObjectURL(file),
        source: 'localFiles',
      };
    }));
  },
};

// Breadth-first rather than recursive-descent so the depth cap is a plain
// counter, and so a folder tree that is deep on one branch cannot blow the
// stack before it hits the cap.
async function walkDirectory(rootHandle) {
  const found = [];
  let queue = [{ handle: rootHandle, path: '' }];

  for (let depth = 0; depth <= MAX_DEPTH && queue.length && found.length < MAX_IMAGES; depth++) {
    const next = [];
    for (const { handle, path } of queue) {
      let entries;
      try {
        entries = handle.entries();
      } catch {
        continue;   // unreadable subfolder — skip it, keep the rest
      }
      for await (const [name, entry] of entries) {
        if (entry.kind === 'directory') {
          if (depth < MAX_DEPTH) next.push({ handle: entry, path: `${path}${name}/` });
        } else if (IMAGE_RE.test(name)) {
          found.push({ handle: entry, path: `${path}${name}` });
          if (found.length >= MAX_IMAGES) break;
        }
      }
      if (found.length >= MAX_IMAGES) break;
    }
    queue = next;
  }

  if (found.length >= MAX_IMAGES) {
    console.warn(`[SlowFrame] folder has more than ${MAX_IMAGES} images; using the first ${MAX_IMAGES}`);
  }
  found.sort((a, b) => a.path.toLowerCase().localeCompare(b.path.toLowerCase()));
  return found;
}

async function fetchNativeBatch() {
  const folder = loadNativeFolder();
  if (!folder?.treeUri) return [];

  let images;
  let folderName;
  let truncated;
  try {
    ({ images, folderName, truncated } = await FolderPicker.listImages({ treeUri: folder.treeUri }));
  } catch (err) {
    if (err?.code === 'ACCESS_LOST' || err?.code === 'NO_FOLDER') {
      // The grant is gone for good — an uninstalled SD card, or the user
      // revoking it in Settings. Forget it so the UI stops claiming a folder
      // is in use and offers the picker again.
      console.warn('[SlowFrame] lost access to the picked folder; forgetting it');
      saveNativeFolder(null);
      return [];
    }
    console.warn('[SlowFrame] could not read the picked folder:', err);
    return [];
  }

  if (truncated) {
    console.warn(`[SlowFrame] folder has more than ${MAX_IMAGES} images; using the first ${MAX_IMAGES}`);
  }

  // Folders get renamed. Cheap to keep the label honest while we are here.
  if (folderName && folderName !== folder.folderName) {
    saveNativeFolder({ ...folder, folderName });
  }

  return images.map(({ name, uri }) => ({
    title: titleFrom(name),
    artist: '',
    date: '',
    department: '',
    // content:// is not loadable by <img> directly; Capacitor's local server
    // proxies it via /_capacitor_content_/ and convertFileSrc builds that URL.
    image: Capacitor.convertFileSrc(uri),
    source: 'localFiles',
  }));
}
