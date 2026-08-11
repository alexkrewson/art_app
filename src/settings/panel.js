// Consolidated settings overlay, following the shared "Settings menu"
// component recipe (accordion sections, all closed by default) from
// /home/alex/apps/shared/css-best-practices.md. Revealed by the gear icon
// that appears once the slideshow is paused (per the app spec's tap-to-reveal
// interaction model) rather than living behind a permanent header icon —
// there's no persistent chrome over the artwork during normal playback.

import { THEMES, loadTheme, applyTheme } from './themes.js';
import { loadSettings, saveSettings, clampKbCycle, KB_SLOWEST_MS, KB_FASTEST_MS } from './store.js';
import { TRANSITIONS } from '../engine/transitions/index.js';
import { SOURCES } from '../sources/registry.js';
import { buildPlaylist, orderPlaylist } from '../sources/manager.js';
import {
  categoriesOf, catId, DEFAULT_COUNT, downloadCategory, removeCategory,
  refreshCategory, stats as libraryStats, estimateBytes, formatBytes, clearLibrary,
} from '../library/library.js';

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
    <div class="field-group">
      <span class="field-label">On screen</span>
      <label class="radio-row">
        <input type="checkbox" name="showRibbon" ${settings.showRibbon !== false ? 'checked' : ''}>
        <span>Info ribbon <span class="field-hint">— title, artist and credit
        along the bottom. Off gives the artwork the whole screen.</span></span>
      </label>
      <label class="radio-row">
        <input type="checkbox" name="showVoting" ${settings.showVoting ? 'checked' : ''}>
        <span>Thumbs up / down <span class="field-hint">— faint buttons beside
        the ribbon. Thumbs up keeps an image through a refresh; thumbs down
        deletes it and never shows it again.</span></span>
      </label>
    </div>
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
    <div class="field-group">
      <label class="field-label" for="kbCycleInput">Ken Burns speed</label>
      <!-- Inverted on purpose: the stored value is a segment DURATION, so a
           bigger number is slower. Dragging right should mean faster, so the
           slider runs on the negated value and the handler flips it back. -->
      <input type="range" id="kbCycleInput" class="field-range" name="kbCycle"
             min="${-KB_SLOWEST_MS}" max="${-KB_FASTEST_MS}" step="500" value="${-settings.kbCycleMs}"
             ${settings.displayMode === 'kenburns' ? '' : 'disabled'}>
      <div class="field-hint">
        <span>Slower</span>
        <span id="kbCycleValue">${(settings.kbCycleMs / 1000).toFixed(0)}s per pan</span>
        <span>Faster</span>
      </div>
      ${settings.displayMode === 'kenburns' ? '' : '<div class="field-hint">Only applies in Ken Burns display mode.</div>'}
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

