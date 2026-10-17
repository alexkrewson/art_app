#!/usr/bin/env python
"""Downloads every harvested candidate to a local file, ready for review.

Reads curate/candidates.jsonl (written by harvest.mjs) and fills curate/pool/.
Resumable and safe to re-run: a candidate whose file already exists is skipped,
so this can be left running, interrupted, and restarted while harvest.mjs is
still trickling more candidates in behind it.

    python curate/download.py                  # everything outstanding
    python curate/download.py --source nasa    # one source
    python curate/download.py --full           # keep originals, no downscale
    python curate/download.py --workers 16

Images are re-encoded to a 1600px long edge by default. That is not about
saving disk (though it roughly halves 3 GB); it is about the review loop. A
reviewer pressing an arrow key every second cannot wait on a 20 MB Commons
original being decoded, and "is this a selfie" is not a question that needs
more than 1600px to answer. Pass --full if you ever want the real bytes.
"""
import argparse
import hashlib
import io
import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse

import requests
from PIL import Image

HERE = Path(__file__).resolve().parent
CANDIDATES = HERE / "candidates.jsonl"
POOL = HERE / "pool"
FAILED = HERE / "failed.jsonl"

UA = "SlowFrame-curate/1.0 (https://github.com/alexkrewson/art_app)"
MAX_EDGE = 1600

# Statuses where retrying is pointless. Everything else — 429, 5xx, a dropped
# connection — is transient and must NOT be recorded as a permanent failure,
# because failed.jsonl is skipped on later runs. Getting this wrong once cost
# 1,931 Commons images on 2026-08-23: they were rate-limited, written off, and
# would have been skipped by every rerun thereafter.
PERMANENT_STATUSES = {400, 401, 403, 404, 410}
MAX_ATTEMPTS = 4

# Per-host politeness: (max in flight, minimum seconds between starts).
# Commons returned 1,931 HTTP 429s at 12 shared workers. Wikimedia asks reusers
# to crawl gently and enforces it, so it gets its own much narrower lane while
# everything else stays fast.
HOST_LIMITS = {
    "upload.wikimedia.org": (3, 0.15),
}
DEFAULT_HOST_LIMIT = (8, 0.0)

# Same host-header rule the app itself needs. Not currently reachable — AIC is
# out of curation scope — but the app learned this the hard way on 2026-08-13
# (every AIC image download 403d on device until the header was added), and a
# downloader that silently 403s a whole source is exactly the failure that cost
# that day. Keep them in step.
HOST_HEADERS = [
    ("artic.edu", {"AIC-User-Agent": UA}),
]


class HostGate:
    """Caps concurrency and pace per host, independently of the worker count.

    One global worker count cannot serve both Commons (which rate-limits) and
    NASA's asset CDN (which doesn't). Without this, the only lever is
    --workers, and tuning it down to keep Commons happy makes everything else
    four times slower.
    """

    def __init__(self):
        self._lanes = {}
        self._guard = threading.Lock()

    def _lane(self, host):
        with self._guard:
            if host not in self._lanes:
                limit, gap = HOST_LIMITS.get(host, DEFAULT_HOST_LIMIT)
                self._lanes[host] = [threading.Semaphore(limit), gap, 0.0, threading.Lock()]
            return self._lanes[host]

    def acquire(self, host):
        sem, gap, _, lock = self._lane(host)
        sem.acquire()
        if gap:
            with lock:
                lane = self._lanes[host]
                wait = lane[2] + gap - time.monotonic()
                if wait > 0:
                    time.sleep(wait)
                lane[2] = time.monotonic()

    def release(self, host):
        self._lane(host)[0].release()


GATE = HostGate()


class Permanent(Exception):
    """A failure worth remembering, as opposed to one worth retrying."""


