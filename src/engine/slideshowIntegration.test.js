import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Slideshow } from './slideshow.js';

// Tests for the sequential-loop engine (rewritten 2026-08-09). The old suite
// tested prefetchNext / the setInterval tick / pendingFinish — all machinery
// that existed only to reconcile two clocks, and all deleted with the rewrite.
//
// What's worth pinning now is behaviour, not internals: captions stay with
// their pictures, nothing is skipped, a dead URL doesn't wedge playback, and
// pause actually stops.

// jsdom has no Web Animations API. The engine only needs animate() to return
// something with `finished`, `cancel` and `commitStyles`.
function stubAnimate(el) {
  el.animate = (keyframes, opts) => {
    const last = keyframes[keyframes.length - 1];
    let done;
    const finished = new Promise(r => { done = r; });
    // Resolve on a macrotask so tests can observe the in-flight state.
    const timer = setTimeout(() => { Object.assign(el.style, last); done(); }, opts?.duration ?? 0);
    return {
      finished,
      cancel() { clearTimeout(timer); done(); },
      commitStyles() { Object.assign(el.style, last); },
    };
  };
}

function fakeImg(id) {
  const el = document.createElement('img');
  el.dataset.id = id;
  let src = '';
  let complete = false;
  Object.defineProperty(el, 'src', {
    get: () => src,
    set: v => {
      src = v;
      complete = false;
      // Loads on a microtask-ish delay, like a real (cached) image.
      queueMicrotask(() => {
        if (src !== v) return;
        if (String(v).includes('broken')) { el.onerror?.(); return; }
        complete = true;
        el.onload?.();
      });
    },
    configurable: true,
  });
  Object.defineProperty(el, 'complete', { get: () => complete, configurable: true });
  Object.defineProperty(el, 'naturalWidth', { get: () => (complete ? 100 : 0), configurable: true });
  el.decode = () => (complete ? Promise.resolve() : Promise.reject(new Error('not decodable')));
  stubAnimate(el);
  return el;
}

function setup({ slideMs = 100, fadeMs = 20, displayMode = 'static' } = {}) {
  document.body.innerHTML = '<div id="stage"><div id="ov"></div><div id="pi"></div></div>';
  const stageEl = document.getElementById('stage');
  const slideA = fakeImg('A');
  const slideB = fakeImg('B');
  stageEl.append(slideA, slideB);

  const captions = [];
  const show = new Slideshow({
    stageEl, slideA, slideB,
    overlayEl: document.getElementById('ov'),
    pauseIcon: document.getElementById('pi'),
    onMeta: rec => captions.push(rec.image),
    slideMs, fadeMs, displayMode,
    transitionId: 'crossfade',
  });
  return { show, slideA, slideB, captions };
}

const visible = (a, b) => (a.style.opacity === '1' ? a : b.style.opacity === '1' ? b : null);
const tick = (ms = 50) => new Promise(r => setTimeout(r, ms));

