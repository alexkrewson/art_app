#!/usr/bin/env python
"""Learns your taste from decisions.jsonl and scores the images you have not
reviewed yet, so the reviewer can put the obvious ones together.

    python curate/score.py            # embed anything new, retrain, rescore
    python curate/score.py --sheets   # also write contact sheets to curate/sheets/

Two steps:

1. Embed. Every image in pool/ goes through CLIP once, a model that turns a
   picture into 512 numbers describing what is in it: a person at a lectern,
   a slide with text, a nebula. Cached in curate/embeddings.npz, so later runs
   only embed what download.py has added since. ~10 images/s on a laptop CPU.

2. Train. A logistic regression on those numbers, fitted to your keep/reject
   decisions. It takes seconds and it learns what *you* reject rather than a
   generic idea of a good photo. Before scoring anything it is checked on
   decisions it was not trained on (5-fold cross-validation), and the report
   says how often its confident calls agree with yours. That number is the
   reason to trust it or not; read it each time.

Output is curate/scores.json, {url: chance you would approve it}, which
review.py --triage reads. Nothing here decides anything: decisions.jsonl is
only ever written by you, in the reviewer.

Needs torch (CPU build is fine), open_clip_torch and scikit-learn:

    pip install --index-url https://download.pytorch.org/whl/cpu torch torchvision
    pip install open_clip_torch scikit-learn
"""
import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from download import path_for  # noqa: E402

CANDIDATES = HERE / "candidates.jsonl"
DECISIONS = HERE / "decisions.jsonl"
EMBEDDINGS = HERE / "embeddings.npz"
SCORES = HERE / "scores.json"
SHEETS = HERE / "sheets"

# ViT-B-32 is the small CLIP: a few times faster than B-16 on a CPU and,
# with a classifier trained on top, the accuracy gap is small. Changing this
# invalidates the cache, which is rebuilt automatically.
MODEL = ("ViT-B-32", "laion2b_s34b_b79k")
BATCH = 32
# A call counts as "confident" outside this band. The report shows how often
# confident calls match your decisions; triage mode uses the same band.
CONFIDENT = (0.15, 0.85)


def load_jsonl(path):
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def latest_decisions():
    latest = {}
    for rec in load_jsonl(DECISIONS):
        if rec["decision"] in ("keep", "reject"):
            latest[rec["url"]] = rec["decision"]
        else:
            latest.pop(rec["url"], None)  # old "skip" lines clear a decision
    return latest


# ── 1. embed ────────────────────────────────────────────────────────────────
def load_cache():
    if not EMBEDDINGS.exists():
        return {}
    z = np.load(EMBEDDINGS, allow_pickle=False)
    if str(z["model"]) != "/".join(MODEL):
        print(f"embeddings.npz was made with {z['model']}; rebuilding for {'/'.join(MODEL)}")
        return {}
    return dict(zip(z["keys"].tolist(), z["vecs"]))


def save_cache(cache):
    keys = sorted(cache)
    tmp = EMBEDDINGS.with_suffix(".tmp.npz")
    np.savez(tmp, model="/".join(MODEL), keys=np.array(keys),
             vecs=np.stack([cache[k] for k in keys]).astype(np.float16))
    tmp.replace(EMBEDDINGS)


