// Core playback state machine, ported from kiosk.html. Owns the two <img>
// slides (crossfade between them), the current pan/zoom transform, and
// auto-advance scheduling. Ken Burns and touch handling are separate modules
// that operate through the small transform API exposed here.

import { KenBurns } from './kenburns.js';
import { resolveTransition, pickRandomTransitionId } from './transitions/index.js';

const MIN_SCALE = 1.0;
const MAX_SCALE = 6.0;

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

  loadAndShow(img, instant) {
    if (this.inFade && !instant) return;

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
      if (!this.paused && this.displayMode === 'kenburns') this.kb.start();
    };

    const display = () => {
      this.kb.stop();
      this.onMeta(img);

      if (instant) {
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

    if (this.waiting.complete && this.waiting.naturalWidth > 0) display();
    else { this.waiting.onload = display; this.waiting.onerror = display; }
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
