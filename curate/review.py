#!/usr/bin/env python
"""The reviewer. One image at a time, full screen.

    ↑  approve           ↓  reject          (both move on to the next image)
    →  next              ←  previous        (move without deciding)
    End  jump to the first undecided image  Home  back to the start
    Esc / q  quit

    python curate/review.py                    # everything, starting at the first undecided
    python curate/review.py --source openverse # one source at a time
    python curate/review.py --cat "openverse::wildlife~bird in flight~deer~big cat~whale"
    python curate/review.py --undecided        # leave already-decided images out of the list
    python curate/review.py --triage           # undecided, likely rejects first (see score.py)
    python curate/review.py --source openverse --sample   # all categories in turn, for training
    python curate/review.py --source openverse --flash    # recheck approvals, flashed one at a time
    python curate/review.py --triage keep      # undecided, likely keeps first

The list holds decided images as well as undecided ones, so ← walks back into
earlier sessions too. An image you have already decided shows a badge and a
coloured frame; press ↑ or ↓ on it again to change your mind. That replaces the
old undo key: at one image per second the images you most want back are the
ones you rejected by accident, and now you just go back and flip them.

The previous and next images sit either side of the current one, smaller, with
their badges, so a decision you just made stays visible on the left after you
have moved past it. Pressing ↑ or ↓ also stamps the verdict large across the
image before moving on. Any key pressed during the stamp finishes it at once,
so it confirms what happened without setting the pace. − and + shorten and
lengthen the stamp while you work; the length is remembered in
curate/review-prefs.json.

Every decision is appended to curate/decisions.jsonl before the next image is
shown, so closing the lid mid-session loses nothing. Changing your mind appends
a second line rather than editing the first; apply.py takes the last line per
URL. That file is the valuable output of this whole exercise — it is hours of
human judgement and it is worth committing.

Decisions are also mirrored into curate/approved/ and curate/rejected/ so the
two piles can be browsed in Explorer. They are hard links to the files in
pool/, not copies, so they cost no disk, and pool/ stays complete so
download.py never re-fetches anything. The mirror is rebuilt from
decisions.jsonl every time this starts: the folders are a view, the jsonl is
the truth, and deleting a file from a folder by hand does not change a
decision.

Images are decoded on a background thread a few either side of where you are.
Without that, every keypress waits on a JPEG decode and the loop drops to a
rhythm that makes you stop reviewing after two hundred.
"""
import argparse
import json
import os
import queue
import random
import shutil
import threading
import time
import tkinter as tk
from pathlib import Path

from PIL import Image, ImageTk

HERE = Path(__file__).resolve().parent
CANDIDATES = HERE / "candidates.jsonl"
DECISIONS = HERE / "decisions.jsonl"
POOL = HERE / "pool"
FOLDERS = {"keep": HERE / "approved", "reject": HERE / "rejected"}
PREFS = HERE / "review-prefs.json"
SCORES = HERE / "scores.json"
SAMPLE_BLOCK = 25           # --sample: images from one category before moving to the next
GUESS_BAND = (0.15, 0.85)   # fallback; scores.json carries the band it was checked with

LOOKAHEAD = 6
FLASH_LOOKAHEAD = 40        # --flash runs through images fast; decode further ahead
FLASH_INTERVAL_MS = 300     # --flash default time per image, until − / + / [ / ] change it
FLASH_INTERVAL_RANGE = (20, 5000)
LOOKBEHIND = 2
FOOTER = 60
FLASH_MS = 500          # default stamp length, until − / + change it
FLASH_STEP = 50
FLASH_FINE_STEP = 10    # used below FLASH_STEP
FLASH_RANGE = (0, 2000)
MAIN_FRAC = 0.62        # share of the screen width the current image gets
PREVIEW_H_FRAC = 0.55   # preview height as a share of the main image's
SIDE_GAP = 20           # space around the previews

# What a decided image looks like on screen: badge text, colour.
BADGES = {
    "keep": ("▲  APPROVED", "#2e9e4f"),
    "reject": ("▼  REJECTED", "#c0392b"),
}

# Imported rather than duplicated: the pool filename must agree with the
# downloader's, or the reviewer silently finds nothing to review.
import sys
sys.path.insert(0, str(HERE))
from download import path_for  # noqa: E402


