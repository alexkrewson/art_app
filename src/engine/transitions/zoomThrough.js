import { play } from './animate.js';

// Outgoing image zooms in until it fills the screen, then a hard cut to the
// incoming image (no cross-dissolve — the zoom itself is the transition).
export function zoomThrough({ activeEl, waitingEl, durationMs }) {
  waitingEl.style.opacity = '0';
  waitingEl.style.transform = 'translate3d(0,0,0) scale3d(1,1,1)';

  return play(activeEl, [
    { transform: 'translate3d(0,0,0) scale3d(1,1,1)', opacity: 1 },
    { transform: 'translate3d(0,0,0) scale3d(2.4,2.4,1)', opacity: 0 },
  ], { durationMs, easing: 'ease-in' }).then(() => {
    waitingEl.style.opacity = '1'; // cut, not a fade
  });
}
