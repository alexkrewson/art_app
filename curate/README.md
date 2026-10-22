# curate — reviewing the free sources by hand

Openverse and Wikimedia Commons are aggregators, not collections. They index
what people uploaded, which means selfies, portraits and holiday snaps arrive
alongside the landscapes. Thumbing those down one at a time on a tablet works
but does not scale. This reviews them on a monitor at roughly one per second.

The output is an **allowlist**, `public/approved.json` (since 2026-10-16).
Openverse, Commons and NASA download only the images in it, as complete
records, straight from their original hosts. No search API is called, so
nothing unreviewed reaches a device, including whatever the sources add after
the harvest. A category with nothing approved yet downloads nothing.

The **blocklist**, `public/blocklist.json`, is still written. It keeps
rejections out when the Settings "jailbreak" switch turns live search back on,
and it deletes rejected images a device downloaded before they were rejected.

## The round trip

```
node curate/harvest.mjs      # enumerate what the app can reach -> candidates.jsonl
python curate/download.py    # fetch them all to curate/pool/
python curate/review.py      # ↑ approve, ↓ reject, ← → move, End next undecided
python curate/apply.py       # -> public/approved.json + public/blocklist.json
git commit + push            # Pages deploys approved.json; devices pick it up
```

The app reads both the bundled `approved.json` and the deployed one at
`alexkrewson.github.io/art_app/approved.json`, keeping whichever has the later
`generated`. `blocklist.json` is read the same way (since 2026-10-22), and at
boot deletes any rejected image already downloaded. So both approvals and
rejections reach every install on the next push, without a new APK.
`npm run cap:sync` and a reinstall are only needed to change what a fresh
install ships, or for a tablet whose APK predates 2026-10-22.

Images a device already holds are not purged for being unapproved. To make an
existing library approved-only, delete all downloaded images on the device and
re-tick the categories.

## Triage: letting a model put the obvious ones together

```
python curate/score.py --sheets      # embed new images, learn from decisions.jsonl, score the rest
python curate/review.py --triage     # undecided only, likely rejects first
python curate/review.py --triage keep   # ...or likely keeps first
python curate/grid.py --source nasa     # confirm confident rejects 20 at a time (--per-page 40 for denser)
python curate/grid.py --source nasa --unsure   # the unsure band, each image marked with its own guess
python curate/grid.py --source nasa --recheck keep   # look over your approvals again, most doubtful first
python curate/review.py --source openverse --sample   # a new source: all categories in turn, to train on
python curate/review.py --source openverse --flash    # recheck approvals by flashing them; Space pauses
```

`grid.py` is the fast way through the confident end. Hover over an image for a
large preview, drag a rectangle to flip many at once, → / ← between pages
(only moving forward records). It shows a page of
likely rejects (or likely keeps with `--keep`), all pre-marked. You click any
that deserve a second look, which leaves them undecided for the reviewer, and
press Enter to record the rest. Holding the right button shows an image large.
It stops at the edge of the unsure band. Close the reviewer before using it:
an open reviewer still has those images in its list as undecided.

`score.py` runs every image through CLIP (a model that describes what is in a
picture as 512 numbers) and fits a classifier to your decisions, so it learns
what *you* reject — staff portraits, clean-room crews, slides — rather than a
generic idea of a good photo. In triage mode the reviewer orders undecided
images by its guess and shows the guess, tinted, bottom right. The obvious
rejects then arrive in one long run that goes by at the speed of ↓.

It never decides anything. Only the reviewer writes `decisions.jsonl`.

Read the report it prints every time. It checks itself on decisions it was not
trained on (5-fold cross-validation) and says how often its confident calls
match yours. On 2026-10-17, trained on 2,136 NASA decisions: AUC 0.975; it was
confident on 80% of them, and you agreed with 98% of its "likely reject" calls
and 97% of its "likely keep" calls. The contact sheets in `curate/sheets/`
show its most confident guesses, and where it disagreed with you most.

Retrain after each session; it gets better with more decisions. A source with
no decisions (Openverse and Commons, so far) gets scores, but they are
untested guesses borrowed from what you thought of NASA. Review a few hundred
of a source by hand before trusting triage on it.

The first run downloads the model (~600 MB, once) and embeds at ~15 images/s
on a laptop CPU, about 13 minutes for the whole pool. Later runs only embed
what `download.py` has added. Needs `torch` (CPU build), `open_clip_torch` and
`scikit-learn`; the install lines are in the docstring of `score.py`.

