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
import { getCacheStats, clearCache } from '../cache/imageCache.js';

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
      <input type="number" id="slideSecInput" class="field" name="slideSec" min="0.1" max="120" step="0.1" value="${formatSeconds(settings.slideMs)}">
      <div class="field-hint">Below ~0.4s, transitions and Ken Burns motion switch off automatically — there aren't enough frames left for them to read as motion instead of a flicker.</div>
    </div>
    <div class="field-group">
      <label class="field-label" for="transitionMsInput">Transition duration (ms)</label>
      <input type="number" id="transitionMsInput" class="field" name="transitionMs" min="200" max="6000" step="100" value="${settings.transitionMs}">
    </div>
  `;
}

// `settings.slideMs / 1000` as a number input value — plain division can
// yield e.g. "0.1" fine but also long floats for some inputs; toFixed(1)
// keeps sub-second values readable while Number.isInteger avoids showing
// "12.0" for the common whole-second case.
function formatSeconds(ms) {
  const sec = ms / 1000;
  return Number.isInteger(sec) ? String(sec) : sec.toFixed(1);
}

function renderAdvancedSection(settings, cacheStats) {
  return `
    <label class="radio-row">
      <input type="checkbox" name="cacheEnabled" ${settings.cacheEnabled ? 'checked' : ''}>
      <span>Cache images for offline use <span class="field-hint">— once an
      image has been downloaded it keeps playing with no internet
      connection; only images you haven't seen yet need a live fetch.</span></span>
    </label>
    <div class="field-group">
      <span class="field-hint">${cacheStats ? `${cacheStats.count} of ${cacheStats.cap} images cached` : 'Loading cache stats…'}</span>
      <button type="button" class="btn-secondary" id="clearCacheBtn">Clear cache</button>
    </div>
    <p>Density, sound, and debug options are planned — see
    <code>maintenance_todo.md</code>.</p>
  `;
}

// Renders one FilterSpec (src/sources/base.js) as a generic field. Every
// source's Sources-panel UI is built entirely from these — no per-source
// markup needed, so adding a new ImageSource never requires touching this
// file. `sensitive` (API keys) renders as a password input; everything
// else follows FilterSpec.type directly.
function renderFilterField(sourceId, spec, settings) {
  const cfg = settings.sources[sourceId];
  const value = cfg?.filters?.[spec.key] ?? spec.default ?? (spec.type === 'checkbox' ? false : '');
  const name = `filter::${sourceId}::${spec.key}`;

  if (spec.type === 'checkbox') {
    return `
      <label class="radio-row">
        <input type="checkbox" name="${name}" ${value ? 'checked' : ''}>
        <span>${spec.label}</span>
      </label>`;
  }
  if (spec.type === 'checkboxGroup') {
    // Same idea as a single checkbox, but one per option, all sharing the
    // same filter key — the stored value is an array of checked option
    // values rather than a boolean. Each input's name carries its own
    // option value (an extra `::`-segment) so the change handler knows
    // which entry to toggle without re-rendering the whole group.
    const checked = Array.isArray(value) ? value : [];
    const options = (spec.options || []).map(o => `
      <label class="radio-row">
        <input type="checkbox" name="${name}::${o.value}" ${checked.includes(o.value) ? 'checked' : ''}>
        <span>${o.label}</span>
      </label>`).join('');
    return `
      <div class="field-group">
        <span class="field-label">${spec.label}</span>
        ${options}
      </div>`;
  }
  if (spec.type === 'select') {
    const options = (spec.options || [])
      .map(o => `<option value="${o.value}" ${String(value) === o.value ? 'selected' : ''}>${o.label}</option>`)
      .join('');
    return `
      <div class="field-group">
        <label class="field-label" for="${name}">${spec.label}</label>
        <select id="${name}" class="field" name="${name}">${options}</select>
      </div>`;
  }
  const inputType = spec.sensitive ? 'password' : spec.type; // 'text' | 'number'
  return `
    <div class="field-group">
      <label class="field-label" for="${name}">${spec.label}</label>
      <input type="${inputType}" id="${name}" class="field" name="${name}" value="${value}" ${spec.placeholder ? `placeholder="${spec.placeholder}"` : ''}>
    </div>`;
}

// The one remaining special case: a folder picker is a browser-permission
// action, not a settings field, so it can't come from listFilters().
function renderLocalFilesExtra(source) {
  if (source.id !== 'localFiles') return '';
  const folderName = source.getPickedFolderName?.();
  return `
    <button type="button" class="btn-secondary" id="pickFolderBtn" ${source.supported ? '' : 'disabled'}>Choose folder&hellip;</button>
    <span class="field-hint">${folderName ? `Using: ${folderName}` : 'No folder selected yet'}</span>`;
}

function renderSourceBlock(source, settings, sourceFilters) {
  const cfg = settings.sources[source.id] || { enabled: false, filters: {} };
  const filters = sourceFilters[source.id] || [];
  const unsupported = source.supported === false;
  const gatedByKey = source.needsApiKey && !cfg.filters?.apiKey;
  const checkboxDisabled = unsupported || gatedByKey;

  let hint = source.description || '';
  if (unsupported) hint = 'Not supported in this browser (needs Chrome/Edge).';
  else if (gatedByKey) hint = `${hint} — enter an API key below to enable.`;

  // Subfields (including the API-key input itself) must stay reachable
  // while gatedByKey, not just once enabled — otherwise there's no way to
  // ever enter the key that would unlock the checkbox in the first place.
  const showSubfields = cfg.enabled || gatedByKey;

  return `
    <label class="radio-row">
      <input type="checkbox" name="src-${source.id}" ${cfg.enabled ? 'checked' : ''} ${checkboxDisabled ? 'disabled' : ''}>
      <span>${source.label} <span class="field-hint">— ${hint}</span></span>
    </label>
    <div class="source-subfields" ${showSubfields ? '' : 'hidden'}>
      ${filters.map(f => renderFilterField(source.id, f, settings)).join('')}
      ${renderLocalFilesExtra(source)}
    </div>
  `;
}

function renderSourcesSection(settings, sourceFilters) {
  return `
    ${Object.values(SOURCES).map(source => renderSourceBlock(source, settings, sourceFilters)).join('')}
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
    render: ctx => renderSourcesSection(ctx.settings, ctx.sourceFilters),
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
    render: ctx => renderAdvancedSection(ctx.settings, ctx.cacheStats),
  },
];

