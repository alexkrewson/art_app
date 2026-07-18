// Consolidated settings overlay, following the shared "Settings menu"
// component recipe (accordion sections, all closed by default) from
// /home/alex/apps/shared/css-best-practices.md. Revealed by the gear icon
// that appears once the slideshow is paused (per the app spec's tap-to-reveal
// interaction model) rather than living behind a permanent header icon —
// there's no persistent chrome over the artwork during normal playback.

import { THEMES, loadTheme, applyTheme } from './themes.js';

const SECTIONS = [
  {
    id: 'sources',
    label: 'Sources',
    render: () => `
      <p>Currently built in: <strong>The Metropolitan Museum of Art</strong>
      (public domain works). Toggleable multi-source support — NASA, Smithsonian,
      Art Institute of Chicago, Rijksmuseum, Europeana, Wikimedia Commons, local
      files, Google Photos — is planned; see <code>maintenance_todo.md</code>
      Phase 3–4.</p>`,
  },
  {
    id: 'display',
    label: 'Display & Transitions',
    render: () => `
      <p>Currently: <strong>Ken Burns</strong> pan/zoom, crossfade transition.
      Static and Fade-only display modes, plus additional transition styles
      (slide, dip-to-color, ink wash, and more), are planned — see
      <code>maintenance_todo.md</code> Phase 2.</p>`,
  },
  {
    id: 'themes',
    label: 'Themes',
    render: (ctx) => `
      <div class="theme-list" role="radiogroup" aria-label="Theme">
        ${Object.entries(THEMES).map(([key, t]) => `
          <button type="button" class="theme-option" data-theme-key="${key}"
            role="radio" aria-checked="${ctx.currentTheme === key}">
            <span class="theme-swatch-pair">
              <span class="theme-swatch" style="background:${t.a.bg}"></span>
              <span class="theme-swatch" style="background:${t.b.bg}"></span>
            </span>
            <span>${t.label}</span>
          </button>
        `).join('')}
      </div>`,
  },
  {
    id: 'about',
    label: 'About',
    render: () => `
      <p><strong>SlowFrame</strong> — an ambient art slideshow for tablets and
      display screens. Successor to <code>kiosk.html</code>.</p>
      <p><strong>Image credits:</strong> artworks from The Metropolitan Museum
      of Art's Open Access collection, released under
      <a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noopener">CC0</a>.</p>
      <p><strong>Gestures:</strong> tap to pause/resume, tap the gear to open
      settings, pinch or scroll to zoom while paused, swipe (or drag while
      paused) left/right for next/previous.</p>
      <p><strong>Version:</strong> 0.1.0 &middot;
      <a href="https://github.com/alexkrewson/art_app" target="_blank" rel="noopener">github.com/alexkrewson/art_app</a></p>`,
  },
  {
    id: 'help',
    label: 'Help',
    render: () => `
      <p>Stuck? The slideshow auto-advances every 12 seconds. Tap anywhere to
      pause it and reveal this menu. Tap the gear icon again, or tap outside
      this panel, to close it.</p>`,
  },
  {
    id: 'advanced',
    label: 'Advanced',
    render: () => `
      <p>Density, sound, and debug options are planned — see
      <code>maintenance_todo.md</code>.</p>`,
  },
];

export function createSettingsPanel() {
  let currentTheme = applyTheme(loadTheme());

  const root = document.createElement('div');
  root.className = 'settings-panel';
  root.hidden = true;
  root.innerHTML = `
    <div class="settings-panel-inner" role="dialog" aria-label="Settings">
      <div class="settings-panel-header">
        <h2 class="settings-title">SlowFrame</h2>
        <button type="button" class="icon-btn settings-close" aria-label="Close settings">&#10005;</button>
      </div>
      <div class="settings-accordion"></div>
    </div>
  `;
  document.body.appendChild(root);

  const accordion = root.querySelector('.settings-accordion');

  function renderSections() {
    accordion.innerHTML = SECTIONS.map(s => `
      <section class="settings-section" data-section="${s.id}">
        <button type="button" class="settings-section-toggle" aria-expanded="false">
          <span>${s.label}</span>
          <span class="settings-section-chevron">&#9656;</span>
        </button>
        <div class="settings-section-content" hidden>${s.render({ currentTheme })}</div>
      </section>
    `).join('');
  }
  renderSections();

  accordion.addEventListener('click', e => {
    const toggle = e.target.closest('.settings-section-toggle');
    if (toggle) {
      const section = toggle.closest('.settings-section');
      const content = section.querySelector('.settings-section-content');
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      content.hidden = expanded;
      return;
    }
    const themeBtn = e.target.closest('.theme-option');
    if (themeBtn) {
      currentTheme = applyTheme(themeBtn.dataset.themeKey);
      accordion.querySelectorAll('.theme-option').forEach(b => {
        b.setAttribute('aria-checked', String(b.dataset.themeKey === currentTheme));
      });
    }
  });

  // Stop clicks inside the panel from bubbling to the stage (which would
  // toggle pause/resume) or the backdrop click-to-close handler below.
  root.addEventListener('click', e => e.stopPropagation());

  function close() { root.hidden = true; }
  function open() { root.hidden = false; }

  root.querySelector('.settings-close').addEventListener('click', close);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !root.hidden) close();
  });

  return {
    open,
    close,
    toggle() { root.hidden ? open() : close(); },
    isOpen() { return !root.hidden; },
  };
}
