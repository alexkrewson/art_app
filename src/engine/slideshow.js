// Core playback state machine, rewritten 2026-08-09.
//
// The previous design (ported from kiosk.html) ran a setInterval that fired
// every `slideMs` and called into an async load/decode/transition chain, then
// reconciled the two clocks with a growing pile of booleans — inFade, loading,
// pendingFinish. Every one of those was added to fix a real symptom, and every
// one gave the scheduler another way to drop a tick. Alex's report was the
// accumulation of that: "sometimes it's smooth, sometimes the Ken Burns pauses
// and then it skips, sometimes it skips over a couple of pictures", and it
// happened with the LOCAL image set, which rules out the network entirely.
//
// This version has one clock. A single async loop does: wait out the dwell,
// load and decode the next image, transition to it, repeat. Each step awaits
// the previous, so there is nothing to reconcile:
//
//   - a slide cannot be skipped, because nothing fires on a timer that might
//     arrive while the engine is busy;
//   - the caption cannot drift from the picture, because onMeta is called at
//     the same await point as the swap;
//   - a new src is never written into the element on screen, because the swap
//     has always completed before the next iteration starts.
//
// Animation is handed to the compositor (Web Animations API, see kenburns.js
// and transitions/crossfade.js) rather than driven frame-by-frame from JS, so
// a busy main thread no longer shows up as stutter.

import { KenBurns } from './kenburns.js';
import { resolveTransition, pickRandomTransitionId } from './transitions/index.js';

const MIN_SCALE = 1.0;
const MAX_SCALE = 6.0;

// Below this slide interval, an animated transition or Ken Burns pan doesn't
// have enough frames left to read as motion — at 60fps, 400ms is ~24 frames.
// Rather than run a broken-looking animation, slides at or below this interval
// hard-cut and skip Ken Burns.
const MIN_ANIMATED_SLIDE_MS = 400;

export class Slideshow {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.stageEl
   * @param {HTMLImageElement} opts.slideA
   * @param {HTMLImageElement} opts.slideB
   * @param {HTMLElement} opts.overlayEl - full-stage layer used by color/light transitions
   * @param {HTMLElement} opts.pauseIcon
   * @param {(item: object) => void} opts.onMeta - called with the record at the moment it appears
   * @param {(paused: boolean) => void} [opts.onPauseChange]
   * @param {'kenburns'|'static'|'fade'} [opts.displayMode]
   * @param {string} [opts.transitionId] - a transitions/index.js key, or 'random'
   * @param {object} [opts.transitionOptions] - e.g. { dipColor, direction }
   * @param {number} [opts.slideMs] - ms per slide
   * @param {number} [opts.fadeMs] - transition duration
   * @param {number} [opts.kbCycleMs] - ms per Ken Burns pan segment
   */
  constructor({
    stageEl, slideA, slideB, overlayEl, pauseIcon, onMeta, onPauseChange,
    displayMode = 'kenburns', transitionId = 'crossfade', transitionOptions = {},
    slideMs = 12000, fadeMs = 1500, kbCycleMs = 13000,
  }) {
    this.stageEl = stageEl;
    this.overlayEl = overlayEl;
    this.pauseIcon = pauseIcon;
    this.onMeta = onMeta;
    this.onPauseChange = onPauseChange || (() => {});
    this.displayMode = displayMode;
    this.transitionId = transitionId;
    this.transitionOptions = transitionOptions;
    this.slideMs = slideMs;
    this.fadeMs = fadeMs;

    this.images = [];
    this.index = 0;
    this.paused = false;
    this.active = slideA;
    this.waiting = slideB;
    this.slideTimer = null;

    // Retained because the diagnostic overlay reports them; they are now plain
    // status, not control flow. Nothing branches on them.
    this.inFade = false;
    this.loading = false;

    // Invalidates a running loop. Anything that restarts playback bumps it, and
    // the old loop notices at its next await and exits — which is what makes
    // "change a setting mid-transition" safe without any locking.
    this.runToken = 0;
    this.wake = null; // resolver for the current dwell, so goNext can cut it short

    this.xf = { scale: 1, tx: 0, ty: 0 };

    this.kb = new KenBurns({
      stageSize: () => this.stageSize(),
      getXf: () => this.xf,
      setXf: xf => { this.xf = xf; },
      getEl: () => this.active,
      cycleMs: kbCycleMs,
    });
  }

  // ── Transform API (shared with touch.js) ──────────────────────────────
  stageSize() {
    return { w: this.stageEl.clientWidth, h: this.stageEl.clientHeight };
  }

  applyXf(el) {
    el.style.transform =
      `translate3d(${this.xf.tx}px,${this.xf.ty}px,0) scale3d(${this.xf.scale},${this.xf.scale},1)`;
  }

