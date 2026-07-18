// Pinch-zoom, pan, swipe, and tap gestures, ported from kiosk.html. Operates
// on a Slideshow instance via its transform API (xf/clampXf/applyXf) plus
// its playback methods (goNext/goPrev/togglePause).

export function attachTouch(stageEl, slideshow) {
  let tStartX = 0, tStartY = 0, tStartMs = 0;
  let tPrevX = 0, tPrevY = 0;
  let tDidPinch = false, tDidPan = false;

  let pinchDist0 = 1;
  let pinchScale0 = 1, pinchTx0 = 0, pinchTy0 = 0;
  let pinchMx0 = 0, pinchMy0 = 0;

  function stageCenter() {
    const r = stageEl.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  stageEl.addEventListener('touchstart', e => {
    e.preventDefault();
    if (e.touches.length === 1) {
      const t = e.touches[0];
      tStartX = tPrevX = t.clientX;
      tStartY = tPrevY = t.clientY;
      tStartMs = Date.now();
      tDidPinch = false;
      tDidPan = false;
    } else if (e.touches.length === 2) {
      tDidPinch = true;
      const c = stageCenter();
      const p0 = { x: e.touches[0].clientX - c.x, y: e.touches[0].clientY - c.y };
      const p1 = { x: e.touches[1].clientX - c.x, y: e.touches[1].clientY - c.y };
      pinchDist0 = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
      pinchScale0 = slideshow.xf.scale;
      pinchTx0 = slideshow.xf.tx;
      pinchTy0 = slideshow.xf.ty;
      pinchMx0 = (p0.x + p1.x) / 2;
      pinchMy0 = (p0.y + p1.y) / 2;
    }
  }, { passive: false });

  stageEl.addEventListener('touchmove', e => {
    e.preventDefault();
    const c = stageCenter();

    if (e.touches.length === 2 && slideshow.paused) {
      // Zoom to pinch midpoint, then pan by midpoint delta:
      // newTx = mx + f*(tx0 - mx0)  where f = newScale/scale0
      const p0 = { x: e.touches[0].clientX - c.x, y: e.touches[0].clientY - c.y };
      const p1 = { x: e.touches[1].clientX - c.x, y: e.touches[1].clientY - c.y };
      const d = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const mx = (p0.x + p1.x) / 2;
      const my = (p0.y + p1.y) / 2;
      const newScale = Math.max(slideshow.minScale, Math.min(slideshow.maxScale, pinchScale0 * d / pinchDist0));
      const f = newScale / pinchScale0;
      slideshow.xf.scale = newScale;
      slideshow.xf.tx = mx + f * (pinchTx0 - pinchMx0);
      slideshow.xf.ty = my + f * (pinchTy0 - pinchMy0);
      slideshow.clampXf();
      slideshow.applyXf(slideshow.active);

    } else if (e.touches.length === 1 && slideshow.paused && !tDidPinch) {
      const dx = e.touches[0].clientX - tPrevX;
      const dy = e.touches[0].clientY - tPrevY;
      tPrevX = e.touches[0].clientX;
      tPrevY = e.touches[0].clientY;
      const totalDist = Math.hypot(e.touches[0].clientX - tStartX, e.touches[0].clientY - tStartY);
      if (totalDist > 8) {
        tDidPan = true;
        slideshow.xf.tx += dx;
        slideshow.xf.ty += dy;
        slideshow.clampXf();
        slideshow.applyXf(slideshow.active);
      }
    } else if (e.touches.length === 1 && !slideshow.paused) {
      tPrevX = e.touches[0].clientX;
      tPrevY = e.touches[0].clientY;
    }
  }, { passive: false });

  stageEl.addEventListener('touchend', e => {
    e.preventDefault();
    if (e.touches.length > 0) return; // not all fingers lifted yet

    const dx = e.changedTouches[0].clientX - tStartX;
    const dy = e.changedTouches[0].clientY - tStartY;
    const dt = Date.now() - tStartMs;
    const dist = Math.hypot(dx, dy);

    if (!tDidPinch && Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx > 0) slideshow.goPrev(); else slideshow.goNext();
      return;
    }

    if (!tDidPinch && !tDidPan && dist < 14 && dt < 380) {
      slideshow.togglePause();
    }
  }, { passive: false });

  // Mouse scroll zoom (desktop testing, paused only)
  stageEl.addEventListener('wheel', e => {
    e.preventDefault();
    if (!slideshow.paused) return;
    const c = stageCenter();
    const mx = e.clientX - c.x;
    const my = e.clientY - c.y;
    const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newScale = Math.max(slideshow.minScale, Math.min(slideshow.maxScale, slideshow.xf.scale * f));
    const sf = newScale / slideshow.xf.scale;
    slideshow.xf.tx = mx * (1 - sf) + slideshow.xf.tx * sf;
    slideshow.xf.ty = my * (1 - sf) + slideshow.xf.ty * sf;
    slideshow.xf.scale = newScale;
    slideshow.clampXf();
    slideshow.applyXf(slideshow.active);
  }, { passive: false });

  // Also support a plain click for desktop testing (touch events won't fire
  // with a mouse in most browsers).
  stageEl.addEventListener('click', () => slideshow.togglePause());
}
