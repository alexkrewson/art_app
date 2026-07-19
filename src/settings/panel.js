// Consolidated settings overlay, following the shared "Settings menu"
// component recipe (accordion sections, all closed by default) from
// /home/alex/apps/shared/css-best-practices.md. Revealed by the gear icon
// that appears once the slideshow is paused (per the app spec's tap-to-reveal
// interaction model) rather than living behind a permanent header icon —
// there's no persistent chrome over the artwork during normal playback.

import { THEMES, loadTheme, applyTheme } from './themes.js';
import { loadSettings, saveSettings } from './store.js';
import { TRANSITIONS } from '../engine/transitions/index.js';
import { SOURCES } from '../sources/registry.js';
import { buildPlaylist, orderPlaylist } from '../sources/manager.js';

const DISPLAY_MODES = [
  { id: 'kenburns', label: 'Ken Burns', hint: 'Slow pan & zoom' },
  { id: 'static', label: 'Static', hint: 'No motion, crossfade' },
  { id: 'fade', label: 'Fade Only', hint: 'No motion, plain fade' },
];

function renderDisplaySection(settings) {
  const transitionOptions = Object.entries(TRANSITIONS).map(([id, t]) => `
    <option value="${id}" ${t.planned ? 'disabled' : ''} ${settings.transitionId === id ? 'selected' : ''}>
      ${t.label}${t.planned ? ' (coming soon)' : ''}
    </option>`).join('');

  return `
    <div class="field-group" role="radiogroup" aria-label="Display mode">
      <span class="field-label">Display mode</span>
      ${DISPLAY_MODES.map(m => `
        <label class="radio-row">
          <input type="radio" name="displayMode" value="${m.id}" ${settings.displayMode === m.id ? 'checked' : ''}>
          <span>${m.label} <span class="field-hint">— ${m.hint}</span></span>
        </label>
      `).join('')}
    </div>
    <div class="field-group">
      <label class="field-label" for="transitionSelect">Transition</label>
      <select id="transitionSelect" class="field" name="transitionId">
        <option value="random" ${settings.transitionId === 'random' ? 'selected' : ''}>Random (cycles enabled)</option>
        ${transitionOptions}
      </select>
    </div>
    <div class="field-group" data-show-if-transition="dipToColor" ${settings.transitionId === 'dipToColor' ? '' : 'hidden'}>
      <label class="field-label" for="dipColorInput">Dip-to-color color</label>
      <input type="color" id="dipColorInput" name="dipColor" value="${settings.dipColor}">
    </div>
    <div class="field-group">
      <label class="field-label" for="slideSecInput">Slide duration (seconds)</label>
      <input type="number" id="slideSecInput" class="field" name="slideSec" min="3" max="120" step="1" value="${Math.round(settings.slideMs / 1000)}">
    </div>
    <div class="field-group">
      <label class="field-label" for="transitionMsInput">Transition duration (ms)</label>
      <input type="number" id="transitionMsInput" class="field" name="transitionMs" min="200" max="6000" step="100" value="${settings.transitionMs}">
    </div>
  `;
}

