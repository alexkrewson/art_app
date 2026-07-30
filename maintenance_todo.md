# SlowFrame — Maintenance / Build TODO

Living checklist for the SlowFrame rewrite (successor to `kiosk.html`). Updated and
checked off as work completes, with a git commit per completed step, so progress
survives a crash or restart. See original spec pasted into the conversation on
2026-07-18 for full feature detail.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked (needs input from Alex)

---
## Where things stand (updated 2026-07-26, working tree ahead of the last commit
## `47f6f06` — see note below)

**Live site:** https://alexkrewson.github.io/art_app/ (auto-deploys on every push to
`main` via GitHub Actions — no manual deploy step needed anymore)
**Repo:** https://github.com/alexkrewson/art_app

**Testing:** see `/home/alex/apps/shared/testing-guidelines.md` for the shared
rulebook (Smoke / Thorough / Costly tiers) — this project doesn't duplicate it.
Conditional sections that apply here: "Third-party API integrations without AI
cost" (all the museum/archive sources — exercise live by hand occasionally, never
in a tight automated loop) and "Offline / local-only mode" (Phase 6 caching is
exactly this — mocked IndexedDB/Cache API is the Thorough tier's foundation for it).
`npm test` runs the automated Thorough-tier suite (Vitest): 68 tests across sources
(mocked `fetch`, one file per API adapter), the playlist manager (mocked
registry/cache, covers merge/fallback/offline/failure paths), the settings store,
and the offline cache (mocked Cache API + real `fake-indexeddb`). **Not yet
covered:** the DOM/canvas-heavy engine (Ken Burns, touch gestures, transitions) and
the settings-panel UI itself — those still rely on manual Smoke/Thorough passes via
Playwright MCP against the live site, per the shared doc's guidance that UI
click-through is the manual fallback where no automated suite exists yet.

**Done — Phases 0 through 3:** project scaffold (Vite, vanilla JS), the full
kiosk.html engine ported (Ken Burns, touch gestures, metadata ribbon), GitHub Pages
live deploy, the shared Ember/light theme + settings menu (Themes, About, Help),
display modes (Ken Burns/Static/Fade Only), a 10-transition pluggable transition
engine, and a multi-source image architecture with a **live** Met Museum API source
(department/keyword/medium/date filters), the original local starter set, and a
local-folder source (Chrome/Edge only).

**Done but uncommitted — Phase 4, part of Phase 5, Phase 6, Phase 8 scaffold:** a
prior session built all six remaining Phase 4 sources (AIC, Wikimedia Commons, NASA,
Smithsonian, Europeana, Rijksmuseum — see per-phase detail below), the one-off
"Sci-Fi & Fantasy" preset (`src/sources/presets.js` — not the full Phase 5 builder),
Phase 6's offline image cache (`src/cache/imageCache.js` + `public/sw.js` service
worker, gated by a new "Cache images for offline use" setting), and a Phase 8
Capacitor Android project scaffold (`android/`, `capacitor.config.json`,
`npm run cap:sync`/`cap:open:android`) — all still sitting as uncommitted working-tree
changes, without having gone through their manual-testing checkpoints. This session
added the automated test coverage above and verified `vite build` + the full
`npm test` suite pass, but has **not** done a live/browser pass on any of it yet.

**Known gaps, already flagged rather than hidden:**
- 4 of 7 "atmospheric" transitions (Burn/Dissolve/Shatter/Ripple) fall back to
  Crossfade — a good version of each needs canvas/WebGL, not yet built
- "Random" transition mode cycles *all* implemented transitions, not a
  user-chosen enabled subset (spec describes the latter)
- Smithsonian/Europeana/Rijksmuseum sources are built against documented API shapes
  but **not yet verified against the live APIs** (no keys available while building)
  — re-check field paths once real keys are in hand
- Rijksmuseum's CORS support from a browser origin is unconfirmed; may need a small
  proxy in front of it
