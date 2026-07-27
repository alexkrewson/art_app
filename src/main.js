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

  const slideshow = new Slideshow({
    stageEl, slideA, slideB, overlayEl, pauseIcon,
    displayMode: settings.displayMode,
    transitionId: settings.transitionId,
    transitionOptions: { dipColor: settings.dipColor },
    slideMs: settings.slideMs,
    fadeMs: settings.transitionMs,
    onMeta: img => ribbon.update(img),
    onPauseChange: paused => {
      settingsGear.hidden = !paused;
      if (!paused) settingsPanel.close();
    },
  });

  const settingsPanel = createSettingsPanel(slideshow);
  attachTouch(stageEl, slideshow, settingsPanel);

  settingsGear.addEventListener('click', e => {
    e.stopPropagation();
    settingsPanel.toggle();
  });

  const playlist = await buildPlaylist(settings.sources, { cacheEnabled: settings.cacheEnabled });
  slideshow.init(orderPlaylist(playlist, settings.order));
}

// Lets the app shell itself (not the artwork, which imageCache.js handles)
// reload with zero connectivity — e.g. reopening a tab in airplane mode.
// Feature-detected so it degrades harmlessly wherever service workers
// aren't supported.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(err => console.warn('[SlowFrame] service worker registration failed:', err));
  });
}

main();
