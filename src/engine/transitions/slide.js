import { playAll } from './animate.js';

const START = {
  left:  'translate3d(-100%,0,0)',
  right: 'translate3d(100%,0,0)',
  up:    'translate3d(0,-100%,0)',
  down:  'translate3d(0,100%,0)',
};
const EXIT = {
  left:  'translate3d(100%,0,0)',
  right: 'translate3d(-100%,0,0)',
  up:    'translate3d(0,100%,0)',
  down:  'translate3d(0,-100%,0)',
};
const DIRECTIONS = Object.keys(START);

// Incoming image enters from `direction`, outgoing exits toward the
// opposite side — both travel together, carousel-style.
export function slide({ activeEl, waitingEl, durationMs, options }) {
  const dir = options?.direction && START[options.direction]
    ? options.direction
    : DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];

  // Both slides are visible for the whole move; it's the travel that reads as
  // the transition, not a fade. Set before animating so there's no flash.
  waitingEl.style.opacity = '1';

  return playAll([
    [waitingEl, [{ transform: START[dir] }, { transform: 'translate3d(0,0,0)' }]],
    [activeEl, [{ transform: 'translate3d(0,0,0)' }, { transform: EXIT[dir] }]],
  ], { durationMs }).then(() => {
    activeEl.style.opacity = '0';
  });
}
