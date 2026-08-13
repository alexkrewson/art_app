// Where downloaded images actually live.
//
// Replaces the Cache-API-of-opaque-responses approach, which could not work in
// the APK. Museum CDNs don't send CORS headers, so `fetch` could only retrieve
// image bytes with `mode: 'no-cors'`, producing an *opaque* Response whose body
// page JS may not read. Those could be stored but only a service worker could
// serve them back — and a service worker cannot register inside Capacitor's
// WebView (confirmed from logcat on 2026-08-09: "Failed to register a
// ServiceWorker for scope https://localhost/"). So on Android, "downloaded"
// images were bytes on disk that the app was unable to display without a
// network. In a design where downloading is the entire point, that's fatal.
//
// On native we now fetch through Capacitor's HTTP layer, which is not subject
// to CORS at all, write real JPEG files, and hand `<img>` a file URL via
// convertFileSrc. No service worker in the loop. Two things follow for free:
// byte sizes are REAL (the old opaque entries were deliberately padded by the
// browser, so every size we reported was fiction), and deleting an image
// genuinely reclaims space.
//
// On the web the old Cache API + service worker path still applies, so the
// GitHub Pages build keeps working as a faithful preview.

import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';

const DIR = Directory.Data;
const FOLDER = 'slowframe-images';

export const isNative = () => Capacitor.isNativePlatform();

// A stable, filesystem-safe name derived from the URL. Keeps the extension so
// the WebView infers the right MIME type when loading it back.
export function fileNameFor(url) {
  let hash = 0;
  for (let i = 0; i < url.length; i++) hash = ((hash << 5) - hash + url.charCodeAt(i)) | 0;
  const ext = (url.split('?')[0].match(/\.(jpe?g|png|webp|gif)$/i)?.[1] || 'jpg').toLowerCase();
  return `${Math.abs(hash).toString(36)}-${url.length.toString(36)}.${ext}`;
}

// Once per session, not once per image. mkdir throws when the folder already
// exists, and the native plugin logs that rejection as an error before we get
// to catch it — so a 100-image download printed 100 "Directory exists" errors
// into logcat. Caching the promise removes both the noise and 99 bridge calls.
let folderReady = null;
async function ensureFolder() {
  if (!folderReady) {
    folderReady = Filesystem.mkdir({ path: FOLDER, directory: DIR, recursive: true })
      .catch(() => { /* already exists — not an error condition for us */ });
  }
  return folderReady;
}

// Hosts that refuse an unidentified client.
//
// The Art Institute of Chicago's terms ask API users to identify themselves
// with an AIC-User-Agent header, and their CDN enforces it on IIIF image
// requests too. Measured on the CP80 on 2026-08-13, against one image URL:
//
//   no headers .................. 403
//   generic User-Agent .......... 403
//   WebView User-Agent+Referer .. 403
//   AIC-User-Agent .............. 200
//
// Only that header works, and its value is not checked — so this identifies
// the project rather than embedding a personal email in a public repo. Node
// gets a 200 without it, which is why this only ever showed up on-device:
// every AIC download silently stored nothing.
const HOST_HEADERS = [
  [/(^|\.)artic\.edu$/i, { 'AIC-User-Agent': 'SlowFrame (https://github.com/alexkrewson/art_app)' }],
];

export function headersFor(url) {
  let host;
  try { host = new URL(url).hostname; } catch { return {}; }
  return HOST_HEADERS.reduce((acc, [re, h]) => (re.test(host) ? { ...acc, ...h } : acc), {});
}

// Roughly how many bytes a base64 payload decodes to. Used for size accounting
// without decoding the whole thing again.
const decodedSize = b64 => Math.floor((b64.length * 3) / 4);

/**
 * Downloads one image and stores it.
 *
 * Resolves to { ok, src, bytes } — `src` being something an <img> can display
 * with no network. Never throws: a download loop should be able to report a
 * failure and move on, not unwind.
 */
export async function storeImage(url) {
  if (!isNative()) return { ok: false, reason: 'web', src: url, bytes: 0 };

  try {
    await ensureFolder();
    const path = `${FOLDER}/${fileNameFor(url)}`;

    // CapacitorHttp directly, rather than enabling the global fetch patch.
    // The native HTTP stack isn't subject to CORS, which is the whole reason
    // this works where the old approach couldn't — but patching fetch app-wide
    // would also reroute every museum API call and the local images.json load,
    // and there's no reason to disturb those to download a JPEG.
    //
    // responseType 'blob' hands back base64 on native, which is exactly the
    // format Filesystem.writeFile wants — no intermediate decode.
    const res = await CapacitorHttp.get({ url, responseType: 'blob', headers: headersFor(url) });
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, reason: `http-${res.status}`, bytes: 0 };
    }
    const data = typeof res.data === 'string' ? res.data : '';
    if (!data) return { ok: false, reason: 'empty', bytes: 0 };

    await Filesystem.writeFile({ path, directory: DIR, data });
    const { uri } = await Filesystem.getUri({ path, directory: DIR });

    return { ok: true, src: Capacitor.convertFileSrc(uri), bytes: decodedSize(data), path };
  } catch (err) {
    console.warn('[SlowFrame] could not store image:', url, err);
    return { ok: false, reason: 'error', bytes: 0 };
  }
}

/** The playable src for an already-stored file, or null if it's gone. */
export async function resolveStored(path) {
  if (!isNative() || !path) return null;
  try {
    // stat() rather than trusting the metadata row: a file can vanish under us
    // (user clears app storage), and offering an image we can't display is
    // exactly the silent failure this module exists to remove.
    await Filesystem.stat({ path, directory: DIR });
    const { uri } = await Filesystem.getUri({ path, directory: DIR });
    return Capacitor.convertFileSrc(uri);
  } catch {
    return null;
  }
}

export async function deleteStored(path) {
  if (!isNative() || !path) return false;
  try {
    await Filesystem.deleteFile({ path, directory: DIR });
    return true;
  } catch {
    return false; // already gone is not a failure worth reporting
  }
}

/** Real bytes on disk, summed from the files themselves. */
export async function usageBytes() {
  if (!isNative()) return 0;
  try {
    const { files } = await Filesystem.readdir({ path: FOLDER, directory: DIR });
    let total = 0;
    for (const f of files) total += typeof f === 'object' ? (f.size || 0) : 0;
    return total;
  } catch {
    return 0;
  }
}

/**
 * Headroom for the size-confirmation dialog. Capacitor's Filesystem has no
 * free-space API, so this uses the Storage Manager quota the WebView reports —
 * which is a share of real free disk, and is the figure the device will
 * actually enforce against us.
 */
export async function freeBytes() {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est?.quota) return null;
    return Math.max(0, est.quota - (est.usage || 0));
  } catch {
    return null;
  }
}

export async function clearAll() {
  if (!isNative()) return;
  try {
    await Filesystem.rmdir({ path: FOLDER, directory: DIR, recursive: true });
  } catch {
    /* nothing stored yet */
  }
}
