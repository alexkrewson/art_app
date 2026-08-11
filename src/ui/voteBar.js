// What the thumbs up/down bar should look like for a given image.
//
// Extracted from main.js because this decision has now been wrong twice, both
// times reported by Alex as "the thumbs up is hanging on after the image
// changed", and both times for a different reason:
//
//   1. The latch was applied after an `await`, so it read a `lastMeta` that
//      might already have moved on.
//   2. `aria-pressed` was only written when the bar was votable, so a stale
//      `true` could sit on a hidden button and reappear with the next image.
//
// A pure function of (settings, record) is testable in a way that a closure
// over live DOM in main.js is not.

/**
 * @param {{showVoting?: boolean}} settings
 * @param {{url?: string, vote?: number}|null|undefined} rec - the record on screen
 * @returns {{hidden: boolean, pressed: boolean}}
 */
export function voteBarState(settings, rec) {
  // Bundled and local-folder images aren't in the library, so there is nothing
  // to vote on — hide the bar rather than offer a button that cannot act.
  const votable = !!settings?.showVoting && !!rec?.url;
  return {
    hidden: !votable,
    // Always derived from the CURRENT record, never left over from the last
    // one. An image nobody has voted on must never show up already latched.
    pressed: rec?.vote === 1,
  };
}
