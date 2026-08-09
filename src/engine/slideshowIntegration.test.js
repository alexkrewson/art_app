import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Slideshow } from './slideshow.js';

// A real end-to-end harness for the advance cycle, added 2026-08-08 after two
// attempts to fix "the caption lags the picture" by reading the code both
// failed. jsdom won't run CSS transitions, but the bug isn't in the animation
// — it's in WHICH element is on screen when, and that is fully observable
// here.
//
// The invariant under test, stated plainly: at every settled moment, the
// visible <img> must be showing the same record the ribbon last described.

function fakeImg(id) {
  const el = document.createElement('img');
  el.dataset.id = id;
  let src = '';
  let complete = false;
  Object.defineProperty(el, 'src', {
    get: () => src,
    // Assigning src resets the load, exactly as a browser does.
    set: v => { src = v; complete = false; },
    configurable: true,
  });
  Object.defineProperty(el, 'complete', { get: () => complete, configurable: true });
  Object.defineProperty(el, 'naturalWidth', { get: () => (complete ? 100 : 0), configurable: true });
  el.decode = () => Promise.resolve();
  el._finishLoad = () => { complete = true; el.onload?.(); };
  return el;
}

function setup({ slideMs = 1000, fadeMs = 400 } = {}) {
  document.body.innerHTML = '<div id="stage"><div id="overlay"></div><div id="pause"></div></div>';
  const stageEl = document.getElementById('stage');
  const slideA = fakeImg('A');
  const slideB = fakeImg('B');
  stageEl.append(slideA, slideB);

  const captions = [];
  const show = new Slideshow({
    stageEl, slideA, slideB,
    overlayEl: document.getElementById('overlay'),
    pauseIcon: document.getElementById('pause'),
    onMeta: rec => captions.push(rec.image),
    slideMs, fadeMs,
    displayMode: 'static',   // keep Ken Burns' RAF loop out of it
    transitionId: 'crossfade',
  });
  return { show, slideA, slideB, captions, stageEl };
}

// Which element is actually on screen, by opacity.
function visible(slideA, slideB) {
  if (slideA.style.opacity === '1') return slideA;
  if (slideB.style.opacity === '1') return slideB;
  return null;
}

// Settle everything: pending loads, decode microtasks, rAF, and the
// transition's own timer.
async function settle(slides, ms = 1000) {
  for (const el of slides) if (!el.complete && el.src) el._finishLoad();
  await Promise.resolve(); await Promise.resolve();
  vi.advanceTimersByTime(ms);
  await Promise.resolve(); await Promise.resolve();
  vi.advanceTimersByTime(ms);
  await Promise.resolve(); await Promise.resolve();
}

describe('Slideshow advance cycle', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  });
  afterEach(() => vi.useRealTimers());

  it('never assigns a new src to the element currently on screen', async () => {
    const { show, slideA, slideB } = setup();
    show.init([{ image: '1.jpg' }, { image: '2.jpg' }, { image: '3.jpg' }]);
    await settle([slideA, slideB]);

    const onScreen = visible(slideA, slideB);
    const srcBefore = onScreen?.src;

    // Advance. The moment `waiting.src` is written, the visible element must
    // NOT be the one being written to — otherwise the picture changes with no
    // caption behind it, and every caption from then on is one behind.
    show.loadAndShow(show.images[1], false);
    expect(onScreen?.src).toBe(srcBefore);
  });

  it('keeps the caption and the visible image in step across several advances', async () => {
    const { show, slideA, slideB, captions } = setup();
    const playlist = [{ image: '1.jpg' }, { image: '2.jpg' }, { image: '3.jpg' }, { image: '4.jpg' }];
    show.init(playlist);
    await settle([slideA, slideB]);

    for (let i = 1; i < playlist.length; i++) {
      show.index = i;
      show.loadAndShow(playlist[i], false);
      await settle([slideA, slideB]);

      const onScreen = visible(slideA, slideB);
      expect(onScreen, `no visible slide after advance ${i}`).not.toBeNull();
      expect(onScreen.src, `picture/caption disagree after advance ${i}`)
        .toBe(captions[captions.length - 1]);
    }
  });

  it('runs the transition rather than snapping when the image is already cached', async () => {
    const { show, slideA, slideB } = setup({ fadeMs: 400 });
    show.init([{ image: '1.jpg' }, { image: '2.jpg' }]);
    await settle([slideA, slideB]);

    show.index = 1;
    show.loadAndShow(show.images[1], false);
    // Let the load + decode resolve, but NOT the transition's duration.
    for (const el of [slideA, slideB]) if (!el.complete && el.src) el._finishLoad();
    await Promise.resolve(); await Promise.resolve();
    vi.advanceTimersByTime(0);
    await Promise.resolve(); await Promise.resolve();

    // A transition is in flight, so the swap must not have been finalised yet.
    expect(show.inFade).toBe(true);
    const incoming = slideA.src === '2.jpg' ? slideA : slideB;
    expect(incoming.style.transition).toContain('400ms');
  });
});
