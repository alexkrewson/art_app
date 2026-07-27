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
