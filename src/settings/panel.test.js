import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSettingsPanel } from './panel.js';

// The Android back button must do exactly what the X button does. close() only
// hides the panel and leaves the slideshow paused behind it, so a back press
// wired to close() would look like it had done nothing: the picture would sit
// frozen with no settings on screen.

function fakeSlideshow() {
  return {
    paused: true,
    togglePause() { this.paused = !this.paused; },
    kb: { smooth: false, start() {}, cycleMs: 8500 },
    applyXf() {},
    setPlaylist() {},
    setDisplayMode() {},
    active: null,
    slideMs: 12000,
    fadeMs: 1500,
  };
}

function setup() {
  localStorage.clear();
  document.body.innerHTML = '';
  const slideshow = fakeSlideshow();
  const panel = createSettingsPanel(slideshow);
  return { panel, slideshow };
}

describe('settings panel dismiss', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('exposes dismiss, so the back button can reach it', () => {
    const { panel } = setup();
    expect(typeof panel.dismiss).toBe('function');
  });

  it('dismiss closes the panel and unpauses', () => {
    const { panel, slideshow } = setup();
    panel.open();
    expect(panel.isOpen()).toBe(true);
    slideshow.paused = true;

    panel.dismiss();

    expect(panel.isOpen()).toBe(false);
    expect(slideshow.paused).toBe(false);   // back returns you to the picture, playing
  });

  it('close only hides — which is why back must not use it', () => {
    const { panel, slideshow } = setup();
    panel.open();
    slideshow.paused = true;

    panel.close();

    expect(panel.isOpen()).toBe(false);
    expect(slideshow.paused).toBe(true);    // still paused: nothing appears to happen
  });

  it('dismiss on an already-closed panel still resumes', () => {
    // Worth pinning because it is a sharp edge: dismiss() resumes whether or
    // not the panel was open, so it would un-pause a slideshow the user had
    // paused deliberately. main.js guards with isOpen() before calling it, and
    // that guard is load-bearing — back with nothing open must minimize the
    // app, not silently restart playback.
    const { panel, slideshow } = setup();
    expect(panel.isOpen()).toBe(false);
    slideshow.paused = true;

    panel.dismiss();

    expect(slideshow.paused).toBe(false);
  });
});
