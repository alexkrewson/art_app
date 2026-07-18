// Title/artist/date footer ribbon, ported from kiosk.html. Falls back
// gracefully when a record has no metadata (e.g. a local file with only a
// filename).

export function createMetadataRibbon(titleEl, metaEl) {
  return {
    update(img) {
      titleEl.textContent = img.title || '';
      const artist = (img.artist || '').split('\n')[0];
      metaEl.textContent = [artist, img.date].filter(Boolean).join('  —  ');
    },
    setVisible(visible) {
      titleEl.parentElement.style.display = visible ? '' : 'none';
    },
  };
}
