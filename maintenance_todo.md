# SlowFrame — Maintenance / Build TODO

Living checklist for the SlowFrame rewrite (successor to `kiosk.html`). Updated and
checked off as work completes, with a git commit per completed step, so progress
survives a crash or restart. See original spec pasted into the conversation on
2026-07-18 for full feature detail.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked (needs input from Alex)

---
## Where things stand (updated 2026-08-13)

**Live site:** https://alexkrewson.github.io/art_app/ (auto-deploys on push to `main`)
**Repo:** https://github.com/alexkrewson/art_app

### Session log

Alex tracks time spent on this project through the commit history, so each
working session starts with a dated marker commit.

- **2026-08-13** — start. On-device testing of the two remaining keyless
  sources, Met and AIC. Everything else keyless (Wikimedia, Openverse, NASA)
  is already verified on hardware; NPS, Flickr, Smithsonian, Europeana and
  Rijksmuseum all set `needsApiKey: true` and cannot be tested without
  credentials. Local Folder needs a folder picked on the device itself.

### The three tablets, and what is outstanding on each

All three are on **versionCode 75** (`v75.87928f7`) as of 2026-08-10, with
30s dwell, crossfade, bundled starter pack off, ribbon on and voting on.
Identify by serial, not by model — two of them report model `Star8`.

| Serial | Alex calls it | Library | Outstanding |
| --- | --- | --- | --- |
| `DJJYHHEU91` | the NASA tablet | 1698 images, 8 Openverse + 10 NASA | nothing |
| `N3XGBIPCHP` | the Openverse tablet | 721 images, 8 Openverse | **top-up owed** |
| `CP80A142320800171` | CP80 | 620 images, 6 Wikimedia | nothing |

**Standing instruction from Alex (2026-08-10): next time `N3XGBIPCHP` is
plugged in, bump it AND run the Openverse top-up.** It holds 721 against a
target of 800. The shortfall is the old per-query ceiling — Openverse caps an
anonymous caller 240 results deep *per query* and repeats heavily inside that
window, so one broad term topped out near 40-80 unique. Splitting each subject
into narrower `~`-separated queries fixed it, but only for new downloads;
existing libraries do not benefit retroactively. Re-downloading each category
de-duplicates against what is held and keeps upvotes, so a top-up accumulates
rather than churning.

### The app was substantially rebuilt on 2026-08-08/09. Read this before the phase list below, which describes the older design.

**Playback is download-first.** Ticking a category in Sources downloads it to the
device; the slideshow only ever plays images already stored locally and never
fetches while running. Alex's reasoning, and it was right: everything shown has to
be downloaded anyway, so fetching mid-slideshow only makes timing unpredictable
and spends someone's mobile data unasked. `src/library/library.js` owns the
downloaded set; `src/cache/fileStore.js` writes real JPEG files via
`@capacitor/filesystem`, fetched through `CapacitorHttp` (the native stack, not
subject to CORS).

**The old Cache-API + service-worker approach is gone.** A service worker cannot
register inside Capacitor's WebView, so image bytes stored as opaque responses
could never be served back — "downloaded" meant files the app couldn't display.
`imageCache.js` is deleted; `sw.js` remains for app-shell caching on the *web*
build only and registration is gated to non-native.

**The engine was rewritten** (`src/engine/slideshow.js`). One sequential async
loop — dwell, load, decode, transition, repeat — replacing a setInterval racing
an async chain reconciled by `inFade`/`loading`/`pendingFinish` booleans. Ken
Burns and every transition now animate via the Web Animations API on the
compositor rather than from JS on the main thread. That combination is what fixed
the choppiness and skipping Alex reported against the kiosk.html-derived design.

**Settings** are full-screen tabs (not accordions), Sources is one collapsible row
per source with All/None, unticking *hides* while a bin button deletes, and there
are thumbs up/down controls plus per-category refresh.

**Testing:** `npm test` — 178 Vitest tests. Sources (mocked `fetch`, one file per
adapter), the library against a real fake-indexeddb, the playlist manager, the
settings store, the ribbon, every transition's contract, and the engine's advance
cycle. **Still not covered:** the settings-panel DOM itself. Every bug found on
2026-08-09 was found by running the app, not by the suite.

### Driving a device directly (this is the good loop)

A debug build exposes a WebView debugging socket. With a tablet plugged in:

