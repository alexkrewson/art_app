// The bundled Met Museum starter set (public/images.json + public/images/),
// carried over from kiosk.html for backward compatibility and as a
// zero-network fallback — the app must still work if every live source is
// disabled or offline (important for the Termux/kiosk use case).
export const localManifestSource = {
  id: 'local',
  label: 'Local Starter Set',
  needsApiKey: false,
  description: 'The bundled Met Museum images shipped with the app. Works fully offline.',

  listFilters() {
    return [];
  },

  async fetchBatch() {
    const res = await fetch('images.json');
    const all = await res.json();
    return all.map(r => ({ ...r, source: 'local' }));
  },
};