function renderSourcesSection(settings, metDepartments) {
  const local = settings.sources.local;
  const met = settings.sources.met;
  const lf = settings.sources.localFiles;

  const deptOptions = metDepartments
    ? metDepartments.map(d => `<option value="${d.value}" ${String(met.filters.departmentId || '') === d.value ? 'selected' : ''}>${d.label}</option>`).join('')
    : '<option>Loading…</option>';

  const folderName = SOURCES.localFiles.getPickedFolderName();

  return `
    <label class="radio-row">
      <input type="checkbox" name="src-local" ${local.enabled ? 'checked' : ''}>
      <span>${SOURCES.local.label} <span class="field-hint">— ${SOURCES.local.description}</span></span>
    </label>

    <label class="radio-row">
      <input type="checkbox" name="src-met" ${met.enabled ? 'checked' : ''}>
      <span>${SOURCES.met.label} <span class="field-hint">— live</span></span>
    </label>
    <div class="source-subfields" ${met.enabled ? '' : 'hidden'}>
      <div class="field-group">
        <label class="field-label" for="metDept">Department</label>
        <select id="metDept" class="field" name="metDepartmentId">
          <option value="">Any department</option>
          ${deptOptions}
        </select>
      </div>
      <div class="field-group">
        <label class="field-label" for="metKeyword">Keyword</label>
        <input type="text" id="metKeyword" class="field" name="metKeyword" value="${met.filters.keyword || ''}" placeholder="e.g. sunflowers">
      </div>
      <div class="field-group">
        <label class="field-label" for="metMedium">Medium</label>
        <input type="text" id="metMedium" class="field" name="metMedium" value="${met.filters.medium || ''}" placeholder="e.g. woodblock print">
      </div>
      <div class="field-group">
        <span class="field-label">Date range (year)</span>
        <div style="display:flex; gap:0.5rem;">
          <input type="number" class="field" name="metDateBegin" value="${met.filters.dateBegin || ''}" placeholder="From">
          <input type="number" class="field" name="metDateEnd" value="${met.filters.dateEnd || ''}" placeholder="To">
        </div>
      </div>
      <label class="radio-row">
        <input type="checkbox" name="metPublicDomainOnly" ${met.filters.publicDomainOnly !== false ? 'checked' : ''}>
        <span>Public domain only</span>
      </label>
    </div>

    <label class="radio-row">
      <input type="checkbox" name="src-localFiles" ${lf.enabled ? 'checked' : ''} ${SOURCES.localFiles.supported ? '' : 'disabled'}>
      <span>${SOURCES.localFiles.label} <span class="field-hint">— ${SOURCES.localFiles.supported ? SOURCES.localFiles.description : 'not supported in this browser (needs Chrome/Edge)'}</span></span>
    </label>
    <div class="source-subfields" ${lf.enabled ? '' : 'hidden'}>
      <button type="button" class="btn-secondary" id="pickFolderBtn" ${SOURCES.localFiles.supported ? '' : 'disabled'}>Choose folder&hellip;</button>
      <span class="field-hint">${folderName ? `Using: ${folderName}` : 'No folder selected yet'}</span>
    </div>

    <div class="field-group" role="radiogroup" aria-label="Playback order">
      <span class="field-label">Playback order</span>
      <label class="radio-row"><input type="radio" name="order" value="sequential" ${settings.order === 'sequential' ? 'checked' : ''}><span>Sequential</span></label>
      <label class="radio-row"><input type="radio" name="order" value="shuffle" ${settings.order === 'shuffle' ? 'checked' : ''}><span>Shuffle</span></label>
    </div>
  `;
}

const SECTIONS = [
  {
    id: 'sources',
    label: 'Sources',
    render: ctx => renderSourcesSection(ctx.settings, ctx.metDepartments),
  },
  {
    id: 'display',
    label: 'Display & Transitions',
    render: ctx => renderDisplaySection(ctx.settings),
  },
  {
    id: 'themes',
    label: 'Themes',
    render: ctx => `
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
      <p>Stuck? The slideshow auto-advances every 12 seconds by default. Tap
      anywhere to pause it and reveal this menu. Tap the gear icon again, or
      tap outside this panel, to close it.</p>`,
  },
  {
    id: 'advanced',
    label: 'Advanced',
    render: () => `
      <p>Density, sound, and debug options are planned — see
      <code>maintenance_todo.md</code>.</p>`,
  },
];