```
adb -s <serial> install -r android/app/build/outputs/apk/debug/app-debug.apk
adb -s <serial> shell cat /proc/net/unix | grep -o "webview_devtools_remote_[0-9]*"
adb -s <serial> forward tcp:9222 localabstract:<socket>
curl -s localhost:9222/json          # -> webSocketDebuggerUrl
```

Then a Node script (Node 22 has a global `WebSocket`) can `Runtime.evaluate`
arbitrary JS in the running app: set localStorage, tick real checkboxes through
their real handlers, read IndexedDB. Install-configure-inspect takes seconds and
found five bugs in one evening that 190 passing tests did not.

**A second measurement trap, same family.** Do not put a long `await sleep(...)`
*inside* a single `Runtime.evaluate` to watch the slideshow advance. A 36s
in-page wait reported the image as unchanged on N3XGBIPCHP and looked exactly
like a stall -- but polling the same tablet once a second from Node showed
crossfades at t=4s, 33.6s and 64.2s, a clean 30s cadence. A long-running
awaited promise inside an evaluate suspends the page's own timers, so the
slideshow really does freeze, but only for the duration of the measurement.
It is not deterministic -- the identical probe on DJJYHHEU91 advanced fine --
which makes it worse, not better. Keep the waiting in Node and ask the page
only short synchronous questions. `scratchpad/poll.mjs` does this.

**A measurement trap that caught me out:** do not sample the ribbon *title* to
check whether the slideshow is advancing. NASA has hundreds of images titled
"International Space Station (ISS)" and Openverse hundreds called "Aurora
borealis", so the caption can sit unchanged for minutes while the picture
changes every slide. Sample the visible `<img>`'s `src` instead.

**A wrong conclusion, recorded so it isn't repeated.** An earlier version of
this file claimed adb serials on these Star8 tablets were unstable, and that
`DJJYHHEU91` and `N3XGBIPCHP` were one device reporting two serials. That is
false. They are two physically different tablets: on 2026-08-10 `N3XGBIPCHP`
held 722 images (Openverse only) while `DJJYHHEU91` held 1,698 (Openverse plus
NASA), and one device cannot hold two different libraries.