  clampXf() {
    const { w, h } = this.stageSize();
    this.xf.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.xf.scale));
    const mx = (this.xf.scale - 1) * w * 0.5;
    const my = (this.xf.scale - 1) * h * 0.5;
    this.xf.tx = Math.max(-mx, Math.min(mx, this.xf.tx));
    this.xf.ty = Math.max(-my, Math.min(my, this.xf.ty));
  }

  get minScale() { return MIN_SCALE; }
  get maxScale() { return MAX_SCALE; }

  // ── Playback ────────────────────────────────────────────────────────
  init(images) {
    if (!images?.length) return;
    this.images = images;
    this.index = 0;
    this.restart();
  }

  /**
   * Replaces the playlist, holding position if the image on screen is still in
   * it.
   *
   * This used to call init(), which restarts from index 0. Harmless when the
   * playlist changed once, on a settings edit — but the download model rebuilds
   * it every few images as they land, and with eight categories downloading at
   * once that meant playback was thrown back to the first image every couple of
   * seconds. Observed on the device: the same photo sat on screen for two
   * minutes at a 10-second slide duration.
   */
  setPlaylist(images) {
    if (!images?.length) return;
    const current = this.images[this.index];
    const idx = current ? images.findIndex(r => r.image === current.image) : -1;
    this.images = images;

    if (idx < 0) {
      // The image on screen is gone (a category was unticked, say) — start over.
      this.index = 0;
      this.restart();
      return;
    }

    // Still there: keep it on screen, keep its remaining dwell honest, and just
    // carry on from its new position in the list.
    this.index = idx;
    const token = ++this.runToken;
    this.cutDwell();
    this.run(token, false);
  }

  // Kept for the settings panel, which calls it after changing slide duration.
  // Restarting the loop is the correct response: the new duration should apply
  // to the dwell that's running, not the one after it.
  scheduleSlides() {
    this.restart();
  }

  restart() {
    const token = ++this.runToken;
    this.cutDwell();
    this.run(token);
  }

  // Resolves the in-flight dwell early (or does nothing if we aren't dwelling).
  cutDwell() {
    if (this.wake) { const w = this.wake; this.wake = null; w(); }
  }

  dwell(ms) {
    return new Promise(resolve => {
      this.wake = resolve;
      this.slideTimer = setTimeout(() => {
        if (this.wake === resolve) this.wake = null;
        resolve();
      }, ms);
    }).finally(() => clearTimeout(this.slideTimer));
  }

  /**
   * Loads a URL into an element and resolves once it is decoded and genuinely
   * ready to paint. Resolves false on failure so the caller can move on rather
   * than stall — a dead image URL must never stop the slideshow.
   */
  async prepare(el, url) {
    el.src = url;
    try {
      if (!el.complete || el.naturalWidth === 0) {
        await new Promise((resolve, reject) => {
          el.onload = resolve;
          el.onerror = () => reject(new Error('image failed'));
        });
      }
      // Decode off the critical path, so the first paint of this image doesn't
      // land in the same frame as the transition starting.
      if (typeof el.decode === 'function') await el.decode();
      return true;
    } catch {
      return false;
    }
  }

  // Resets the hidden slide and loads `record` into it. Split out from show()
  // so the loop can start this DURING the current slide's dwell instead of
  // after it: otherwise every image's download time is added to the slide
  // duration, and the pacing drifts even though each transition itself is
  // perfectly smooth. Loading into the real hidden element (rather than a
  // detached Image, as the old prefetch did) means there's nothing to keep in
  // sync — the bytes land exactly where they're needed.
  async load(record) {
    this.waiting.style.transition = 'none';
    this.waiting.style.clipPath = '';
    this.waiting.style.opacity = '0';
    this.waiting.style.transform = 'translate3d(0,0,0) scale3d(1,1,1)';

    this.loading = true;
    const ok = await this.prepare(this.waiting, record.image);
    this.loading = false;
    return ok;
  }

  // Puts `record` on screen. `instant` skips the transition (first slide, or a
  // slide interval too short to animate).
  async show(record, instant) {
    const ok = await this.load(record);
    if (!ok) return false;
    return this.present(record, instant);
  }

  // The visible half: caption, transition, swap. Assumes `waiting` already
  // holds a decoded image, which is what makes the transition reliable.
  async present(record, instant) {
    const forceInstant = instant || this.slideMs <= MIN_ANIMATED_SLIDE_MS;

    this.kb.stop();

    // Caption and picture are set at the same point in the sequence, so they
    // cannot disagree — the drift that produced two failed fixes is structurally
    // impossible now rather than merely guarded against.
    this.onMeta(record);

    if (forceInstant) {
      this.active.style.opacity = '0';
      this.waiting.style.opacity = '1';
    } else {
      this.inFade = true;
      const id = this.transitionId === 'random' ? pickRandomTransitionId() : this.transitionId;
      const { run } = resolveTransition(id);
      await run({
        activeEl: this.active,
        waitingEl: this.waiting,
        overlayEl: this.overlayEl,
        stageEl: this.stageEl,
        durationMs: this.fadeMs,
        options: this.transitionOptions,
      });
      this.inFade = false;
    }

    [this.active, this.waiting] = [this.waiting, this.active];
    this.xf = { scale: 1, tx: 0, ty: 0 };
    this.applyXf(this.active);
    this.waiting.style.clipPath = '';

    if (!this.paused && this.displayMode === 'kenburns' && this.slideMs > MIN_ANIMATED_SLIDE_MS) {
      this.kb.start();
    }
    return true;
  }

  /**
   * The one clock. Shows the current image, then loops: dwell, advance, repeat.
   * Every step awaits the one before it, so there is no second timer to fall
   * out of step with and nothing to guard.
   */
  async run(token, showFirst = true) {
    if (!this.images.length) return;

    // showFirst=false is for a playlist swap that kept the current image:
    // re-showing it would reload the same src and flash for no reason.
    if (showFirst) {
      await this.show(this.images[this.index], true);
      if (token !== this.runToken) return;
    }

    while (token === this.runToken) {
      // Start fetching the next image immediately, then dwell. The download
      // overlaps the time the current slide is on screen instead of being
      // added to it, so a slow image costs nothing as long as it arrives
      // within the dwell — and if it doesn't, the current slide simply holds
      // a little longer rather than the transition running on a half-loaded
      // image. This is the prefetch, but with no second copy to keep in sync:
      // it loads into the very element the transition will reveal.
      let next = (this.index + 1) % this.images.length;
      let loading = this.load(this.images[next]);

      // Dwell for the remainder of the slide after the transition it already
      // spent. Floor at a quarter of the interval so a long transition can
      // never squeeze the dwell to nothing and spin the loop.
      const rest = Math.max(this.slideMs * 0.25, this.slideMs - this.fadeMs);
      await this.dwell(rest);
      if (token !== this.runToken || this.paused) return;

      // Skip past unloadable records rather than stopping, but don't spin
      // forever if the whole playlist is broken.
      let shown = false;
      for (let tries = 0; tries < Math.min(5, this.images.length) && !shown; tries++) {
        const ok = await loading;
        if (token !== this.runToken) return;
        if (ok) {
          this.index = next;
          shown = await this.present(this.images[next], false);
        } else {
          // Dead URL: line up the one after it and try again straight away,
          // without waiting out another full dwell.
          next = (next + 1) % this.images.length;
          loading = this.load(this.images[next]);
        }
        if (token !== this.runToken) return;
      }
    }
  }

  /**
   * Drops the image on screen from the playlist and moves to the next one.
   *
   * For a downvote: rebuilding the whole playlist would work but restarts it
   * from the beginning, so disliking one picture would throw you back to the
   * top of the rotation. This removes just that entry and carries on.
   */
  async dropCurrent() {
    if (this.images.length <= 1) return false;
    const dropped = this.images[this.index];
    this.images = this.images.filter(r => r !== dropped);
    // Step back one so the loop's own increment lands on what would have been
    // the next image rather than skipping it.
    this.index = (this.index - 1 + this.images.length) % this.images.length;
    this.restart();
    return true;
  }

  setDisplayMode(mode) {
    this.displayMode = mode;
    if (mode !== 'kenburns') {
      this.kb.stop();
      this.xf = { scale: 1, tx: 0, ty: 0 };
      this.applyXf(this.active);
    } else if (!this.paused) {
      this.kb.start();
    }
  }

  setTransition(id, options) {
    this.transitionId = id;
    if (options) this.transitionOptions = { ...this.transitionOptions, ...options };
  }

  async goNext() {
    this.index = (this.index + 1) % this.images.length;
    await this.show(this.images[this.index], true);
    if (!this.paused) this.restart();
  }

  async goPrev() {
    this.index = (this.index - 1 + this.images.length) % this.images.length;
    await this.show(this.images[this.index], true);
    if (!this.paused) this.restart();
  }

  togglePause() {
    this.paused = !this.paused;
    this.pauseIcon.style.opacity = this.paused ? '1' : '0';

    if (this.paused) {
      this.kb.stop();          // also writes the frozen position back into xf
      this.runToken++;         // stops the loop at its next await
      this.cutDwell();
    } else {
      this.restart();
      if (this.displayMode === 'kenburns' && this.slideMs > MIN_ANIMATED_SLIDE_MS) this.kb.start();
    }
    this.onPauseChange(this.paused);
  }
}