- The uncommitted Phase 4/6/8 work above hasn't had its manual checkpoint yet

**Next up, in order:**
1. Commit the uncommitted Phase 4/6/8 work (logical chunks: sources, caching,
   Android scaffold) and run the Phase 4/6 manual-testing checkpoints that never
   happened
2. Phase 5: the real curated-preset set + custom preset builder (save/load) —
   currently only the one "Sci-Fi & Fantasy" preset exists
3. Phase 7: Google Photos — `[!]` needs a Google Cloud OAuth client ID from Alex
4. Finish Phase 8: Alex needs to actually build/run the Android scaffold on his own
   machine (Android SDK/device) — can't be verified from this environment
5. Phase 9: polish (perf guardrails, accessibility pass, README)

**How to resume a session on this:** read this summary, then skim the decisions log
at the bottom for anything non-obvious, then check `git status` and `git log
--oneline -10` against the phase checkboxes above to confirm nothing's drifted out
of sync — this doc has fallen behind the working tree before (see the 2026-07-26
note above), so don't trust the checkboxes blindly.
---

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
- [x] `ImageSource` interface documented in `src/sources/base.js` (id, label, needsApiKey,
      description, listFilters(), fetchBatch({filters,count})); `ImageRecord` shape
      matches what Slideshow already expects (title/artist/date/department/image/source)
- [x] Source manager (`src/sources/manager.js`): merges enabled sources' `fetchBatch()`
      results; a single source failing (network error, bad filters) is caught and
      logged rather than crashing the slideshow — this runs unattended, one flaky API
      shouldn't take the display down; falls back to the local starter set if every
      enabled source returns nothing. `orderPlaylist()` handles shuffle/sequential.
