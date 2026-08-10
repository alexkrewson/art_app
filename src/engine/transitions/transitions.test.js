import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRANSITIONS } from './index.js';

// Written after Alex found Slide "freezes then jumps" on 2026-08-09. The cause
// was that only crossfade had been converted to the Web Animations API and the
// other six still used the CSS-transition-plus-setTimeout pattern with its
// commit race. The specific bug matters less than the shape of the mistake:
// seven implementations of the same thing, one of them fixed.
//
// So this runs the contract over EVERY registered transition rather than any
// one of them. A new transition is covered the moment it's added to the
// registry.

function el(id) {
  const node = document.createElement('div');
  node.dataset.id = id;
  // jsdom has no Web Animations API. Resolve on a macrotask and apply the last
  // keyframe, which is what a real animation leaves behind.
  node.animate = (keyframes, opts) => {
    const last = keyframes[keyframes.length - 1];
    let done;
    const finished = new Promise(r => { done = r; });
    const t = setTimeout(() => { Object.assign(node.style, last); done(); }, opts?.duration ?? 0);
    return {
      finished,
      cancel() { clearTimeout(t); done(); },
      commitStyles() { Object.assign(node.style, last); },
    };
  };
  return node;
}

function ctx() {
  const activeEl = el('active');
  const waitingEl = el('waiting');
  const overlayEl = el('overlay');
  const stageEl = el('stage');
  activeEl.style.opacity = '1';
  waitingEl.style.opacity = '0';
  return {
    activeEl, waitingEl, overlayEl, stageEl,
    durationMs: 20,
    options: { dipColor: '#123456', direction: 'left' },
  };
}

const ids = Object.keys(TRANSITIONS);

describe('every registered transition', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('has at least the built-in set registered', () => {
    expect(ids).toContain('crossfade');
    expect(ids.length).toBeGreaterThanOrEqual(10);
  });

  it.each(ids)('"%s" resolves rather than hanging the engine', async id => {
    const c = ctx();
    // The engine awaits this. A transition that never settles stops playback
    // dead, which is worse than one that looks wrong.
    const result = await Promise.race([
      TRANSITIONS[id].run(c).then(() => 'resolved'),
      new Promise(r => setTimeout(() => r('TIMED OUT'), 2000)),
    ]);
    expect(result).toBe('resolved');
  });

  it.each(ids)('"%s" leaves the incoming slide visible', async id => {
    const c = ctx();
    await TRANSITIONS[id].run(c);
    // Whatever the effect, it must end with the new image on screen — the
    // engine swaps active/waiting immediately afterwards and assumes this.
    expect(c.waitingEl.style.opacity, `${id} left the incoming slide hidden`).toBe('1');
  });

  it.each(ids)('"%s" does not leave a clip-path cropping the next image', async id => {
    const c = ctx();
    await TRANSITIONS[id].run(c);
    // inkWash and curtain animate clip-path; a leftover clip would crop
    // whatever image lands on that element next.
    expect(c.waitingEl.style.clipPath || '').toBe('');
  });

  it('lightLeak clears the shared overlay blend mode', async () => {
    const c = ctx();
    await TRANSITIONS.lightLeak.run(c);
    // The overlay is shared between transitions — a leftover screen blend
    // would tint every later one that uses it.
    expect(c.overlayEl.style.mixBlendMode || '').toBe('');
  });

  it('fades through the configured dip colour', async () => {
    const c = ctx();
    await TRANSITIONS.dipToColor.run(c);
    expect(c.overlayEl.style.background).toContain('rgb(18, 52, 86)');
    expect(c.overlayEl.style.opacity).toBe('0'); // faded back out, not left covering the image
  });
});
