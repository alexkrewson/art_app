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
  // Ken Burns pan/zoom segment length in ms — lower is faster drift. 13s was
  // the hardcoded value inherited from kiosk.html; Alex asked for it to be
  // adjustable, so it is now a setting with that value as the default.
  kbCycleMs: 13000,
  order: 'sequential', // 'sequential' | 'shuffle'
  // Title/artist ribbon along the bottom. On by default; switching it off
  // gives the artwork the full screen height rather than leaving a gap.
  showRibbon: true,
  // Faded thumbs up/down over the artwork. Defaulted ON as of 2026-08-10:
  // originally off on the reasoning that controls over artwork should be
  // opt-in, but Alex went looking for these twice and couldn't find them, so
  // the reasoning was worth less than the discoverability. They sit at 35%
  // opacity and cost nothing when unused.
  showVoting: true,
  // Temporary on-screen diagnostic. Added 2026-08-08 because two attempts to
  // fix the lagging caption by reading the code both failed, and a jsdom
  // harness of the advance cycle could not reproduce it either — so the next
  // step is measuring the real thing rather than guessing a third time.
  debugOverlay: false,
  // Ticked categories, keyed by the ids from library.js's catId(). Each is
  // { count } — how many images that category should keep on the device.
  // Replaces the old cacheEnabled/streaming model entirely: if it isn't in
  // here and downloaded, the slideshow never shows it.
  categories: {},
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
    return {
      ...DEFAULTS, ...stored,
      sources: { ...DEFAULTS.sources, ...stored.sources },
      categories: { ...(stored.categories || {}) },
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(KEY, JSON.stringify(settings));
}
