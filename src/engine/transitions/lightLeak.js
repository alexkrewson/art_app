import { play } from './animate.js';

// A warm flare blooms across the screen (via the overlay, screen-blended
// so it brightens rather than obscures) and clears to reveal the next image.
export async function lightLeak({ activeEl, waitingEl, overlayEl, durationMs }) {
  const half = durationMs / 2;
  const x = 20 + Math.random() * 60;
  const y = 20 + Math.random() * 60;

  overlayEl.style.background =
    `radial-gradient(circle at ${x}% ${y}%, rgba(255,255,255,0.95), rgba(255,244,214,0.5) 35%, transparent 70%)`;
  overlayEl.style.mixBlendMode = 'screen';
  overlayEl.style.opacity = '0';
  waitingEl.style.opacity = '1';

  await play(overlayEl, [{ opacity: 0 }, { opacity: 1 }], { durationMs: half, easing: 'ease-in' });

  // Swap at peak brightness, where the flare is hiding the cut.
  activeEl.style.opacity = '0';

  await play(overlayEl, [{ opacity: 1 }, { opacity: 0 }], { durationMs: half, easing: 'ease-out' });

  // Must be cleared: the overlay is shared, and a leftover screen blend would
  // tint every subsequent transition that uses it.
  overlayEl.style.mixBlendMode = '';
}