- [x] Met Museum source (`src/sources/met.js`) is now a **live** API source, not the
      static snapshot — verified directly against the real API (CORS confirmed open:
      `Access-Control-Allow-Origin: *`; confirmed `/search` 502s without a `q` param,
      so empty keyword sends `q=*`). Filters: department (dynamically populated from
      `/departments`, live), keyword, medium, date range, public-domain-only (checked
      client-side per object since it's not a dedicated search param). Fetches search
      → samples random objectIDs → fetches object details at concurrency 5 → filters
      to public-domain + has-image. Ran a real end-to-end Node test (not just syntax
      check) — see decisions log.
- [x] `localManifest.js` wraps the existing bundled `public/images.json` +
      `public/images/` as its own source (id `local`, enabled by default) — this IS
      the backward-compatible local file structure the spec asks for, and the
      zero-network fallback if every live source is disabled/offline.
- [x] Local folder source (`src/sources/localFiles.js`): File System Access API
      (`showDirectoryPicker`), Chrome/Edge only — feature-detected (`.supported`),
      settings UI disables the picker with an explanatory note on unsupported browsers
      (Firefox/Safari) rather than showing a button that would throw. No metadata,
      filename fallback per spec.
- [x] Sources settings section is now fully functional: enable/disable checkboxes for
      all 3 sources, Met filter fields (department select, keyword, medium, date
      range, public-domain-only), "Choose folder…" button, sequential/shuffle radio.
      Changing anything rebuilds the playlist live via `slideshow.setPlaylist()` — no
      reload needed.
- [x] Verified: `node --check` on every file, `vite build`, dev-server route checks,
      AND a real Node script exercising `metSource.fetchBatch()` against the live API
      (returned 6/6 valid records with real image URLs) and `buildPlaylist()`/
      `orderPlaylist()` end-to-end. Have NOT visually confirmed the Sources settings
      UI itself in a browser (no browser access this session) — that's the main thing
      to check at the checkpoint below.
- [ ] **Checkpoint: pause for manual testing** — please try enabling Met Museum with a
      few different filter combos, and if you're on Chrome/Edge, try "Choose folder…"
      with a local folder of images

## Phase 4 — More public API sources (all keyless ones first)
- [x] Art Institute of Chicago (keyless, CORS-friendly — verified against the live
      API; client-side date/public-domain/has-image filtering, same pattern as Met).
      **2026-07-29: two live-browser bugs found and fixed** — see decisions log.
- [x] Wikimedia Commons (keyless; free-text search doubles as the "Sci-Fi & Fantasy"
      preset's mechanism — no dedicated genre API exists, see `presets.js`)
- [x] Smithsonian Open Access — built against the documented API shape, `[!]` **not
      yet verified live** (no key available while building; re-check field paths,
      especially the media-type/rights paths, once a real key is in hand)
- [x] NASA Image and Video Library — verified live; the `images-api.nasa.gov` search
      endpoint turned out to be keyless/CORS-open (unlike api.nasa.gov), so no API
      key field was needed after all
- [x] Europeana — built against the documented API shape, `[!]` **not yet verified
      live** (no key available while building; re-check `edmIsShownBy`/`edmPreview`
      and the rights-filter syntax once a real key is in hand)
- [x] Rijksmuseum — built against the documented API shape, `[!]` **not yet verified
      live**, and CORS support from a browser origin is still unconfirmed — may need
      a tiny proxy
- [x] Automated coverage: `src/sources/*.test.js` mocks `fetch` for all eight
      sources (record shape, filtering/gating logic, param building) — see
      `npm test`. This is the Thorough-tier automated substitute for exercising each
      adapter's *logic*; it doesn't replace occasionally exercising the real APIs by
      hand per the third-party-API section of the shared testing guidelines.
- [x] **Checkpoint: pause for manual testing — done 2026-07-29** via Playwright MCP
      against the dev server: enabled local + Met + AIC + Wikimedia + NASA
      simultaneously through the actual Settings UI (not just localStorage) and
      confirmed `buildPlaylist()` genuinely merges all five into one playlist
      (521 records: 425 local + 24 each live source) with zero console
      errors/warnings on a clean reload. This **is** the "multi-library" feature —
      it works. See decisions log for the two AIC bugs this pass found and fixed,
      and a note on Met/Smithsonian flakiness observed during testing.

## Phase 5 — Presets
- [ ] Preset config format (bundles source + filter combinations) — no general
      format yet, see below
- [ ] Ship curated presets: Ancient East Asian, Impressionism, Space & Nature,
      Classical Western, Modern & Contemporary — not started
- [x] One specific preset built ahead of the rest of this phase: "Sci-Fi & Fantasy"
      (`src/sources/presets.js`) — a minimal one-off `{id, label, apply(settings)}`
      shape, not the general format/builder above. Covered by
      `src/sources/presets.test.js`. **2026-07-29: reworked after a live-testing
      pass found two real problems** — see decisions log. Now browses two
      curated Commons categories (`Category:Science fiction art`,
      `Category:Fantasy art`) instead of a noisy free-text search, and
      `wikimedia.js` filters out anything outside a Public
      domain/CC0/CC-BY(-SA) license allowlist and shows attribution in the
      metadata ribbon when a license requires it. Same fix applies to
      Wikimedia used standalone (not just via this preset), since the license
      mix issue isn't preset-specific. **Same day, follow-up:** Alex pointed
      out the Preset dropdown was a confusing way to reach this (it's a
      one-shot trigger that resets to blank right after applying, no
      persistent indication of what's on) and asked for the two categories
      to be directly toggleable in the Wikimedia Commons section instead.
      Added a `checkboxGroup` FilterSpec type (`src/settings/panel.js`) —
      one checkbox per option, stored as an array — and exposed "Sci-Fi art"
      /"Fantasy art" as real checkboxes there; checked boxes take priority
      over the free-text field, which still supports manually typed
      Category: browsing as a fallback. The preset button still exists as a
      shortcut (ticks both + enables NASA) but the checkboxes are now the
      primary, always-visible way to use this. Verified live: check/uncheck
      each box, confirmed the stored filter array and the real merged
      playlist both update correctly.
- [ ] Custom preset builder + save/load (localStorage)

## Phase 6 — Settings & offline/download support
- [x] Offline image cache (`src/cache/imageCache.js`): Cache API for image bytes +
      IndexedDB for metadata, a 300-image global soft cap, and a new "Cache images
      for offline use" setting (`cacheEnabled`, default on) wired through
      `manager.js`'s `buildPlaylist()`. Requires `public/sw.js` (a hand-written
      service worker, registered from `main.js`) to actually serve cached images
      offline — most museum CDNs don't send CORS headers, so cached bytes are opaque
      `no-cors` responses that only a service worker (not page JS) can hand back to
      the browser's image loader. Also makes the app shell itself
      (index.html/JS/CSS) reloadable with zero connectivity.
- [ ] "Download content" action — fetch a batch from enabled sources to local storage
      on demand (distinct from the automatic background caching above) — not started
- [ ] Cached-vs-network indicator per image — not started
- [x] Backward compatibility with `~/art_app/images/` + `images.json` preserved —
      `localManifest.js` still wraps them as the zero-network fallback source
- [x] Automated coverage: `src/cache/imageCache.test.js` (mocked Cache API + real
      `fake-indexeddb`) covers cache/retrieve/dedupe/soft-cap/clear and a fetch
      failure — see `npm test`.
- [x] **2026-07-29: found and fixed a real standing bug** — `sw.js`'s shell
      cache was cache-first for `index.html` under a hardcoded, never-bumped
      cache name. Since `sw.js`'s own bytes don't change on a normal app
      deploy, the browser never even detects a new service worker version
      to install, so a returning visitor's cached shell never refreshes —
      every deploy after someone's first visit was invisible to them,
      forever, until they manually cleared it. This is exactly what bit
      Alex: a real, verified-successful deploy still showed the old UI.
      Fixed by making the shell HTML network-first (falls back to cache
      only offline); hashed JS/CSS/image assets stay cache-first since
      those filenames are immutable per-deploy. Verified against a real
      built preview server: simulated a redeploy by editing built
      `index.html` without touching `sw.js`, confirmed a reload picked up
      the new content, then killed the server entirely and confirmed the
      offline fallback still served that fresh copy (not a stale one).
      Anyone with the old service worker already installed (i.e. Alex,
      right now) needs one hard refresh / tab close-reopen to pick up this
      specific fix; after that, normal reloads should reflect deploys again.
- [ ] **Checkpoint: pause for manual testing** — still outstanding, in particular
      confirming the service worker actually serves images offline in a real browser
      (this can't be verified without one)

## Phase 7 — Google Photos integration
- [ ] `[!]` Needs a Google Cloud OAuth client ID from Alex (Google Photos Picker API)
- [ ] OAuth flow (one-time auth)
- [ ] Album picker, selected albums feed into the playlist rotation

## Phase 8 — Android app (Capacitor)
- [x] Capacitor project scaffold wrapping the web app: `capacitor.config.json`
      (`webDir: 'dist'`), full `android/` Gradle project, `npm run cap:sync` /
      `cap:open:android` scripts, `.gitignore` updated for Android build artifacts
      and keystores. Not yet committed.
- [ ] Android storage permissions + local folder picker — not started (the existing
      `localFiles.js` source is File System Access API, browser-only; Android needs
      its own native-ish equivalent)
- [x] **2026-07-29: verified an Android SDK + `adb` already exist on this machine**
      (`~/Android/Sdk`, `android/local.properties` already pointed at it) — ran
      `npm run cap:sync` then `./gradlew assembleDebug` for real and it produced an
      installable `android/app/build/outputs/apk/debug/app-debug.apk` (~101MB, mostly
      the bundled local starter images). `BUILD SUCCESSFUL`. Not yet installed on a
      device/emulator to confirm it actually runs — that's the remaining gap, not the
      Gradle build itself.
- [ ] `[!]` Still needs a device or emulator to confirm the installed app actually
      launches/runs correctly — the build succeeding is necessary but not sufficient
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
- 2026-07-18: Phase 3 makes the Met Museum source genuinely live (browser calls
  collectionapi.metmuseum.org directly at runtime) rather than only reading the
  committed snapshot from Phase 1.5. Kept `local` (the committed snapshot) enabled
  by default alongside it — it's still the zero-network fallback for offline/kiosk
  use, and `manager.js` falls back to it automatically if every enabled live source
  comes back empty. Deliberately didn't add request throttling beyond a concurrency
  cap of 5 for object-detail fetches — a slideshow pulling ~24 images occasionally is
  not the same load pattern as `build.py`'s bulk 20k-image download (which throttles
  to ~2 req/sec for that reason), so a stricter limit here would just be slower with
  no real benefit.
- 2026-07-26: A prior session built Phase 4 (all sources), the Sci-Fi & Fantasy
  preset, Phase 6 (caching), and the Phase 8 Capacitor scaffold in one sitting
  without committing anything or updating this doc, breaking the "commit + update
  checklist per completed step" discipline this file describes at the top. Caught
  and reconciled this session — see the "Where things stand" note above. Lesson:
  the discipline is the whole point of this doc; don't let a long session's changes
  pile up uncommitted/undocumented even when nothing's obviously broken.
- 2026-07-29: Alex asked (1) is this ready for an APK, (2) is multi-library ready.
  Investigated both live rather than trusting the doc:
  - **APK**: `vite build` → `cap sync android` → `./gradlew assembleDebug` all
    actually run on this machine (real Android SDK present) and produced a working
    debug APK. Also noticed `android/app/build.gradle` had picked up an uncommitted
    `afterEvaluate` hook (+ new `android/upload-apk.sh`) that auto-uploads every
    `assembleDebug`/`assembleRelease` output to Alex's real Google Drive via `rclone`
    — confirmed `rclone`+the `gdrive` remote are actually configured on this
    machine, so this isn't a no-op stub, it does real uploads. Ran the script once
    to check it was a safe no-op, discovered mid-transfer it wasn't, and killed it
    (confirmed no partial file was left in `AndroidBuilds/art/` on Drive). Flagging
    for Alex rather than assuming this auto-upload-on-every-build behavior is
    wanted. Also: `rclone` warned its shared Google-Drive `client_id` is being
    retired sometime in 2026 — the upload script will need Alex's own client_id
    before then if he wants to keep it.
  - **Multi-library**: confirmed via Playwright MCP against the real dev server
    (see Phase 3/4 checkpoint above) that enabling multiple sources at once
    genuinely merges into one playlist. While doing that live pass, found the
    Art Institute of Chicago source was fully broken end-to-end despite passing
    its "verified against the live API" check on 2026-07-18 — that earlier check
    only exercised the JSON search API, never actually loaded an image in a
    browser. Two distinct bugs, both confirmed root-caused with `curl` before
    fixing:
    1. AIC's Cloudflare/Cantaloupe IIIF server 403s any image request carrying a
       non-artic.edu `Referer` header (hotlink protection) — every browser sends
       one by default, so every AIC image 403'd for every user, not just this
       environment. Fixed with `referrerpolicy="no-referrer"` on the two `<img>`
       elements in `index.html` (the only place `src/engine/slideshow.js` ever
       assigns a remote URL to an `<img>`).
    2. `src/sources/aic.js` hardcoded a fixed IIIF width (`full/843,/...`), which
       Cantaloupe rejects with `ScaleRestrictedException` ("scales in excess of
       100%") for any artwork whose native width is under 843px — a large
       fraction of AIC's collection is portrait-oriented and narrower than that.
       Fixed by switching to the IIIF bounded-fit qualifier (`full/!843,843/...`),
       confirmed via `info.json` + a live fetch that it never upscales and never
       403s. Updated `aic.test.js`'s expected URL to match. All 69 tests pass.
    Also observed, but did **not** treat as a code bug: the Met Museum API
    intermittently 403'd with an Incapsula bot-challenge page during this session
    (both from `curl` and from the browser) — this looks like anti-bot rate
    limiting on this sandbox's IP, not a CORS/API regression, since a plain `curl`
    with no special headers got the same generic challenge page. Re-check on
    Alex's own network/browser before concluding Met is actually broken. Smithsonian
    still 403s in the live pass too, but that's expected — the only key configured
    was a leftover fake `test-key-123` from earlier testing, not a real key.
- 2026-07-29 (continued): Alex asked about redistribution/licensing for
  Smithsonian/Europeana/Rijksmuseum (a public Play Store release), then asked
  about the "fun" sources (Sci-Fi & Fantasy). Researched actual terms rather
  than assume:
  - Smithsonian + Rijksmuseum images are unconditionally CC0/public domain —
    fine to bundle for every user. The real constraint is each API *key*:
    api.data.gov defaults to 1,000 req/hour, so a personal key baked into a
    distributed APK would be shared (and extractable) across every install;
    Rijksmuseum's terms also require emailing website@rijksmuseum.nl at
    launch and showing in-app attribution that the app uses their API.
    Recommended pre-fetching a bundled batch (like the local starter set)
    under a personal key rather than live-fetching per end user — not yet
    built, since there's no key to test against yet.
  - Europeana is more restrictive on both axes: individual objects carry
    per-item rights (CC0 through fully rights-reserved, plus a "NoC-NC"
    non-commercial-only tier for some public-private-partnership scans), and
    Europeana's own API keys are split into "Personal" (explicitly
    non-production) vs "Project" (production-scale, requires an application
    reviewed by their team) — a Personal key is not authorized for a
    distributed app at all, regardless of the object's own rights.
  - Following up on "what about scifi/fantasy": live-tested the existing
    preset's free-text Commons query and found it already had the same class
    of problem in miniature — Commons hosts a real mix of licenses (not just
    PD, unlike the museum sources), and a plain-text search for "science
    fiction OR fantasy art" surfaced author headshots and a library-shelf
    photo alongside genuine pulp-art hits, since Commons relevance search has
    no genre concept. Fixed both: `wikimedia.js` now filters to Public
    domain/CC0/CC-BY(-SA) and shows attribution in the ribbon when required;
    the preset now browses `Category:Science fiction art` +
    `Category:Fantasy art` (confirmed live: 176 and 197 files respectively)
    instead of searching, via a new `|`-separated multi-category mode. All 72
    tests pass (69 → 72, three new cases for the license filter/attribution/
    multi-category behavior).
- 2026-07-26: Added automated Thorough-tier test coverage (Vitest,
  `/home/alex/apps/shared/testing-guidelines.md`) for everything with mockable
  logic: all 8 image sources (mocked `fetch`, one file each), the playlist manager
  (mocked registry + cache module, covers the merge/fallback/offline/single-source-
  failure paths), the settings store, and the offline cache (mocked Cache API +
  real `fake-indexeddb` for IndexedDB). 68 tests, `npm test` to run them. This is
  new infrastructure for this project — previously the only verification was
  `node --check` plus one-off Node scripts against live APIs. Deliberately did NOT
  attempt automated coverage of the engine (Ken Burns, transitions, touch gestures)
  or the settings-panel UI itself — those are DOM/canvas/animation heavy enough
  that mocking would mostly test the mocks, not the code; per the shared testing
  doc, manual Playwright-MCP passes remain the right tool there. Also deliberately
  did NOT call any live third-party API from the automated suite, per the shared
  doc's guidance on rate-limited third-party integrations — hand-verified logic
  against mocked responses instead, same as met.js/aic.js were manually verified
  against the real APIs when first built.
