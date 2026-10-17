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

The list holds decided images as well as undecided ones, so ← walks back into
earlier sessions too. An image you have already decided shows a badge and a
coloured frame; press ↑ or ↓ on it again to change your mind. That replaces the
old undo key: at one image per second the images you most want back are the
ones you rejected by accident, and now you just go back and flip them.

The previous and next images sit either side of the current one, smaller, with
their badges, so a decision you just made stays visible on the left after you
have moved past it. Pressing ↑ or ↓ also stamps the verdict large across the
image for FLASH_MS before moving on. Any key pressed during the stamp finishes
it at once, so it confirms what happened without setting the pace.

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

LOOKAHEAD = 6
LOOKBEHIND = 2
FOOTER = 60
FLASH_MS = 250          # how long the verdict stamp shows before moving on
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
    def __init__(self, items, latest, start, root):
        self.items = items
        self.latest = latest         # url -> "keep" | "reject", kept current as you go
        self.root = root
        self.i = start
        self.dir = 1                 # last direction of travel, for stepping over bad files
        self.bad = set()             # indices whose file would not decode
        self.cache = {}              # index -> PIL.Image at main size, filled by the loader thread
        self.small = {}              # index -> PIL.Image at preview size, made on demand
        self.pending = None          # Tk `after` id while a verdict stamp is showing
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

        self.show()

    # ── image loading ────────────────────────────────────────────────────
    def _loader(self):
        """Decodes around the reviewer so a keypress never waits on a JPEG."""
        while True:
            idx = self.want.get()
            if idx is None:
                return
            ahead = range(idx, min(idx + LOOKAHEAD, len(self.items)))
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
                        if k < idx - LOOKBEHIND - 2 or k > idx + LOOKAHEAD + 1:
                            del self.cache[k]

    def _load(self, idx):
        try:
            img = Image.open(path_for(self.items[idx]["url"]))
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
        title = rec.get("title", "") or "Untitled"
        artist = rec.get("artist", "")
        self.canvas.itemconfig(self.title_txt, text=f"{title}{'  —  ' + artist if artist else ''}"[:180])

    def _draw_status(self):
        rec = self.items[self.i]
        self.canvas.itemconfig(self.status, text=(
            f"{self.i + 1:,} / {len(self.items):,}     {self._tally()}"
            f"     |     {short_cat(rec.get('cat', ''))}"
            f"     |     ↑ approve   ↓ reject   ← →  move   End  next undecided   Esc  quit"
        ))

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
        self.pending = self.root.after(FLASH_MS, self._advance)

    def finish(self):
        for slot in self.slots.values():
            self._hide_slot(slot)
        self._hide_stamp()
        self.canvas.itemconfig(self.status, text=self._tally())
        self.canvas.itemconfig(self.title_txt, text="")
        left = sum(1 for r in self.items if r["url"] not in self.latest)
        more = (f"{left:,} still undecided — End jumps to the first one.\n"
                if left else "Everything here is decided.\n")
        self.canvas.itemconfig(self.notice, text=(
            "End of the list.\n\n" + more +
            "← to go back.   Esc to close, then run  python curate/apply.py"))

    def quit(self):
        self.want.put(None)
        self.root.destroy()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", help="only this source (openverse, wikimedia, nasa)")
    ap.add_argument("--cat", help="only this category id")
    ap.add_argument("--undecided", action="store_true",
                    help="leave images already approved or rejected out of the list")
    args = ap.parse_args()

    latest = latest_decisions()
    sync_mirror(latest)

    candidates, seen = [], set()
    for rec in load_jsonl(CANDIDATES):
        if rec["url"] in seen:
            continue
        seen.add(rec["url"])
        candidates.append(rec)

    items = [c for c in candidates
             if (not args.undecided or c["url"] not in latest)
             and (not args.source or c.get("source") == args.source)
             and (not args.cat or c.get("cat") == args.cat)
             and path_for(c["url"]).exists()]

    # Grouped, so you stay in one visual context instead of being thrown
    # between a nebula and a waterfall on consecutive keypresses. Python's sort
    # is stable, so the order is the same every run and ← always finds the
    # image you were just looking at.
    items.sort(key=lambda c: (c.get("source", ""), c.get("cat", "")))

    if not items:
        missing = [c for c in candidates if not path_for(c["url"]).exists()]
        print(f"nothing to review ({len(latest):,} already decided, "
              f"{len(missing):,} candidates not downloaded yet)")
        print("run `python curate/download.py` if that second number is large.")
        return

    start = next((j for j, c in enumerate(items) if c["url"] not in latest), len(items))
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
    Reviewer(items, latest, start, root)
    root.mainloop()


if __name__ == "__main__":
    main()
