// Both images drift past each other with a slight parallax offset while
// cross-dissolving, rather than a flat opacity blend in place.
export function drift({ activeEl, waitingEl, durationMs }) {
  return new Promise(resolve => {
    waitingEl.style.transition = 'none';
    waitingEl.style.opacity = '0';
    waitingEl.style.transform = 'translate3d(4%,0,0) scale3d(1.04,1.04,1)';

    activeEl.style.transition = 'none';
    requestAnimationFrame(() => {
      const t = `opacity ${durationMs}ms ease-in-out, transform ${durationMs}ms ease-in-out`;
      activeEl.style.transition = t;
      waitingEl.style.transition = t;
      activeEl.style.opacity = '0';
      activeEl.style.transform = 'translate3d(-4%,0,0) scale3d(1.04,1.04,1)';
      waitingEl.style.opacity = '1';
      waitingEl.style.transform = 'translate3d(0,0,0) scale3d(1,1,1)';
    });

    setTimeout(resolve, durationMs);
  });
}
