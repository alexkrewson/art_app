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

// Below this slide duration the smooth profile is ignored and the pan stays
// linear. Alex's call: an ease-in/ease-out over a short slide spends most of
// its time barely moving.
export const SMOOTH_MIN_SLIDE_MS = 5000;

// How far through the pan we are at time `t` (0..1) under a sine-squared
// VELOCITY profile: stationary at both ends, fastest in the middle, smooth
// through the inflections — what Alex described as a bell curve rather than a
// jagged ramp.
//
//   v(t) = 2·sin²(πt)   ->   p(t) = t − sin(2πt) / 2π
//
// v peaks at 2 and averages 1, which is the whole reason a smooth segment runs
// at twice the slider's duration: the slider sets the MAXIMUM speed, so the
// same pan extent necessarily takes twice as long to cover.
export function smoothProgress(t) {
  const x = Math.max(0, Math.min(1, t));
  return x - Math.sin(2 * Math.PI * x) / (2 * Math.PI);
}

// The curve is sampled into keyframes rather than expressed as an easing
// function. `linear(...)` easing would be exact but needs Chrome 113+, and
// these run on budget tablets and an e-reader; a cubic-bezier cannot represent
// this curve at all. Sampled keyframes with linear interpolation between them
// work anywhere element.animate() does, and at this many samples the
// difference is far below one pixel per frame.
const SMOOTH_SAMPLES = 32;

export class KenBurns {
  /**
   * @param {object} opts
   * @param {() => {w:number, h:number}} opts.stageSize
   * @param {() => {scale:number, tx:number, ty:number}} opts.getXf
   * @param {(xf: {scale:number, tx:number, ty:number}) => void} opts.setXf
   * @param {() => HTMLElement} opts.getEl - the element currently on screen
   * @param {number} [opts.cycleMs] - ms per pan segment at full speed
   * @param {boolean} [opts.smooth] - ease the pan in and out instead of a constant rate
   * @param {number} [opts.slideMs] - how long an image is shown; gates `smooth`
   */
  constructor({ stageSize, getXf, setXf, getEl, cycleMs = 8500, smooth = false, slideMs = 12000 }) {
    this.stageSize = stageSize;
    this.getXf = getXf;
    this.setXf = setXf;
    this.getEl = getEl;
    this.cycleMs = cycleMs;
    this.smooth = smooth;
    this.slideMs = slideMs;
    this.animation = null;
  }

  /** Smooth is requested AND the slide is long enough to be worth easing. */
  get smoothing() {
    return !!this.smooth && this.slideMs >= SMOOTH_MIN_SLIDE_MS;
  }

  /**
   * A smooth segment takes twice as long as the slider says, because the
   * slider sets peak speed and this profile averages half its peak. Same pan
   * extent, calmer motion.
   */
  get segmentMs() {
    return this.smoothing ? this.cycleMs * 2 : this.cycleMs;
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

    // Held for stop(), which has to know which curve was in flight even if the
    // setting changes mid-segment.
    const smoothing = this.smoothing;
    const duration = this.segmentMs;
    this.smoothingNow = smoothing;
    this.durationMs = duration;

    const lerpXf = f => ({
      scale: from.scale + (to.scale - from.scale) * f,
      tx: from.tx + (to.tx - from.tx) * f,
      ty: from.ty + (to.ty - from.ty) * f,
    });

    // Constant rate stays the default. Its own justification still holds when
    // smooth is off: an ease hits zero velocity at both ends of every segment,
    // which without the doubled duration reads as a periodic "stop and
    // restart" pulse rather than continuous ambient drift. Alex asked for the
    // eased profile as an option, so it is one.
    const keyframes = smoothing
      ? Array.from({ length: SMOOTH_SAMPLES + 1 }, (_, i) => {
        const at = i / SMOOTH_SAMPLES;
        return { offset: at, transform: toTransform(lerpXf(smoothProgress(at))) };
      })
      : [{ transform: toTransform(from) }, { transform: toTransform(to) }];

    const anim = el.animate(keyframes, {
      duration,
      easing: 'linear',   // the curve lives in the keyframe offsets, not here
      fill: 'forwards',
    });
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
      // Against the segment's OWN duration and curve. Using this.cycleMs and a
      // straight ratio would be wrong twice over under the smooth profile: the
      // segment runs at twice cycleMs, and elapsed time is not proportional to
      // distance covered. Getting this wrong makes the image jump the moment
      // you pause.
      const raw = Math.max(0, Math.min(1, (Number(anim.currentTime) || 0) / (this.durationMs || this.cycleMs)));
      const t = this.smoothingNow ? smoothProgress(raw) : raw;
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
