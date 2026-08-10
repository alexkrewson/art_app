// Shared Web Animations helper for every transition.
//
// All of these were originally written as: set `transition: none`, set a start
// value, then in a requestAnimationFrame set the transition property and the
// target value. That only animates if the browser has COMMITTED the start value
// first, and whether it has depends on whether a frame boundary happened to
// fall in between — which in turn depended on how long the image took to load.
// Once prefetching made images arrive from cache, that gap closed and the
// transitions began snapping instead of running.
//
// It was fixed for crossfade on 2026-08-09 and, embarrassingly, only for
// crossfade: Alex tried Slide the same evening and got "a freeze and then an
// immediate switch". This module exists so the fix is shared rather than
// re-implemented seven times.
//
// element.animate() takes explicit from/to keyframes, so it never depends on
// what the committed style was. `finished` resolves when the animation actually
// ends rather than when a parallel setTimeout guesses it has, and the whole
// thing runs on the compositor instead of the main thread.

/**
 * Plays one keyframe list on one element and resolves when it's done, leaving
 * the element at the final keyframe's values.
 */
export function play(el, keyframes, { durationMs, easing = 'ease-in-out' }) {
  const end = keyframes[keyframes.length - 1];
  const land = () => Object.assign(el.style, end);

  // Very old WebViews: jump to the end rather than hanging the caller on a
  // promise that never settles.
  if (typeof el.animate !== 'function') {
    land();
    return Promise.resolve();
  }

  const anim = el.animate(keyframes, { duration: durationMs, easing, fill: 'forwards' });
  return anim.finished
    .then(() => {
      // Bake the end state into inline style before discarding the animation.
      // A lingering fill:forwards animation outranks any inline style the
      // engine sets afterwards, which would leave the next slide invisible.
      try { anim.commitStyles(); } catch { land(); }
      anim.cancel();
    })
    // Cancelled mid-flight (a forced advance): land on the end state anyway so
    // the swap the engine is about to perform is visually consistent.
    .catch(land);
}

/** Runs several element/keyframe pairs together and resolves when all finish. */
export function playAll(parts, opts) {
  return Promise.all(parts.map(([el, keyframes, own]) => play(el, keyframes, { ...opts, ...own })));
}
