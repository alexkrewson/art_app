import { play } from './animate.js';

// Shared implementation for "Fade to black", "Fade to white", and "Dip to
// color": the outgoing image fades into a solid color overlay, then the
// overlay fades away to reveal the incoming image already in place.
//
// The swap happens at the midpoint, while the overlay is fully opaque and
// hiding both slides — that's what makes it a dip rather than a cross-fade.
async function fadeThroughColor({ activeEl, waitingEl, overlayEl, durationMs }, color) {
  const half = durationMs / 2;

  overlayEl.style.background = color;
  overlayEl.style.opacity = '0';
  waitingEl.style.opacity = '1'; // ready underneath the overlay

  await play(overlayEl, [{ opacity: 0 }, { opacity: 1 }], { durationMs: half, easing: 'ease-in' });

  // Fully hidden now, so this cut is invisible.
  activeEl.style.opacity = '0';

  await play(overlayEl, [{ opacity: 1 }, { opacity: 0 }], { durationMs: half, easing: 'ease-out' });
}

export function fadeToBlack(ctx) { return fadeThroughColor(ctx, '#000'); }
export function fadeToWhite(ctx) { return fadeThroughColor(ctx, '#fff'); }
export function dipToColor(ctx) { return fadeThroughColor(ctx, ctx.options?.dipColor || '#8a5a3b'); }