def embed(candidates):
    cache = load_cache()
    todo = []
    for c in candidates:
        p = path_for(c["url"])
        if p.stem not in cache and p.exists():
            todo.append(p)
    todo = list(dict.fromkeys(todo))
    print(f"{len(cache):,} images already embedded, {len(todo):,} to do")
    if not todo:
        return cache

    import open_clip
    import torch
    model, _, preprocess = open_clip.create_model_and_transforms(MODEL[0], pretrained=MODEL[1])
    model.eval()

    def prep(p):
        try:
            with Image.open(p) as img:
                return p.stem, preprocess(img.convert("RGB"))
        except Exception:  # noqa: BLE001 — the reviewer steps over bad files too
            return p.stem, None

    start = time.time()
    done = 0
    with ThreadPoolExecutor(4) as pool, torch.no_grad():
        for i in range(0, len(todo), BATCH):
            batch = [r for r in pool.map(prep, todo[i:i + BATCH]) if r[1] is not None]
            if batch:
                vecs = model.encode_image(torch.stack([t for _, t in batch]))
                vecs = vecs / vecs.norm(dim=-1, keepdim=True)
                for (stem, _), v in zip(batch, vecs.numpy()):
                    cache[stem] = v
            done += len(todo[i:i + BATCH])
            rate = done / (time.time() - start)
            print(f"\r  {done:,}/{len(todo):,}  {rate:.1f}/s  "
                  f"~{(len(todo) - done) / rate / 60:.0f} min left   ", end="", flush=True)
            if (i // BATCH) % 50 == 49:
                save_cache(cache)  # a killed run keeps most of its work
    print()
    save_cache(cache)
    return cache


# ── 2. train and score ──────────────────────────────────────────────────────
def train(candidates, cache, latest):
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import roc_auc_score
    from sklearn.model_selection import StratifiedKFold, cross_val_predict

    by_url = {}
    for c in candidates:
        stem = path_for(c["url"]).stem
        if stem in cache:
            by_url[c["url"]] = (c, cache[stem].astype(np.float32))

    labelled = [u for u in latest if u in by_url]
    if len(labelled) < 50 or len({latest[u] for u in labelled}) < 2:
        sys.exit(f"Only {len(labelled)} decided images with embeddings; review some more first.")
    X = np.stack([by_url[u][1] for u in labelled])
    y = np.array([latest[u] == "keep" for u in labelled], dtype=int)

    clf = LogisticRegression(C=2.0, max_iter=2000, class_weight="balanced")
    folds = StratifiedKFold(5, shuffle=True, random_state=0)
    p = cross_val_predict(clf, X, y, cv=folds, method="predict_proba")[:, 1]
    report(labelled, latest, by_url, y, p, roc_auc_score(y, p))

    clf.fit(X, y)
    urls = list(by_url)
    probs = clf.predict_proba(np.stack([by_url[u][1] for u in urls]))[:, 1]
    scores = {u: round(float(s), 4) for u, s in zip(urls, probs)}
    SCORES.write_text(json.dumps({"model": "/".join(MODEL), "trained_on": len(labelled),
                                  "confident": CONFIDENT, "scores": scores}), encoding="utf-8")
    undecided_report(by_url, latest, scores)
    return by_url, scores, dict(zip(labelled, p))


def report(labelled, latest, by_url, y, p, auc):
    lo, hi = CONFIDENT
    sources = sorted({by_url[u][0].get("source", "") for u in labelled})
    print(f"\nChecked on decisions it was not trained on "
          f"({len(labelled):,}: {y.sum():,} approved, {len(y) - y.sum():,} rejected; "
          f"{', '.join(sources)})")
    print(f"  ranking quality (AUC, 0.5 = coin flip, 1.0 = perfect): {auc:.3f}")
    for name, mask, want in (("likely reject", p < lo, 0), ("likely keep", p > hi, 1)):
        n = mask.sum()
        if n:
            agree = (y[mask] == want).mean()
            print(f"  {name:13}  {n:5,} images ({n / len(y):4.0%} of all)  "
                  f"you agreed with {agree:5.1%}  ->  {int(n - agree * n):,} it got wrong")
    unsure = ((p >= lo) & (p <= hi)).sum()
    print(f"  {'unsure':13}  {unsure:5,} images ({unsure / len(y):4.0%})")


def undecided_report(by_url, latest, scores):
    lo, hi = CONFIDENT
    per = {}
    for u, (c, _) in by_url.items():
        if u in latest:
            continue
        b = per.setdefault(c.get("source", ""), [0, 0, 0])
        b[0 if scores[u] < lo else 2 if scores[u] > hi else 1] += 1
    print(f"\nUndecided images, as it sees them (written to {SCORES.name}):")
    for src, (rej, uns, keep) in sorted(per.items()):
        print(f"  {src:10}  likely reject {rej:5,}   unsure {uns:5,}   likely keep {keep:5,}")
    trained = {by_url[u][0].get("source", "") for u in latest if u in by_url}
    untried = sorted(set(per) - trained)
    if untried:
        print(f"  ({', '.join(untried)}: no decisions yet, so these scores are untested guesses)")


# ── contact sheets, for eyeballing what it does ─────────────────────────────
def sheet(name, urls, cols=8, cell=220):
    SHEETS.mkdir(exist_ok=True)
    urls = urls[:cols * 6]
    if not urls:
        return
    rows = (len(urls) + cols - 1) // cols
    out = Image.new("RGB", (cols * cell, rows * cell), "black")
    for i, u in enumerate(urls):
        try:
            with Image.open(path_for(u)) as img:
                img = img.convert("RGB")
                img.thumbnail((cell - 6, cell - 6))
                out.paste(img, ((i % cols) * cell + 3, (i // cols) * cell + 3))
        except Exception:  # noqa: BLE001
            pass
    out.save(SHEETS / f"{name}.jpg", quality=85)


def sheets(by_url, latest, scores, cv):
    und = sorted((u for u in by_url if u not in latest), key=scores.get)
    sheet("undecided-most-likely-reject", und)
    sheet("undecided-most-likely-keep", und[::-1])
    # Where it disagreed most with you, on decisions it was not trained on:
    # the best picture of what it has not learned (or of a decision to revisit).
    sheet("wrong-said-reject-you-kept",
          sorted((u for u in cv if latest[u] == "keep"), key=cv.get))
    sheet("wrong-said-keep-you-rejected",
          sorted((u for u in cv if latest[u] == "reject"), key=cv.get, reverse=True))
    print(f"\nContact sheets in {SHEETS}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--sheets", action="store_true", help="write contact sheets to curate/sheets/")
    args = ap.parse_args()
    candidates = load_jsonl(CANDIDATES)
    cache = embed(candidates)
    by_url, scores, cv = train(candidates, cache, latest_decisions())
    if args.sheets:
        sheets(by_url, latest_decisions(), scores, cv)


if __name__ == "__main__":
    main()
