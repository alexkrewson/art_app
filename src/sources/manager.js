import { SOURCES } from './registry.js';
import { shuffle } from './base.js';
import { localManifestSource } from './localManifest.js';
import { getCachedRecords, cacheRecord } from '../cache/imageCache.js';

// Sources that are already zero-network by nature (bundled starter set,
// user-picked local folder) skip the cache wrapper entirely — there's
// nothing for it to add, and no point storing a second copy.
function isCacheable(id) {
  return id !== 'local' && id !== 'localFiles';
}

// Wraps a network source's fetchBatch with the offline image cache: when
// there's no connectivity, serve whatever's already cached for this source
// instead of attempting (and failing) a live call; when online, fetch live
// as normal and fire-and-forget cache writes for what came back so it's
// available next time there's no connection. cacheEnabled lets the "Cache
// images for offline use" setting turn this off entirely (falls back to
// plain live fetchBatch with no caching side effects).
async function cachingFetchBatch(id, filters, cacheEnabled) {
  const source = SOURCES[id];
  if (!isCacheable(id) || !cacheEnabled) {
    return source.fetchBatch({ filters });
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return getCachedRecords(id);
  }

  const records = await source.fetchBatch({ filters });
  records.forEach(r => cacheRecord(r)); // not awaited — caching happens in the background
  return records;
}

// Merges every enabled source's images into one playlist. A single source
// failing (network error, bad filters) is logged and treated as an empty
// contribution rather than crashing the whole slideshow — this is meant to
// run unattended, so one flaky API shouldn't take the display down.
export async function buildPlaylist(sourceConfig = {}, { cacheEnabled = true } = {}) {
  const entries = Object.entries(sourceConfig).filter(([id, cfg]) => cfg?.enabled && SOURCES[id]);

  const batches = await Promise.all(entries.map(async ([id, cfg]) => {
    try {
      return await cachingFetchBatch(id, cfg.filters || {}, cacheEnabled);
    } catch (err) {
      console.warn(`[SlowFrame] source "${id}" failed to load:`, err);
      return isCacheable(id) && cacheEnabled ? getCachedRecords(id) : [];
    }
  }));

  let playlist = batches.flat();

  // Absolute fallback: never hand the slideshow an empty playlist, even if
  // every source is disabled or every enabled one failed.
  if (!playlist.length) {
    console.warn('[SlowFrame] no images from any enabled source — falling back to the local starter set');
    playlist = await localManifestSource.fetchBatch();
  }

  return playlist;
}

export function orderPlaylist(playlist, mode) {
  return mode === 'shuffle' ? shuffle(playlist) : playlist;
}