// The cache toggle used to live here, buried under Advanced. Alex asked for it
// next to the source/playback controls instead — it decides what the slideshow
// can still show with no connection, which is a Sources question, not a
// debug-menu one. Clearing the cache stays here: it's destructive and rare.
// Reports the downloaded library, which is the only image storage there is now.
// This used to show the old Cache-API counter and a button claiming to clear
// downloads — the counter read zero because nothing writes to that cache any
// more, and the button cleared it rather than the images, so it deleted
// precisely nothing while saying otherwise.
function renderAdvancedSection(settings, lib) {
  return `
    <div class="field-group">
      <span class="field-label">Storage</span>
      <span class="field-hint">${lib
        ? `${lib.count} image${lib.count === 1 ? '' : 's'} downloaded · ${formatBytes(lib.bytes)}${lib.upvoted ? ` · ${lib.upvoted} thumbed up` : ''}${lib.free ? ` · ${formatBytes(lib.free)} free` : ''}`
        : 'Reading storage…'}</span>
      <button type="button" class="btn-secondary" id="clearLibraryBtn" ${lib?.count ? '' : 'disabled'}>Delete all downloaded images</button>
      <div class="field-hint">Removes every downloaded image from this device,
      including ones you've thumbed up. Categories stay ticked, so they will
      download again. Images you've thumbed <em>down</em> stay blocked.</div>
    </div>
    <div class="field-group">
      <label class="radio-row">
        <input type="checkbox" name="debugOverlay" ${settings.debugOverlay ? 'checked' : ''}>
        <span>Show diagnostic overlay <span class="field-hint">— a small readout
        over the artwork showing which image is on screen versus which one the
        caption describes. For pinning down the caption/picture mismatch;
        screenshot it and turn it back off.</span></span>
      </label>
    </div>
    <p>Density and sound options are planned — see
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

function renderSourceBlock(source, settings, sourceFilters, lib, expanded) {
  const cfg = settings.sources[source.id] || { enabled: false, filters: {} };
  const filters = sourceFilters[source.id] || [];
  const unsupported = source.supported === false;
  const gatedByKey = source.needsApiKey && !cfg.filters?.apiKey;
  const open = expanded.has(source.id);

  // The two genuinely-local sources have nothing to download, so they stay a
  // single plain checkbox rather than pretending to be a category list.
  if (source.id === 'local' || source.id === 'localFiles') {
    return `
      <div class="source-row">
        <label class="radio-row source-row-head">
          <input type="checkbox" name="src-${source.id}" ${cfg.enabled ? 'checked' : ''} ${unsupported ? 'disabled' : ''}>
          <span>${source.label}</span>
        </label>
        ${source.id === 'localFiles' ? `<div class="source-detail">${renderLocalFilesExtra(source)}</div>` : ''}
      </div>`;
  }

  const cats = categoriesOf(source.id, source);
  const otherFilters = filters.filter(f => f.type !== 'checkboxGroup');
  const onCount = cats.filter(c => settings.categories?.[c.cat]).length;
  const saved = cats.reduce((n, c) => n + (lib?.byCat?.[c.cat] || 0), 0);
  const anyBusy = cats.some(c => lib?.busy?.[c.cat]);

  // Collapsed summary carries the only two numbers worth seeing at a glance:
  // how many of this source's categories are on, and how many images that is.
  const summary = gatedByKey
    ? 'needs an API key'
    : anyBusy ? 'downloading…'
    : onCount ? `${onCount}/${cats.length} on · ${saved} image${saved === 1 ? '' : 's'}`
    : `${cats.length} categor${cats.length === 1 ? 'y' : 'ies'}`;

  const rows = cats.map(c => {
    const on = !!settings.categories?.[c.cat];
    const count = settings.categories?.[c.cat]?.count ?? DEFAULT_COUNT;
    const have = lib?.byCat?.[c.cat] || 0;
    const busy = lib?.busy?.[c.cat];
    // Downloaded-but-unticked is a real state now: the images stay on the
    // device and are simply out of the rotation.
    // "all available" is the honest label when the source has no more to give:
    // 60 of a requested 100 isn't a stalled download if 60 is everything there is.
    const dry = lib?.exhausted?.has(c.cat);
    const note = busy ? ''
      : have ? (on ? `(${have}${dry ? ' — all available' : ''})` : `(${have} saved, hidden)`)
      : '';
    return `
      <div class="cat-row">
        <label class="radio-row cat-row-label">
          <input type="checkbox" name="cat::${c.cat}" ${on ? 'checked' : ''} ${gatedByKey || busy ? 'disabled' : ''}>
          <span>${c.label}${note ? ` <span class="field-hint">${note}</span>` : ''}</span>
        </label>
        <input type="number" class="field field-inline" name="catcount::${c.cat}"
               min="10" max="500" step="10" value="${count}" ${busy ? 'disabled' : ''}
               aria-label="Images to keep for ${c.label}">
        <button type="button" class="btn-secondary btn-tiny" data-refresh="${c.cat}"
                ${on && have && !busy ? '' : 'disabled'}
                title="Replace these with new images, keeping any you've thumbed up"
                aria-label="Refresh ${c.label}">&#8635;</button>
        <button type="button" class="btn-secondary btn-tiny" data-delete="${c.cat}"
                ${have && !busy ? '' : 'disabled'}
                title="Delete these images from the device"
                aria-label="Delete downloaded images for ${c.label}">&#128465;</button>
      </div>
      <div class="download-progress" data-progress="${c.cat}" ${busy ? '' : 'hidden'}>
        <div class="download-progress-track">
          <div class="download-progress-fill" style="width:${busy?.percent ?? 0}%"></div>
        </div>
        <span class="field-hint" data-progress-label="${c.cat}">${busy?.label ?? ''}</span>
      </div>`;
  }).join('');

  return `
    <div class="source-row">
      <div class="source-row-head">
        <button type="button" class="source-expand" data-expand="${source.id}" aria-expanded="${open}">
          <span class="settings-section-chevron">&#9656;</span>
          <span class="source-title">${source.label}</span>
          <span class="field-hint">${summary}</span>
        </button>
        <button type="button" class="btn-secondary btn-tiny" data-select-all="${source.id}" ${gatedByKey ? 'disabled' : ''}>All</button>
        <button type="button" class="btn-secondary btn-tiny" data-select-none="${source.id}">None</button>
      </div>
      <div class="source-detail" ${open ? '' : 'hidden'}>
        ${source.description ? `<div class="field-hint">${source.description}</div>` : ''}
        ${otherFilters.map(f => renderFilterField(source.id, f, settings)).join('')}
        ${rows}
      </div>
    </div>`;
}

function renderSourcesSection(settings, sourceFilters, lib, expanded = new Set()) {
  return `
    <p class="field-hint">Ticking a category downloads it to this device — the
    slideshow only ever plays images you already have, so it never uses data
    while it's running. Unticking just hides it from the rotation; the images
    stay, and the bin button is what deletes them.</p>
    ${lib ? `<div class="field-group"><span class="field-hint">${lib.count} images stored · ${formatBytes(lib.bytes)}${lib.free ? ` · ${formatBytes(lib.free)} free` : ''}</span></div>` : ''}
    ${Object.values(SOURCES).map(source => renderSourceBlock(source, settings, sourceFilters, lib, expanded)).join('')}
    <div class="field-group" role="radiogroup" aria-label="Playback order">
      <span class="field-label">Playback order</span>
      <label class="radio-row"><input type="radio" name="order" value="sequential" ${settings.order === 'sequential' ? 'checked' : ''}><span>Sequential</span></label>
      <label class="radio-row"><input type="radio" name="order" value="shuffle" ${settings.order === 'shuffle' ? 'checked' : ''}><span>Shuffle</span></label>
    </div>
  `;
}

// "Download this category so it's there without a connection" — the Spotify
// shape Alex asked for. Only enabled sources are listed: downloading from a
// source you've switched off would be storing images the playlist won't use.
const SECTIONS = [
  {
    id: 'sources',
    label: 'Sources',
    render: ctx => renderSourcesSection(ctx.settings, ctx.sourceFilters, ctx.lib, ctx.expanded),
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
    render: ctx => renderAdvancedSection(ctx.settings, ctx.lib),
  },
];

export function createSettingsPanel(slideshow, {
  onDebugOverlayChange = () => {}, onRibbonChange = () => {}, onVotingChange = () => {},
} = {}) {
  let currentTheme = applyTheme(loadTheme());
  let settings = loadSettings();
  let sourceFilters = {}; // sourceId -> FilterSpec[], populated asynchronously below
  // What's on disk: counts per category, total bytes, free space. `busy` holds
  // in-flight downloads so a ticked category shows progress rather than
  // appearing to do nothing for a minute.
  let lib = null;
  const busy = {};
  // Categories whose source ran dry before reaching their target, so the row
  // can say "all there is" rather than showing a number that looks unfinished.
  const exhausted = new Set();
  // Which source rows are open. Collapsed by default so Sources is a short
  // list of one row per source rather than a wall of every category, key
  // field and description at once.
  const expanded = new Set();

  const root = document.createElement('div');
  root.className = 'settings-panel';
  root.hidden = true;
  root.innerHTML = `
    <div class="settings-panel-inner" role="dialog" aria-label="Settings">
      <div class="settings-panel-header">
        <h2 class="settings-title">SlowFrame</h2>
        <button type="button" class="icon-btn settings-close" aria-label="Close settings">&#10005;</button>
      </div>
      <div class="settings-tabs" role="tablist"></div>
      <div class="settings-tabpanel" role="tabpanel"></div>
    </div>
  `;
  document.body.appendChild(root);

  // Tabs rather than stacked accordions (Alex, 2026-08-09). With the panel now
  // full-screen there's room to show one section entirely, and an accordion
  // made you scroll past five collapsed headers to reach the sixth.
  let activeTab = SECTIONS[0].id;
  const tabsEl = root.querySelector('.settings-tabs');
  const panelEl = root.querySelector('.settings-tabpanel');
  // `accordion` is still the delegation root for every handler below; it just
  // points at the tab panel now.
  const accordion = panelEl;

  function renderTabs() {
    tabsEl.innerHTML = SECTIONS.map(sec => `
      <button type="button" class="settings-tab" role="tab"
              data-tab="${sec.id}" aria-selected="${sec.id === activeTab}">${sec.label}</button>
    `).join('');
  }

  function renderActive() {
    const sec = SECTIONS.find(x => x.id === activeTab) || SECTIONS[0];
    panelEl.innerHTML = sec.render({ currentTheme, settings, sourceFilters, lib, expanded });
    panelEl.scrollTop = 0;
  }

  function renderSections() { renderTabs(); renderActive(); }
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

  // Only the visible tab is in the DOM, so a refresh for a hidden one is a
  // no-op — it'll render current data whenever it's next selected.
  function refreshSection(id, renderFn) {
    if (id !== activeTab) return;
    const scroll = panelEl.scrollTop;
    panelEl.innerHTML = renderFn();
    panelEl.scrollTop = scroll; // don't jump the user to the top mid-interaction
  }

  const refreshDisplaySection = () => refreshSection('display', () => renderDisplaySection(settings));
  const refreshSourcesSection = () => refreshSection('sources', () => renderSourcesSection(settings, sourceFilters, lib, expanded));
  const refreshAdvancedSection = () => refreshSection('advanced', () => renderAdvancedSection(settings, lib));
  // Re-reads what's actually on disk. Called after anything that changes it,
  // so the counts and the storage line are never stale after an action the
  // user just took.
  async function refreshLibrary(rerender = true) {
    try {
      lib = { ...(await libraryStats()), busy, exhausted };
      refreshAdvancedSection();
    } catch (err) {
      console.warn('[SlowFrame] could not read the library:', err);
      lib = lib || { count: 0, bytes: 0, byCat: {}, busy };
    }
    if (rerender) refreshSourcesSection();
  }
  refreshLibrary();

  async function rebuildPlaylist() {
    const playlist = await buildPlaylist(settings.sources, { categories: settings.categories || {} });
    slideshow.setPlaylist(orderPlaylist(playlist, settings.order));
  }

  // Writes progress straight into the one row rather than re-rendering the
  // section under the user's finger while they're still tapping other
  // categories.
  function showProgress(cat, done, total) {
    const percent = total ? Math.round((done / total) * 100) : 0;
    busy[cat] = { percent, label: `${done} of ${total} downloaded` };
    const fill = accordion.querySelector(`[data-progress="${CSS.escape(cat)}"] .download-progress-fill`);
    const label = accordion.querySelector(`[data-progress-label="${CSS.escape(cat)}"]`);
    if (fill) fill.style.width = `${percent}%`;
    if (label) label.textContent = busy[cat].label;
  }

  // Runs one category's download, refreshing the playlist as images land so a
  // freshly-ticked category starts showing results within seconds rather than
  // when the whole batch finishes.
  async function runDownload(spec) {
    const cat = spec.cat;
    if (busy[cat]) return;
    busy[cat] = { percent: 0, label: `0 of ${spec.count} downloaded` };
    refreshSourcesSection();

    let lastRebuild = 0;
    const result = await downloadCategory(spec, ({ done, total }) => {
      showProgress(cat, done, total);
      // Throttled: rebuilding on every single image would thrash the engine.
      if (done - lastRebuild >= 5) { lastRebuild = done; rebuildPlaylist(); }
    });

    delete busy[cat];
    if (result.exhausted) exhausted.add(cat); else exhausted.delete(cat);
    await refreshLibrary();
    rebuildPlaylist();
    if (!result.added) {
      console.warn(`[SlowFrame] ${cat} downloaded nothing:`, result.reason);
    }
    return result;
  }

  // Everything tickable, flattened, so a handler can find a category by id.
  function allCategories() {
    return Object.entries(SOURCES)
      .filter(([id]) => id !== 'local' && id !== 'localFiles')
      .flatMap(([id, source]) => categoriesOf(id, source).map(c => ({ ...c, source })));
  }

  function specFor(c) {
    return {
      sourceId: c.sourceId,
      subjectKey: c.subjectKey,
      subject: c.subject,
      cat: c.cat,
      count: settings.categories?.[c.cat]?.count ?? DEFAULT_COUNT,
      filters: settings.sources[c.sourceId]?.filters || {},
    };
  }

  // Asks before a large download. The estimate uses per-source measured
  // averages (they differ by 55x), so this quotes something real rather than
  // one hand-waved number — and a wrong estimate here means a nasty surprise
  // on someone's data plan.
  function confirmSize(specs) {
    const total = specs.reduce((n, s) => n + estimateBytes(s.sourceId, s.count), 0);
    const images = specs.reduce((n, s) => n + s.count, 0);
    if (total < 40 * 1024 * 1024) return true;
    return window.confirm(
      `Download ${images} image${images === 1 ? '' : 's'}?

` +
      `That's roughly ${formatBytes(total)} on this device.` +
      (lib?.free ? `
You have about ${formatBytes(lib.free)} free.` : ''),
    );
  }

  accordion.addEventListener('click', e => {
    const themeBtn = e.target.closest('.theme-option');
    if (themeBtn) {
      currentTheme = applyTheme(themeBtn.dataset.themeKey);
      accordion.querySelectorAll('.theme-option').forEach(b => {
        b.setAttribute('aria-checked', String(b.dataset.themeKey === currentTheme));
      });
      return;
    }

    const clearLibBtn = e.target.closest('#clearLibraryBtn');
    if (clearLibBtn) {
      const n = lib?.count || 0;
      if (!window.confirm(`Delete all ${n} downloaded image${n === 1 ? '' : 's'} from this device?

This includes ones you've thumbed up. Your ticked categories stay selected, so they'll download again.`)) return;
      clearLibBtn.disabled = true;
      clearLibrary()
        .catch(err => console.warn('[SlowFrame] could not clear the library:', err))
        .then(async () => {
          await refreshLibrary();
          rebuildPlaylist();
        });
      return;
    }

    const delBtn = e.target.closest('[data-delete]');
    if (delBtn) {
      const cat = delBtn.dataset.delete;
      if (busy[cat]) return;
      const have = lib?.byCat?.[cat] || 0;
      if (!window.confirm(`Delete ${have} downloaded image${have === 1 ? '' : 's'} from this device?

Images you've thumbed up are kept. Anything shared with another downloaded category stays too.`)) return;
      delete settings.categories[cat];
      saveSettings(settings);
      refreshSourcesSection();
      removeCategory(cat).then(async () => {
        await refreshLibrary();
        rebuildPlaylist();
      });
      return;
    }

    // Refresh one category: swap the un-upvoted images for new ones, same
    // count. For when a set starts to feel stale.
    const refreshBtn = e.target.closest('[data-refresh]');
    if (refreshBtn) {
      const cat = refreshBtn.dataset.refresh;
      const c = allCategories().find(x => x.cat === cat);
      if (!c || busy[cat]) return;
      const have = lib?.byCat?.[cat] || 0;
      if (!window.confirm(`Replace ${have} image${have === 1 ? '' : 's'} in this category with new ones?

Anything you've thumbed up is kept.`)) return;

      busy[cat] = { percent: 0, label: 'refreshing…' };
      refreshSourcesSection();
      refreshCategory(specFor(c), ({ done, total }) => showProgress(cat, done, total))
        .then(async () => {
          delete busy[cat];
          await refreshLibrary();
          rebuildPlaylist();
        })
        .catch(async err => {
          console.warn('[SlowFrame] refresh failed:', err);
          delete busy[cat];
          await refreshLibrary();
        });
      return;
    }

    const expandBtn = e.target.closest('[data-expand]');
    if (expandBtn) {
      const id = expandBtn.dataset.expand;
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
      refreshSourcesSection();
      return;
    }

    // Select all / None for one source. Ticking many categories at once is
    // the most expensive thing in this panel, so it confirms as a batch rather
    // than asking once per category.
    const allBtn = e.target.closest('[data-select-all]');
    if (allBtn) {
      const id = allBtn.dataset.selectAll;
      const pending = categoriesOf(id, SOURCES[id])
        .filter(c => !settings.categories?.[c.cat])
        .map(specFor);
      if (!pending.length || !confirmSize(pending)) return;
      settings.categories = settings.categories || {};
      pending.forEach(sp => { settings.categories[sp.cat] = { count: sp.count }; });
      saveSettings(settings);
      refreshSourcesSection();
      // Sequential on purpose: several parallel batches would compete for the
      // connection and make every one of them slower to first image.
      (async () => { for (const sp of pending) await runDownload(sp); })();
      return;
    }

    const noneBtn = e.target.closest('[data-select-none]');
    if (noneBtn) {
      const id = noneBtn.dataset.selectNone;
      const on = categoriesOf(id, SOURCES[id]).filter(c => settings.categories?.[c.cat]);
      if (!on.length) return;
      // Hides rather than deletes, matching what unticking does. Nothing is
      // removed from the device, so this needs no confirmation.
      on.forEach(c => { delete settings.categories[c.cat]; });
      saveSettings(settings);
      refreshSourcesSection();
      rebuildPlaylist();
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

  // A range input only fires `change` when the thumb is released, so without
  // this the speed and its readout wouldn't move until you let go — which for
  // a "how fast should the pan be" control is the whole feedback loop.
  accordion.addEventListener('input', e => {
    if (e.target.name !== 'kbCycle') return;
    const ms = clampKbCycle(-Number(e.target.value));
    settings.kbCycleMs = ms;
    settings.kbCycleUserSet = true;   // chosen, so stop tracking the default
    slideshow.kb.cycleMs = ms;
    const out = accordion.querySelector('#kbCycleValue');
    if (out) out.textContent = `${Math.round(ms / 1000)}s per pan`;
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
      }
      // Always re-render: the Ken Burns speed slider is disabled outside Ken
      // Burns mode, so it has to reflect the new mode either way.
      refreshDisplaySection();
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
    } else if (el.name === 'kbCycle') {
      // The slider carries the negated duration so that dragging right reads
      // as "faster"; flip it back to the real segment length here.
      const ms = clampKbCycle(-Number(el.value));
      settings.kbCycleMs = ms;
      settings.kbCycleUserSet = true;   // chosen, so stop tracking the default
      slideshow.kb.cycleMs = ms;
      // Restart the current segment so the new speed is felt immediately
      // rather than after the current pan finishes.
      if (!slideshow.paused && settings.displayMode === 'kenburns') slideshow.kb.start();
      const out = accordion.querySelector('#kbCycleValue');
      if (out) out.textContent = `${Math.round(ms / 1000)}s per pan`;
    } else if (el.name === 'showVoting') {
      settings.showVoting = el.checked;
      onVotingChange(el.checked);
    } else if (el.name === 'showRibbon') {
      settings.showRibbon = el.checked;
      onRibbonChange(el.checked);
    } else if (el.name.startsWith('cat::')) {
      // Ticking a category IS downloading it — there's no separate button any
      // more, which is the point of the redesign: everything the slideshow
      // shows is already on the device.
      const cat = el.name.slice(5);
      const c = allCategories().find(x => x.cat === cat);
      if (!c) return;
      settings.categories = settings.categories || {};

      const held = lib?.byCat?.[cat] || 0;

      if (el.checked) {
        const spec = specFor(c);
        settings.categories[cat] = { count: spec.count };
        saveSettings(settings);

        // Already on the device: this is an unhide, not a download. No
        // network, no size warning — nothing is being fetched.
        if (held >= spec.count) {
          refreshSourcesSection();
          rebuildPlaylist();
          return;
        }
        const missing = spec.count - held;
        if (!confirmSize([{ ...spec, count: missing }])) {
          delete settings.categories[cat];
          saveSettings(settings);
          el.checked = false;
          return;
        }
        runDownload({ ...spec, count: missing });
      } else {
        // Hide only. Unticking used to delete the images, which made an
        // ordinary "not right now" indistinguishable from "throw these away"
        // — and re-ticking meant downloading them all again. The files stay;
        // the bin button next to it is what deletes.
        delete settings.categories[cat];
        saveSettings(settings);
        refreshSourcesSection();
        rebuildPlaylist();
      }
      return;
    } else if (el.name.startsWith('catcount::')) {
      const cat = el.name.slice(10);
      const count = Math.max(10, Math.min(500, Number(el.value) || DEFAULT_COUNT));
      settings.categories = settings.categories || {};
      settings.categories[cat] = { ...(settings.categories[cat] || {}), count };
      saveSettings(settings);

      // Only act if the category is already on: raising the number tops it up,
      // lowering it just changes what a future refresh will aim for. Silently
      // deleting images because a number went down would be a nasty surprise.
      const have = lib?.byCat?.[cat] || 0;
      const c = allCategories().find(x => x.cat === cat);
      // `have &&` used to be in this condition, which meant a category with
      // nothing downloaded — or one whose stats hadn't loaded yet, making
      // `have` 0 — silently did nothing when you raised its number.
      if (c && count > have) runDownload({ ...specFor(c), count: count - have });
      return;
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
      // An API key also un-disables that source's rows under Offline
      // downloads, which show "needs an API key in Sources" without one.
      if (key === 'apiKey') { refreshSourcesSection(); refreshDownloadsSection(); }
      rebuildPlaylist();
    } else if (el.name === 'debugOverlay') {
      settings.debugOverlay = el.checked;
      onDebugOverlayChange(el.checked);
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
  tabsEl.addEventListener('click', e => {
    const tab = e.target.closest('.settings-tab');
    if (!tab) return;
    activeTab = tab.dataset.tab;
    renderSections();
  });

  // Clicking the backdrop dismisses and resumes, same as the X. Anything
  // inside the card must not: `e.target === root` is true only for the
  // backdrop itself, since the card is a child.
  root.addEventListener('click', e => {
    if (e.target === root) dismiss();
    e.stopPropagation();
  });

  const inner = root.querySelector('.settings-panel-inner');

  // Opens the panel positioned near wherever the cursor currently is,
  // instead of always centered — Alex asked for this after finding the
  // fixed gear icon (see main.js) required too much mouse travel to reach.
  // `cursorPos` is optional so the panel still works (centered, via the
  // existing flex layout) if ever opened without a known mouse position.
  // Always centred, via the flex centering on `.settings-panel`. The panel used
  // to open at the pointer (2026-07-30, to save mouse travel on the desktop),
  // but Alex asked for it centred after using it on the phone: with a bigger
  // panel and no cursor to be near, "wherever you last tapped" just means the
  // panel lands somewhere different every time. The gear itself still follows
  // the pointer — that's the part that saved the travel.
  //
  // Takes and ignores a position argument so the existing callers don't need
  // to care; clearing the inline styles matters because a build that had
  // positioned it before would otherwise leave them stuck on the element.
  function open() {
    root.hidden = false;
    inner.style.position = '';
    inner.style.left = '';
    inner.style.top = '';
  }
  function close() { root.hidden = true; }

  // Closing the panel resumes the slideshow. Kept separate from close() so the
  // pause-change handler in main.js can hide the panel without recursing back
  // into togglePause.
  function dismiss() {
    close();
    if (slideshow.paused) slideshow.togglePause();
  }

  root.querySelector('.settings-close').addEventListener('click', dismiss);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !root.hidden) dismiss();
  });

  return {
    open,
    close,
    toggle(cursorPos) { root.hidden ? open(cursorPos) : close(); },
    isOpen() { return !root.hidden; },
  };
}
