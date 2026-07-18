// The original kiosk.html default: simple opacity blend.
export function crossfade({ activeEl, waitingEl, durationMs }) {
  return new Promise(resolve => {
    activeEl.style.transition = `opacity ${durationMs}ms ease-in-out`;
    waitingEl.style.transition = `opacity ${durationMs}ms ease-in-out`;
    requestAnimationFrame(() => {
      activeEl.style.opacity = '0';
      waitingEl.style.opacity = '1';
    });
    setTimeout(resolve, durationMs);
  });
}
