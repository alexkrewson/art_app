// Deliberately minimal preset mechanism: bundles a source + filter
// combination under a friendly name, applied as a one-shot action from
// the Sources settings section. This exists specifically to answer "Sci-Fi
// & Fantasy" sources — there's no dedicated public API for that genre (see
// the note in wikimedia.js), so the preset ticks Wikimedia's two curated
// category checkboxes (`Science fiction art`, `Fantasy art` — confirmed to
// exist directly on Commons with a good number of files each) and adds
// NASA's real space imagery alongside it for the aesthetic overlap. An
// earlier version used a plain free-text search ("science fiction OR
// fantasy art"), which surfaced off-topic matches — author headshots, a
// library-shelf photo — since Commons' relevance search has no genre
// concept; browsing real categories fixed that. The categories are also
// individually toggleable straight from the Wikimedia Commons section
// itself (not just through this preset) — this button is just a shortcut
// for "both, plus NASA". Phase 5's full custom-preset builder (save/load,
// more curated bundles) stays out of scope here — this is just the one
// preset asked for.
export const PRESETS = [
  {
    id: 'scifi-fantasy',
    label: 'Sci-Fi & Fantasy',
    apply(settings) {
      settings.sources.wikimedia.enabled = true;
      settings.sources.wikimedia.filters.categories = ['Science fiction art', 'Fantasy art'];
      settings.sources.nasa.enabled = true;
    },
  },
];
