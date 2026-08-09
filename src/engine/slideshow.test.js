import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Slideshow } from './slideshow.js';

// Only prefetchNext is unit-tested here. The rest of Slideshow is transitions,
// Ken Burns and DOM swapping — canvas/animation work that stays manual per the
// shared testing guidelines. This method is pure list arithmetic plus one
// Image assignment, and it exists to fix a real stall, so it earns a test.
//
// Called via .call() on a plain object rather than a constructed Slideshow:
// the constructor wants a full stage DOM and starts a RAF loop, none of which
// this logic touches.
const prefetchNext = Slideshow.prototype.prefetchNext;

function ctx(images, index = 0) {
  return { images, index };
}

describe('Slideshow.prefetchNext', () => {
  let created;

  beforeEach(() => {
    created = [];
    // Capture constructed Images without a real network fetch.
    vi.stubGlobal('Image', class {
      constructor() { created.push(this); }
      set src(v) { this._src = v; }
      get src() { return this._src; }
    });
  });

  it('prefetches the next image in the playlist', () => {
    const self = ctx([{ image: 'a.jpg' }, { image: 'b.jpg' }], 0);
    prefetchNext.call(self);
    expect(created).toHaveLength(1);
    expect(created[0].src).toBe('b.jpg');
  });

  it('wraps around to the start at the end of the playlist', () => {
    const self = ctx([{ image: 'a.jpg' }, { image: 'b.jpg' }], 1);
    prefetchNext.call(self);
    expect(created[0].src).toBe('a.jpg');
  });

  it('sets no-referrer, without which AIC would 403 every prefetch', () => {
    const self = ctx([{ image: 'a.jpg' }, { image: 'b.jpg' }], 0);
    prefetchNext.call(self);
    expect(created[0].referrerPolicy).toBe('no-referrer');
  });

  it('does not refetch the same URL twice', () => {
    const self = ctx([{ image: 'a.jpg' }, { image: 'b.jpg' }], 0);
    prefetchNext.call(self);
    prefetchNext.call(self);
    expect(created).toHaveLength(1);
  });

  it('does nothing with a single-image or empty playlist', () => {
    prefetchNext.call(ctx([{ image: 'only.jpg' }], 0));
    prefetchNext.call(ctx([], 0));
    expect(created).toHaveLength(0);
  });

  it('skips a record with no image URL rather than prefetching undefined', () => {
    prefetchNext.call(ctx([{ image: 'a.jpg' }, { image: '' }], 0));
    expect(created).toHaveLength(0);
  });
});

// The auto-advance tick. Same .call() approach — scheduleSlides only touches
// timers and a handful of fields.
const scheduleSlides = Slideshow.prototype.scheduleSlides;

function ticker(overrides = {}) {
  return {
    paused: false,
    slideMs: 1000,
    index: 0,
    images: [{ image: 'a.jpg' }, { image: 'b.jpg' }, { image: 'c.jpg' }],
    inFade: false,
    loading: false,
    loadAndShow: vi.fn(),
    ...overrides,
  };
}

describe('Slideshow.scheduleSlides', () => {
  beforeEach(() => vi.useFakeTimers());

  it('advances one image per tick', () => {
    const self = ticker();
    scheduleSlides.call(self);
    vi.advanceTimersByTime(1000);
    expect(self.index).toBe(1);
    expect(self.loadAndShow).toHaveBeenCalledWith(self.images[1], false);
  });

  it('skips the tick entirely while an image is still loading', () => {
    const self = ticker({ loading: true });
    scheduleSlides.call(self);
    vi.advanceTimersByTime(3000);
    // The index must NOT run ahead of what's on screen. When it did, records
    // were silently skipped and the caption rendered for one image could end
    // up over a different one several places along.
    expect(self.index).toBe(0);
    expect(self.loadAndShow).not.toHaveBeenCalled();
  });

  it('skips the tick while a transition is mid-flight', () => {
    const self = ticker({ inFade: true });
    scheduleSlides.call(self);
    vi.advanceTimersByTime(3000);
    expect(self.index).toBe(0);
    expect(self.loadAndShow).not.toHaveBeenCalled();
  });

  it('resumes advancing once the load finishes', () => {
    const self = ticker({ loading: true });
    scheduleSlides.call(self);
    vi.advanceTimersByTime(2000);
    expect(self.index).toBe(0);

    self.loading = false;
    vi.advanceTimersByTime(1000);
    expect(self.index).toBe(1);
    expect(self.loadAndShow).toHaveBeenCalledTimes(1);
  });

  it('settles a pending swap before starting a new load', () => {
    // While a transition is in flight, active/waiting haven't been swapped
    // back, so `waiting` is the element ON SCREEN. Writing a src into it moves
    // the picture on with no display() behind it — the image changes and the
    // caption doesn't, which is what Alex saw.
    const settled = vi.fn();
    const self = {
      slideMs: 12000, inFade: true, pendingFinish: settled,
      active: { style: {} },
      waiting: { style: {}, complete: false, decode: () => Promise.resolve() },
      kb: { stop() {}, start() {} },
      onMeta: vi.fn(),
      images: [], index: 0,
    };
    Slideshow.prototype.loadAndShow.call(self, { image: 'x.jpg' }, true);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(self.pendingFinish).toBeNull();
  });

  it('leaves a non-forced advance to be skipped rather than settling anything', () => {
    const settled = vi.fn();
    const self = { slideMs: 12000, inFade: true, pendingFinish: settled };
    Slideshow.prototype.loadAndShow.call(self, { image: 'x.jpg' }, false);
    // The tick guard already declines this one; nothing should be disturbed.
    expect(settled).not.toHaveBeenCalled();
  });

  it('schedules nothing at all while paused', () => {
    const self = ticker({ paused: true });
    scheduleSlides.call(self);
    vi.advanceTimersByTime(5000);
    expect(self.loadAndShow).not.toHaveBeenCalled();
  });
});
