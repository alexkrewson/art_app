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

  return new Promise(resolve => {
    waitingEl.style.transition = 'none';
    waitingEl.style.opacity = '1';
    waitingEl.style.transform = START[dir];
    activeEl.style.transition = 'none';

    requestAnimationFrame(() => {
      waitingEl.style.transition = `transform ${durationMs}ms ease-in-out`;
      activeEl.style.transition = `transform ${durationMs}ms ease-in-out`;
      waitingEl.style.transform = 'translate3d(0,0,0)';
      activeEl.style.transform = EXIT[dir];
    });

    setTimeout(() => {
      activeEl.style.opacity = '0';
      resolve();
    }, durationMs);
  });
}
