import { crossfade } from './crossfade.js';
import { fadeToBlack, fadeToWhite, dipToColor } from './fadeThroughColor.js';
import { slide } from './slide.js';
import { zoomThrough } from './zoomThrough.js';
import { drift } from './drift.js';
import { lightLeak } from './lightLeak.js';
import { inkWash } from './inkWash.js';
import { curtain } from './curtain.js';

export const DEFAULT_TRANSITION = 'crossfade';

// tier 'css' transitions are implemented and run today. tier 'canvas'/'webgl'
// entries are listed (per the app spec) so they show up as real options in
// settings, but aren't built yet — `run` falls back to crossfade until they
// are, rather than shipping a cheap effect that doesn't match the spec's
// description of what they should look like. See maintenance_todo.md Phase 2.
export const TRANSITIONS = {
  crossfade:   { label: 'Crossfade',      tier: 'css', run: crossfade },
  fadeToBlack: { label: 'Fade to black',  tier: 'css', run: fadeToBlack },
  fadeToWhite: { label: 'Fade to white',  tier: 'css', run: fadeToWhite },
  dipToColor:  { label: 'Dip to color',   tier: 'css', run: dipToColor },
  slide:       { label: 'Slide',          tier: 'css', run: slide },
  zoomThrough: { label: 'Zoom through',   tier: 'css', run: zoomThrough },
  drift:       { label: 'Drift',          tier: 'css', run: drift },
  lightLeak:   { label: 'Light leak',     tier: 'css', run: lightLeak },
  inkWash:     { label: 'Ink wash',       tier: 'css', run: inkWash },
  curtain:     { label: 'Curtain',        tier: 'css', run: curtain },
  burn:        { label: 'Burn',           tier: 'webgl', run: crossfade, planned: true },
  dissolve:    { label: 'Dissolve',       tier: 'webgl', run: crossfade, planned: true },
  shatter:     { label: 'Shatter',        tier: 'webgl', run: crossfade, planned: true },
  ripple:      { label: 'Ripple',         tier: 'webgl', run: crossfade, planned: true },
};

export function resolveTransition(id) {
  return TRANSITIONS[id] || TRANSITIONS[DEFAULT_TRANSITION];
}

const IMPLEMENTED_IDS = Object.keys(TRANSITIONS).filter(id => !TRANSITIONS[id].planned);

export function pickRandomTransitionId() {
  return IMPLEMENTED_IDS[Math.floor(Math.random() * IMPLEMENTED_IDS.length)];
}
