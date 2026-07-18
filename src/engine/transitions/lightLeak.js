// A warm flare blooms across the screen (via the overlay, screen-blended
// so it brightens rather than obscures) and clears to reveal the next image.
export function lightLeak({ activeEl, waitingEl, overlayEl, durationMs }) {
  return new Promise(resolve => {
    const half = durationMs / 2;
    const x = 20 + Math.random() * 60;
    const y = 20 + Math.random() * 60;

    overlayEl.style.background =
      `radial-gradient(circle at ${x}% ${y}%, rgba(255,255,255,0.95), rgba(255,244,214,0.5) 35%, transparent 70%)`;
    overlayEl.style.mixBlendMode = 'screen';
    overlayEl.style.transition = 'none';
    overlayEl.style.opacity = '0';
    waitingEl.style.transition = 'none';
    waitingEl.style.opacity = '1';
    activeEl.style.transition = 'none';

    requestAnimationFrame(() => {
      overlayEl.style.transition = `opacity ${half}ms ease-in`;
      overlayEl.style.opacity = '1';
    });

    setTimeout(() => {
      activeEl.style.opacity = '0';
      overlayEl.style.transition = `opacity ${half}ms ease-out`;
      requestAnimationFrame(() => { overlayEl.style.opacity = '0'; });
      setTimeout(() => {
        overlayEl.style.mixBlendMode = '';
        resolve();
      }, half);
    }, half);
  });
}
