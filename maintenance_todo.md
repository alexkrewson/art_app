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
- [x] `package.json` + Vite scaffold (vanilla JS, no heavy framework — keeps this close
      to the original single-file app's simplicity and easy to reason about)
- [x] Base `index.html` + CSS reset, stage/footer layout ported from `kiosk.html`

## Phase 1 — Core slideshow engine (parity with kiosk.html)
- [x] `src/engine/slideshow.js` — playback state machine (index, active/waiting slides,
      auto-advance timer, pause/resume)
- [x] `src/engine/kenburns.js` — RAF-based pan/zoom loop (ported from kiosk.html)
- [x] `src/engine/touch.js` — pinch-zoom, pan, swipe next/prev, tap to pause (ported);
      also added a plain `click` handler for mouse/desktop-browser testing
- [x] `src/ui/metadataRibbon.js` — title/artist/date footer ribbon
- [x] Wire everything together in `src/main.js` using the existing `images.json` as a
      static data source
- [x] Verified via `vite build` (no errors) and dev server HTTP checks (index.html,
      main.js, images.json, and a sample image all return 200) — no visual/browser
      confirmation yet, Claude in Chrome isn't connected this session
- [x] **Checkpoint: pause for manual testing** — `npm run dev` is running on
      http://localhost:8080 right now, ready for Alex to check in a browser

## Phase 1.5 — GitHub Pages live deploy + shared design system (added 2026-07-18,
## per Alex's request mid-build — inserted ahead of Phase 2)
- [x] Discovered `alexkrewson/art_app` already exists on GitHub (public, had one old
      "Initial art kiosk" commit) — merged that history in with `--allow-unrelated-histories`
      rather than force-pushing over it
- [x] Fix root-relative asset/data paths (`/src/main.js`, `fetch('/images.json')`) to
      relative paths, plus `vite.config.js` `base:'./'`, so the app works both at
      `/` (dev) and under the GitHub Pages project subpath (`/art_app/`) — verified
      by simulating a subpath deploy locally with `python -m http.server`
- [x] Un-ignored `/images/` (moved to `public/images/`) and committed the actual
      image binaries (425 files, ~98MB, largest <1MB) so the live page has
      something to show. Revisit once Phase 3/4 give the app live API-fetched
      sources — committed binaries are a stopgap, not the long-term plan.
- [x] Added `.github/workflows/deploy.yml` — GitHub Actions build+deploy to Pages,
      matching the shared convention ("GitHub Pages via GitHub Actions is the
      default for anything static", per `/home/alex/apps/shared/best-practices.md`)
- [x] Pushed merged history + all commits to `origin/main` (confirmed:
      `3ded4f8..d714ecb main -> main`, then the design-system commit on top)
- [ ] `[!]` Blocked on Alex: one-time manual step, since I have no GitHub API/token
      access (no `gh` CLI auth, SSH key only does git push, not repo settings) —
      go to https://github.com/alexkrewson/art_app/settings/pages and set
      **Build and deployment → Source → GitHub Actions**. Everything else is
      automated; this single toggle is the only thing I can't do myself. Once set,
      the workflow that already ran (or the next push) will publish to
      https://alexkrewson.github.io/art_app/.
- [x] Applied `/home/alex/apps/shared/css-best-practices.md` design system: Ember
      dark theme as default (CSS custom properties in `src/style.css`), explicit
      light-mode toggle via `[data-theme]` (not `prefers-color-scheme`, persisted
      to `localStorage`), system font stack, 44px `.icon-btn` touch targets,
      shared modal/settings-panel recipe. Did NOT yet wire reduced-motion → default
      display mode, since Static mode doesn't exist as a real toggle until Phase 2
      — faking it now would be misleading UI; revisit when Phase 2 lands.
- [x] Added a consolidated Settings panel (`src/settings/panel.js` + `themes.js`)
      per the shared component recipe (accordion sections, all closed by default),
      revealed via a gear icon that appears once paused (fits the app's existing
      tap-to-reveal interaction model better than a permanent header icon — there's
      no persistent chrome over the artwork during normal playback). Sections:
      **Sources** (placeholder), **Display & Transitions** (placeholder), **Themes**
      (functional: Ember/Light + swatch picker), **About** (functional: what
      SlowFrame is, Met CC0 credit, gesture guide, version/repo link), **Help**
      (functional), **Advanced** (placeholder). No **Account** section — nothing
      needs auth until Google Photos (Phase 7).
- [x] Verified with `vite build` + `node --check` on every changed module + dev
      server route checks (200s on index/main.js/panel.js/themes.js/images.json).
      Still no actual in-browser confirmation (Claude in Chrome not connected).
- [x] **Checkpoint: pause for manual testing** — live site confirmed working.
      Ken Burns motion was choppy at first; fixed a real algorithmic bug (linear
      instead of ease-in-out per segment, so motion doesn't fully stop every
      ~13s — commit f0bbae8) and forced GPU compositing (translate3d/scale3d
      instead of translate/scale — commit 267c2e4). Remaining choppiness turned
      out to be Firefox-specific (smooth in Chrome) — not pursuing further, not
      a bug in the app.

## Phase 2 — Display modes & transitions
- [x] Display mode toggle: Ken Burns / Static / Fade Only (`Slideshow.setDisplayMode` —
      Static/Fade Only both mean "no motion"; they're distinguished per the spec's own
      wording only by their default transition, both of which map to crossfade since
      that IS "a soft/clean fade" — selecting either resets the transition to crossfade
      as a convenience default, Ken Burns leaves the transition setting alone)
- [x] Transition engine: `src/engine/transitions/` registry (`index.js`), each transition
      is a `({activeEl, waitingEl, overlayEl, stageEl, durationMs, options}) => Promise`.
      Capability tiers are tagged (`css` vs `webgl`) but there's no runtime low-power
      detection/fallback yet — see the atmospheric-transitions note below, this only
      matters once those are real
- [x] Standard transitions, all implemented: Crossfade (default), Fade to black, Fade to
      white, Dip to color (user color picker in settings)
- [x] Motion transitions, all implemented: Slide (4 directions, random per-cycle unless
      pinned), Zoom through, Drift (parallax)
- [x] Transition duration + slide duration settings (number inputs, Display & Transitions
      section); "Random" transition mode cycles through all *implemented* transitions —
      NOT yet a per-transition enable/disable checklist like the spec describes
      ("cycle through all enabled ones") — Random currently means "all of them or none",
      not a customizable subset. Flagging as a known gap, not silently narrowing scope.
- [x] Atmospheric transitions: implemented 3 of 7 as CSS-only approximations (no
      canvas/WebGL needed) — **Light leak** (radial gradient bloom, screen-blended),
      **Ink wash** (circular clip-path reveal from a random point), **Curtain**
      (clip-path wipe from center). **Burn, Dissolve, Shatter, Ripple** are registered
      (show up in the picker) but `[!]` not actually built — a good version of each
      genuinely needs canvas/WebGL (burn/dissolve/shatter especially), which is a
      meaningfully bigger effort than the CSS ones. They currently fall back to
      crossfade silently. Being upfront about this rather than shipping a fake version
      that doesn't match the spec's description — revisit as a follow-up if Alex wants
      the full set.
- [x] Verified with `vite build`, `node --check` on every new/changed module, and dev
      server route checks. Still no in-browser visual confirmation of the transitions
      themselves (no browser access this session) — this is the main thing to check at
      the checkpoint below.
- [ ] **Checkpoint: pause for manual testing** — please cycle through each display mode
      and transition (Settings → Display & Transitions) and confirm they look right,
      especially the ones I couldn't visually verify myself

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
- 2026-07-18: `art_app` already existed on GitHub with one prior commit; merged
  histories instead of overwriting. Also: Alex asked to make this a live GitHub
  Pages page and to apply `/home/alex/apps/shared/` conventions (design system,
  hosting-via-Actions default, settings-menu recipe) going forward — see Phase 1.5.
  Did not edit `/home/alex/apps/shared/best-practices.md`'s project table (it still
  lists `art` as "Python build scripts, static HTML" / no hosting) since that's a
  separate repo Alex may want to update himself — flagged in my reply instead.
