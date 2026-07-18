# SlowFrame — Maintenance / Build TODO

Living checklist for the SlowFrame rewrite (successor to `kiosk.html`). Updated and
checked off as work completes, with a git commit per completed step, so progress
survives a crash or restart. See original spec pasted into the conversation on
2026-07-18 for full feature detail.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked (needs input from Alex)

## Phase 0 — Project setup
- [x] `git init`, rename default branch to `main`
- [x] `.gitignore` (exclude downloaded image binaries, node_modules, build output, secrets)
- [x] `maintenance_todo.md` (this file)
- [x] Commit existing `kiosk.html`/scripts as a baseline snapshot before rewriting
- [ ] `package.json` + Vite scaffold (vanilla JS, no heavy framework — keeps this close
      to the original single-file app's simplicity and easy to reason about)
- [ ] Base `index.html` + CSS reset, stage/footer layout ported from `kiosk.html`

## Phase 1 — Core slideshow engine (parity with kiosk.html)
- [ ] `src/engine/slideshow.js` — playback state machine (index, active/waiting slides,
      auto-advance timer, pause/resume)
- [ ] `src/engine/kenburns.js` — RAF-based pan/zoom loop (ported from kiosk.html)
- [ ] `src/engine/touch.js` — pinch-zoom, pan, swipe next/prev, tap to pause (ported)
- [ ] `src/ui/metadataRibbon.js` — title/artist/date footer ribbon
- [ ] Wire everything together in `src/main.js` using the existing `images.json` as a
      static data source, confirm visual parity with `kiosk.html`
- [ ] **Checkpoint: pause for manual testing** (per Alex's request — stop here before
      going further)

## Phase 2 — Display modes & transitions
- [ ] Display mode toggle: Ken Burns / Static / Fade Only
- [ ] Transition engine with pluggable transition registry + capability-based fallback
      to crossfade on low-powered devices
- [ ] Standard transitions: Crossfade (default), Fade to black, Fade to white, Dip to
      color (user-chosen color)
- [ ] Motion transitions: Slide (4 directions), Zoom through, Drift (parallax)
- [ ] Transition duration setting; "Random" mode to cycle enabled transitions
- [ ] Atmospheric transitions (CSS/canvas/WebGL, lower priority, must degrade gracefully):
      Burn, Dissolve, Ink wash, Light leak, Shatter, Ripple, Curtain
- [ ] **Checkpoint: pause for manual testing**

## Phase 3 — Image source architecture
- [ ] `ImageSource` interface (id, label, needsApiKey, listFilters(), fetchBatch(filters))
- [ ] Source manager: enable/disable per source, merge + shuffle/sequential playlist
      across enabled sources
- [ ] Per-source filter UI (department/medium/date range/culture/keyword/public-domain-only),
      populated dynamically from each API where possible
- [ ] Port Met Museum source into the new architecture (already implemented in
      `build.py`/`fetch.py`/`images.json` — reuse scoring/backward-compat logic)
- [ ] Local file folder source (File System Access API on web; Android storage picker
      later in the Capacitor phase); filename fallback when no metadata
- [ ] **Checkpoint: pause for manual testing**

## Phase 4 — More public API sources (all keyless ones first)
- [ ] Art Institute of Chicago (keyless, CORS-friendly — already prototyped in `fetch.py`)
- [ ] Wikimedia Commons (keyless)
- [ ] Smithsonian Open Access — `[!]` needs an API key from Alex (api.data.gov)
- [ ] NASA Image and Video Library — `[!]` needs an API key from Alex (api.nasa.gov),
      though NASA's `DEMO_KEY` works for light testing
- [ ] Europeana — `[!]` needs an API key from Alex (pro.europeana.eu/get-api)
- [ ] Rijksmuseum — `[!]` needs an API key from Alex (data.rijksmuseum.nl), and CORS
      support needs verification — may require a tiny proxy
- [ ] **Checkpoint: pause for manual testing**

## Phase 5 — Presets
- [ ] Preset config format (bundles source + filter combinations)
- [ ] Ship curated presets: Ancient East Asian, Impressionism, Space & Nature,
      Classical Western, Modern & Contemporary
- [ ] Custom preset builder + save/load (localStorage)

## Phase 6 — Settings & offline/download support
- [ ] Full settings overlay (tap to reveal): sources, display mode, slide/transition
      duration, metadata toggle, shuffle vs sequential, download content
- [ ] Local image cache (IndexedDB or Cache API) for offline playback
- [ ] "Download content" action — fetch a batch from enabled sources to local storage
- [ ] Cached-vs-network indicator per image
- [ ] Preserve backward compatibility with the existing `~/art_app/images/` +
      `images.json` layout for the Termux/kiosk transition period

## Phase 7 — Google Photos integration
- [ ] `[!]` Needs a Google Cloud OAuth client ID from Alex (Google Photos Picker API)
- [ ] OAuth flow (one-time auth)
- [ ] Album picker, selected albums feed into the playlist rotation

## Phase 8 — Android app (Capacitor)
- [ ] Capacitor project scaffold wrapping the web app
- [ ] Android storage permissions + local folder picker
- [ ] `[!]` Needs Android SDK / a device or emulator on Alex's machine to build & test —
      cannot fully verify from this environment
- [ ] Fully Kiosk Browser parity check (or Capacitor equivalent kiosk mode)

## Phase 9 — Polish
- [ ] Performance guardrails: detect low-powered devices, degrade fancy transitions
- [ ] Accessibility pass (contrast, reduced-motion preference)
- [ ] README with setup/run/deploy instructions
- [ ] `[!]` Push to `github.com/alexkrewson/art_app` — needs Alex to confirm the remote
      exists / provide push access before I push

---
## Notes / decisions log
- 2026-07-18: Starting fresh in `/home/alex/apps/art` (was not a git repo). Keeping
  `kiosk.html` and Python scripts as a committed baseline snapshot for reference/rollback
  rather than deleting them outright.
- 2026-07-18: Downloaded image binaries (`images/`, `images_captioned/`, ~177MB) are
  gitignored — they're regenerable cache data, not source, consistent with the new
  app's own offline-download model. `images.json` (the manifest) stays tracked.
- 2026-07-18: Alex asked to pause for manual testing after each major phase rather than
  running straight through to the end — checkpoints added above accordingly.
