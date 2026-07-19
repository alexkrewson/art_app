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
  sources: {
    local: { enabled: true, filters: {} },
    met: { enabled: false, filters: {} },
    localFiles: { enabled: false, filters: {} },
  },
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(KEY, JSON.stringify(settings));
}
