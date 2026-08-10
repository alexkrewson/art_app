import { SOURCES } from './registry.js';
import { shuffle } from './base.js';
import { localManifestSource } from './localManifest.js';
import { playlistFor } from '../library/library.js';

// Builds what the slideshow plays.
//
// Rewritten 2026-08-09 with the download-first model. This used to call every
// enabled source's fetchBatch() at startup and hand back live URLs, so the
// slideshow was streaming from eight APIs while it played. Alex's objection was
// exactly right: everything shown has to be downloaded anyway, so fetching it
// mid-slideshow only makes the timing unpredictable and spends someone's mobile
// data without asking.
//
// Now the playlist comes off the disk. Ticking a category downloads it (see
// library.js); this just reads what's there. The only sources still consulted
// live are the two that were never remote to begin with: the bundled starter
// set and a user-picked local folder.
export async function buildPlaylist(sourceConfig = {}, { categories = {} } = {}) {
  const activeCats = Object.keys(categories);

  let downloaded = [];
  try {
    downloaded = await playlistFor(activeCats);
  } catch (err) {
    console.warn('[SlowFrame] could not read the downloaded library:', err);
  }

  // These two are already local, so they stay direct reads rather than being
  // copied into the library.
  const localBatches = await Promise.all(
    ['local', 'localFiles']
      .filter(id => sourceConfig[id]?.enabled && SOURCES[id])
      .map(async id => {
        try {
          return await SOURCES[id].fetchBatch({ filters: sourceConfig[id].filters || {}, count: 500 });
        } catch (err) {
          console.warn(`[SlowFrame] local source "${id}" failed:`, err);
          return [];
        }
      }),
  );

  const playlist = [...downloaded, ...localBatches.flat()];

  // Never hand the slideshow nothing: a first run with no categories ticked
  // still shows the bundled set rather than a black screen.
  if (!playlist.length) {
    console.warn('[SlowFrame] nothing downloaded or enabled — falling back to the bundled starter set');
    return localManifestSource.fetchBatch();
  }
  return playlist;
}

export function orderPlaylist(playlist, mode) {
  return mode === 'shuffle' ? shuffle(playlist) : playlist;
}
