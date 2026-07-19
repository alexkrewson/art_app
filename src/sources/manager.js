import { SOURCES } from './registry.js';
import { shuffle } from './base.js';
import { localManifestSource } from './localManifest.js';

// Merges every enabled source's images into one playlist. A single source
// failing (network error, bad filters) is logged and treated as an empty
// contribution rather than crashing the whole slideshow — this is meant to
// run unattended, so one flaky API shouldn't take the display down.
export async function buildPlaylist(sourceConfig = {}) {
  const entries = Object.entries(sourceConfig).filter(([id, cfg]) => cfg?.enabled && SOURCES[id]);

  const batches = await Promise.all(entries.map(async ([id, cfg]) => {
    try {
      return await SOURCES[id].fetchBatch({ filters: cfg.filters || {} });
    } catch (err) {
      console.warn(`[SlowFrame] source "${id}" failed to load:`, err);
      return [];
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
