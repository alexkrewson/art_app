// Title/artist/date footer ribbon, ported from kiosk.html. Falls back
// gracefully when a record has no metadata (e.g. a local file with only a
// filename).

export function createMetadataRibbon(titleEl, metaEl) {
  return {
    update(img) {
      titleEl.textContent = img.title || '';
      const artist = (img.artist || '').split('\n')[0];
      // `attribution` (source/license credit) is only set by sources whose
      // license requires it, e.g. Wikimedia Commons' CC BY/CC BY-SA images —
      // Public domain/CC0 records leave it blank, same as every other source.
      metaEl.textContent = [artist, img.date, img.attribution].filter(Boolean).join('  —  ');
    },
    setVisible(visible) {
      titleEl.parentElement.style.display = visible ? '' : 'none';
    },
  };
}
