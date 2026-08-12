import { describe, it, expect } from 'vitest';
import { describeCategory, describeCategories, sourceName } from './categoryLabel.js';

describe('sourceName', () => {
  it('uses a ribbon-length name, not the Settings label', () => {
    // SOURCES[].label is "NASA Image and Video Library" / "US National Park
    // Service", which is right in a settings list and far too long in a caption.
    expect(sourceName('nasa')).toBe('NASA');
    expect(sourceName('nps')).toBe('National Parks');
    expect(sourceName('wikimedia')).toBe('Wikimedia');
    expect(sourceName('openverse')).toBe('Openverse');
  });

  it('falls back to the id for something unrecognised', () => {
    expect(sourceName('nope')).toBe('nope');
  });
});

describe('describeCategory', () => {
  it('gives the source and the ticked label', () => {
    // The example Alex asked for.
    expect(describeCategory('openverse::mountain~alps~summit~glacier%20peak'))
      .toEqual({ source: 'Openverse', subject: 'Mountains' });
  });

  it('reads a NASA curated subject', () => {
    expect(describeCategory('nasa::nebula')).toEqual({ source: 'NASA', subject: 'Nebulae' });
  });

  it('recovers a label for a subject that no longer matches any option', () => {
    // Not hypothetical: the tablets hold `openverse::coast%20ocean` from
    // before the subjects were rewritten as ~-separated queries, so no current
    // option matches. Showing nothing would blank the category for a whole
    // existing library.
    expect(describeCategory('openverse::coast%20ocean'))
      .toEqual({ source: 'Openverse', subject: 'Coast ocean' });
  });

  it('takes the first query when a subject bundles several', () => {
    expect(describeCategory('wikimedia::Featured%20pictures%7CQuality%20images').subject)
      .toBe('Featured pictures');
  });

  it('truncates a very long recovered subject', () => {
    const d = describeCategory(`wikimedia::${encodeURIComponent('a'.repeat(80))}`);
    expect(d.subject.length).toBeLessThanOrEqual(32);
    expect(d.subject.endsWith('…')).toBe(true);
  });

  it('handles a source with no subjects at all', () => {
    expect(describeCategory('openverse')).toEqual({ source: 'Openverse', subject: '' });
  });

  it('returns null for junk rather than rendering it', () => {
    expect(describeCategory('')).toBeNull();
    expect(describeCategory(null)).toBeNull();
    expect(describeCategory('notasource::thing')).toBeNull();
  });
});

describe('describeCategories', () => {
  it('formats a single category the way Alex described it', () => {
    expect(describeCategories(['openverse::mountain~alps~summit~glacier%20peak']))
      .toBe('Openverse, Mountains');
  });

  it('joins two categories', () => {
    expect(describeCategories(['nasa::nebula', 'nasa::galaxy']))
      .toBe('NASA, Nebulae · NASA, Galaxies');
  });

  it('caps the list rather than growing without bound', () => {
    // One image can be downloaded under many categories; the ribbon has to
    // stay one line.
    const out = describeCategories(['nasa::nebula', 'nasa::galaxy', 'nasa::apollo', 'nasa::mars%20surface']);
    expect(out).toBe('NASA, Nebulae · NASA, Galaxies +2');
  });

  it('de-duplicates identical labels', () => {
    expect(describeCategories(['nasa::nebula', 'nasa::nebula'])).toBe('NASA, Nebulae');
  });

  it('is empty for an image with no categories', () => {
    // Bundled and local-folder images are not in the library at all.
    expect(describeCategories([])).toBe('');
    expect(describeCategories(undefined)).toBe('');
    expect(describeCategories(['badsource::x'])).toBe('');
  });
});
