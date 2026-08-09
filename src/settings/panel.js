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
import { getCacheStats, clearCache, listDownloads, removeDownload } from '../cache/imageCache.js';
import { downloadableTargets, downloadTarget, storageSummary, formatBytes } from '../cache/downloads.js';

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
    <div class="field-group">
      <label class="field-label" for="kbCycleInput">Ken Burns speed</label>
      <!-- Inverted on purpose: the stored value is a segment DURATION, so a
           bigger number is slower. Dragging right should mean faster, so the
           slider runs on the negated value and the handler flips it back. -->
      <input type="range" id="kbCycleInput" class="field-range" name="kbCycle"
             min="-40000" max="-4000" step="1000" value="${-settings.kbCycleMs}"
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
function renderAdvancedSection(settings, cacheStats) {
  return `
    <div class="field-group">
      <span class="field-hint">${cacheStats ? `${cacheStats.count} of ${cacheStats.cap} images cached automatically` : 'Loading cache stats…'}</span>
      <button type="button" class="btn-secondary" id="clearCacheBtn">Clear cache</button>
      <div class="field-hint">Also removes anything saved under <strong>Offline
      downloads</strong>.</div>
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
    <div class="field-group">
      <span class="field-label">Offline</span>
      <label class="radio-row">
        <input type="checkbox" name="cacheEnabled" ${settings.cacheEnabled ? 'checked' : ''}>
        <span>Cache images as they're shown <span class="field-hint">— once an
        image has been displayed it keeps playing with no internet connection.
        To choose what's available offline in advance, use
        <strong>Offline downloads</strong>.</span></span>
      </label>
    </div>
  `;
}

// "Download this category so it's there without a connection" — the Spotify
// shape Alex asked for. Only enabled sources are listed: downloading from a
// source you've switched off would be storing images the playlist won't use.
const DOWNLOAD_COUNTS = [25, 50, 100, 250, 500];

// Says what actually happened, including the awkward outcomes. A download that
// asked for 250 and saved 60 must not look identical to one that saved 250 —
// this whole feature exists so the user knows what they'll have offline.
function downloadOutcome(result) {
  if (!result) return '';
  const REASONS = {
    'budget-full': 'the storage budget is full — remove a download to make room',
    'source-returned-fewer': 'that\'s all the source had for these filters',
    'no-results': 'the source returned nothing — check its filters or API key',
    'fetch-failed': 'the source could not be reached',
    'unknown-source': 'that source is no longer available',
  };
  const why = REASONS[result.reason];
  if (!result.stoppedEarly) return `<p class="field-hint">Saved ${result.added} images.</p>`;
  return `<p class="field-hint">Saved ${result.added} of ${result.requested}${why ? ` — ${why}` : ''}.</p>`;
}

