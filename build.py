#!/usr/bin/env python3
"""Generates kiosk.html with image metadata embedded — no server needed."""
import json

with open("images.json") as f:
    images = json.load(f)

data_js = json.dumps(images)

TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<title>Art</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; -webkit-user-select:none; user-select:none; }
  html, body { width:100%; height:100%; overflow:hidden; background:#000; touch-action:none; }
  body { display:flex; flex-direction:column; }

  #stage {
    flex:1; min-height:0;
    position:relative; overflow:hidden;
    background:#0a0a0a;
  }

  .slide {
    position:absolute; inset:0;
    width:100%; height:100%;
    object-fit:contain;
    opacity:0;
    /* transform handled entirely by JS — no CSS transition on it */
  }

  #footer {
    flex-shrink:0; height:88px;
    background:#111; border-top:1px solid #2a2a2a;
    display:flex; flex-direction:column;
    justify-content:center; gap:6px;
    padding:0 28px;
  }
  #title {
    font:italic clamp(1rem,2.2vw,1.4rem) Georgia,serif;
    color:#ececec; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  }
  #meta {
    font:clamp(0.8rem,1.6vw,1rem) Arial,sans-serif;
    color:#888; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  }

  #pause-icon {
    position:absolute; bottom:14px; right:16px;
    font-size:1.6rem; color:rgba(255,255,255,0.45);
    pointer-events:none;
    opacity:0; transition:opacity 0.3s;
  }
</style>
</head>
<body>

<div id="stage">
  <img class="slide" id="slide-a" alt="">
  <img class="slide" id="slide-b" alt="">
  <div id="pause-icon">⏸</div>
</div>
<div id="footer">
  <div id="title"></div>
  <div id="meta"></div>
</div>

<script>
const IMAGES = INJECT_DATA;

// ── Config ───────────────────────────────────────────────────────────────────
const SLIDE_MS   = 12000;  // ms per slide (auto-advance)
const FADE_MS    = 1500;   // crossfade duration
const KB_MS      = 13000;  // Ken Burns cycle duration
const MIN_SCALE  = 1.0;
const MAX_SCALE  = 6.0;

// Ken Burns target positions as fractions of stage dimensions.
// Each slide picks a random start → end pair.
const KB_TARGETS = [
  { scale:1.12, tx:-0.030, ty:-0.025 },
  { scale:1.00, tx: 0.000, ty: 0.000 },
  { scale:1.12, tx: 0.030, ty: 0.025 },
  { scale:1.08, tx:-0.022, ty: 0.030 },
  { scale:1.08, tx: 0.022, ty:-0.030 },
  { scale:1.15, tx: 0.000, ty: 0.000 },
  { scale:1.00, tx: 0.030, ty: 0.022 },
  { scale:1.00, tx:-0.030, ty:-0.022 },
];

// ── DOM refs ─────────────────────────────────────────────────────────────────
const stageEl   = document.getElementById('stage');
const slideA    = document.getElementById('slide-a');
const slideB    = document.getElementById('slide-b');
const titleEl   = document.getElementById('title');
const metaEl    = document.getElementById('meta');
const pauseIcon = document.getElementById('pause-icon');

// ── State ────────────────────────────────────────────────────────────────────
let index   = 0;
let paused  = false;
let active  = slideA;   // currently visible slide
let waiting = slideB;   // preloading next slide
let inFade  = false;

// Current transform (applied to `active`).
// Representation: translate(tx px, ty px) scale(scale), transform-origin: 50% 50%
// A point at element coords (ex, ey) maps to viewport: (ex*scale + tx, ey*scale + ty)
let xf = { scale:1, tx:0, ty:0 };

// Ken Burns animation state
let kbFrom     = null;   // { scale, tx, ty } at start of current segment
let kbTo       = null;   // target
let kbStartTs  = null;   // performance.now() at segment start
let rafId      = null;

let slideTimer = null;

// ── Utilities ────────────────────────────────────────────────────────────────
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t < 0.5 ? 2*t*t : -1 + (4 - 2*t)*t;

function stageSize() {
  return { w: stageEl.clientWidth, h: stageEl.clientHeight };
}

// Convert a KB_TARGETS entry (fractional) to pixel values
function toPixels(t) {
  const { w, h } = stageSize();
  return { scale: t.scale, tx: t.tx * w, ty: t.ty * h };
}

// Pick a KB target meaningfully different from `cur`
function pickTarget(cur) {
  const { w, h } = stageSize();
  const pool = KB_TARGETS.filter(t => {
    const p = toPixels(t);
    return Math.abs(p.scale - cur.scale) > 0.03
        || Math.abs(p.tx - cur.tx) > w * 0.015
        || Math.abs(p.ty - cur.ty) > h * 0.015;
  });
  const src = pool.length >= 2 ? pool : KB_TARGETS;
  return toPixels(src[Math.floor(Math.random() * src.length)]);
}

