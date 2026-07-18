// Slow pan/zoom loop, ported from kiosk.html. Runs as a RAF loop that
// continuously animates toward randomly-picked targets, restarting a new
// segment each time the current one completes so the drift never stops.

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

const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);

export class KenBurns {
  /**
   * @param {object} opts
   * @param {() => {w:number, h:number}} opts.stageSize
   * @param {() => {scale:number, tx:number, ty:number}} opts.getXf
   * @param {(xf: {scale:number, tx:number, ty:number}) => void} opts.setXf
   * @param {() => void} opts.applyXf - push current xf to the DOM
   * @param {() => boolean} opts.isPaused
   * @param {number} [opts.cycleMs]
   */
  constructor({ stageSize, getXf, setXf, applyXf, isPaused, cycleMs = 13000 }) {
    this.stageSize = stageSize;
    this.getXf = getXf;
    this.setXf = setXf;
    this.applyXf = applyXf;
    this.isPaused = isPaused;
    this.cycleMs = cycleMs;

    this.kbFrom = null;
    this.kbTo = null;
    this.kbStartTs = null;
    this.rafId = null;
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

  start() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.kbFrom = { ...this.getXf() };
    this.kbTo = this.pickTarget(this.getXf());
    this.kbStartTs = null;
    this.rafId = requestAnimationFrame(this._tick);
  }

  stop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  _tick = ts => {
    if (this.isPaused()) {
      this.rafId = null;
      return;
    }
    if (this.kbStartTs === null) this.kbStartTs = ts;
    const t = (ts - this.kbStartTs) / this.cycleMs;

    if (t >= 1) {
      // Seamlessly start next segment from current endpoint
      this.setXf({ ...this.kbTo });
      this.kbFrom = { ...this.getXf() };
      this.kbTo = this.pickTarget(this.getXf());
      this.kbStartTs = ts;
      this.applyXf();
      this.rafId = requestAnimationFrame(this._tick);
      return;
    }

    const e = ease(t);
    this.setXf({
      scale: lerp(this.kbFrom.scale, this.kbTo.scale, e),
      tx: lerp(this.kbFrom.tx, this.kbTo.tx, e),
      ty: lerp(this.kbFrom.ty, this.kbTo.ty, e),
    });
    this.applyXf();
    this.rafId = requestAnimationFrame(this._tick);
  };
}
