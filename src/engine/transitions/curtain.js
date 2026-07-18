// A wipe that draws open from the center outward, like a curtain parting.
export function curtain({ activeEl, waitingEl, durationMs }) {
  return new Promise(resolve => {
    waitingEl.style.transition = 'none';
    waitingEl.style.opacity = '1';
    waitingEl.style.clipPath = 'inset(0 50% 0 50%)';
    activeEl.style.transition = 'none';

    requestAnimationFrame(() => {
      waitingEl.style.transition = `clip-path ${durationMs}ms ease-in-out`;
      waitingEl.style.clipPath = 'inset(0 0 0 0)';
    });

    setTimeout(() => {
      activeEl.style.opacity = '0';
      waitingEl.style.clipPath = '';
      resolve();
    }, durationMs);
  });
}
