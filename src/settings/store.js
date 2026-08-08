// Small localStorage-backed settings store, separate from themes.js (which
// predates this and has its own persistence key/reasons — kept as-is rather
// than merged in, to avoid an unrelated refactor).
const KEY = 'slowframe.settings';

export const DEFAULTS = {
  displayMode: 'kenburns',  // 'kenburns' | 'static' | 'fade'
  transitionId: 'crossfade', // or 'random', or any TRANSITIONS key
  dipColor: '#8a5a3b',
  slideMs: 12000,
  transitionMs: 1500,
  order: 'sequential', // 'sequential' | 'shuffle'
  cacheEnabled: true, // cache live-source images (Cache API + IndexedDB) so the app keeps working offline
  sources: {
    local: { enabled: true, filters: {} },
    met: { enabled: false, filters: {} },
    aic: { enabled: false, filters: {} },
    wikimedia: { enabled: false, filters: {} },
    nasa: { enabled: false, filters: {} },
    openverse: { enabled: false, filters: {} },
    nps: { enabled: false, filters: {} },
    flickr: { enabled: false, filters: {} },
    smithsonian: { enabled: false, filters: {} },
    europeana: { enabled: false, filters: {} },
    rijksmuseum: { enabled: false, filters: {} },
    localFiles: { enabled: false, filters: {} },
  },
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const stored = JSON.parse(raw);
    // `sources` needs its own merge, not just the top-level spread below: a
    // plain `{...DEFAULTS, ...stored}` lets a stored `sources` object
    // wholesale replace DEFAULTS.sources, silently dropping any source added
    // to DEFAULTS after the settings were last saved — confirmed live, an
    // existing localStorage predating Phase 4 hid all six new sources from
    // the Settings panel until this was fixed.
    return { ...DEFAULTS, ...stored, sources: { ...DEFAULTS.sources, ...stored.sources } };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(KEY, JSON.stringify(settings));
}