export function createSettingsPanel(slideshow) {
  let currentTheme = applyTheme(loadTheme());
  let settings = loadSettings();
  let sourceFilters = {}; // sourceId -> FilterSpec[], populated asynchronously below
  let cacheStats = null;

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
        <div class="settings-section-content" hidden>${s.render({ currentTheme, settings, sourceFilters, cacheStats })}</div>
      </section>
    `).join('');
  }
  renderSections();

  // Every source's filter list (e.g. Met's department dropdown, which needs
  // a live fetch) is loaded once up front so it's ready by the time someone
  // opens Sources, rather than lazily on first expand — refreshes the
  // section as each source resolves rather than waiting for the slowest one.
  Object.values(SOURCES).forEach(source => {
    Promise.resolve(source.listFilters())
      .then(filters => { sourceFilters[source.id] = filters; })
      .catch(err => {
        console.warn(`[SlowFrame] could not load filters for source "${source.id}":`, err);
        sourceFilters[source.id] = [];
      })
      .then(() => refreshSourcesSection());
  });

  getCacheStats().then(stats => {
    cacheStats = stats;
    refreshAdvancedSection();
  }).catch(err => console.warn('[SlowFrame] could not load cache stats:', err));

  function refreshSection(id, renderFn) {
    const content = accordion.querySelector(`[data-section="${id}"] .settings-section-content`);
    const wasExpanded = accordion.querySelector(`[data-section="${id}"] .settings-section-toggle`)
      .getAttribute('aria-expanded') === 'true';
    content.innerHTML = renderFn();
    content.hidden = !wasExpanded;
  }

  const refreshDisplaySection = () => refreshSection('display', () => renderDisplaySection(settings));
  const refreshSourcesSection = () => refreshSection('sources', () => renderSourcesSection(settings, sourceFilters));
  const refreshAdvancedSection = () => refreshSection('advanced', () => renderAdvancedSection(settings, cacheStats));

  async function rebuildPlaylist() {
    const playlist = await buildPlaylist(settings.sources, { cacheEnabled: settings.cacheEnabled });
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

    const clearCacheBtn = e.target.closest('#clearCacheBtn');
    if (clearCacheBtn) {
      clearCache()
        .then(() => getCacheStats())
        .then(stats => {
          cacheStats = stats;
          refreshAdvancedSection();
        })
        .catch(err => console.warn('[SlowFrame] failed to clear cache:', err));
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
      const sec = Math.max(0.1, Math.min(120, Number(el.value) || 12));
      settings.slideMs = Math.round(sec * 1000);
      slideshow.slideMs = settings.slideMs;
      // Cap transition duration at half the slide interval — otherwise a
      // slow crossfade can outlast a very short slide, so auto-advance
      // silently stalls (waiting on `inFade`) until the current transition
      // finally finishes. Below MIN_ANIMATED_SLIDE_MS (slideshow.js) this is
      // moot since transitions switch off entirely, but the cap also
      // matters just above that threshold, where transitions are still on
      // but a leftover long transitionMs from a slower-slide session could
      // still exceed the new, shorter interval.
      const maxSafeFadeMs = Math.max(50, Math.round(settings.slideMs / 2));
      if (settings.transitionMs > maxSafeFadeMs) {
        settings.transitionMs = maxSafeFadeMs;
        slideshow.fadeMs = maxSafeFadeMs;
        refreshDisplaySection();
      }
      slideshow.scheduleSlides();
    } else if (el.name === 'transitionMs') {
      const ms = Math.max(200, Math.min(6000, Number(el.value) || 1500));
      settings.transitionMs = ms;
      slideshow.fadeMs = ms;
    } else if (el.name.startsWith('src-')) {
      const id = el.name.slice(4);
      settings.sources[id].enabled = el.checked;
      refreshSourcesSection();
      rebuildPlaylist();
    } else if (el.name.startsWith('filter::')) {
      const parts = el.name.split('::');
      const [, id, key, optionValue] = parts;
      if (parts.length === 4) {
        // checkboxGroup: one input per option, toggling membership in an
        // array rather than a single boolean/text value.
        const current = Array.isArray(settings.sources[id].filters[key]) ? settings.sources[id].filters[key] : [];
        settings.sources[id].filters[key] = el.checked
          ? [...current, optionValue]
          : current.filter(v => v !== optionValue);
      } else {
        const value = el.type === 'checkbox' ? el.checked : (el.value || undefined);
        settings.sources[id].filters[key] = value;
      }
      // API-key fields gate the enable checkbox itself (disabled/enabled,
      // hint text) — everything else just needs the playlist rebuilt.
      if (key === 'apiKey') refreshSourcesSection();
      rebuildPlaylist();
    } else if (el.name === 'cacheEnabled') {
      settings.cacheEnabled = el.checked;
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

  const inner = root.querySelector('.settings-panel-inner');

  // Opens the panel positioned near wherever the cursor currently is,
  // instead of always centered — Alex asked for this after finding the
  // fixed gear icon (see main.js) required too much mouse travel to reach.
  // `cursorPos` is optional so the panel still works (centered, via the
  // existing flex layout) if ever opened without a known mouse position.
  function open(cursorPos) {
    root.hidden = false;
    if (!cursorPos) {
      inner.style.position = '';
      inner.style.left = '';
      inner.style.top = '';
      return;
    }
    inner.style.position = 'absolute';
    const rect = inner.getBoundingClientRect();
    const margin = 12;
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    inner.style.left = `${Math.max(margin, Math.min(maxLeft, cursorPos.x - rect.width / 2))}px`;
    inner.style.top = `${Math.max(margin, Math.min(maxTop, cursorPos.y - rect.height / 2))}px`;
  }
  function close() { root.hidden = true; }

  root.querySelector('.settings-close').addEventListener('click', close);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !root.hidden) close();
  });

  return {
    open,
    close,
    toggle(cursorPos) { root.hidden ? open(cursorPos) : close(); },
    isOpen() { return !root.hidden; },
  };
}
