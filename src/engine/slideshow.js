// Core playback state machine, ported from kiosk.html. Owns the two <img>
// slides (crossfade between them), the current pan/zoom transform, and
// auto-advance scheduling. Ken Burns and touch handling are separate modules
// that operate through the small transform API exposed here.

import { KenBurns } from './kenburns.js';
import { resolveTransition, pickRandomTransitionId } from './transitions/index.js';

const MIN_SCALE = 1.0;
const MAX_SCALE = 6.0;

// Below this slide interval, an animated transition or Ken Burns pan doesn't
// have enough frames left to actually read as motion — at 60fps, 400ms is
// ~24 frames; well under that (e.g. 100ms is ~6 frames) a crossfade reads as
// a flicker and a "slow pan" isn't perceptible at all, since the slow pan
// *is* the point of Ken Burns. Rather than run a broken-looking animation,
// slides at or below this interval hard-cut instantly and skip Ken Burns
// entirely for that slide.
const MIN_ANIMATED_SLIDE_MS = 400;

export class Slideshow {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.stageEl
   * @param {HTMLImageElement} opts.slideA
   * @param {HTMLImageElement} opts.slideB
   * @param {HTMLElement} opts.overlayEl - full-stage layer used by color/light transitions
   * @param {HTMLElement} opts.pauseIcon
   * @param {(item: object) => void} opts.onMeta - called with the current image record on show
   * @param {(paused: boolean) => void} [opts.onPauseChange]
   * @param {'kenburns'|'static'|'fade'} [opts.displayMode]
   * @param {string} [opts.transitionId] - a transitions/index.js key, or 'random'
   * @param {object} [opts.transitionOptions] - e.g. { dipColor, direction }
   * @param {number} [opts.slideMs] - ms per slide (auto-advance)
   * @param {number} [opts.fadeMs] - transition duration
   */
  constructor({
    stageEl, slideA, slideB, overlayEl, pauseIcon, onMeta, onPauseChange,
    displayMode = 'kenburns', transitionId = 'crossfade', transitionOptions = {},
    slideMs = 12000, fadeMs = 1500,
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
    this.inFade = false;
    this.slideTimer = null;

    this.xf = { scale: 1, tx: 0, ty: 0 };

    this.kb = new KenBurns({
      stageSize: () => this.stageSize(),
      getXf: () => this.xf,
      setXf: xf => { this.xf = xf; },
      applyXf: () => this.applyXf(this.active),
      isPaused: () => this.paused,
    });
  }

  // ── Transform API (shared with touch.js) ──────────────────────────────
  stageSize() {
    return { w: this.stageEl.clientWidth, h: this.stageEl.clientHeight };
  }

  applyXf(el) {
    // translate3d/scale3d (not translate/scale) reliably force GPU-layer
    // compositing across browsers — plain 2D transform functions leave some
    // browsers (notably Firefox) to decide layerization heuristically, which
    // can fall back to main-thread repaint every frame and show up as
    // constant low framerate specifically on the animated element.
    el.style.transform = `translate3d(${this.xf.tx}px,${this.xf.ty}px,0) scale3d(${this.xf.scale},${this.xf.scale},1)`;
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
    this.images = images;
    this.index = 0;
    this.loadAndShow(this.images[0], true);
    this.scheduleSlides();
  }

  // Replaces the playlist in place (e.g. the Sources settings changed) and
  // jumps to its first image, without recreating the engine.
  setPlaylist(images) {
    if (!images.length) return;
    this.init(images);
  }

  // Defers the prefetch to idle time instead of firing it the instant the
  // transition lands. Prefetching *decodes* as well as downloads, and doing
  // that at the exact moment Ken Burns starts put a decode of a full-screen
  // photo in the frames where the pan is just getting going — which is the
  // hitch that survived the first choppiness fix. There's a whole slide's dwell
  // to play with, so almost any later moment is a better one.
  schedulePrefetch() {
    if (this.prefetchPending) return;
    const run = () => { this.prefetchPending = null; this.prefetchNext(); };
    if (typeof requestIdleCallback === 'function') {
      // The timeout matters: on a busy tab idle may never come, and a prefetch
      // that never runs silently costs the next slide its head start.
      this.prefetchPending = requestIdleCallback(run, { timeout: 2000 });
    } else {
      this.prefetchPending = setTimeout(run, 600);
    }
  }

  // Warms the next image into the browser's HTTP cache as soon as the current
  // one is on screen, so the next tick assigns a `src` that resolves locally.
  //
  // Without this, every slide paid full network latency at the moment it was
  // due — and worse, a tick arriving while the previous image was still in
  // flight would reassign `waiting.src` and abandon that download to start
  // another. At a 2s interval against images that take longer than 2s to
  // fetch, the slideshow can spend a long time cancelling itself and showing
  // nothing, which is exactly the "sometimes it sticks for 30 seconds" Alex
  // reported on 2026-08-08 with several live sources enabled. The bundled
  // local set never showed it because those images load from the APK.
  //
  // Deliberately fire-and-forget: a prefetch that fails costs nothing, because
  // loadAndShow still does its own load and has its own onerror path.
  prefetchNext() {
    if (this.images.length < 2) return;
    const next = this.images[(this.index + 1) % this.images.length];
    if (!next?.image || next.image === this.prefetchedUrl) return;
    this.prefetchedUrl = next.image;
    const im = new Image();
    // Matches the <img> elements in index.html. AIC's IIIF server 403s any
    // request carrying a foreign Referer, so without this the prefetch would
    // reliably miss for that source and quietly do nothing useful.
    im.referrerPolicy = 'no-referrer';
    im.decoding = 'async';
    im.src = next.image;
    // Decode it too, not just download it — a warmed HTTP cache still leaves
    // the main-thread decode to happen at paint time, which is the half of the
    // hitch that bytes-on-disk doesn't fix.
    im.decode?.().catch(() => {});
    this.prefetchImg = im; // hold a reference so it isn't collected mid-flight
  }

  loadAndShow(img, instant) {
    // A slide interval at or below MIN_ANIMATED_SLIDE_MS can't show a
    // transition or Ken Burns pan as anything but a flicker, so treat it as
    // an instant cut regardless of the caller's own intent — this also
    // means auto-advance below the threshold never sets `inFade`, so it
    // can't stall waiting on an animation that was never going to run.
    const forceInstant = instant || this.slideMs <= MIN_ANIMATED_SLIDE_MS;
    if (this.inFade && !forceInstant) return;

    this.waiting.style.transition = 'none';
    this.waiting.style.opacity = '0';
    this.waiting.style.clipPath = '';
    this.waiting.style.transform = 'translate3d(0,0,0) scale3d(1,1,1)';
    this.waiting.src = img.image;

    const finishSwap = () => {
      [this.active, this.waiting] = [this.waiting, this.active];
      this.xf = { scale: 1, tx: 0, ty: 0 };
      this.applyXf(this.active);
      this.waiting.style.clipPath = '';
      this.inFade = false;
      if (!this.paused && this.displayMode === 'kenburns' && this.slideMs > MIN_ANIMATED_SLIDE_MS) this.kb.start();
      this.schedulePrefetch();
    };

    const display = () => {
      this.loading = false;
      this.kb.stop();
      // Caption and pixels are set from the same `img` in the same call, so
      // they cannot disagree — the ribbon is only ever wrong if this doesn't
      // run, which is what the tick guard in scheduleSlides now prevents.
      this.onMeta(img);

      if (forceInstant) {
        this.active.style.transition = 'none';
        this.waiting.style.transition = 'none';
        requestAnimationFrame(() => {
          this.active.style.opacity = '0';
          this.waiting.style.opacity = '1';
          finishSwap();
        });
      } else {
        this.inFade = true;
        const transitionId = this.transitionId === 'random' ? pickRandomTransitionId() : this.transitionId;
        const { run } = resolveTransition(transitionId);
        run({
          activeEl: this.active,
          waitingEl: this.waiting,
          overlayEl: this.overlayEl,
          stageEl: this.stageEl,
          durationMs: this.fadeMs,
          options: this.transitionOptions,
        }).then(finishSwap);
      }
    };

    // Decode before showing. `onload` only means the bytes arrived — the JPEG
    // is still decoded lazily, on the main thread, at the moment the browser
    // first has to paint it. On a full-screen photo that decode lands in the
    // same frame as the transition starting, which is exactly the hitch Alex
    // described as "choppy between some of the images". decode() moves it off
    // the critical path and resolves once the bitmap is genuinely ready.
    //
    // It rejects if the src is replaced mid-decode; showing the image anyway is
    // the right fallback, since the alternative is a slide that never appears.
    const ready = () => {
      if (typeof this.waiting.decode !== 'function') return display();
      this.waiting.decode().then(display, () => display());
    };

    this.loading = true;
    if (this.waiting.complete && this.waiting.naturalWidth > 0) ready();
    else {
      this.waiting.onload = ready;
      this.waiting.onerror = display; // a broken URL must not wedge `loading`
    }
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

  scheduleSlides() {
    clearInterval(this.slideTimer);
    if (!this.paused) {
      this.slideTimer = setInterval(() => {
        // Skip the tick entirely rather than advancing past it. Previously
        // `index` was incremented before loadAndShow could decline the tick
        // (mid-transition, or still downloading), so the counter ran ahead of
        // what was on screen: records got silently skipped, prefetchNext warmed
        // the wrong image, and the next completed load showed an image several
        // places along from the caption that had been rendered for it.
        if (this.inFade || this.loading) return;
        this.index = (this.index + 1) % this.images.length;
        this.loadAndShow(this.images[this.index], false);
      }, this.slideMs);
    }
  }

  goNext() {
    this.index = (this.index + 1) % this.images.length;
    this.loadAndShow(this.images[this.index], true);
    if (!this.paused) this.scheduleSlides();
  }

  goPrev() {
    this.index = (this.index - 1 + this.images.length) % this.images.length;
    this.loadAndShow(this.images[this.index], true);
    if (!this.paused) this.scheduleSlides();
  }

  togglePause() {
    this.paused = !this.paused;
    if (this.paused) {
      clearInterval(this.slideTimer);
      this.kb.stop();
      this.pauseIcon.style.opacity = '1';
    } else {
      this.pauseIcon.style.opacity = '0';
      if (this.displayMode === 'kenburns') this.kb.start();
      this.scheduleSlides();
    }
    this.onPauseChange(this.paused);
  }
}
