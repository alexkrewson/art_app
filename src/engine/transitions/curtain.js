import { play } from './animate.js';

// A wipe that draws open from the center outward, like a curtain parting.
export function curtain({ activeEl, waitingEl, durationMs }) {
  waitingEl.style.opacity = '1';

  return play(waitingEl, [
    { clipPath: 'inset(0 50% 0 50%)' },
    { clipPath: 'inset(0 0 0 0)' },
  ], { durationMs }).then(() => {
    activeEl.style.opacity = '0';
    waitingEl.style.clipPath = '';
  });
}
