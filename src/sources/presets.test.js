import { describe, it, expect } from 'vitest';
import { PRESETS } from './presets.js';
import { DEFAULTS } from '../settings/store.js';

function freshSettings() {
  return JSON.parse(JSON.stringify(DEFAULTS));
}

describe('PRESETS', () => {
  it('the Sci-Fi & Fantasy preset enables Wikimedia with a genre query and enables NASA', () => {
    const preset = PRESETS.find(p => p.id === 'scifi-fantasy');
    const settings = freshSettings();
    preset.apply(settings);

    expect(settings.sources.wikimedia.enabled).toBe(true);
    expect(settings.sources.wikimedia.filters.query).toBe('Category:Science fiction art|Category:Fantasy art');
    expect(settings.sources.nasa.enabled).toBe(true);
  });

  it('does not touch unrelated sources', () => {
    const preset = PRESETS.find(p => p.id === 'scifi-fantasy');
    const settings = freshSettings();
    preset.apply(settings);

    expect(settings.sources.met.enabled).toBe(false);
    expect(settings.sources.local.enabled).toBe(true);
  });
});
