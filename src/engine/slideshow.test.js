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
