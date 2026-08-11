import { describe, it, expect } from 'vitest';
import { voteBarState } from './voteBar.js';

const lib = (over = {}) => ({ url: 'https://x/a.jpg', vote: 0, ...over });

describe('voteBarState', () => {
  it('shows the bar for a library image when voting is on', () => {
    expect(voteBarState({ showVoting: true }, lib())).toEqual({ hidden: false, pressed: false });
  });

  it('latches for an image that has been kept', () => {
    expect(voteBarState({ showVoting: true }, lib({ vote: 1 })).pressed).toBe(true);
  });

  it('does not latch for a downvoted image', () => {
    expect(voteBarState({ showVoting: true }, lib({ vote: -1 })).pressed).toBe(false);
  });

  it('clears the latch as soon as the next image arrives', () => {
    // The reported bug, twice over: thumbs up stayed lit after the slide
    // changed. Whatever the previous image was, the new one decides.
    const previous = voteBarState({ showVoting: true }, lib({ vote: 1 }));
    const next = voteBarState({ showVoting: true }, lib({ url: 'https://x/b.jpg', vote: 0 }));
    expect(previous.pressed).toBe(true);
    expect(next.pressed).toBe(false);
  });

  it('reports not-pressed for an image that cannot be voted on', () => {
    // A bundled image has no url. The bar hides — but `pressed` must still go
    // false, because guarding the attribute write on votability is exactly how
    // a stale `true` survived onto the next image.
    expect(voteBarState({ showVoting: true }, { image: 'bundled/1.jpg' }))
      .toEqual({ hidden: true, pressed: false });
  });

  it('hides the bar when voting is switched off, without claiming pressed', () => {
    expect(voteBarState({ showVoting: false }, lib({ vote: 1 })))
      .toEqual({ hidden: true, pressed: true });   // hidden, but still truthfully kept
  });

  it('survives a missing record between slides', () => {
    expect(voteBarState({ showVoting: true }, null)).toEqual({ hidden: true, pressed: false });
    expect(voteBarState({}, undefined)).toEqual({ hidden: true, pressed: false });
  });
});
