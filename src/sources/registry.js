import { localManifestSource } from './localManifest.js';
import { metSource } from './met.js';
import { localFilesSource } from './localFiles.js';
import { aicSource } from './aic.js';
import { wikimediaSource } from './wikimedia.js';
import { nasaSource } from './nasa.js';
import { smithsonianSource } from './smithsonian.js';
import { europeanaSource } from './europeana.js';
import { rijksmuseumSource } from './rijksmuseum.js';

export const SOURCES = {
  local: localManifestSource,
  met: metSource,
  aic: aicSource,
  wikimedia: wikimediaSource,
  nasa: nasaSource,
  smithsonian: smithsonianSource,
  europeana: europeanaSource,
  rijksmuseum: rijksmuseumSource,
  localFiles: localFilesSource,
};