function renderDownloadsSection(settings, downloads, storage, busy, lastResult) {
  // Every live source, not only the enabled ones. Requiring a source to be
  // switched on first was a hidden precondition: Alex opened this section and
  // reported "I don't see anything clickable", which is exactly what it shows
  // when nothing live happens to be ticked. Wanting a category offline is
  // itself the intent to use it, so the button is always offered and enabling
  // the source is handled for you when a download succeeds.
  const live = Object.entries(SOURCES).filter(([id]) => id !== 'local' && id !== 'localFiles');

  const bar = storage ? `
    <div class="field-group">
      <span class="field-label">Storage used by offline images</span>
      <div class="storage-bar" role="img"
           aria-label="${storage.percent}% of the offline storage budget used">
        <div class="storage-bar-fill" style="width:${storage.percent}%"></div>
      </div>
      <span class="field-hint">${formatBytes(storage.usage)} of ${formatBytes(storage.budget)} used
        &middot; budget is a share of what this device offers</span>
    </div>` : '<span class="field-hint">Checking available storage&hellip;</span>';

  const existing = downloads?.length ? `
    <div class="field-group">
      <span class="field-label">Downloaded</span>
      ${downloads.map(d => `
        <div class="download-row">
          <span class="download-row-label">${d.label}</span>
          <span class="field-hint">${d.count} image${d.count === 1 ? '' : 's'}</span>
          <button type="button" class="btn-secondary" data-remove-download="${d.collection}">Remove</button>
        </div>`).join('')}
    </div>` : '';

  const targets = live.flatMap(([id, source]) => downloadableTargets(id, source));

  const available = `
    <div class="field-group">
      <span class="field-label">Available to download</span>
      ${targets.map(t => {
        const have = downloads?.find(d => d.collection === t.collection);
        const state = busy?.[t.collection];
        // A keyed source with no key can't fetch anything, so say that on the
        // row rather than letting the download fail with an empty result.
        const source = SOURCES[t.sourceId];
        const needsKey = source.needsApiKey && !settings.sources[t.sourceId]?.filters?.apiKey;
        return `
        <div class="download-row">
          <span class="download-row-label">${t.label}${have ? ` <span class="field-hint">(${have.count} saved)</span>` : ''}${needsKey ? ' <span class="field-hint">— needs an API key in Sources</span>' : ''}</span>
          <select class="field field-inline" data-download-count="${t.collection}" ${state || needsKey ? 'disabled' : ''}>
            ${DOWNLOAD_COUNTS.map(n => `<option value="${n}" ${n === 100 ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
          <button type="button" class="btn-secondary" data-download="${t.collection}" ${state || needsKey ? 'disabled' : ''}>
            ${state ? 'Saving…' : (have ? 'Add more' : 'Download')}
          </button>
        </div>
        <!-- Its own row beneath, so a long category name can't squash the bar.
             Hidden until a download starts; updated in place while it runs so
             the section isn't re-rendered under the user's finger. -->
        <div class="download-progress" data-progress="${t.collection}" ${state ? '' : 'hidden'}>
          <div class="download-progress-track">
            <div class="download-progress-fill" style="width:${state?.percent ?? 0}%"></div>
          </div>
          <span class="field-hint" data-progress-label="${t.collection}">${state?.label ?? ''}</span>
        </div>`;
      }).join('')}
    </div>`;

  return `
    <p class="field-hint">Save a category to this device so the slideshow keeps
    working with no connection. Downloads are kept until you remove them — the
    automatic cache can't evict them.</p>
    ${bar}
    ${downloadOutcome(lastResult)}
    ${existing}
    ${available}`;
}

const SECTIONS = [
  {
    id: 'sources',
    label: 'Sources',
    render: ctx => renderSourcesSection(ctx.settings, ctx.sourceFilters),
  },
  {
    id: 'downloads',
    label: 'Offline downloads',
    render: ctx => renderDownloadsSection(ctx.settings, ctx.downloads, ctx.storage, ctx.downloadBusy, ctx.lastDownloadResult),
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

export function createSettingsPanel(slideshow, { onDebugOverlayChange = () => {} } = {}) {
  let currentTheme = applyTheme(loadTheme());
  let settings = loadSettings();
  let sourceFilters = {}; // sourceId -> FilterSpec[], populated asynchronously below
  let cacheStats = null;
  let downloads = null;     // grouped pinned collections, loaded asynchronously
  let storage = null;       // {usage, budget, percent}
  const downloadBusy = {};  // collection -> progress label, e.g. "42/100"
  let lastDownloadResult = null; // so a short-fall is reported, not silently absorbed

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
        <div class="settings-section-content" hidden>${s.render({ currentTheme, settings, sourceFilters, cacheStats, downloads, storage, downloadBusy, lastDownloadResult })}</div>
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
  const refreshDownloadsSection = () =>
    refreshSection('downloads', () => renderDownloadsSection(settings, downloads, storage, downloadBusy, lastDownloadResult));

  // Re-reads both the download list and the storage bar. Called after anything
  // that changes either, so the numbers on screen are never stale after an
  // action the user just took.
  async function refreshDownloadState() {
    try {
      [downloads, storage] = await Promise.all([listDownloads(), storageSummary()]);
    } catch (err) {
      console.warn('[SlowFrame] could not read offline downloads:', err);
      downloads = downloads || [];
    }
    refreshDownloadsSection();
  }
  refreshDownloadState();

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
        // Clearing the cache removes pinned rows too, so the downloads list
        // and storage bar are both stale until this runs.
        .then(() => refreshDownloadState())
        .catch(err => console.warn('[SlowFrame] failed to clear cache:', err));
      return;
    }

    const downloadBtn = e.target.closest('[data-download]');
    if (downloadBtn) {
      const collection = downloadBtn.dataset.download;
      if (downloadBusy[collection]) return; // already running; the button is disabled anyway
      const countEl = accordion.querySelector(`[data-download-count="${CSS.escape(collection)}"]`);
      const count = Number(countEl?.value) || 100;

      const target = Object.entries(SOURCES)
        .flatMap(([id, source]) => downloadableTargets(id, source))
        .find(t => t.collection === collection);
      if (!target) return;

      downloadBusy[collection] = { percent: 0, label: `0 of ${count}…` };
      refreshDownloadsSection();

      downloadTarget(
        target,
        settings.sources[target.sourceId]?.filters || {},
        count,
        // Re-rendering the whole section per image would fight the user's
        // scroll position, so the bar and its label are written in place.
        ({ done, total, added }) => {
          const percent = total ? Math.round((done / total) * 100) : 0;
          downloadBusy[collection] = { percent, label: `${done} of ${total} — ${added} saved` };
          const fill = accordion.querySelector(`[data-progress="${CSS.escape(collection)}"] .download-progress-fill`);
          const label = accordion.querySelector(`[data-progress-label="${CSS.escape(collection)}"]`);
          if (fill) fill.style.width = `${percent}%`;
          if (label) label.textContent = downloadBusy[collection].label;
        },
      )
        .then(result => {
          delete downloadBusy[collection];
          if (result.added === 0) {
            console.warn(`[SlowFrame] download of ${collection} added nothing:`, result.reason);
          }
          lastDownloadResult = result;
          // Downloading a category is a clear statement that you want to see
          // it, so switch the source on rather than saving images the playlist
          // will then ignore. Only on success — enabling a source that just
          // failed would be worse than doing nothing.
          if (result.added > 0 && !settings.sources[target.sourceId]?.enabled) {
            settings.sources[target.sourceId] = {
              ...(settings.sources[target.sourceId] || { filters: {} }),
              enabled: true,
            };
            saveSettings(settings);
            refreshSourcesSection();
            rebuildPlaylist();
          }
          return refreshDownloadState();
        })
        // A download that half-finished still saved something, so the list has
        // to refresh on the failure path too.
        .catch(err => {
          delete downloadBusy[collection];
          console.warn('[SlowFrame] download failed:', err);
          return refreshDownloadState();
        });
      return;
    }

    const removeBtn = e.target.closest('[data-remove-download]');
    if (removeBtn) {
      removeBtn.disabled = true;
      removeDownload(removeBtn.dataset.removeDownload)
        .catch(err => console.warn('[SlowFrame] failed to remove download:', err))
        .then(() => refreshDownloadState());
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
    const ms = Math.max(4000, Math.min(40000, -Number(e.target.value) || 13000));
    settings.kbCycleMs = ms;
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
      const ms = Math.max(4000, Math.min(40000, -Number(el.value) || 13000));
      settings.kbCycleMs = ms;
      slideshow.kb.cycleMs = ms;
      // Restart the current segment so the new speed is felt immediately
      // rather than after the current 13-second pan finishes.
      if (!slideshow.paused && settings.displayMode === 'kenburns') slideshow.kb.start();
      const out = accordion.querySelector('#kbCycleValue');
      if (out) out.textContent = `${Math.round(ms / 1000)}s per pan`;
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
    } else if (el.name === 'cacheEnabled') {
      settings.cacheEnabled = el.checked;
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
  root.addEventListener('click', e => e.stopPropagation());

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
