import { describe, it, expect, vi } from 'vitest';
import { KenBurns, smoothProgress, SMOOTH_MIN_SLIDE_MS } from './kenburns.js';

// A fake element that records what element.animate() was asked to do, so the
// keyframes and duration can be inspected without a compositor.
function fakeEl() {
  const calls = [];
  return {
    calls,
    animate(keyframes, opts) {
      calls.push({ keyframes, opts });
      return {
        currentTime: 0,
        finished: new Promise(() => {}),   // never resolves: no chaining in tests
        commitStyles() {},
        cancel() {},
      };
    },
  };
}

function make(over = {}) {
  const el = fakeEl();
  const kb = new KenBurns({
    stageSize: () => ({ w: 1000, h: 600 }),
    getXf: () => ({ scale: 1, tx: 0, ty: 0 }),
    setXf: vi.fn(),
    getEl: () => el,
    cycleMs: 8000,
    ...over,
  });
  return { kb, el };
}

describe('smoothProgress', () => {
  it('starts at 0 and ends at 1', () => {
    expect(smoothProgress(0)).toBe(0);
    expect(smoothProgress(1)).toBeCloseTo(1, 10);
  });

  it('is exactly half way at the midpoint', () => {
    expect(smoothProgress(0.5)).toBeCloseTo(0.5, 10);
  });

  it('is stationary at both ends', () => {
    // What Alex asked for: no motion at the start or the end of a segment.
    const d = 1e-4;
    const startSpeed = (smoothProgress(d) - smoothProgress(0)) / d;
    const endSpeed = (smoothProgress(1) - smoothProgress(1 - d)) / d;
    expect(startSpeed).toBeLessThan(0.01);
    expect(endSpeed).toBeLessThan(0.01);
  });

  it('peaks at twice the average speed, in the middle', () => {
    // This is the reason a smooth segment runs for twice the slider value:
    // peak = 2 x mean, so matching the peak doubles the time.
    const d = 1e-4;
    const mid = (smoothProgress(0.5 + d) - smoothProgress(0.5 - d)) / (2 * d);
    expect(mid).toBeCloseTo(2, 3);
  });

  it('never reverses — speed is non-negative throughout', () => {
    // A jagged or overshooting curve would pan backwards mid-segment.
    let prev = 0;
    for (let i = 1; i <= 200; i++) {
      const cur = smoothProgress(i / 200);
      expect(cur).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = cur;
    }
  });

  it('accelerates smoothly rather than in steps', () => {
    // Sample the second derivative: no sudden jumps in acceleration, which is
    // what "smooth inflection points" means in practice.
    const n = 400, d = 1 / n;
    let maxJerk = 0, prevAcc = null;
    for (let i = 1; i < n - 1; i++) {
      const acc = smoothProgress((i + 1) * d) - 2 * smoothProgress(i * d) + smoothProgress((i - 1) * d);
      if (prevAcc !== null) maxJerk = Math.max(maxJerk, Math.abs(acc - prevAcc));
      prevAcc = acc;
    }
    expect(maxJerk).toBeLessThan(1e-5);
  });

  it('clamps outside 0..1', () => {
    expect(smoothProgress(-1)).toBe(0);
    expect(smoothProgress(2)).toBeCloseTo(1, 10);
  });
});

describe('KenBurns smooth gating', () => {
  it('is off unless asked for', () => {
    const { kb } = make({ smooth: false, slideMs: 30000 });
    expect(kb.smoothing).toBe(false);
    expect(kb.segmentMs).toBe(8000);
  });

  it('ignores the request on a slide shorter than the threshold', () => {
    // Alex's rule: only apply at 5 seconds or more.
    const { kb } = make({ smooth: true, slideMs: SMOOTH_MIN_SLIDE_MS - 1 });
    expect(kb.smoothing).toBe(false);
    expect(kb.segmentMs).toBe(8000);
  });

  it('applies at exactly the threshold', () => {
    const { kb } = make({ smooth: true, slideMs: SMOOTH_MIN_SLIDE_MS });
    expect(kb.smoothing).toBe(true);
  });

  it('doubles the segment so the slider sets peak speed, not average', () => {
    const { kb } = make({ smooth: true, slideMs: 30000 });
    expect(kb.segmentMs).toBe(16000);
  });

  it('follows the slide duration when it changes later', () => {
    // slideMs is assigned from the settings panel long after construction.
    const { kb } = make({ smooth: true, slideMs: 30000 });
    expect(kb.smoothing).toBe(true);
    kb.slideMs = 3000;
    expect(kb.smoothing).toBe(false);
  });
});

describe('KenBurns animation', () => {
  it('uses two keyframes at a constant rate', () => {
    const { kb, el } = make({ smooth: false, slideMs: 30000 });
    kb.start();
    const { keyframes, opts } = el.calls[0];
    expect(keyframes).toHaveLength(2);
    expect(opts.duration).toBe(8000);
  });

  it('samples the curve into keyframes when smoothing', () => {
    const { kb, el } = make({ smooth: true, slideMs: 30000 });
    kb.start();
    const { keyframes, opts } = el.calls[0];
    expect(opts.duration).toBe(16000);
    expect(keyframes.length).toBeGreaterThan(8);
    // Offsets must span 0..1 and ascend, or the animation is invalid.
    expect(keyframes[0].offset).toBe(0);
    expect(keyframes[keyframes.length - 1].offset).toBe(1);
    for (let i = 1; i < keyframes.length; i++) {
      expect(keyframes[i].offset).toBeGreaterThan(keyframes[i - 1].offset);
    }
  });

  it('bunches movement toward the middle of a smooth segment', () => {
    // The first tenth of the time should cover far less than a tenth of the
    // distance; a linear ramp would cover exactly a tenth.
    expect(smoothProgress(0.1)).toBeLessThan(0.05);
    expect(smoothProgress(0.9)).toBeGreaterThan(0.95);
  });
});

describe('KenBurns stop()', () => {
  it('writes back the eased position, not the raw time fraction', () => {
    // Getting this wrong makes the image jump the instant you pause: at 10% of
    // a smooth segment the pan has moved ~1.3% of the way, not 10%.
    const setXf = vi.fn();
    const { kb, el } = make({ smooth: true, slideMs: 30000, setXf });
    kb.from = { scale: 1, tx: 0, ty: 0 };
    kb.to = { scale: 2, tx: 100, ty: 100 };
    kb.start();
    kb.from = { scale: 1, tx: 0, ty: 0 };
    kb.to = { scale: 2, tx: 100, ty: 100 };
    kb.animation.currentTime = 1600;          // 10% of the 16000ms segment
    kb.stop();

    const written = setXf.mock.calls.at(-1)[0];
    expect(written.tx).toBeCloseTo(100 * smoothProgress(0.1), 4);
    expect(written.tx).toBeLessThan(10);      // a linear read would say 10
    expect(el.calls.length).toBe(1);
  });

  it('uses the plain fraction when not smoothing', () => {
    const setXf = vi.fn();
    const { kb } = make({ smooth: false, slideMs: 30000, setXf });
    kb.start();
    kb.from = { scale: 1, tx: 0, ty: 0 };
    kb.to = { scale: 2, tx: 100, ty: 100 };
    kb.animation.currentTime = 4000;          // half of 8000ms
    kb.stop();
    expect(setXf.mock.calls.at(-1)[0].tx).toBeCloseTo(50, 6);
  });
});
