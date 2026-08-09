// The original kiosk.html default: simple opacity blend.
//
// Rewritten 2026-08-09 to use the Web Animations API instead of setting a CSS
// `transition` property and racing a setTimeout against it. Two bugs came out
// of the old approach, and I failed to fix the first one twice:
//
//  1. A CSS transition only fires if the browser has COMMITTED the start value
//     first. loadAndShow resets the incoming slide to `transition:none;
//     opacity:0`, and once prefetching made images load from cache, that reset
//     and this animation started landing in the same style recalculation — so
//     there was nothing to animate from and every transition snapped. It was
//     intermittent because it depended on whether a frame boundary happened to
//     fall between them, which is exactly the "works about 20% of the time"
//     Alex reported.
//  2. Completion was a setTimeout guess running alongside the CSS animation.
//     If the main thread was busy the timer fired late, the swap happened late,
//     and the next advance was dropped.
//
// element.animate() takes explicit from/to keyframes, so it does not care what
// the element's committed style was — the class of bug above cannot occur. And
// `finished` resolves when the animation actually ends, not when a parallel
// timer guesses it has.
export function crossfade({ activeEl, waitingEl, durationMs }) {
  // No animate() (very old WebView): fall back to an instant swap rather than
  // leaving the caller waiting on a promise that never settles.
  if (typeof waitingEl.animate !== 'function') {
    activeEl.style.opacity = '0';
    waitingEl.style.opacity = '1';
    return Promise.resolve();
  }

  const opts = { duration: durationMs, easing: 'ease-in-out', fill: 'forwards' };
  const out = activeEl.animate([{ opacity: 1 }, { opacity: 0 }], opts);
  const inn = waitingEl.animate([{ opacity: 0 }, { opacity: 1 }], opts);

  return Promise.all([out.finished, inn.finished])
    .then(() => {
      // Bake the end state into inline style, then drop the animations —
      // otherwise a lingering fill:forwards animation outranks any later
      // inline opacity the engine sets, and the next slide never appears.
      for (const [anim, el, end] of [[out, activeEl, '0'], [inn, waitingEl, '1']]) {
        try { anim.commitStyles(); } catch { el.style.opacity = end; }
        anim.cancel();
      }
    })
    .catch(() => {
      // Cancelled mid-flight (a forced advance). Land on the end state anyway
      // so the swap the caller is about to do is visually consistent.
      activeEl.style.opacity = '0';
      waitingEl.style.opacity = '1';
    });
}
