import { playAll } from './animate.js';

// Both images drift past each other with a slight parallax offset while
// cross-dissolving, rather than a flat opacity blend in place.
export function drift({ activeEl, waitingEl, durationMs }) {
  return playAll([
    [activeEl, [
      { opacity: 1, transform: 'translate3d(0,0,0) scale3d(1,1,1)' },
      { opacity: 0, transform: 'translate3d(-4%,0,0) scale3d(1.04,1.04,1)' },
    ]],
    [waitingEl, [
      { opacity: 0, transform: 'translate3d(4%,0,0) scale3d(1.04,1.04,1)' },
      { opacity: 1, transform: 'translate3d(0,0,0) scale3d(1,1,1)' },
    ]],
  ], { durationMs });
}
