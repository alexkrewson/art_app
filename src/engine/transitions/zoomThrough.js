// Outgoing image zooms in until it fills the screen, then a hard cut to the
// incoming image (no cross-dissolve — the zoom itself is the transition).
export function zoomThrough({ activeEl, waitingEl, durationMs }) {
  return new Promise(resolve => {
    waitingEl.style.transition = 'none';
    waitingEl.style.opacity = '0';
    waitingEl.style.transform = 'translate3d(0,0,0) scale3d(1,1,1)';

    activeEl.style.transition = 'none';
    requestAnimationFrame(() => {
      activeEl.style.transition = `transform ${durationMs}ms ease-in, opacity ${durationMs}ms ease-in`;
      activeEl.style.transform = 'translate3d(0,0,0) scale3d(2.4,2.4,1)';
      activeEl.style.opacity = '0';
    });

    setTimeout(() => {
      waitingEl.style.opacity = '1'; // cut, not a fade
      resolve();
    }, durationMs);
  });
}
