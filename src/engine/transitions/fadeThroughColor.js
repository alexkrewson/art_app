// Shared implementation for "Fade to black", "Fade to white", and "Dip to
// color": the outgoing image fades into a solid color overlay, then the
// overlay fades away to reveal the incoming image already in place.
function fadeThroughColor({ activeEl, waitingEl, overlayEl, durationMs }, color) {
  return new Promise(resolve => {
    const half = durationMs / 2;

    overlayEl.style.background = color;
    overlayEl.style.transition = 'none';
    overlayEl.style.opacity = '0';
    waitingEl.style.transition = 'none';
    waitingEl.style.opacity = '1'; // ready underneath the overlay
    activeEl.style.transition = 'none';

    requestAnimationFrame(() => {
      overlayEl.style.transition = `opacity ${half}ms ease-in`;
      overlayEl.style.opacity = '1';
    });

    setTimeout(() => {
      activeEl.style.opacity = '0'; // swap happens fully hidden behind the overlay
      overlayEl.style.transition = `opacity ${half}ms ease-out`;
      requestAnimationFrame(() => { overlayEl.style.opacity = '0'; });
      setTimeout(resolve, half);
    }, half);
  });
}

export function fadeToBlack(ctx) { return fadeThroughColor(ctx, '#000'); }
export function fadeToWhite(ctx) { return fadeThroughColor(ctx, '#fff'); }
export function dipToColor(ctx) { return fadeThroughColor(ctx, ctx.options?.dipColor || '#8a5a3b'); }