The actual explanation is duller: Alex had been clicking around in the new
settings UI and had ticked Openverse categories on the second tablet himself.
The reasoning error is the part worth keeping — an unexpected library turned up,
a plausible technical story was invented to explain it, and Alex was asked to
make a decision resting on that story. The disconfirming check ("does the
library follow the serial?") was a single command and wasn't run. Two Star8
tablets with the same model string and build fingerprint is not evidence of a
serial collision.

### Devices currently configured

| Device | Content | Settings |
|---|---|---|
| CP80 (Android 14) | all 6 Wikimedia Commons categories | 5s slides, 2000ms crossfade |
| Star8 (Android 12) | Openverse (725) + NASA (976), bundled set off | 10s slides, random transitions |

Sideloading on the Star8 needed Play Protect's install verifier disabled
(`settings put global package_verifier_user_consent -1`) — its APK Analysis scan
took 15s and errored, and the GUI installer blocks on that while `adb install`
does not. Installing over adb sidesteps it entirely.

### Next up

1. **Nobody has used the settings UI by hand** since it became tabs. Voting has
   never been used at all — not by Alex, not by me. The logic beneath it is
   tested; the buttons are not.
2. Google Photos (Phase 7) — still needs an OAuth client ID.
3. A release keystore, which would also stop Play Protect treating every build as
   an unknown stranger.
4. `rclone`'s shared Google Drive `client_id` retires during 2026; the upload
   script needs Alex's own before then.

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
- [x] **2026-07-30: keyboard shortcuts** (`src/main.js`) — Space pauses/resumes,
      Left/Right arrows step prev/next (mirrors the swipe gestures), S jumps
      straight to Settings (pausing first if needed). Ignored while a settings
      field has focus, so typing behaves normally there. Also: the gear icon
      now appears at the cursor's last known position instead of a fixed
      corner, and the Settings panel itself opens centered on that position
      instead of always screen-centered (both clamped on-screen) — Alex asked
      for this after finding the fixed gear required too much mouse travel.
      Verified live: typed "star wars" into a settings field and confirmed
      none of the shortcuts fired; simulated mousemove + pause and confirmed
      both the icon and panel repositioned to center on the simulated point.
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
      **2026-07-29: found and fixed a real auto-advance stall.** Alex set slide
      duration to 1s and the slideshow never advanced again (Ken Burns kept
      panning on one image forever). Root cause: transition duration (up to
      6000ms) was never bounded relative to slide duration — a transition
      that outlasts the slide interval it's meant to run within causes the
      *next* auto-advance tick to get silently dropped by `loadAndShow`'s
      `inFade` guard, so advancing appears to stall until the pending
      transition happens to finish. Fixed by capping transitionMs at half the
      slide interval whenever slide duration changes, and — per Alex's own
      framing that a transition/pan with too few frames left just reads as a
      flicker, not motion — added a `MIN_ANIMATED_SLIDE_MS` (400ms, ~24
      frames at 60fps) floor in `slideshow.js`: at or below it, Ken Burns and
      transitions are skipped entirely for an instant cut instead. Also
      lowered the slide-duration field's floor from 3s to 0.1s (Alex wanted
      to be able to try an intentionally-extreme fast mode). Verified live at
      0.1s: advances continuously with no stall and no Ken Burns motion;
      confirmed default-range durations still pan/transition unchanged.
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
      **2026-07-30:** bumped the per-source fetch count from each source's own
      default of 24 to 60 (`FETCH_COUNT` in manager.js) — Alex wanted more
      variety per session. Verified live: AIC/NASA/Wikimedia (via its category
      checkboxes) all reach the full 60; Met came back at 48/60 in one live
      test due to some individual object-detail fetches hitting transient
      anti-bot blocking on this sandbox's IP (same issue noted earlier this
      session, not a regression) — the existing per-candidate resilience just
      yields somewhat fewer than the target rather than failing outright.
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
- [x] **2026-08-08: three photography sources added** (Alex asked about using
      subreddits like r/EarthPorn; that's not redistributable — see the decisions
      log — so this is the legal route to the same look):
      - **Openverse** (`openverse.js`) — keyless, CORS-open aggregator over
        Flickr (~536M), iNaturalist (~266M), Wikimedia (~89M), Europeana and
        the museums, with a machine-readable licence per record. Gated to
        `license_type=commercial,modification`, which leaves CC0 / PDM /
        CC BY / CC BY-SA. **The one live source that's safe in a distributed
        APK**: its limits are per-IP (20/min, 200/day), not per-key, so it
        has none of the shared-baked-in-key problem. Anonymous callers are
        capped at `page_size` 20 and 240 results deep — both measured, both
        encoded in the adapter, which picks a random page inside that window
        so the pool over time is 240/subject rather than the same top 20.
      - **NPS** (`nps.js`) — US National Park Service gallery, ~205k assets.
        Uses the same api.data.gov key as Smithsonian. Every asset carries a
        blanket `copyright` warning (the gallery mixes staff and donated
        work), but also a machine-readable `constraintsInfo`; the adapter
        requires `constraint: "Public domain"` AND `grantingRights: "Full"`.
        Serves `/proxy/hires` (~220KB) rather than the ~2MB original.
      - **Flickr** (`flickr.js`) — built, registered, and `[!]` **unusable for
        now**: Flickr disabled API-key creation for free accounts partway
        through this work ("API key creation is available to all Flickr PRO
        subscribers"). Left in place rather than deleted — it's complete and
        tested, and needs only a key if Alex ever takes a PRO subscription.
        Licence allowlist is IDs 4/5/7/8/9/10, excluding All Rights Reserved,
        every NonCommercial licence, and every NoDerivatives licence (Ken
        Burns crops, so ND doesn't apply cleanly). No practical loss meanwhile:
        Openverse indexes Flickr's CC pool without a key.
      - **Wikimedia Commons** gained Landscapes / Mountains / Forests /
        Waterfalls checkboxes, browsing Commons' own peer-reviewed "Featured
        pictures of X" + "Quality images of X" tiers. One checkbox may now name
        several `|`-separated categories so a single tick covers both tiers.
        Category names and file counts were verified live; four that sounded
        plausible (seascapes, skies, aurorae, deserts) don't exist on Commons
        and were dropped rather than shipped as silently-empty checkboxes.
- [x] **2026-08-08: verified live end-to-end**, not just unit-tested — a Node
      script drove `fetchBatch()` against the real APIs for Openverse (subjects
      *and* free-text), NPS (via api.data.gov's public `DEMO_KEY`) and the new
      Wikimedia checkbox. All four returned their full requested count with no
      missing image/title, and the returned image URLs were then actually
      fetched: 200/206 `image/jpeg` across the board, including with a foreign
      `Referer` (so no repeat of the AIC hotlink-protection bug). 27 new unit
      tests, suite now 99 passing.
- [x] **Checkpoint: pause for manual testing — done 2026-07-29** via Playwright MCP
      against the dev server: enabled local + Met + AIC + Wikimedia + NASA
      simultaneously through the actual Settings UI (not just localStorage) and
      confirmed `buildPlaylist()` genuinely merges all five into one playlist
      (521 records: 425 local + 24 each live source) with zero console
      errors/warnings on a clean reload. This **is** the "multi-library" feature —
      it works. See decisions log for the two AIC bugs this pass found and fixed,
      and a note on Met/Smithsonian flakiness observed during testing.

## Performance — per-image payload (added 2026-08-08)

Alex on the APK: local-only at a 2s slide duration advances reliably every 2s,
but with several live sources enabled it "gets stuck" for up to ~30 seconds.
Two causes, both measured rather than guessed:

- [x] **Wikimedia was serving full-resolution ORIGINALS.** `imageinfo.url` is the
      original file, and the landscape categories added the same day are Commons'
      highest-resolution showcase images: a 10-file sample of "Featured pictures
      of landscapes" averaged **20.5 MB**, with one at **80.9 MB** (17806x6969).
      Fixed with `iiurlwidth=1920` + preferring `thumburl` — the same two files
      then come back at 1.01 MB and 0.43 MB (33x and 189x smaller). Verified live
      after the fix: the source now averages **0.30 MB** per image.
- [x] **Nothing was preloaded, and in-flight loads were being abandoned.**
      `loadAndShow` assigns `waiting.src` and waits on `onload`; a tick arriving
      while the previous image is still downloading reassigns `src`, cancelling
      that download to start another. At a 2s interval against images that take
      longer than 2s, the slideshow spends its time cancelling itself — which is
      why the bundled local set (instant, loaded from the APK) never showed this
      and every live source did. Added `Slideshow.prefetchNext()`: warms the next
      image into the HTTP cache as soon as the current one is displayed, with
      `referrerPolicy = 'no-referrer'` so AIC's hotlink protection doesn't 403 it.
      6 unit tests.

Measured per-image payload after the fixes (live, as the slideshow requests it):

| Source | avg per image | note |
|---|---|---|
| Met | 0.06 MB | `primaryImageSmall` — smallest, possibly *too* soft for a wall |
| Openverse | 0.23 MB | Flickr `_b` (1024px) and similar |
| Wikimedia | 0.30 MB | was 20.5 MB before the `iiurlwidth` fix |
| AIC | 0.24 MB | bounded IIIF `!843,843` |
| NPS | 3.30 MB | `/proxy/hires`, 1330–2714px — the heavy one, deliberately |

NPS was left on `/proxy/hires` on purpose: the smaller `/proxy/large` variant is
only ~500-680px wide (measured), which would look soft full-screen and worse
under Ken Burns zoom. Its weight is the right thing to solve with prefetching
rather than by shipping a blurry image. Note `/proxy/hires` is *sometimes*
identical to the original — it is a cap, not a guaranteed downscale.

- [ ] **Not yet checked for the same problem:** `europeana.js` uses
      `edmIsShownBy`, which is the full object rather than a preview, and
      `smithsonian.js` uses whatever `online_media` hands back. Both are still
      unverified against their live APIs, so measure their payload at the same
      time as verifying their field paths.
- [ ] Met's 0.06 MB may be too low-quality for a large display — `primaryImage`
      (the full version) is the other extreme. Worth eyeballing on the wall before
      deciding; this is a quality call, not a bug.

## Phase 5 — Presets
- [ ] Preset config format (bundles source + filter combinations) — no general
      format yet, see below
- [ ] Ship curated presets: Ancient East Asian, Impressionism, Space & Nature,
      Classical Western, Modern & Contemporary — not started
- [x] ~~One specific preset built ahead of the rest of this phase: "Sci-Fi &
      Fantasy"~~ **2026-07-29: removed.** Went through two revisions same day
      (noisy free-text search → curated-category free text → a real
      `checkboxGroup` FilterSpec with "Sci-Fi art"/"Fantasy art" checkboxes
      directly in the Wikimedia Commons section), and once the checkboxes
      existed, Alex said the Preset dropdown itself was now redundant and
      asked for it gone entirely. Deleted `src/sources/presets.js` +
      `src/sources/presets.test.js` and the dropdown/handler in
      `src/settings/panel.js` — no preset mechanism exists anymore, just the
      Wikimedia category checkboxes doing the same job directly. If Phase 5's
      general preset format ever gets built, it's starting from zero, not
      extending this.
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
- [x] **"Download content" action — built 2026-08-08.** Alex asked for the
      Spotify/YouTube shape: pick a category, take it offline before losing
      signal. New **Offline downloads** settings section listing one row per
      curated category of every *enabled* live source (local/localFiles are
      excluded — they're already offline), each with a count picker
      (25/50/100/250/500, Alex's choice over a fixed batch) and a Download
      button that shows live `42/100` progress in place of its label.
      Downloads are listed with their image counts and can be removed
      individually. `src/cache/downloads.js` orchestrates; `imageCache.js`
      gained the storage/pinning model.
      Three design points that matter:
      - **Pinned records ignore the 300-image `SOFT_CAP`.** That cap now
        governs *incidental* caching only. A deliberate download must never be
        refused because background caching happened to fill a quota first.
      - **Downloads are bounded by bytes, asked of the device.** A count cap is
        meaningless at a 55x payload spread (300 images = 18 MB of Met, >1 GB of
        NPS). `navigator.storage.estimate()` gives quota; the budget is half of
        it, clamped to 200 MB–4 GB, shown as a used/total bar. Falls back to the
        floor rather than refusing everything when Storage Manager is missing.
        Note browsers pad *opaque* responses in quota accounting, so `usage`
        reads high — that's the number the browser enforces, so it's the right
        one to budget against.
      - **An image can belong to several downloads at once.** Caught by a test:
        the row key is `source::image`, so the first model silently put a shared
        image in one collection only, and removing that collection deleted bytes
        another still needed. Commons' Landscapes and Mountains categories
        genuinely overlap. Rows now carry a `collections[]` multiEntry index;
        removing a download drops the membership and only deletes bytes when the
        last one goes.
      22 new tests (11 cache, 11 downloads), suite 114 -> 133.
- [ ] **Not yet done on downloads:** no in-browser/device pass yet (the section
      renders and the logic is unit-tested, but nothing has been clicked); no
      way to refresh/top-up every download at once; and the download runs
      sequentially on purpose to avoid competing with playback, which means a
      500-image download of a heavy source is slow — worth a progress
      notification or a cancel button if that proves annoying in practice.
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
- [x] **2026-08-08: first real device install — and it immediately found a bug
      no desktop pass could.** Built the APK on Windows (needed a new
      `android/local.properties`; SDK at `%LOCALAPPDATA%\Android\Sdk`), and Alex
      installed it on his phone. The app ran, tap-to-pause worked, but **the
      settings gear was completely unreachable**: tapping it just resumed
      playback. Root cause: `#settings-gear` is a child of `#stage`, and
      `touch.js`'s `touchstart`/`touchend` handlers called `e.preventDefault()`
      unconditionally on everything that bubbled to them. `preventDefault()` on
      `touchend` suppresses the synthetic `click`, so the gear's own listener in
      `main.js` never fired, and the stage's tap handling then ran
      `togglePause()` — hiding the gear again. It worked under a mouse the entire
      time because a mouse click fires no touch events at all, which is why every
      desktop and Playwright pass missed it. Fixed by exempting
      `#settings-gear` from the three touch handlers. Second, smaller bug in the
      same report: the gear rendered dead centre over the artwork, because
      `lastMouse` only ever updated on `mousemove` and a touch device never fires
      one — now also tracked from `touchstart`, so the gear appears where you
      tapped. `src/engine/touch.test.js` is new (7 tests, the first engine tests
      in the project): verified they genuinely catch it by reverting the fix and
      confirming 3 fail. Suite 99 → 106.
      **Lesson worth keeping: the emulator/desktop cannot catch this whole class
      of bug.** Anything involving `preventDefault` on touch, synthetic clicks,
      or the absence of a cursor only shows up on real hardware.
- [x] **2026-08-08: the Gradle auto-upload hook does not work** — and fails
      silently, which is worse than not existing. `afterEvaluate` iterates
      `assembleDebug`'s `t.outputs.files` looking for a `.apk`, but under this AGP
      version `assembleDebug` is a lifecycle task whose outputs don't include the
      APK, so the `doLast` loop matches nothing and no-ops. `BUILD SUCCESSFUL`
      therefore reads as "uploaded" while `AndroidBuilds/art/` stays empty —
      confirmed by checking Drive after a green build. Worked around by calling
      `bash android/upload-apk.sh <apk>` directly (verified landed: byte sizes
      match, 104,993,347 both ends). `[ ]` **Not yet fixed** — the fix is to read
      the APK path from the variant's artifact provider instead of
      `t.outputs.files`. Also note `rclone` now warns on every call that its
      shared Google Drive `client_id` retires during 2026, as predicted on
      2026-07-29; it needs Alex's own client_id before then.
- [x] **2026-08-08 (same day): fixed, and the fix promoted to `apps-shared`.**
      It turned out `argument_mapper` had already hit this exact bug and fixed
      it — its `build.gradle` even carries a "Do NOT go back to iterating
      t.outputs.files" comment — but the knowledge lived only in that project,
      so this repo had no way to inherit it and rediscovered it the hard way.
      That's the actual gap, and it's now closed: the uploader lives at
      `apps-shared/scripts/upload-apk.mjs` (generalised with `--dest` and
      repo-root detection), `best-practices.md` gained a "Shipping an Android
      build" section with the canonical snippet, and this project's
      `android/upload-apk.sh` is deleted. Verified end-to-end with a real
      `assembleDebug`: `upload-apk: uploading … to gdrive:AndroidBuilds/art/
      app-debug-v1-20260808-1423-964164d-dirty.apk` → `uploaded`. Uploads are
      now named with versionCode + timestamp + short sha (+ `-dirty`), which
      fixes the *other* problem today exposed — two different builds both called
      `app-debug.apk`, distinguishable only by byte count.
      Hardening added beyond argument_mapper's version: a missing uploader
      script logs an error rather than skipping silently, and `exec` is wrapped
      in try/catch because `ignoreExitValue` covers a non-zero exit but **not** a
      missing executable — without it, "no node on PATH" would fail the entire
      build over an optional upload. New `.doctor.json` (7 checks, all passing)
      declares node/python/rclone/JAVA_HOME/local.properties so a machine is
      checked before a 20-minute build finds out.
      `argument_mapper` deliberately left alone — nothing broken there and a Play
      Store submission was mid-flight; a dated migration note is in its
      `maintenance_todo.txt`.
- [ ] `[!]` Still needs a wider device pass — the app launches and runs, but only
      pause/resume, the gear and Settings have actually been exercised on hardware
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
- 2026-08-08: Alex asked whether subreddits (r/EarthPorn was the example) could
  be an image source for the Android app. Answer was no, on three independent
  grounds, and the first is the one that actually decides it:
  - **Copyright.** Reddit doesn't own the photos; the posters do. Reddit's User
    Agreement licenses content to *Reddit*, and that doesn't flow to a
    third-party app. Every other source in this project can answer "what licence
    is this image under?" per-image — that's the whole architecture, from Met's
    public-domain filter to wikimedia.js' allowlist. Reddit can't answer it at
    all. A full-screen slideshow with no attribution, no link back and no
    subreddit context is also about the weakest fair-use posture available.
  - **API terms.** Free tier is non-commercial only at 100 QPM per OAuth client
    ID; commercial needs manual approval at $0.24/1K calls, with the real
    commercial tier starting around $12k/month. A single client ID baked into a
    distributed APK is shared and extractable — the same objection already
    logged against shipping a personal api.data.gov key. Reddit also began
    403ing all unauthenticated requests in late May 2026, so the old `.json`
    trick is dead. And Phase 6's offline cache would be storing content Reddit's
    terms require us to drop on deletion.
  - **Play Store.** Reddit content is UGC, which pulls in the moderation/
    reporting/blocking requirements; even well-modded SFW subs surface shock
    content before mods catch it.
  Built the legal equivalent instead (see the Phase 4 entry above). Also ruled
  out **Unsplash and Pexels** despite their permissive *image* licences: both
  API guidelines specifically prohibit replicating their core experience, and
  Unsplash names wallpaper apps as the example — "a wallpaper app returns
  Unsplash images for downloading. Without the integration, the app has no
  content and no value to users." SlowFrame is exactly that shape. Don't
  revisit these two without re-reading their guidelines first.
- 2026-08-08: two things worth knowing before tuning the new sources:
  - The Wikimedia landscape categories are overwhelmingly CC BY-SA, so the
    metadata ribbon will show a credit line on nearly every slide from them —
    correct behaviour, not a bug, but it looks different from the museum
    sources where most images are public domain and the ribbon stays clean.
  - Openverse **free-text** search has the same weakness the Commons free-text
    search turned out to have on 2026-07-29: querying "glacier" returned NPS
    documentary snapshots (a plant nursery, a ranger portrait) alongside
    scenery, because relevance search has no concept of "is this a landscape".
    The curated subject checkboxes are the good path and are what the source
    defaults to; free text is the escape hatch, not the headline feature.
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