describe('Slideshow (sequential loop)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('shows the first image and captions it', async () => {
    const { show, slideA, slideB, captions } = setup();
    show.init([{ image: '1.jpg' }, { image: '2.jpg' }]);
    await tick(30);

    expect(visible(slideA, slideB)?.src).toBe('1.jpg');
    expect(captions).toEqual(['1.jpg']);
    show.togglePause();
  });

  it('keeps caption and picture in step over many advances', async () => {
    const { show, slideA, slideB, captions } = setup({ slideMs: 40, fadeMs: 10 });
    show.init([{ image: '1.jpg' }, { image: '2.jpg' }, { image: '3.jpg' }, { image: '4.jpg' }]);
    // Generous: this asserts a property, not a rate. A tight window turns it
    // into a load test of whatever else the machine happens to be doing.
    await tick(800);
    show.togglePause();

    // The invariant that two previous fixes failed to hold: whatever is on
    // screen is what the ribbon was last told to describe.
    expect(visible(slideA, slideB)?.src).toBe(captions[captions.length - 1]);
    expect(captions.length).toBeGreaterThan(2); // it really did advance
  });

  it('advances one image at a time, never skipping', async () => {
    const { show, captions } = setup({ slideMs: 40, fadeMs: 10 });
    show.init([{ image: '1.jpg' }, { image: '2.jpg' }, { image: '3.jpg' }]);
    await tick(400);
    show.togglePause();

    // Consecutive captions must walk the playlist in order and wrap — the old
    // engine could jump two or three at once when ticks landed mid-transition.
    const order = ['1.jpg', '2.jpg', '3.jpg'];
    for (let i = 1; i < captions.length; i++) {
      const prev = order.indexOf(captions[i - 1]);
      expect(captions[i]).toBe(order[(prev + 1) % order.length]);
    }
  });

  it('never writes a new src into the element that is on screen', async () => {
    const { show, slideA, slideB } = setup({ slideMs: 40, fadeMs: 10 });
    show.init([{ image: '1.jpg' }, { image: '2.jpg' }, { image: '3.jpg' }]);
    await tick(30);

    for (let i = 0; i < 6; i++) {
      const onScreen = visible(slideA, slideB);
      const src = onScreen?.src;
      await tick(25);
      // Between advances the visible element's src must never change under it:
      // that's the fault that made the picture move while the caption stayed.
      if (visible(slideA, slideB) === onScreen) expect(onScreen.src).toBe(src);
    }
    show.togglePause();
  });

  it('skips a broken image instead of stalling', async () => {
    const { show, captions } = setup({ slideMs: 30, fadeMs: 5 });
    show.init([{ image: '1.jpg' }, { image: 'broken.jpg' }, { image: '3.jpg' }]);
    await tick(300);
    show.togglePause();

    expect(captions).toContain('3.jpg');
    expect(captions).not.toContain('broken.jpg');
  });

  it('stops advancing when paused and resumes afterwards', async () => {
    const { show, captions } = setup({ slideMs: 30, fadeMs: 5 });
    show.init([{ image: '1.jpg' }, { image: '2.jpg' }, { image: '3.jpg' }]);
    await tick(80);
    show.togglePause();
    const atPause = captions.length;

    await tick(150);
    expect(captions.length).toBe(atPause);

    show.togglePause();
    await tick(150);
    expect(captions.length).toBeGreaterThan(atPause);
    show.togglePause();
  });

  it('holds position when the playlist grows under it', async () => {
    // The download model rebuilds the playlist every few images as they land.
    // Restarting from the top each time meant the first image sat on screen
    // indefinitely while everything else was downloading — seen on the device
    // as one photo for two minutes at a 10-second slide duration.
    const { show, slideA, slideB, captions } = setup({ slideMs: 60, fadeMs: 10 });
    show.init([{ image: '1.jpg' }, { image: '2.jpg' }, { image: '3.jpg' }]);
    await tick(200);

    const onScreen = visible(slideA, slideB)?.src;
    const before = captions.length;

    // Same three, plus more — as a download landing would produce.
    show.setPlaylist([
      { image: '1.jpg' }, { image: '2.jpg' }, { image: '3.jpg' },
      { image: '4.jpg' }, { image: '5.jpg' },
    ]);
    await tick(30);

    // The picture must not jump back to the start, and must not be re-shown.
    expect(visible(slideA, slideB)?.src).toBe(onScreen);
    expect(captions.length).toBe(before);
    show.togglePause();
  });

  it('starts over when the image on screen is no longer in the playlist', async () => {
    const { show, slideA, slideB } = setup({ slideMs: 60, fadeMs: 10 });
    show.init([{ image: 'gone.jpg' }, { image: 'also-gone.jpg' }]);
    await tick(120);

    show.setPlaylist([{ image: 'new1.jpg' }, { image: 'new2.jpg' }]);
    await tick(120);
    // Unticking a category removes what was playing; it has to move on.
    expect(visible(slideA, slideB)?.src).toMatch(/^new/);
    show.togglePause();
  });

  it('abandons the old loop when the playlist is replaced', async () => {
    const { show, captions } = setup({ slideMs: 30, fadeMs: 5 });
    show.init([{ image: 'old1.jpg' }, { image: 'old2.jpg' }]);
    await tick(60);

    show.setPlaylist([{ image: 'new1.jpg' }, { image: 'new2.jpg' }]);
    await tick(150);
    show.togglePause();

    // Nothing from the old playlist may appear after the swap — two loops
    // running at once would interleave them.
    const afterSwap = captions.slice(captions.indexOf('new1.jpg'));
    expect(afterSwap.every(c => c.startsWith('new'))).toBe(true);
  });
});