## Why enumeration is possible at all

The reason this is a finite job rather than an endless one is that two of the
three sources are bounded, measured 2026-08-23:

| source | reachable universe | why |
| --- | --- | --- |
| Openverse | 33 queries × 240 = up to 7,920 | the anonymous API refuses to paginate past 240 results and reports `result_count: 240` however many millions are behind the query |
| Wikimedia | 1,984 images | every curated category is smaller than the 600 members the adapter already walks; largest is 566 |
| NASA | ~4,600 | only after the subjects were narrowed — see below |

So a full review is on the order of 13,000 images, not an infinite stream, and
when it is done it is *done* — barring index drift, which a re-harvest picks up.

That Openverse figure is higher than a first estimate of ~3,000, and the
correction is worth keeping. The adapter's measured ~62% duplicate rate is a
property of how it *samples* — random pages inside the window, overlapping each
other — not of the window itself. Walking all 12 pages of a query in order
returns very close to 20 unique per page. Sampling duplicates; enumeration
does not.

NASA had to be changed to get there. Its adapter windows randomly across every
hit, and the old subject list totalled **87,286** — unreviewable by
construction, and its two broadest queries (`international space station` at
64,983, `apollo` at 5,908) were mostly crew portraits, i.e. the exact thing
being curated out. The subjects were narrowed on 2026-08-23; the counts are in
the comment in `src/sources/nasa.js`.

## Files

| file | committed? | what |
| --- | --- | --- |
| `harvest.mjs` | yes | enumerates candidates from the app's own adapters |
| `download.py` | yes | fetches them to `pool/`, resumable |
| `review.py` | yes | the reviewer |
| `apply.py` | yes | decisions → `public/approved.json` + `public/blocklist.json` |
| `score.py` | yes | learns from decisions, scores the rest for `review.py --triage` |
| `grid.py` | yes | confirms `score.py`'s confident guesses a page at a time |
| `embeddings.npz`, `scores.json`, `sheets/` | no | `score.py`'s cache, guesses and contact sheets; all regenerable |
| `decisions.jsonl` | **yes** | hours of human judgement, the one thing here that cannot be regenerated |
| `candidates.jsonl`, `pool/`, `harvest-state.json`, `failed.jsonl` | no | regenerable, and `pool/` is a couple of GB |
| `approved/`, `rejected/` | no | hard links into `pool/` mirroring `decisions.jsonl`, for browsing in Explorer; rebuilt on every `review.py` start |

## Notes worth knowing

**Openverse takes two days.** 396 requests against a 200/day anonymous quota.
`--budget N` stops a run cleanly and `harvest-state.json` resumes it, so run it
once today and once tomorrow. Wikimedia and NASA each finish in under a minute,
which is why they harvest first — you can start reviewing while Openverse is
still filling in.

**`harvest.mjs` imports the real adapters, and must keep doing so.** Not
`fetchBatch()` — that samples deliberately — but `toRecord()`, the licence
filters, `THUMB_WIDTH`, `bestImageUrl()`. The blocklist is keyed on
`record.image`. If this directory ever computed a URL differently from the app
(a different `iiurlwidth`, a different NASA link preference) every rejection
would key on a URL the app never produces, and the whole thing would silently
do nothing while looking like it worked.

**Downloads are re-encoded to a 1600px long edge.** Not to save disk, but so a
keypress never waits on a 20 MB Commons original being decoded. `--full` keeps
the real bytes.

**Everything is resumable.** Decisions are appended before the next image is
shown, so closing the window mid-session costs nothing.

**Changing your mind is ← and a new arrow.** The reviewer's list includes
images already decided, marked with a badge and a coloured frame, so going back
reaches earlier sessions too. A changed decision is appended, not edited in
place; `apply.py` takes the last line per URL.

**`approved/` and `rejected/` are a view, not the record.** They are hard links
(no extra disk) that `review.py` rebuilds from `decisions.jsonl` whenever it
starts. Deleting a file from one of them in Explorer changes nothing — the
next start puts it back. Change a decision in the reviewer instead.

**Retiring a category strands what it downloaded.** Changing a subject's *value*
(as the NASA retune did) changes its `catId`, so images already on a tablet
under the old id keep their files and keep playing, but no longer appear under
any checkbox. The cleanest fix is the one you want anyway after a first
curation pass: on the tablet, delete all downloaded images and re-tick the
categories. The blocklist deliberately survives that (`clearLibrary()` does not
touch it), so the re-download comes back vetted.
