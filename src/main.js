// Entry point. Phase 1: wires the ported engine up to the existing
// images.json manifest, for visual parity with kiosk.html. Multi-source
// loading (Met/AIC/NASA/etc, local files, Google Photos) replaces this
// single fetch in later phases — see maintenance_todo.md Phase 3+.

import { Slideshow } from './engine/slideshow.js';
import { attachTouch } from './engine/touch.js';
import { createMetadataRibbon } from './ui/metadataRibbon.js';
import './style.css';

async function main() {
  const stageEl = document.getElementById('stage');
  const slideA = document.getElementById('slide-a');
  const slideB = document.getElementById('slide-b');
  const pauseIcon = document.getElementById('pause-icon');
  const titleEl = document.getElementById('title');
  const metaEl = document.getElementById('meta');

  const ribbon = createMetadataRibbon(titleEl, metaEl);

  const slideshow = new Slideshow({
    stageEl, slideA, slideB, pauseIcon,
    onMeta: img => ribbon.update(img),
  });

  attachTouch(stageEl, slideshow);

  const res = await fetch('/images.json');
  const images = await res.json();
  slideshow.init(images);
}

main();
