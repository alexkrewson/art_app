import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULTS, loadSettings, saveSettings } from './store.js';

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
});
