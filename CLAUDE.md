# art_app — notes for future sessions

Read the shared conventions first: `CHANGELOG.md`, then `best-practices.md`,
`css-best-practices.md` and `testing-guidelines.md`. They live in the
`apps-shared` repo — `../apps-shared/` here, `/home/alex/apps/shared/` on the
Ubuntu box, otherwise `github.com/alexkrewson/apps-shared`. Say "sync shared"
to have them re-applied to this project.

## Stack

Vite + Capacitor (Android), plus Python build scripts at the repo root:
`fetch.py` (needs `requests`), `add_captions.py` (needs `Pillow`), `build.py`.

No `.env` — the only env vars referenced are Vite built-ins (`BASE_URL`, `PROD`).

## Curation

`curate/` reviews the free sources by hand and produces `public/approved.json`
(the allowlist Openverse, Commons and NASA download from) and
`public/blocklist.json`. Status and how to ship it are in
`maintenance_todo.md` under "Curation". Read
`curate/README.md` before touching it — particularly the reason `harvest.mjs`
imports the app's own `toRecord()` rather than reimplementing it.

```bash
node curate/harvest.mjs · python curate/download.py
python curate/score.py · python curate/review.py [--triage] · python curate/apply.py
```

## Commands

```bash
npm run dev · npm run build · npm run test
npm run cap:sync · npm run cap:open:android
```

On Windows, `python3` resolves to a 0-byte Microsoft Store stub. Use `python`.
