// Slow pan/zoom, driven by the Web Animations API rather than a per-frame JS
// loop.
//
// The original (ported from kiosk.html) ran a requestAnimationFrame loop that
// wrote `style.transform` on every frame. That works on a dedicated tablet
// showing local files, where nothing competes for the main thread — which is
// exactly where it was written. It does NOT work on a phone that is also
// decoding JPEGs, running a service worker and talking to eight APIs: every
// main-thread stall becomes a dropped frame, and Alex's report on 2026-08-08
// was precisely that — "the Ken Burns effect pauses and then it skips".
//
// A transform/opacity animation created with element.animate() is handed to the
// compositor and keeps running at full framerate even while the main thread is
// blocked. Same visual result, no dependence on JS keeping up.
//
// The trade-off is that the transform is no longer readable from `xf` mid-flight
// (it lives on the compositor), so anything that needs the current value — the
// pinch/pan gestures in touch.js — must stop the animation first. That's already
// how it works: gestures are only live while paused, and pausing stops Ken Burns.

const KB_TARGETS = [
  { scale: 1.12, tx: -0.030, ty: -0.025 },
  { scale: 1.00, tx: 0.000, ty: 0.000 },
  { scale: 1.12, tx: 0.030, ty: 0.025 },
  { scale: 1.08, tx: -0.022, ty: 0.030 },
  { scale: 1.08, tx: 0.022, ty: -0.030 },
  { scale: 1.15, tx: 0.000, ty: 0.000 },
  { scale: 1.00, tx: 0.030, ty: 0.022 },
  { scale: 1.00, tx: -0.030, ty: -0.022 },
];

function toTransform({ scale, tx, ty }) {
  return `translate3d(${tx}px, ${ty}px, 0) scale3d(${scale}, ${scale}, 1)`;
}

export class KenBurns {
  /**
   * @param {object} opts
   * @param {() => {w:number, h:number}} opts.stageSize
   * @param {() => {scale:number, tx:number, ty:number}} opts.getXf
   * @param {(xf: {scale:number, tx:number, ty:number}) => void} opts.setXf
   * @param {() => HTMLElement} opts.getEl - the element currently on screen
   * @param {number} [opts.cycleMs] - ms per pan segment
   */
  constructor({ stageSize, getXf, setXf, getEl, cycleMs = 8500 }) {
    this.stageSize = stageSize;
    this.getXf = getXf;
    this.setXf = setXf;
    this.getEl = getEl;
    this.cycleMs = cycleMs;
    this.animation = null;
  }

  toPixels(t) {
    const { w, h } = this.stageSize();
    return { scale: t.scale, tx: t.tx * w, ty: t.ty * h };
  }

  pickTarget(cur) {
    const { w, h } = this.stageSize();
    const pool = KB_TARGETS.filter(t => {
      const p = this.toPixels(t);
      return (
        Math.abs(p.scale - cur.scale) > 0.03 ||
        Math.abs(p.tx - cur.tx) > w * 0.015 ||
        Math.abs(p.ty - cur.ty) > h * 0.015
      );
    });
    const src = pool.length >= 2 ? pool : KB_TARGETS;
    return this.toPixels(src[Math.floor(Math.random() * src.length)]);
  }

  // Runs one segment, then chains the next from wherever it ended. Chaining on
  // `finished` rather than looping a single animation keeps each leg's target
  // random while never leaving a gap between segments.
  start() {
    this.stop();
    const el = this.getEl();
    if (!el || typeof el.animate !== 'function') return;

    const from = { ...this.getXf() };
    const to = this.pickTarget(from);
    this.from = from;
    this.to = to;

    const anim = el.animate(
      [{ transform: toTransform(from) }, { transform: toTransform(to) }],
      {
        duration: this.cycleMs,
        // Linear, not an ease: an ease curve hits zero velocity at both ends of
        // every segment, which reads as a periodic "decelerate to a stop, then
        // re-accelerate" pulse rather than continuous ambient drift.
        easing: 'linear',
        fill: 'forwards',
      },
    );
    this.animation = anim;

    anim.finished
      .then(() => {
        // A superseded animation resolves too; only the current one continues.
        if (this.animation !== anim) return;
        this.setXf(to);
        this.start();
      })
      .catch(() => { /* cancelled by stop() — expected, not an error */ });
  }

  // Freezes the pan where it is and writes that position back into `xf`, so a
  // pinch/pan gesture picks up exactly where the drift left off instead of
  // jumping. commitStyles() bakes the composited value into inline style before
  // the animation is discarded.
  stop() {
    if (!this.animation) return;
    const anim = this.animation;
    this.animation = null;

    // Write the position the pan actually reached back into `xf`. Without
    // this, `xf` still holds the value from the START of the segment, so a
    // pinch or pan right after pausing would jump the image back to where the
    // drift began. The animation's own clock is the source of truth here —
    // the composited transform isn't readable from JS.
    if (this.from && this.to) {
      const t = Math.max(0, Math.min(1, (Number(anim.currentTime) || 0) / this.cycleMs));
      const lerp = (a, b) => a + (b - a) * t;
      this.setXf({
        scale: lerp(this.from.scale, this.to.scale),
        tx: lerp(this.from.tx, this.to.tx),
        ty: lerp(this.from.ty, this.to.ty),
      });
    }

    try {
      anim.commitStyles();
    } catch {
      /* element detached, or styles not commitable — nothing to preserve */
    }
    anim.cancel();
  }
}
