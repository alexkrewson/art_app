// Core playback state machine, ported from kiosk.html. Owns the two <img>
// slides (crossfade between them), the current pan/zoom transform, and
// auto-advance scheduling. Ken Burns and touch handling are separate modules
// that operate through the small transform API exposed here.

import { KenBurns } from './kenburns.js';

const MIN_SCALE = 1.0;
const MAX_SCALE = 6.0;

export class Slideshow {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.stageEl
   * @param {HTMLImageElement} opts.slideA
   * @param {HTMLImageElement} opts.slideB
   * @param {HTMLElement} opts.pauseIcon
   * @param {(item: object) => void} opts.onMeta - called with the current image record on show
   * @param {(paused: boolean) => void} [opts.onPauseChange]
   * @param {number} [opts.slideMs] - ms per slide (auto-advance)
   * @param {number} [opts.fadeMs] - crossfade duration
   */
  constructor({ stageEl, slideA, slideB, pauseIcon, onMeta, onPauseChange, slideMs = 12000, fadeMs = 1500 }) {
    this.stageEl = stageEl;
    this.pauseIcon = pauseIcon;
    this.onMeta = onMeta;
    this.onPauseChange = onPauseChange || (() => {});
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
    el.style.transform = `translate(${this.xf.tx}px,${this.xf.ty}px) scale(${this.xf.scale})`;
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

  loadAndShow(img, instant) {
    if (this.inFade && !instant) return;

    this.waiting.style.transition = 'none';
    this.waiting.style.opacity = '0';
    this.waiting.style.transform = 'translate(0px,0px) scale(1)';
    this.waiting.src = img.image;

    const display = () => {
      this.kb.stop();
      this.onMeta(img);

      if (instant) {
        this.active.style.transition = 'none';
        this.waiting.style.transition = 'none';
        requestAnimationFrame(() => {
          this.active.style.opacity = '0';
          this.waiting.style.opacity = '1';
          this.xf = { scale: 1, tx: 0, ty: 0 };
          this.applyXf(this.waiting);
          [this.active, this.waiting] = [this.waiting, this.active];
          if (!this.paused) this.kb.start();
        });
      } else {
        this.inFade = true;
        requestAnimationFrame(() => {
          this.active.style.transition = `opacity ${this.fadeMs}ms ease-in-out`;
          this.waiting.style.transition = `opacity ${this.fadeMs}ms ease-in-out`;
          this.active.style.opacity = '0';
          this.waiting.style.opacity = '1';
          setTimeout(() => {
            [this.active, this.waiting] = [this.waiting, this.active];
            this.xf = { scale: 1, tx: 0, ty: 0 };
            this.applyXf(this.active);
            this.inFade = false;
            if (!this.paused) this.kb.start();
          }, this.fadeMs);
        });
      }
    };

    if (this.waiting.complete && this.waiting.naturalWidth > 0) display();
    else { this.waiting.onload = display; this.waiting.onerror = display; }
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
      this.kb.start();
      this.scheduleSlides();
    }
    this.onPauseChange(this.paused);
  }
}
