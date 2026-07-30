// Deliberately minimal preset mechanism: bundles a source + filter
// combination under a friendly name, applied as a one-shot action from
// the Sources settings section. This exists specifically to answer "Sci-Fi
// & Fantasy" sources — there's no dedicated public API for that genre (see
// the note in wikimedia.js), so the preset points Wikimedia Commons at two
// curated categories (browsed via wikimedia.js's `|`-separated Category:
// support, not free-text search) and adds NASA's real space imagery
// alongside it for the aesthetic overlap. An earlier version used a plain
// free-text search ("science fiction OR fantasy art"), which also surfaced
// off-topic matches — author headshots, a library-shelf photo — since
// Commons' relevance search has no genre concept; confirmed both
// `Category:Science fiction art` and `Category:Fantasy art` exist directly
// on Commons with a good number of files each, so browsing them beats
// searching for them. Phase 5's full custom-preset builder (save/load, more
// curated bundles) stays out of scope here — this is just the one preset
// asked for.
export const PRESETS = [
  {
    id: 'scifi-fantasy',
    label: 'Sci-Fi & Fantasy',
    apply(settings) {
      settings.sources.wikimedia.enabled = true;
      settings.sources.wikimedia.filters.query = 'Category:Science fiction art|Category:Fantasy art';
      settings.sources.nasa.enabled = true;
    },
  },
];