def load_jsonl(path):
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return out


def load_prefs():
    try:
        return json.loads(PREFS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_prefs(prefs):
    try:
        PREFS.write_text(json.dumps(prefs, indent=2) + "\n", encoding="utf-8")
    except OSError:
        pass    # a preference not saving is not worth interrupting a review over


def latest_decisions():
    """url -> "keep" | "reject". Last line wins, same rule as apply.py.

    An old "skip" line (the reviewer used to have a skip key) means "not
    decided", so it clears whatever came before it rather than being kept.
    """
    latest = {}
    for d in load_jsonl(DECISIONS):
        if d.get("decision") in FOLDERS:
            latest[d["url"]] = d["decision"]
        else:
            latest.pop(d.get("url"), None)
    return latest


def short_cat(cat: str) -> str:
    """`openverse::coast~ocean waves~beach cliffs~fjord` -> `openverse / coast …`."""
    if "::" not in cat:
        return cat
    src, rest = cat.split("::", 1)
    first = rest.split("~")[0].split("|")[0]
    more = " …" if ("~" in rest or "|" in rest) else ""
    return f"{src} / {first}{more}"


# ── the approved/ and rejected/ mirror ───────────────────────────────────
def place(url: str, decision: str):
    """Put this image's file in the folder for `decision` and no other."""
    src = path_for(url)
    for what, folder in FOLDERS.items():
        dest = folder / src.name
        if what == decision:
            if not dest.exists() and src.exists():
                folder.mkdir(exist_ok=True)
                try:
                    os.link(src, dest)
                except OSError:
                    # Not NTFS, or pool/ on another drive: fall back to a copy.
                    shutil.copy2(src, dest)
        elif dest.exists():
            dest.unlink()


def sync_mirror(latest):
    """Make both folders match decisions.jsonl exactly, adding and removing."""
    want = {what: {path_for(u).name for u, d in latest.items() if d == what}
            for what in FOLDERS}
    added = removed = 0
    for what, folder in FOLDERS.items():
        folder.mkdir(exist_ok=True)
        for f in folder.iterdir():
            if f.is_file() and f.name not in want[what]:
                f.unlink()
                removed += 1
    for url, what in latest.items():
        dest = FOLDERS[what] / path_for(url).name
        if not dest.exists() and path_for(url).exists():
            place(url, what)
            added += 1
    if added or removed:
        print(f"mirror: {added:,} linked, {removed:,} removed")


class Reviewer:
    def __init__(self, items, latest, start, root, scores=None, flash=False):
        self.items = items
        self.latest = latest         # url -> "keep" | "reject", kept current as you go
        self.scores = scores or {}   # url -> score.py's chance you'd approve it; --triage only
        self.root = root
        self.i = start
        self.dir = 1                 # last direction of travel, for stepping over bad files
        self.bad = set()             # indices whose file would not decode
        self.cache = {}              # index -> PIL.Image at main size, filled by the loader thread
        self.small = {}              # index -> PIL.Image at preview size, made on demand
        self.pending = None          # Tk `after` id while a verdict stamp is showing
        self.flash_ms = int(load_prefs().get("flash_ms", FLASH_MS))
        # --flash: approved images advance on their own every interval_ms;
        # Space pauses. Starts paused, so you are ready before it moves.
        self.flash = flash
        self.running = False
        self.interval_ms = int(load_prefs().get("flash_interval_ms", FLASH_INTERVAL_MS))
        self.tick_job = None
        self.ahead = FLASH_LOOKAHEAD if flash else LOOKAHEAD
        self.position_key = ""       # main() sets it to --source, the key a resume looks up
        self.want = queue.Queue()
        self.lock = threading.Lock()

        self.sw = root.winfo_screenwidth()
        self.sh = root.winfo_screenheight()
        self.main_size = (int(self.sw * MAIN_FRAC), self.sh - FOOTER)
        side_w = (self.sw - self.main_size[0]) // 2 - 2 * SIDE_GAP
        self.small_size = (max(side_w, 40), int(self.main_size[1] * PREVIEW_H_FRAC))
        cx, cy = self.sw // 2, self.main_size[1] // 2
        side_cx = (self.sw - self.main_size[0]) // 4

        self.canvas = tk.Canvas(root, bg="black", highlightthickness=0,
                                width=self.sw, height=self.sh)
        self.canvas.pack(fill="both", expand=True)
        self.slots = {
            "prev": self._make_slot(side_cx, cy, font=11, frame=3),
            "main": self._make_slot(cx, cy, font=20, frame=6),
            "next": self._make_slot(self.sw - side_cx, cy, font=11, frame=3),
        }
        # The big verdict stamp shown for FLASH_MS after a keypress.
        self.stamp_bg = self.canvas.create_rectangle(0, 0, 0, 0, width=0, state="hidden")
        self.stamp = self.canvas.create_text(cx, cy, anchor="center", fill="white",
                                             font=("Segoe UI", 54, "bold"), state="hidden")
        self.status = self.canvas.create_text(
            24, self.sh - 42, anchor="w", fill="#cccccc",
            font=("Segoe UI", 13), text="")
        self.title_txt = self.canvas.create_text(
            24, self.sh - 20, anchor="w", fill="#8a8a8a",
            font=("Segoe UI", 11), text="")
        self.notice = self.canvas.create_text(
            cx, cy, anchor="center", fill="#cccccc", justify="center",
            font=("Segoe UI", 16), text="")
        # The model's guess, in the footer opposite the title: a hint to read,
        # not a verdict, so it looks nothing like the badges. Not over the
        # image, where a tall bright photo would swallow it.
        self.guess = self.canvas.create_text(
            self.sw - 24, self.sh - 20, anchor="e", fill="#8a8a8a",
            font=("Segoe UI", 12), text="")

        threading.Thread(target=self._loader, daemon=True).start()

        # Every key first finishes a stamp in progress, so a fast reviewer is
        # never held up by it. Indices are read inside the lambdas, after that.
        keys = {
            "<Up>": lambda: self.decide("keep"),
            "<Down>": lambda: self.decide("reject"),
            "<Right>": lambda: self.go(self.i + 1),
            "<Left>": lambda: self.go(self.i - 1),
            "<Home>": lambda: self.go(0),
            "<End>": lambda: self.go(self.first_undecided(), 1),
        }
        for key, action in keys.items():
            root.bind(key, lambda e, a=action: (self._finish_stamp(), a()))
        root.bind("<Escape>", lambda e: self.quit())
        root.bind("q", lambda e: self.quit())
        if flash:
            # − / + move the speed 10 ms, [ / ] 1 ms; Space pauses.
            for key, d in (("<minus>", -10), ("<KP_Subtract>", -10), ("<equal>", 10),
                           ("<plus>", 10), ("<KP_Add>", 10),
                           ("<bracketleft>", -1), ("<bracketright>", 1)):
                root.bind(key, lambda e, d=d: self.adjust_interval(d))
            root.bind("<space>", lambda e: self.toggle_run())
        else:
            for key in ("<minus>", "<KP_Subtract>"):
                root.bind(key, lambda e: self.adjust_flash(-FLASH_STEP))
            for key in ("<equal>", "<plus>", "<KP_Add>"):
                root.bind(key, lambda e: self.adjust_flash(FLASH_STEP))

        self.show()

    # ── image loading ────────────────────────────────────────────────────
    def _loader(self):
        """Decodes around the reviewer so a keypress never waits on a JPEG."""
        while True:
            idx = self.want.get()
            if idx is None:
                return
            ahead = range(idx, min(idx + self.ahead, len(self.items)))
            behind = range(idx - 1, max(idx - LOOKBEHIND, 0) - 1, -1)
            for j in [*ahead, *behind]:
                if not self.want.empty():
                    break            # the reviewer has moved on; serve the new spot first
                with self.lock:
                    if j in self.cache:
                        continue
                img = self._load(j)
                with self.lock:
                    self.cache[j] = img
                    # Keep only a window around where we are, rather than
                    # holding gigabytes of decoded bitmaps in memory.
                    for k in list(self.cache):
                        if k < idx - LOOKBEHIND - 2 or k > idx + self.ahead + 1:
                            del self.cache[k]

    def _load(self, idx):
        try:
            img = Image.open(path_for(self.items[idx]["url"]))
            # Let the JPEG decoder skip detail the screen cannot show: several
            # times faster on big files, which --flash needs at short intervals.
            img.draft("RGB", self.main_size)
            img.thumbnail(self.main_size, Image.LANCZOS)
            return img.convert("RGB")
        except Exception:  # noqa: BLE001 — a corrupt file is stepped over, not a crash
            return None

    def _get(self, idx):
        with self.lock:
            img = self.cache.get(idx, "miss")
        if img == "miss":
            img = self._load(idx)
            with self.lock:
                self.cache[idx] = img
        return img

    def _get_small(self, idx):
        if idx not in self.small:
            img = self._get(idx).copy()
            img.thumbnail(self.small_size, Image.LANCZOS)
            self.small[idx] = img
        return self.small[idx]

    def _usable(self, idx):
        """Whether this index has a decodable image, remembering ones that don't."""
        if idx in self.bad:
            return False
        if self._get(idx) is None:
            self.bad.add(idx)
            return False
        return True

    def _neighbour(self, idx, step):
        j = idx + step
        while 0 <= j < len(self.items):
            if self._usable(j):
                return j
            j += step
        return None

    # ── navigation ───────────────────────────────────────────────────────
    def go(self, idx, direction=None):
        idx = max(0, min(idx, len(self.items)))
        if idx == self.i:
            return
        self.dir = direction or (1 if idx > self.i else -1)
        self.i = idx
        self.show()

    def first_undecided(self):
        for j, rec in enumerate(self.items):
            if rec["url"] not in self.latest and j not in self.bad:
                return j
        return len(self.items)

    # ── display ──────────────────────────────────────────────────────────
    def _make_slot(self, cx, cy, font, frame):
        c = self.canvas
        return {
            "cx": cx, "cy": cy, "photo": None,   # photo: a reference Tk will not keep for us
            "img": c.create_image(cx, cy, anchor="center"),
            "frame": c.create_rectangle(0, 0, 0, 0, width=frame, outline="", state="hidden"),
            "badge_bg": c.create_rectangle(0, 0, 0, 0, width=0, state="hidden"),
            "badge": c.create_text(0, 0, anchor="nw", fill="white",
                                   font=("Segoe UI", font, "bold"), state="hidden"),
            "inset": frame // 2,
            "pad": (font * 7 // 10, font * 3 // 10),
        }

    def _hide_slot(self, slot):
        self.canvas.itemconfig(slot["img"], image="")
        slot["photo"] = None
        for item in ("frame", "badge_bg", "badge"):
            self.canvas.itemconfig(slot[item], state="hidden")

    def _draw_slot(self, name, idx):
        slot = self.slots[name]
        if idx is None:
            return self._hide_slot(slot)
        img = self._get(idx) if name == "main" else self._get_small(idx)
        slot["photo"] = ImageTk.PhotoImage(img)
        self.canvas.itemconfig(slot["img"], image=slot["photo"])
        self._draw_badge(slot, img.width, img.height, self.latest.get(self.items[idx]["url"]))

    def _draw_badge(self, slot, w, h, decision):
        c = self.canvas
        if self.flash and decision == "keep":
            decision = None          # every image here is approved; only a reject is news
        if decision not in BADGES:
            for item in ("frame", "badge_bg", "badge"):
                c.itemconfig(slot[item], state="hidden")
            return
        text, colour = BADGES[decision]
        x0, y0 = slot["cx"] - w // 2, slot["cy"] - h // 2
        inset, (px, py) = slot["inset"], slot["pad"]
        c.coords(slot["frame"], x0 + inset, y0 + inset, x0 + w - inset, y0 + h - inset)
        c.itemconfig(slot["frame"], outline=colour, state="normal")
        c.coords(slot["badge"], x0 + inset * 2 + px * 2, y0 + inset * 2 + py * 3)
        c.itemconfig(slot["badge"], text=text, state="normal")
        bx0, by0, bx1, by1 = c.bbox(slot["badge"])
        c.coords(slot["badge_bg"], bx0 - px * 2, by0 - py * 2, bx1 + px * 2, by1 + py * 2)
        c.itemconfig(slot["badge_bg"], fill=colour, state="normal")
        c.tag_raise(slot["badge"])

    def show(self):
        # Step over files that will not decode, in whichever direction we were
        # going. Turn round at the start rather than getting stuck there.
        while self.i < len(self.items):
            if self._usable(self.i):
                break
            if self.dir < 0 and self.i == 0:
                self.dir = 1
            self.i += self.dir
        else:
            return self.finish()

        self.want.put(self.i)
        self._hide_stamp()
        self.canvas.itemconfig(self.notice, text="")
        self._draw_slot("main", self.i)
        self._draw_slot("prev", self._neighbour(self.i, -1))
        self._draw_slot("next", self._neighbour(self.i, 1))
        for k in list(self.small):
            if abs(k - self.i) > 3:
                del self.small[k]

        self._draw_status()
        rec = self.items[self.i]
        text, colour = self._guess(rec["url"])
        self.canvas.itemconfig(self.guess, text=text, fill=colour)
        title = rec.get("title", "") or "Untitled"
        artist = rec.get("artist", "")
        # Shorter when a guess shares the line, so the two never overlap.
        self.canvas.itemconfig(self.title_txt, text=f"{title}{'  —  ' + artist if artist else ''}"
                               [:130 if text else 180])

    def _draw_status(self):
        rec = self.items[self.i]
        if self.flash:
            state = "▶ running" if self.running else "❚❚ paused — Space to run"
            self.canvas.itemconfig(self.status, text=(
                f"{self.i + 1:,} / {len(self.items):,}     {self._tally()}"
                f"     |     {short_cat(rec.get('cat', ''))}     |     {state}"
                f"   {self.interval_ms} ms per image  (− + 10 ms   [ ] 1 ms)"
                f"     ↓ reject   ↑ approve   ← →  move   Esc  quit"))
            return
        self.canvas.itemconfig(self.status, text=(
            f"{self.i + 1:,} / {len(self.items):,}     {self._tally()}"
            f"     |     {short_cat(rec.get('cat', ''))}"
            f"     |     ↑ approve   ↓ reject   ← →  move   End  next undecided"
            f"   − +  stamp {self.flash_ms} ms   Esc  quit"
        ))

    def _guess(self, url):
        """score.py's guess for this image as (text, colour); ("", …) without --triage."""
        s = self.scores.get(url)
        if s is None:
            return "", "#8a8a8a"
        lo, hi = GUESS_BAND
        word, colour = (("likely reject", "#d98880") if s < lo else
                        ("likely keep", "#7dcea0") if s > hi else ("unsure", "#8a8a8a"))
        return f"model guess:  {word}  ({s:.0%} keep)", colour

    def _tally(self):
        keep = reject = 0
        for rec in self.items:
            d = self.latest.get(rec["url"])
            keep += d == "keep"
            reject += d == "reject"
        left = len(self.items) - keep - reject
        return f"approved {keep:,}   rejected {reject:,}   undecided {left:,}"

    # ── the verdict stamp ────────────────────────────────────────────────
    def _show_stamp(self, decision):
        text, colour = BADGES[decision]
        c = self.canvas
        c.itemconfig(self.stamp, text=text, state="normal")
        x0, y0, x1, y1 = c.bbox(self.stamp)
        c.coords(self.stamp_bg, x0 - 36, y0 - 14, x1 + 36, y1 + 14)
        c.itemconfig(self.stamp_bg, fill=colour, state="normal")
        c.tag_raise(self.stamp_bg)
        c.tag_raise(self.stamp)

    def _hide_stamp(self):
        self.canvas.itemconfig(self.stamp, state="hidden")
        self.canvas.itemconfig(self.stamp_bg, state="hidden")

    def _finish_stamp(self):
        """Ends a stamp early and moves on, as if its timer had just fired."""
        if self.pending is not None:
            self.root.after_cancel(self.pending)
            self._advance()

    def _advance(self):
        self.pending = None
        self.go(self.i + 1)

    # ── decisions ────────────────────────────────────────────────────────
    def decide(self, what):
        if self.i >= len(self.items):
            return
        rec = self.items[self.i]
        if self.latest.get(rec["url"]) != what:
            # Written before the stamp shows, not when it ends: a session that
            # ends by closing the window must not lose its work.
            with DECISIONS.open("a", encoding="utf-8") as f:
                f.write(json.dumps({
                    "url": rec["url"],
                    "decision": what,
                    "source": rec.get("source", ""),
                    "cat": rec.get("cat", ""),
                    "at": int(time.time()),
                }) + "\n")
            self.latest[rec["url"]] = what
            place(rec["url"], what)
        self._draw_slot("main", self.i)
        self._draw_status()
        self._show_stamp(what)
        if self.flash and self.running:
            return                   # the flash timer moves on; the next image clears the stamp
        self.pending = self.root.after(self.flash_ms, self._advance)

    # ── --flash ──────────────────────────────────────────────────────────
    def toggle_run(self):
        self.running = not self.running
        if self.tick_job is not None:
            self.root.after_cancel(self.tick_job)
            self.tick_job = None
        if self.running:
            self.tick_job = self.root.after(self.interval_ms, self._tick)
        else:
            self._save_position()
        if self.i < len(self.items):
            self._draw_status()

    def _tick(self):
        """Next image when it is decoded; a few ms' wait rather than a stall
        on a JPEG decode if the loader has fallen behind."""
        self.tick_job = None
        if not self.running:
            return
        nxt = self._neighbour_ready(self.i)
        if nxt == "wait":
            self.tick_job = self.root.after(5, self._tick)
            return
        t0 = time.perf_counter()
        self.go(self.i + 1)
        if self.i >= len(self.items):
            self.running = False
            return
        # Drawing an image takes tens of ms; count it inside the interval so
        # interval_ms is the time from one image to the next, not that plus
        # however long the draw took.
        spent = int((time.perf_counter() - t0) * 1000)
        self.tick_job = self.root.after(max(1, self.interval_ms - spent), self._tick)

    def _neighbour_ready(self, idx):
        with self.lock:
            return "ok" if idx + 1 >= len(self.items) or idx + 1 in self.cache else "wait"

    def adjust_interval(self, delta):
        lo, hi = FLASH_INTERVAL_RANGE
        self.interval_ms = max(lo, min(hi, self.interval_ms + delta))
        save_prefs({**load_prefs(), "flash_interval_ms": self.interval_ms})
        if self.i < len(self.items):
            self._draw_status()

    def _save_position(self):
        """Where a --flash pass got to, per source, so the next one resumes."""
        if not self.flash or self.i >= len(self.items):
            return
        rec = self.items[self.i]
        prefs = load_prefs()
        prefs.setdefault("flash_position", {})[self.position_key] = rec["url"]
        save_prefs(prefs)

    def adjust_flash(self, delta):
        # Finer steps at the short end, where 10 ms is a noticeable difference:
        # … 100, 50, 40, 30, 20, 10, 0 and back up the same way.
        fine = self.flash_ms < FLASH_STEP or (delta < 0 and self.flash_ms == FLASH_STEP)
        step = FLASH_FINE_STEP if fine else FLASH_STEP
        lo, hi = FLASH_RANGE
        self.flash_ms = max(lo, min(hi, self.flash_ms + (step if delta > 0 else -step)))
        save_prefs({**load_prefs(), "flash_ms": self.flash_ms})
        if self.i < len(self.items):
            self._draw_status()

    def finish(self):
        for slot in self.slots.values():
            self._hide_slot(slot)
        self._hide_stamp()
        self.canvas.itemconfig(self.status, text=self._tally())
        self.canvas.itemconfig(self.title_txt, text="")
        self.canvas.itemconfig(self.guess, text="")
        left = sum(1 for r in self.items if r["url"] not in self.latest)
        more = (f"{left:,} still undecided — End jumps to the first one.\n"
                if left else "Everything here is decided.\n")
        self.canvas.itemconfig(self.notice, text=(
            "End of the list.\n\n" + more +
            "← to go back.   Esc to close, then run  python curate/apply.py"))

    def quit(self):
        self._save_position()
        self.want.put(None)
        self.root.destroy()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", help="only this source (openverse, wikimedia, nasa)")
    ap.add_argument("--cat", help="only this category id")
    ap.add_argument("--undecided", action="store_true",
                    help="leave images already approved or rejected out of the list")
    ap.add_argument("--sample", action="store_true",
                    help="take turns between categories, shuffled within each, so any "
                         "stretch you review covers all of them: for teaching score.py a new source")
    ap.add_argument("--flash", action="store_true",
                    help="recheck approved images by flashing them one at a time, "
                         "the ones the model doubts most first in each category")
    ap.add_argument("--triage", nargs="?", const="reject", choices=("reject", "keep"),
                    help="undecided images only, ordered by score.py's guess: likely "
                         "rejects first (the default) or likely keeps first")
    args = ap.parse_args()

    scores = {}
    if args.flash and SCORES.exists():
        scores = json.loads(SCORES.read_text(encoding="utf-8"))["scores"]
    if args.triage:
        if not SCORES.exists():
            print("no scores yet: run `python curate/score.py` first.")
            return
        data = json.loads(SCORES.read_text(encoding="utf-8"))
        scores = data["scores"]
        global GUESS_BAND
        GUESS_BAND = tuple(data.get("confident", GUESS_BAND))
        args.undecided = True

    latest = latest_decisions()
    sync_mirror(latest)

    candidates, seen = [], set()
    for rec in load_jsonl(CANDIDATES):
        if rec["url"] in seen:
            continue
        seen.add(rec["url"])
        candidates.append(rec)

    items = [c for c in candidates
             if (not args.flash or latest.get(c["url"]) == "keep")
             and (not args.undecided or c["url"] not in latest)
             and (not args.source or c.get("source") == args.source)
             and (not args.cat or c.get("cat") == args.cat)
             and path_for(c["url"]).exists()]

    # Grouped, so you stay in one visual context instead of being thrown
    # between a nebula and a waterfall on consecutive keypresses. Python's sort
    # is stable, so the order is the same every run and ← always finds the
    # image you were just looking at.
    items.sort(key=lambda c: (c.get("source", ""), c.get("cat", "")))
    if args.triage:
        # Score order instead, so the obvious ones arrive in a run and go
        # by at the speed of one key. Images scored before they were
        # downloaded, which score.py has not seen, go last.
        sign = 1 if args.triage == "reject" else -1
        # Still grouped by category, score order within each.
        items.sort(key=lambda c: (c.get("source", ""), c.get("cat", ""),
                                  c["url"] not in scores, sign * scores.get(c["url"], 0)))
    elif args.flash:
        # Grouped by category; within one, the approvals the model doubts
        # most come first, where a mistake is likeliest.
        items.sort(key=lambda c: (c.get("source", ""), c.get("cat", ""),
                                  scores.get(c["url"], 1)))
    elif args.sample:
        # Blocks of SAMPLE_BLOCK from each category in turn: any stretch you
        # review covers them all, without switching category every image.
        # The shuffle is seeded so the order is the same every run and a
        # session picks up where the last one ended.
        rng = random.Random(0)
        by_cat = {}
        for c in items:
            by_cat.setdefault(c.get("cat", ""), []).append(c)
        for group in by_cat.values():
            rng.shuffle(group)
        longest = max(map(len, by_cat.values()))
        items = [c for k in range(0, longest, SAMPLE_BLOCK)
                 for g in by_cat.values() for c in g[k:k + SAMPLE_BLOCK]]

    if not items:
        missing = [c for c in candidates if not path_for(c["url"]).exists()]
        print(f"nothing to review ({len(latest):,} already decided, "
              f"{len(missing):,} candidates not downloaded yet)")
        print("run `python curate/download.py` if that second number is large.")
        return

    start = next((j for j, c in enumerate(items) if c["url"] not in latest), len(items))
    if args.flash:
        # Everything here is decided, so resume where the last flash pass
        # stopped rather than at the first undecided image.
        saved = load_prefs().get("flash_position", {}).get(args.source or "", "")
        start = next((j for j, c in enumerate(items) if c["url"] == saved), 0)
    undecided = sum(1 for c in items if c["url"] not in latest)

    # ASCII on purpose: a Windows console is cp1252 and printing the arrow
    # glyphs here raises UnicodeEncodeError before the window ever opens.
    # The on-screen legend, which Tk renders itself, keeps the arrows.
    print(f"{len(items):,} in the list, {undecided:,} undecided. "
          "Up = approve, Down = reject, Left/Right = move, End = next undecided, Esc = quit.")
    root = tk.Tk()
    root.title("SlowFrame — review")
    root.configure(bg="black")
    root.attributes("-fullscreen", True)
    root.config(cursor="none")
    rv = Reviewer(items, latest, start, root, scores, flash=args.flash)
    rv.position_key = args.source or ""
    root.mainloop()


if __name__ == "__main__":
    main()
