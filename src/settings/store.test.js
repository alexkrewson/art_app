import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULTS, loadSettings, saveSettings, clampKbCycle, KB_SLOWEST_MS, KB_FASTEST_MS } from './store.js';

const KEY = 'slowframe.settings';

describe('settings store', () => {
  beforeEach(() => localStorage.clear());

  it('returns a copy of DEFAULTS when nothing is stored', () => {
    const settings = loadSettings();
    expect(settings).toEqual(DEFAULTS);
    expect(settings).not.toBe(DEFAULTS); // fresh top-level object, so callers can mutate without corrupting DEFAULTS
  });

  it('merges stored settings over the defaults', () => {
    localStorage.setItem(KEY, JSON.stringify({ slideMs: 5000, order: 'shuffle' }));
    const settings = loadSettings();
    expect(settings.slideMs).toBe(5000);
    expect(settings.order).toBe('shuffle');
    expect(settings.transitionMs).toBe(DEFAULTS.transitionMs); // untouched default preserved
  });

  it('preserves stored per-source settings while still gaining sources added to DEFAULTS since', () => {
    // Simulates a user whose localStorage predates a source added later
    // (e.g. Phase 4): only `local` and `met` exist in their stored settings.
    localStorage.setItem(KEY, JSON.stringify({
      sources: {
        local: { enabled: true, filters: {} },
        met: { enabled: true, filters: { keyword: 'sunflowers' } },
      },
    }));
    const settings = loadSettings();
    expect(settings.sources.met).toEqual({ enabled: true, filters: { keyword: 'sunflowers' } }); // their choice is kept
    expect(settings.sources.aic).toEqual(DEFAULTS.sources.aic); // a source added later is still present
    expect(Object.keys(settings.sources)).toEqual(Object.keys(DEFAULTS.sources)); // nothing missing
  });

  it('falls back to defaults when the stored value is corrupted JSON', () => {
    localStorage.setItem(KEY, '{not valid json');
    expect(loadSettings()).toEqual(DEFAULTS);
  });

  it('saveSettings persists to localStorage, round-tripping through loadSettings', () => {
    const settings = { ...DEFAULTS, slideMs: 9000 };
    saveSettings(settings);
    expect(JSON.parse(localStorage.getItem(KEY)).slideMs).toBe(9000);
    expect(loadSettings().slideMs).toBe(9000);
  });

  // Ken Burns range narrowed 2026-08-11: the old 13s default became the
  // slowest available setting, the fast end stayed, the default moved to the
  // midpoint. Every tablet in the field has a value saved from the old range.
  describe('Ken Burns bounds', () => {
    it('defaults to the midpoint of the range', () => {
      expect(DEFAULTS.kbCycleMs).toBe((KB_SLOWEST_MS + KB_FASTEST_MS) / 2);
      expect(DEFAULTS.kbCycleMs).toBe(8500);
    });

    it('no longer allows anything slower than the old default', () => {
      expect(KB_SLOWEST_MS).toBe(13000);
      expect(clampKbCycle(40000)).toBe(13000);
      expect(clampKbCycle(20000)).toBe(13000);
    });

    it('leaves the fast end where it was', () => {
      expect(KB_FASTEST_MS).toBe(4000);
      expect(clampKbCycle(4000)).toBe(4000);
      expect(clampKbCycle(1000)).toBe(4000);
    });

    it('clamps a value saved before the range narrowed', () => {
      // Without this a tablet holding 25000 would render the slider pinned at
      // its slow end while the engine kept panning at the old, wider speed.
      localStorage.setItem(KEY, JSON.stringify({ ...DEFAULTS, kbCycleMs: 25000 }));
      expect(loadSettings().kbCycleMs).toBe(KB_SLOWEST_MS);
    });

    it('leaves an in-range saved value alone', () => {
      localStorage.setItem(KEY, JSON.stringify({ ...DEFAULTS, kbCycleMs: 10000 }));
      expect(loadSettings().kbCycleMs).toBe(10000);
    });

    it('falls back to the default for a junk value', () => {
      localStorage.setItem(KEY, JSON.stringify({ ...DEFAULTS, kbCycleMs: 'fast' }));
      expect(loadSettings().kbCycleMs).toBe(DEFAULTS.kbCycleMs);
    });
  });
});
