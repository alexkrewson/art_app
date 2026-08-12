// Small localStorage-backed settings store, separate from themes.js (which
// predates this and has its own persistence key/reasons — kept as-is rather
// than merged in, to avoid an unrelated refactor).
const KEY = 'slowframe.settings';

// Ken Burns pan bounds, as segment DURATIONS in ms — bigger is slower.
// Exported because these numbers were previously repeated as literals in the
// slider markup and both of its handlers, which is three places to forget.
//
// Narrowed on 2026-08-11 at Alex's request: the slow end used to reach 40s per
// pan and the default sat at 13s. The old default is now the slowest setting
// available, the fast end is unchanged, and the default sits midway between
// them. Anything slower than a 13s pan is gone.
export const KB_SLOWEST_MS = 13000;
export const KB_FASTEST_MS = 4000;
export const KB_DEFAULT_MS = (KB_SLOWEST_MS + KB_FASTEST_MS) / 2;   // 8500

// The default in force before the range narrowed. Needed only to recognise
// settings saved back then: a stored 13000 almost certainly means "never
// touched the slider" rather than "chose 13 seconds", and after the change
// that value lands on the slider's minimum. Alex hit exactly this — reloaded
// the web app and found the handle pinned left instead of centred.
const LEGACY_KB_DEFAULT_MS = 13000;

export const DEFAULTS = {
  displayMode: 'kenburns',  // 'kenburns' | 'static' | 'fade'
  transitionId: 'crossfade', // or 'random', or any TRANSITIONS key
  dipColor: '#8a5a3b',
  slideMs: 12000,
  transitionMs: 1500,
  // Ken Burns pan/zoom segment length in ms — lower is faster drift. See
  // KB_SLOWEST_MS/KB_FASTEST_MS above for the range and why it narrowed.
  kbCycleMs: KB_DEFAULT_MS,
  // Ease the Ken Burns pan in and out instead of drifting at a constant rate:
  // stationary at each end, fastest in the middle. Off by default, because the
  // default has to stay what it has always been. Only takes effect when the
  // slide is at least SMOOTH_MIN_SLIDE_MS long — see kenburns.js.
  kbSmooth: false,
  // Whether the Ken Burns speed was chosen deliberately. Without this, a saved
  // value is indistinguishable from an untouched default, so any future change
  // to KB_DEFAULT_MS would silently fail to reach anyone who had ever opened
  // Settings — the stored copy of the OLD default would win forever.
  kbCycleUserSet: false,
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

export function clampKbCycle(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return KB_DEFAULT_MS;
  return Math.min(KB_SLOWEST_MS, Math.max(KB_FASTEST_MS, n));
}

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
    const merged = {
      ...DEFAULTS, ...stored,
      sources: { ...DEFAULTS.sources, ...stored.sources },
      categories: { ...(stored.categories || {}) },
    };
    // Settings saved before kbCycleUserSet existed: infer it. A value equal to
    // the old default means the slider was never touched, so the new default
    // should win; anything else was a deliberate choice and is kept.
    if (stored.kbCycleUserSet === undefined) {
      merged.kbCycleUserSet =
        stored.kbCycleMs !== undefined && stored.kbCycleMs !== LEGACY_KB_DEFAULT_MS;
    }
    // An untouched speed always tracks the current default rather than a stale
    // copy of an old one.
    if (!merged.kbCycleUserSet) merged.kbCycleMs = DEFAULTS.kbCycleMs;
    // A value saved before the range narrowed would otherwise leave the slider
    // pinned at one end while the engine ran a speed the slider cannot express.
    merged.kbCycleMs = clampKbCycle(merged.kbCycleMs);
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(KEY, JSON.stringify(settings));
}
