// Deliberately minimal preset mechanism: bundles a source + filter
// combination under a friendly name, applied as a one-shot action from
// the Sources settings section. This exists specifically to answer "Sci-Fi
// & Fantasy" sources — there's no dedicated public API for that genre (see
// the note in wikimedia.js), so the preset just points Wikimedia Commons'
// free-text search at a query that surfaces it well (verified directly
// against the live Commons API while building this) and adds NASA's real
// space imagery alongside it for the aesthetic overlap. Phase 5's full
// custom-preset builder (save/load, more curated bundles) stays out of
// scope here — this is just the one preset asked for.
export const PRESETS = [
  {
    id: 'scifi-fantasy',
    label: 'Sci-Fi & Fantasy',
    apply(settings) {
      settings.sources.wikimedia.enabled = true;
      settings.sources.wikimedia.filters.query = 'science fiction OR fantasy art';
      settings.sources.nasa.enabled = true;
    },
  },
];
