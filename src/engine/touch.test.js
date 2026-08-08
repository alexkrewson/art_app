import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attachTouch } from './touch.js';

// The engine is mostly canvas/animation and stays manual-test territory per
// the shared testing guidelines. This file is the exception: the gear-tap bug
// found on Alex's phone on 2026-08-08 was pure event dispatch — no rendering,
// no timing — and it survived every desktop and Playwright pass because a
// mouse click fires no touch events at all. That's exactly the shape of thing
// a regression test should hold down.

// jsdom has no TouchEvent constructor, and the handlers only ever read
// `touches`, `changedTouches`, `target` and `preventDefault` — so a plain
// Event carrying those properties exercises the real code path.
function touchEvent(type, touches = [], changed = touches) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'touches', { value: touches });
  Object.defineProperty(e, 'changedTouches', { value: changed });
  return e;
}

function pt(x, y) {
  return { clientX: x, clientY: y };
}

function setup() {
  document.body.innerHTML = `
    <div id="stage">
      <img id="slide-a">
      <button id="settings-gear" class="icon-btn" aria-label="Settings"></button>
    </div>`;
  const stageEl = document.getElementById('stage');
  const gearEl = document.getElementById('settings-gear');

  const slideshow = {
    paused: true,
    xf: { scale: 1, tx: 0, ty: 0 },
    minScale: 1, maxScale: 4,
    active: document.getElementById('slide-a'),
    clampXf: vi.fn(),
    applyXf: vi.fn(),
    togglePause: vi.fn(),
    goNext: vi.fn(),
    goPrev: vi.fn(),
  };
  const settingsPanel = { isOpen: vi.fn(() => false), close: vi.fn() };

  attachTouch(stageEl, slideshow, settingsPanel);
  return { stageEl, gearEl, slideshow, settingsPanel };
}

// Dispatches a complete tap (down then up at the same point) on `el`,
// returning the touchend event so the caller can inspect defaultPrevented.
function tap(el, x = 10, y = 10) {
  el.dispatchEvent(touchEvent('touchstart', [pt(x, y)]));
  const end = touchEvent('touchend', [], [pt(x, y)]);
  el.dispatchEvent(end);
  return end;
}

describe('attachTouch', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('lets a tap on the settings gear through untouched', () => {
    const { gearEl, slideshow } = setup();
    const end = tap(gearEl);
    // The whole bug in one assertion pair: preventDefault() on touchend
    // suppresses the synthetic click that the gear's own listener needs, and
    // the stage's tap handling would steal the tap as a pause toggle.
    expect(end.defaultPrevented).toBe(false);
    expect(slideshow.togglePause).not.toHaveBeenCalled();
  });

  it('does not close an open panel when the gear itself is tapped', () => {
    const { gearEl, settingsPanel } = setup();
    settingsPanel.isOpen.mockReturnValue(true);
    tap(gearEl);
    // Otherwise the gear could never toggle the panel shut — the stage would
    // close it first and the gear's own toggle would reopen it.
    expect(settingsPanel.close).not.toHaveBeenCalled();
  });

  it('still treats a tap on the stage itself as pause/resume', () => {
    const { stageEl, slideshow } = setup();
    const end = tap(stageEl, 100, 100);
    expect(end.defaultPrevented).toBe(true);
    expect(slideshow.togglePause).toHaveBeenCalledTimes(1);
  });

  it('still closes an open panel when the stage is tapped', () => {
    const { stageEl, slideshow, settingsPanel } = setup();
    settingsPanel.isOpen.mockReturnValue(true);
    tap(stageEl, 100, 100);
    expect(settingsPanel.close).toHaveBeenCalledTimes(1);
    expect(slideshow.togglePause).not.toHaveBeenCalled();
  });

  it('still swipes to the next and previous image', () => {
    const { stageEl, slideshow } = setup();

    stageEl.dispatchEvent(touchEvent('touchstart', [pt(300, 100)]));
    stageEl.dispatchEvent(touchEvent('touchend', [], [pt(100, 105)]));
    expect(slideshow.goNext).toHaveBeenCalledTimes(1);

    stageEl.dispatchEvent(touchEvent('touchstart', [pt(100, 100)]));
    stageEl.dispatchEvent(touchEvent('touchend', [], [pt(300, 105)]));
    expect(slideshow.goPrev).toHaveBeenCalledTimes(1);
  });

  it('ignores a drag on the gear rather than panning the image', () => {
    const { gearEl, slideshow } = setup();
    gearEl.dispatchEvent(touchEvent('touchstart', [pt(10, 10)]));
    gearEl.dispatchEvent(touchEvent('touchmove', [pt(90, 90)]));
    expect(slideshow.applyXf).not.toHaveBeenCalled();
  });

  it('still pans the image when the drag starts on the stage', () => {
    const { stageEl, slideshow } = setup();
    stageEl.dispatchEvent(touchEvent('touchstart', [pt(10, 10)]));
    stageEl.dispatchEvent(touchEvent('touchmove', [pt(90, 90)]));
    expect(slideshow.applyXf).toHaveBeenCalled();
  });
});