export function createSettingsPanel(slideshow) {
  let currentTheme = applyTheme(loadTheme());
  let settings = loadSettings();
  let metDepartments = null;

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
        <div class="settings-section-content" hidden>${s.render({ currentTheme, settings, metDepartments })}</div>
      </section>
    `).join('');
  }
  renderSections();

  // Met's department list rarely changes — fetch it once up front so it's
  // ready by the time someone opens Sources, rather than fetching lazily on
  // first expand (which would need its own loading state in that path too).
  SOURCES.met.listFilters().then(filters => {
    metDepartments = filters.find(f => f.key === 'departmentId').options.slice(1); // drop the synthetic "Any" entry, added again by renderSourcesSection
    refreshSourcesSection();
  }).catch(err => console.warn('[SlowFrame] could not load Met departments:', err));

  function refreshSection(id, renderFn) {
    const content = accordion.querySelector(`[data-section="${id}"] .settings-section-content`);
    const wasExpanded = accordion.querySelector(`[data-section="${id}"] .settings-section-toggle`)
      .getAttribute('aria-expanded') === 'true';
    content.innerHTML = renderFn();
    content.hidden = !wasExpanded;
  }

  const refreshDisplaySection = () => refreshSection('display', () => renderDisplaySection(settings));
  const refreshSourcesSection = () => refreshSection('sources', () => renderSourcesSection(settings, metDepartments));

  async function rebuildPlaylist() {
    const playlist = await buildPlaylist(settings.sources);
    slideshow.setPlaylist(orderPlaylist(playlist, settings.order));
  }

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
      return;
    }

    const pickBtn = e.target.closest('#pickFolderBtn');
    if (pickBtn) {
      // showDirectoryPicker() requires a user gesture — must be called
      // directly from this click handler, not after an intervening await.
      SOURCES.localFiles.pickFolder()
        .then(({ count }) => {
          settings.sources.localFiles.enabled = true;
          saveSettings(settings);
          refreshSourcesSection();
          if (count > 0) rebuildPlaylist();
        })
        .catch(err => console.warn('[SlowFrame] folder picker cancelled or failed:', err));
    }
  });

  accordion.addEventListener('change', e => {
    const el = e.target;

    if (el.name === 'displayMode') {
      settings.displayMode = el.value;
      slideshow.setDisplayMode(el.value);
      // Static/Fade Only are defined by the spec as "no motion, crossfade" /
      // "no motion, plain fade" — both map to our crossfade transition, so
      // switching into either sets a sensible transition default. Ken Burns
      // doesn't dictate a transition, so it's left as whatever was selected.
      if (el.value !== 'kenburns') {
        settings.transitionId = 'crossfade';
        slideshow.setTransition('crossfade');
        refreshDisplaySection();
      }
    } else if (el.name === 'transitionId') {
      settings.transitionId = el.value;
      slideshow.setTransition(el.value);
      refreshDisplaySection();
    } else if (el.name === 'dipColor') {
      settings.dipColor = el.value;
      slideshow.setTransition(settings.transitionId, { dipColor: el.value });
    } else if (el.name === 'slideSec') {
      const sec = Math.max(3, Math.min(120, Number(el.value) || 12));
      settings.slideMs = sec * 1000;
      slideshow.slideMs = settings.slideMs;
      slideshow.scheduleSlides();
    } else if (el.name === 'transitionMs') {
      const ms = Math.max(200, Math.min(6000, Number(el.value) || 1500));
      settings.transitionMs = ms;
      slideshow.fadeMs = ms;
    } else if (el.name === 'src-local') {
      settings.sources.local.enabled = el.checked;
      rebuildPlaylist();
    } else if (el.name === 'src-met') {
      settings.sources.met.enabled = el.checked;
      refreshSourcesSection();
      rebuildPlaylist();
    } else if (el.name === 'src-localFiles') {
      settings.sources.localFiles.enabled = el.checked;
      refreshSourcesSection();
      rebuildPlaylist();
    } else if (el.name === 'metDepartmentId') {
      settings.sources.met.filters.departmentId = el.value || undefined;
      rebuildPlaylist();
    } else if (el.name === 'metKeyword') {
      settings.sources.met.filters.keyword = el.value || undefined;
      rebuildPlaylist();
    } else if (el.name === 'metMedium') {
      settings.sources.met.filters.medium = el.value || undefined;
      rebuildPlaylist();
    } else if (el.name === 'metDateBegin') {
      settings.sources.met.filters.dateBegin = el.value || undefined;
      rebuildPlaylist();
    } else if (el.name === 'metDateEnd') {
      settings.sources.met.filters.dateEnd = el.value || undefined;
      rebuildPlaylist();
    } else if (el.name === 'metPublicDomainOnly') {
      settings.sources.met.filters.publicDomainOnly = el.checked;
      rebuildPlaylist();
    } else if (el.name === 'order') {
      settings.order = el.value;
      // Reorder in place — no need to re-fetch from every source just to
      // change sequential vs. shuffle.
      slideshow.setPlaylist(orderPlaylist(slideshow.images, settings.order));
    } else {
      return;
    }
    saveSettings(settings);
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
