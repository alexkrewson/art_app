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

## Commands

```bash
npm run dev · npm run build · npm run test
npm run cap:sync · npm run cap:open:android
```

On Windows, `python3` resolves to a 0-byte Microsoft Store stub. Use `python`.