function applyXf(el) {
  el.style.transform = `translate(${xf.tx}px,${xf.ty}px) scale(${xf.scale})`;
}

function clamp() {
  const { w, h } = stageSize();
  xf.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, xf.scale));
  const mx = (xf.scale - 1) * w * 0.5;
  const my = (xf.scale - 1) * h * 0.5;
  xf.tx = Math.max(-mx, Math.min(mx, xf.tx));
  xf.ty = Math.max(-my, Math.min(my, xf.ty));
}

function updateMeta(img) {
  titleEl.textContent = img.title || '';
  const artist = (img.artist || '').split('\n')[0];
  metaEl.textContent = [artist, img.date].filter(Boolean).join('  —  ');
}

// ── Ken Burns ─────────────────────────────────────────────────────────────────
function startKB() {
  if (rafId) cancelAnimationFrame(rafId);
  kbFrom    = { ...xf };
  kbTo      = pickTarget(xf);
  kbStartTs = null;
  rafId = requestAnimationFrame(kbTick);
}

function kbTick(ts) {
  if (paused) { rafId = null; return; }
  if (kbStartTs === null) kbStartTs = ts;
  const t = (ts - kbStartTs) / KB_MS;
  if (t >= 1) {
    // Seamlessly start next KB segment from current endpoint
    xf        = { ...kbTo };
    kbFrom    = { ...xf };
    kbTo      = pickTarget(xf);
    kbStartTs = ts;
    applyXf(active);
    rafId = requestAnimationFrame(kbTick);
    return;
  }
  const e = ease(t);
  xf = {
    scale: lerp(kbFrom.scale, kbTo.scale, e),
    tx:    lerp(kbFrom.tx,    kbTo.tx,    e),
    ty:    lerp(kbFrom.ty,    kbTo.ty,    e),
  };
  applyXf(active);
  rafId = requestAnimationFrame(kbTick);
}

// ── Slide loading ─────────────────────────────────────────────────────────────
function loadAndShow(img, instant) {
  if (inFade && !instant) return;

  // Prep the waiting slide
  waiting.style.transition  = 'none';
  waiting.style.opacity     = '0';
  waiting.style.transform   = 'translate(0px,0px) scale(1)';
  waiting.src = img.image;

  function display() {
    // Stop any running KB
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }

    updateMeta(img);

    if (instant) {
      active.style.transition  = 'none';
      waiting.style.transition = 'none';
      requestAnimationFrame(() => {
        active.style.opacity  = '0';
        waiting.style.opacity = '1';
        xf = { scale:1, tx:0, ty:0 };
        applyXf(waiting);
        [active, waiting] = [waiting, active];
        if (!paused) startKB();
      });
    } else {
      inFade = true;
      requestAnimationFrame(() => {
        active.style.transition  = `opacity ${FADE_MS}ms ease-in-out`;
        waiting.style.transition = `opacity ${FADE_MS}ms ease-in-out`;
        active.style.opacity  = '0';
        waiting.style.opacity = '1';
        setTimeout(() => {
          [active, waiting] = [waiting, active];
          xf = { scale:1, tx:0, ty:0 };
          applyXf(active);
          inFade = false;
          if (!paused) startKB();
        }, FADE_MS);
      });
    }
  }

  if (waiting.complete && waiting.naturalWidth > 0) display();
  else { waiting.onload = display; waiting.onerror = display; }
}

function scheduleSlides() {
  clearInterval(slideTimer);
  if (!paused) {
    slideTimer = setInterval(() => {
      index = (index + 1) % IMAGES.length;
      loadAndShow(IMAGES[index], false);
    }, SLIDE_MS);
  }
}

function goNext() {
  index = (index + 1) % IMAGES.length;
  loadAndShow(IMAGES[index], true);
  if (!paused) scheduleSlides();
}

function goPrev() {
  index = (index - 1 + IMAGES.length) % IMAGES.length;
  loadAndShow(IMAGES[index], true);
  if (!paused) scheduleSlides();
}

// ── Pause / resume ────────────────────────────────────────────────────────────
function togglePause() {
  paused = !paused;
  if (paused) {
    clearInterval(slideTimer);
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    pauseIcon.style.opacity = '1';
  } else {
    pauseIcon.style.opacity = '0';
    // KB starts from wherever xf currently is — smooth continuation
    startKB();
    scheduleSlides();
  }
}