def get_bytes(url: str) -> bytes:
    host = urlparse(url).netloc
    last = None
    for attempt in range(MAX_ATTEMPTS):
        GATE.acquire(host)
        try:
            r = requests.get(url, headers=headers_for(url), timeout=30)
        except requests.RequestException as err:
            last = err
            r = None
        finally:
            GATE.release(host)

        if r is not None:
            if r.status_code in PERMANENT_STATUSES:
                raise Permanent(f"HTTP {r.status_code}")
            if r.ok:
                return r.content
            last = requests.HTTPError(f"HTTP {r.status_code}")
            # Honour Retry-After when the server bothers to send one, and back
            # off exponentially when it doesn't.
            retry_after = r.headers.get("Retry-After")
            delay = float(retry_after) if (retry_after or "").isdigit() else 2 ** attempt
        else:
            delay = 2 ** attempt

        if attempt < MAX_ATTEMPTS - 1:
            time.sleep(min(delay, 30))
    raise RuntimeError(str(last))


def path_for(url: str) -> Path:
    """Deterministic, so review.py can find a file from the candidate alone."""
    return POOL / (hashlib.sha1(url.encode("utf-8")).hexdigest()[:16] + ".jpg")


def headers_for(url: str) -> dict:
    h = {"User-Agent": UA}
    for host, extra in HOST_HEADERS:
        if host in url:
            h.update(extra)
    return h


def load_candidates(source: str | None):
    if not CANDIDATES.exists():
        sys.exit(f"no {CANDIDATES} — run `node curate/harvest.mjs` first")
    out, seen = [], set()
    for line in CANDIDATES.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        if rec["url"] in seen:
            continue
        seen.add(rec["url"])
        if source and rec.get("source") != source:
            continue
        out.append(rec)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--full", action="store_true", help="keep originals, no downscale")
    args = ap.parse_args()

    POOL.mkdir(parents=True, exist_ok=True)
    candidates = load_candidates(args.source)

    # Anything already failed is not retried automatically. A dead URL stays
    # dead, and re-attempting a few hundred of them on every run turns a
    # resumable job into a slow one.
    already_failed = set()
    if FAILED.exists():
        for line in FAILED.read_text(encoding="utf-8").splitlines():
            if line.strip():
                try:
                    already_failed.add(json.loads(line)["url"])
                except (json.JSONDecodeError, KeyError):
                    pass

    todo = [c for c in candidates
            if not path_for(c["url"]).exists() and c["url"] not in already_failed]
    print(f"{len(candidates)} candidates, {len(todo)} to fetch "
          f"({len(candidates) - len(todo)} already held or previously failed)")
    if not todo:
        return

    lock = threading.Lock()
    counts = {"ok": 0, "fail": 0, "retry": 0, "last_transient": ""}

    def fetch(rec):
        url = rec["url"]
        dest = path_for(url)
        try:
            data = get_bytes(url)
            if args.full:
                dest.write_bytes(data)
            else:
                img = Image.open(io.BytesIO(data))
                img = img.convert("RGB")
                img.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
                # Write to a temp name and rename, so an interrupted run never
                # leaves a truncated file that looks downloaded to the next one.
                tmp = dest.with_suffix(".part")
                img.save(tmp, "JPEG", quality=85)
                tmp.replace(dest)
            with lock:
                counts["ok"] += 1
        except Permanent as err:
            with lock:
                counts["fail"] += 1
                with FAILED.open("a", encoding="utf-8") as f:
                    f.write(json.dumps({"url": url, "error": str(err)[:200]}) + "\n")
        except Exception as err:  # noqa: BLE001 — one bad URL must not stop the run
            # Transient: counted and reported, but deliberately NOT written to
            # failed.jsonl, so the next run picks it up again.
            with lock:
                counts["retry"] += 1
                counts["last_transient"] = f"{urlparse(url).netloc}: {str(err)[:80]}"
        with lock:
            n = counts["ok"] + counts["fail"] + counts["retry"]
            if n % 25 == 0 or n == len(todo):
                msg = f"  {n}/{len(todo)}  ok={counts['ok']} dead={counts['fail']}"
                if counts["retry"]:
                    msg += f" deferred={counts['retry']} ({counts['last_transient']})"
                print(msg, flush=True)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(fetch, todo))

    print(f"\ndone: {counts['ok']} downloaded, {counts['fail']} permanently dead "
          f"(logged to {FAILED.name})")
    if counts["retry"]:
        print(f"{counts['retry']} still unfetched after {MAX_ATTEMPTS} attempts — transient, "
              f"NOT written off. Re-run this command to pick them up.")


if __name__ == "__main__":
    main()
