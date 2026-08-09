// Entry point.

import { Slideshow } from './engine/slideshow.js';
import { attachTouch } from './engine/touch.js';
import { createMetadataRibbon } from './ui/metadataRibbon.js';
import { createSettingsPanel } from './settings/panel.js';
import { loadSettings } from './settings/store.js';
import { buildPlaylist, orderPlaylist } from './sources/manager.js';
import './style.css';

async function main() {
  const stageEl = document.getElementById('stage');
  const slideA = document.getElementById('slide-a');
  const slideB = document.getElementById('slide-b');
  const overlayEl = document.getElementById('transition-overlay');
  const pauseIcon = document.getElementById('pause-icon');
  const settingsGear = document.getElementById('settings-gear');
  const titleEl = document.getElementById('title');
  const metaEl = document.getElementById('meta');

  const ribbon = createMetadataRibbon(titleEl, metaEl);
  const settings = loadSettings();

  // Tracked so the gear icon (below) and the settings panel (panel.js) can
  // both appear near wherever the pointer actually is instead of a fixed
  // corner/center — Alex asked for this after finding the fixed gear icon
  // required too much mouse travel to reach. Falls back to the stage
  // center if nothing has been pointed at yet (e.g. keyboard-only use).
  let lastPointer = null;
  document.addEventListener('mousemove', e => { lastPointer = { x: e.clientX, y: e.clientY }; });
  // A touch device never fires mousemove, so on a phone this stayed null and
  // the gear always landed at the stage centre — directly over the artwork
  // and nowhere near the tap that summoned it (visible in Alex's 2026-08-08
  // screenshot from the first APK). Capture phase so the position is recorded
  // before the stage's own touch handling runs.
  document.addEventListener('touchstart', e => {
    const t = e.touches[0];
    if (t) lastPointer = { x: t.clientX, y: t.clientY };
  }, { passive: true, capture: true });
  function pointerPos() {
    if (lastPointer) return lastPointer;
    const r = stageEl.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  const slideshow = new Slideshow({
    stageEl, slideA, slideB, overlayEl, pauseIcon,
    displayMode: settings.displayMode,
    transitionId: settings.transitionId,
    transitionOptions: { dipColor: settings.dipColor },
    slideMs: settings.slideMs,
    fadeMs: settings.transitionMs,
    kbCycleMs: settings.kbCycleMs,
    // lastMeta is what the ribbon was last told to show; the overlay compares
    // it against the src of whichever element is actually visible.
    onMeta: img => { lastMeta = img; ribbon.update(img); updateDebug(); },
    onPauseChange: paused => {
      settingsGear.hidden = !paused;
      if (paused) positionGearAtPointer();
      else settingsPanel.close();
    },
  });

  // Places the gear icon at the pointer's last known position (clamped to
  // stay fully inside the stage), overriding its CSS default bottom-left
  // corner. Relative to the stage, since #settings-gear is `position:
  // absolute` inside `#stage` (`position: relative`), not the viewport.
  function positionGearAtPointer() {
    const { x, y } = pointerPos();
    const stageRect = stageEl.getBoundingClientRect();
    const size = 44; // .icon-btn's fixed touch-target size
    const margin = 8;
    const maxLeft = Math.max(margin, stageRect.width - size - margin);
    const maxTop = Math.max(margin, stageRect.height - size - margin);
    settingsGear.style.left = `${Math.max(margin, Math.min(maxLeft, x - stageRect.left - size / 2))}px`;
    settingsGear.style.top = `${Math.max(margin, Math.min(maxTop, y - stageRect.top - size / 2))}px`;
    settingsGear.style.bottom = 'auto';
  }

  // ── Diagnostic overlay ────────────────────────────────────────────────
  // Reports, four times a second, what is ACTUALLY on screen versus what the
  // ribbon is describing. Exists because the "caption lags the picture" report
  // survived two fixes reasoned from the source, and a jsdom harness of the
  // whole advance cycle couldn't reproduce it either — so the next move is to
  // measure the running app instead of guessing a third time.
  //
  // Deliberately reads the same fields the engine uses rather than being told
  // anything: if the overlay and the ribbon disagree, the engine is the liar.
  let debugEl = null;
  let debugTimer = null;
  let lastMeta = null;

  function fileOf(url) {
    return String(url || '').split('/').pop()?.slice(-26) || '—';
  }

  function updateDebug() {
    if (!debugEl) return;
    const onScreen = [slideA, slideB].find(el => el.style.opacity === '1');
    const shown = onScreen ? fileOf(onScreen.src) : 'none visible';
    const caption = lastMeta ? fileOf(lastMeta.image) : '—';
    debugEl.textContent = [
      `idx ${slideshow.index}/${slideshow.images.length}`,
      `slide ${slideshow.slideMs}ms  fade ${slideshow.fadeMs}ms`,
      `inFade ${slideshow.inFade ? 'Y' : 'n'}  loading ${slideshow.loading ? 'Y' : 'n'}`,
      `active=${slideshow.active === slideA ? 'A' : 'B'} visible=${onScreen ? (onScreen === slideA ? 'A' : 'B') : '-'}`,
      `SCREEN  ${shown}`,
      `CAPTION ${caption}`,
      shown === caption ? 'IN STEP' : '*** MISMATCH ***',
    ].join('\n');
  }

  function setDebugOverlay(on) {
    if (on && !debugEl) {
      debugEl = document.createElement('pre');
      debugEl.id = 'debug-overlay';
      stageEl.appendChild(debugEl);
      debugTimer = setInterval(updateDebug, 250);
      updateDebug();
    } else if (!on && debugEl) {
      clearInterval(debugTimer);
      debugEl.remove();
      debugEl = null;
      debugTimer = null;
    }
  }

  const settingsPanel = createSettingsPanel(slideshow, { onDebugOverlayChange: setDebugOverlay });
  setDebugOverlay(settings.debugOverlay);
  attachTouch(stageEl, slideshow, settingsPanel);

  settingsGear.addEventListener('click', e => {
    e.stopPropagation();
    settingsPanel.toggle(pointerPos());
  });

  // Space: pause/resume. Left/Right: previous/next (mirrors the swipe
  // gestures in touch.js). S: jump straight to Settings, pausing first if
  // needed — added so reaching Settings never requires any mouse travel at
  // all. Ignored while typing into a settings field (e.g. a source's
  // keyword search) so these keys behave like normal text entry there.
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.key === ' ') {
      e.preventDefault();
      slideshow.togglePause();
    } else if (e.key === 'ArrowRight') {
      slideshow.goNext();
    } else if (e.key === 'ArrowLeft') {
      slideshow.goPrev();
    } else if (e.key.toLowerCase() === 's') {
      if (settingsPanel.isOpen()) {
        settingsPanel.close();
      } else {
        if (!slideshow.paused) slideshow.togglePause();
        settingsPanel.open(pointerPos());
      }
    }
  });

  const playlist = await buildPlaylist(settings.sources, { cacheEnabled: settings.cacheEnabled });
  slideshow.init(orderPlaylist(playlist, settings.order));
}

// Lets the app shell itself (not the artwork, which imageCache.js handles)
// reload with zero connectivity — e.g. reopening a tab in airplane mode.
// Feature-detected so it degrades harmlessly wherever service workers
// aren't supported. PROD-gated: a cache-first service worker registered
// against `vite dev`'s unbundled, constantly-changing modules serves stale
// code across reloads — confirmed directly, it masked an unrelated settings
// bug during manual testing until the SW was unregistered by hand.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(err => console.warn('[SlowFrame] service worker registration failed:', err));
  });
}

main();