// ── Touch handling ────────────────────────────────────────────────────────────
// State for current gesture
let tStartX = 0, tStartY = 0, tStartMs = 0;
let tPrevX  = 0, tPrevY  = 0;
let tDidPinch = false, tDidPan = false;

// Pinch state (captured at pinch start)
let pinchDist0  = 1;
let pinchScale0 = 1, pinchTx0 = 0, pinchTy0 = 0;
let pinchMx0    = 0, pinchMy0 = 0;

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
    tDidPan   = false;
  } else if (e.touches.length === 2) {
    tDidPinch = true;
    const c  = stageCenter();
    const p0 = { x: e.touches[0].clientX - c.x, y: e.touches[0].clientY - c.y };
    const p1 = { x: e.touches[1].clientX - c.x, y: e.touches[1].clientY - c.y };
    pinchDist0  = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
    pinchScale0 = xf.scale;
    pinchTx0    = xf.tx;
    pinchTy0    = xf.ty;
    pinchMx0    = (p0.x + p1.x) / 2;
    pinchMy0    = (p0.y + p1.y) / 2;
  }
}, { passive: false });

stageEl.addEventListener('touchmove', e => {
  e.preventDefault();
  const c = stageCenter();

  if (e.touches.length === 2 && paused) {
    // ── Pinch zoom + pan ──────────────────────────────────────────────────────
    // Formula: zoom to pinch midpoint, then pan by midpoint delta
    // newTx = mx + f*(tx0 - mx0)  where f = newScale/scale0
    const p0 = { x: e.touches[0].clientX - c.x, y: e.touches[0].clientY - c.y };
    const p1 = { x: e.touches[1].clientX - c.x, y: e.touches[1].clientY - c.y };
    const d  = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const mx = (p0.x + p1.x) / 2;
    const my = (p0.y + p1.y) / 2;
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinchScale0 * d / pinchDist0));
    const f  = newScale / pinchScale0;
    xf.scale = newScale;
    xf.tx    = mx + f * (pinchTx0 - pinchMx0);
    xf.ty    = my + f * (pinchTy0 - pinchMy0);
    clamp();
    applyXf(active);

  } else if (e.touches.length === 1 && paused && !tDidPinch) {
    // ── Single-finger pan (while paused) ─────────────────────────────────────
    const dx = e.touches[0].clientX - tPrevX;
    const dy = e.touches[0].clientY - tPrevY;
    tPrevX = e.touches[0].clientX;
    tPrevY = e.touches[0].clientY;
    const totalDist = Math.hypot(e.touches[0].clientX - tStartX, e.touches[0].clientY - tStartY);
    if (totalDist > 8) {
      tDidPan = true;
      xf.tx += dx;
      xf.ty += dy;
      clamp();
      applyXf(active);
    }
  } else if (e.touches.length === 1 && !paused) {
    // Track prev even when playing (needed for swipe velocity)
    tPrevX = e.touches[0].clientX;
    tPrevY = e.touches[0].clientY;
  }
}, { passive: false });

stageEl.addEventListener('touchend', e => {
  e.preventDefault();
  if (e.touches.length > 0) return;  // not all fingers lifted yet

  const dx   = e.changedTouches[0].clientX - tStartX;
  const dy   = e.changedTouches[0].clientY - tStartY;
  const dt   = Date.now() - tStartMs;
  const dist = Math.hypot(dx, dy);

  // ── Swipe: dominant horizontal, enough distance ───────────────────────────
  if (!tDidPinch && Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    if (dx > 0) goPrev(); else goNext();
    return;
  }

  // ── Tap: tiny movement, quick ─────────────────────────────────────────────
  if (!tDidPinch && !tDidPan && dist < 14 && dt < 380) {
    togglePause();
  }
}, { passive: false });

// ── Mouse scroll zoom (desktop testing, paused only) ─────────────────────────
stageEl.addEventListener('wheel', e => {
  e.preventDefault();
  if (!paused) return;
  const c  = stageCenter();
  const mx = e.clientX - c.x;
  const my = e.clientY - c.y;
  const f  = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, xf.scale * f));
  const sf = newScale / xf.scale;
  xf.tx    = mx * (1 - sf) + xf.tx * sf;
  xf.ty    = my * (1 - sf) + xf.ty * sf;
  xf.scale = newScale;
  clamp();
  applyXf(active);
}, { passive: false });

// ── Init ──────────────────────────────────────────────────────────────────────
loadAndShow(IMAGES[0], true);
scheduleSlides();
</script>
</body>
</html>
"""

html = TEMPLATE.replace("INJECT_DATA", data_js)

with open("kiosk.html", "w", encoding="utf-8") as f:
    f.write(html)

print(f"Generated kiosk.html with {len(images)} images.")
print("Copy kiosk.html and the images/ folder to your tablet.")
