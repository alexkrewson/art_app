// Title/artist/date footer ribbon, ported from kiosk.html. Falls back
// gracefully when a record has no metadata (e.g. a local file with only a
// filename).
import { describeCategories } from '../library/categoryLabel.js';

export function createMetadataRibbon(titleEl, metaEl) {
  return {
    update(img) {
      titleEl.textContent = img.title || '';
      const artist = (img.artist || '').split('\n')[0];
      // `department` carries whatever a source uses to place a record: Met's
      // curatorial department, the park an NPS photo belongs to, or the
      // upstream provider for Openverse (Flickr, iNaturalist, …). It was
      // populated by several sources but never displayed. Showing it matters
      // most for Openverse, whose records carry no date at all — measured, 12
      // of 12 — so without it that line is often just a name and a licence.
      //
      // `attribution` (source/license credit) is only set by sources whose
      // license requires it, e.g. Wikimedia Commons' CC BY/CC BY-SA images —
      // Public domain/CC0 records leave it blank, same as every other source.
      // Which ticked category this image came from, e.g. "Openverse,
      // Mountains". Last in the line because it answers "where is this from"
      // rather than "what is it", and it is empty for anything outside the
      // downloaded library (bundled and local-folder images have no category).
      const category = describeCategories(img.cats);
      metaEl.textContent = [artist, img.date, img.department, img.attribution, category]
        .filter(Boolean)
        .join('  —  ');
    },
    setVisible(visible) {
      titleEl.parentElement.style.display = visible ? '' : 'none';
    },
  };
}
