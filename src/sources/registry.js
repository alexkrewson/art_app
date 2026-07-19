import { localManifestSource } from './localManifest.js';
import { metSource } from './met.js';
import { localFilesSource } from './localFiles.js';

export const SOURCES = {
  local: localManifestSource,
  met: metSource,
  localFiles: localFilesSource,
};
