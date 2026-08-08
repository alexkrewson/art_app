import { localManifestSource } from './localManifest.js';
import { metSource } from './met.js';
import { localFilesSource } from './localFiles.js';
import { aicSource } from './aic.js';
import { wikimediaSource } from './wikimedia.js';
import { nasaSource } from './nasa.js';
import { smithsonianSource } from './smithsonian.js';
import { europeanaSource } from './europeana.js';
import { rijksmuseumSource } from './rijksmuseum.js';
import { openverseSource } from './openverse.js';
import { flickrSource } from './flickr.js';
import { npsSource } from './nps.js';

export const SOURCES = {
  local: localManifestSource,
  met: metSource,
  aic: aicSource,
  wikimedia: wikimediaSource,
  nasa: nasaSource,
  openverse: openverseSource,
  nps: npsSource,
  flickr: flickrSource,
  smithsonian: smithsonianSource,
  europeana: europeanaSource,
  rijksmuseum: rijksmuseumSource,
  localFiles: localFilesSource,
};
