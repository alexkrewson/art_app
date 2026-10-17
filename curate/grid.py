#!/usr/bin/env python
"""Confirms score.py's confident guesses a page at a time instead of one by one.

    python curate/grid.py --source nasa          # likely rejects, 40 to a page
    python curate/grid.py --source nasa --keep   # likely keeps instead
    python curate/grid.py --source nasa --below 50   # into the unsure band, up to 50% keep
    python curate/grid.py --source nasa --unsure     # the unsure band, each image its own guess
    python curate/grid.py --source nasa --recheck keep   # look over your approvals again

Every image on the page starts marked with the model's guess. Look over the
page, then:

    left click     spare an image: it stays undecided, for the reviewer
                   (click again to mark it once more). In an --unsure grid a
                   click cycles: its guess, the other verdict, spared, back.
    right button   hold to see that image large
    Enter / Space  record the marked ones and show the next page
    Esc / q        quit; the page on screen is NOT recorded

Only images the model is confident about are shown (outside the band score.py
checked itself on); the unsure middle is left for review.py. The pages come in
score order within each category (a category always starts a new page), so
the surest guesses are first and it gets less certain as you
go — slow down when the page starts looking mixed.

Decisions go to decisions.jsonl exactly as the reviewer writes them, plus
"via": "grid", so they can be found again. A wrong one is fixed the usual way:
find it in review.py (or its file in curate/rejected/) and press the other key.
"""
import argparse
import json
import threading
import time
import tkinter as tk

from PIL import Image, ImageTk

import review as R

COLS, ROWS = 8, 5
FOOTER = 60
GAP = 6
MARK = {"reject": "#c0392b", "keep": "#2e9e4f"}


class Grid:
    def __init__(self, root, items, scores, verdict, current=None):
        self.root = root
        self.items = items          # grouped by category, in the order pages are cut from
        self.scores = scores
        self.verdict = verdict      # "reject", "keep", or "mixed": each image its own guess
        # --recheck: url -> decision already recorded. Images start marked with
        # it, a click flips it, and Enter records only the ones that changed.
        self.current = current or {}
        self.pages = self._paginate()   # needs scores, verdict and current, so after them
        self.page = 0
        self.marks = {}             # index on page -> what Enter records for it; None = spared
        self.done = 0
        self.photos = {}            # index on page -> PhotoImage; Tk does not keep them
        self.big = None
        self.next_imgs = None       # the following page, decoded in the background
        self.loading = None

        sw, sh = root.winfo_screenwidth(), root.winfo_screenheight()
        self.sw, self.sh = sw, sh
        self.cell = min(sw // COLS, (sh - FOOTER) // ROWS)
        self.x0 = (sw - self.cell * COLS) // 2
        self.canvas = tk.Canvas(root, bg="black", highlightthickness=0, width=sw, height=sh)
        self.canvas.pack(fill="both", expand=True)
        self.status = self.canvas.create_text(24, sh - 30, anchor="w", fill="#cccccc",
                                              font=("Segoe UI", 13), text="")

        self.canvas.bind("<Button-1>", self.toggle)
        self.canvas.bind("<ButtonPress-3>", self.enlarge)
        self.canvas.bind("<ButtonRelease-3>", self.shrink)
        for key in ("<Return>", "<KP_Enter>", "<space>"):
            root.bind(key, lambda e: self.confirm())
        root.bind("<Escape>", lambda e: self.quit())
        root.bind("q", lambda e: self.quit())
        self.show()

    # ── pages ────────────────────────────────────────────────────────────
    def _slice(self, page):
        return self.pages[page] if page < len(self.pages) else []

    def _paginate(self):
        """Pages of up to COLS*ROWS that hold one category and one starting
        verdict: a new category, or the guess flipping from reject to keep,
        starts a fresh page. Mixed red and green on one page is much harder
        to judge at a glance (Alex's call, 2026-10-17)."""
        n, pages, last = COLS * ROWS, [], None
        for rec in self.items:
            key = (rec.get("cat"), self._initial(rec))
            if not pages or len(pages[-1]) == n or key != last:
                pages.append([])
            pages[-1].append(rec)
            last = key
        return pages

    def _initial(self, rec):
        """What an image starts marked as: its recorded decision in a recheck,
        otherwise the grid's verdict, or in a mixed grid its own guess."""
        if rec["url"] in self.current:
            return self.current[rec["url"]]
        if self.verdict != "mixed":
            return self.verdict
        return "keep" if self.scores[rec["url"]] >= 0.5 else "reject"

    def _decode(self, recs):
        side = self.cell - 2 * GAP
        out = []
        for rec in recs:
            try:
                with Image.open(R.path_for(rec["url"])) as img:
                    img = img.convert("RGB")
                    img.thumbnail((side, side), Image.LANCZOS)
                    out.append(img)
            except Exception:  # noqa: BLE001 — shown as an empty cell, never recorded
                out.append(None)
        return out

    def _prefetch(self):
        page = self.page + 1
        def work():
            self.next_imgs = (page, self._decode(self._slice(page)))
        self.loading = threading.Thread(target=work, daemon=True)
        self.loading.start()

    def show(self):
        recs = self._slice(self.page)
        if not recs:
            return self.finish()
        if self.loading:
            self.loading.join()
        imgs = (self.next_imgs[1] if self.next_imgs and self.next_imgs[0] == self.page
                else self._decode(recs))
        self.canvas.delete("cell")
        self.photos = {}
        self.recs = recs
        self.marks = {i: self._guess(i) for i, img in enumerate(imgs) if img is not None}
        for i, img in enumerate(imgs):
            x, y = self._origin(i)
            c = self.cell
            self.canvas.create_rectangle(x + 2, y + 2, x + c - 2, y + c - 2, width=4,
                                         outline="", tags=("cell", f"frame{i}"))
            if img is not None:
                self.photos[i] = ImageTk.PhotoImage(img)
                self.canvas.create_image(x + c // 2, y + c // 2, image=self.photos[i],
                                         tags=("cell",))
            self.canvas.create_text(x + c - 10, y + c - 8, anchor="se", fill="white",
                                    font=("Segoe UI", 10, "bold"), tags=("cell", f"pct{i}"),
                                    text=f"{self.scores[recs[i]['url']]:.0%}")
            self._paint(i)
        self._draw_status()
        self._prefetch()

    def _origin(self, i):
        return self.x0 + (i % COLS) * self.cell, (i // COLS) * self.cell

    def _at(self, x, y):
        col, row = (x - self.x0) // self.cell, y // self.cell
        i = row * COLS + col
        if 0 <= col < COLS and 0 <= row < ROWS and 0 <= i < len(self.recs):
            return i
        return None

    @property
    def marked(self):
        """Indices on this page that Enter will record."""
        return {i for i, m in self.marks.items() if m}

    def _guess(self, i):
        return self._initial(self.recs[i])

    def _paint(self, i):
        m = self.marks.get(i)
        self.canvas.itemconfig(f"frame{i}", outline=MARK[m] if m else "#444444",
                               dash=() if m else (4, 4))
        self.canvas.itemconfig(f"pct{i}", fill="white" if m else "#777777")

    def _draw_status(self):
        pages = len(self.pages)
        cat = R.short_cat(self.recs[0].get("cat", "")) if self.recs else ""
        keep = sum(m == "keep" for m in self.marks.values())
        reject = sum(m == "reject" for m in self.marks.values())
        spared = len(self.recs) - keep - reject
        click = ("click  flip approve / reject" if self.current else
                 "click  cycle approve / reject / spare" if self.verdict == "mixed"
                 else "click  spare / re-mark")
        self.canvas.itemconfig(self.status, text=(
            f"{cat}     page {self.page + 1} / {pages}     approve {keep}   reject {reject}   spare {spared}"
            f"     {self.done:,} recorded this session     |     {click}"
            f"   hold right button  enlarge   Enter  record + next page   Esc  quit"))

    # ── mouse ────────────────────────────────────────────────────────────
    def toggle(self, e):
        """Single-verdict grids flip between the verdict and spared. A mixed
        grid cycles from the guess to the other verdict, to spared, and back."""
        i = self._at(e.x, e.y)
        if i is None or i not in self.photos:
            return
        guess = self._guess(i)
        other = {"keep": "reject", "reject": "keep"}[guess]
        order = ([guess, other] if self.current else
                 [guess, other, None] if self.verdict == "mixed" else [guess, None])
        self.marks[i] = order[(order.index(self.marks.get(i)) + 1) % len(order)]
        self._paint(i)
        self._draw_status()

    def enlarge(self, e):
        i = self._at(e.x, e.y)
        if i is None or i not in self.photos:
            return
        with Image.open(R.path_for(self.recs[i]["url"])) as img:
            img = img.convert("RGB")
            img.thumbnail((self.sw, self.sh - FOOTER), Image.LANCZOS)
        self.big = ImageTk.PhotoImage(img)
        self.canvas.create_rectangle(0, 0, self.sw, self.sh - FOOTER, fill="black",
                                     width=0, tags=("big",))
        self.canvas.create_image(self.sw // 2, (self.sh - FOOTER) // 2, image=self.big,
                                 tags=("big",))
        title = self.recs[i].get("title", "") or "Untitled"
        self.canvas.create_text(self.sw // 2, self.sh - FOOTER - 12, anchor="s", fill="white",
                                font=("Segoe UI", 13), text=title[:160], tags=("big",))

    def shrink(self, e):
        self.canvas.delete("big")
        self.big = None

    # ── recording ────────────────────────────────────────────────────────
    def confirm(self):
        if self.big is not None:
            return
        # Unchanged rechecks are not rewritten: the decision is already there.
        record = [i for i in sorted(self.marked)
                  if self.marks[i] != self.current.get(self.recs[i]["url"])]
        with R.DECISIONS.open("a", encoding="utf-8") as f:
            for i in record:
                rec = self.recs[i]
                f.write(json.dumps({
                    "url": rec["url"],
                    "decision": self.marks[i],
                    "source": rec.get("source", ""),
                    "cat": rec.get("cat", ""),
                    "at": int(time.time()),
                    "via": "grid",
                }) + "\n")
        for i in record:
            R.place(self.recs[i]["url"], self.marks[i])
        self.done += len(record)
        self.page += 1
        self.show()

    def finish(self):
        # Nothing left for Enter to record: without this, Enter on the end
        # screen wrote the last page a second time.
        self.recs, self.marks = [], {}
        self.canvas.delete("cell")
        self.canvas.itemconfig(self.status, text=f"{self.done:,} recorded this session")
        lo, hi = R.GUESS_BAND
        self.canvas.create_text(
            self.sw // 2, self.sh // 2, anchor="center", fill="#cccccc", justify="center",
            font=("Segoe UI", 16), tags=("cell",), text=(
                "No more confident guesses.\n\n"
                f"What is left scored between {lo:.0%} and {hi:.0%}: review it one by one with\n"
                "python curate/review.py --triage\n\n"
                "Retrain first (python curate/score.py) — it learns from what you just did.\n"
                "Esc to close."))

    def quit(self):
        self.root.destroy()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", help="only this source (openverse, wikimedia, nasa)")
    ap.add_argument("--keep", action="store_true",
                    help="confirm likely keeps instead of likely rejects")
    ap.add_argument("--below", type=float, metavar="PCT",
                    help="reach into the unsure band: show images scored under PCT%% keep "
                         "(default: only confident ones). With --keep, over 100-PCT%%.")
    ap.add_argument("--unsure", action="store_true",
                    help="the unsure band instead, each image pre-marked with its own "
                         "guess: approve at 50%% keep or more, otherwise reject")
    ap.add_argument("--recheck", choices=("keep", "reject"),
                    help="look over images already approved (keep) or rejected, the ones "
                         "the model doubts most first; a click flips one")
    args = ap.parse_args()

    if not R.SCORES.exists():
        print("no scores yet: run `python curate/score.py` first.")
        return
    data = json.loads(R.SCORES.read_text(encoding="utf-8"))
    scores = data["scores"]
    lo, hi = R.GUESS_BAND = tuple(data.get("confident", R.GUESS_BAND))
    if args.below is not None:
        # Wider than score.py checked itself on, so the pages get mixed sooner:
        # this is for when you have seen the unsure end and it is still rejects.
        lo, hi = args.below / 100, 1 - args.below / 100
        R.GUESS_BAND = (lo, hi)

    latest = R.latest_decisions()
    R.sync_mirror(latest)
    seen, items = set(), []
    for rec in R.load_jsonl(R.CANDIDATES):
        u = rec["url"]
        if u in seen or u not in scores:
            continue
        seen.add(u)
        if args.source and rec.get("source") != args.source:
            continue
        s = scores[u]
        if args.recheck:
            wanted = latest.get(u) == args.recheck
        else:
            wanted = u not in latest and (lo <= s <= hi if args.unsure else
                                          s > hi if args.keep else s < lo)
        if wanted and R.path_for(u).exists():
            items.append(rec)
    # Least likely to be kept first, except for a keep grid. An unsure grid
    # in that order turns from mostly red to mostly green as you page.
    # A recheck shows the decisions the model doubts most first: approvals it
    # scores lowest, rejections it scores highest.
    # Grouped by category throughout (Alex finds mixed pages harder to
    # judge), score order within each.
    flip = (args.recheck == "reject") if args.recheck else (args.keep and not args.unsure)
    items.sort(key=lambda c: (c.get("source", ""), c.get("cat", ""),
                              -scores[c["url"]] if flip else scores[c["url"]]))

    verdict = args.recheck or ("mixed" if args.unsure else "keep" if args.keep else "reject")
    what = {"mixed": "unsure images", "keep": "confident keeps", "reject": "confident rejects"}
    if args.recheck:
        what[verdict] = f"{'approved' if verdict == 'keep' else 'rejected'} images"
    print(f"{len(items):,} {what[verdict]} to confirm, {COLS * ROWS} to a page. "
          "Click = change, Enter = record page, Esc = quit.")
    if not items:
        return
    root = tk.Tk()
    root.title("SlowFrame — grid")
    root.configure(bg="black")
    root.attributes("-fullscreen", True)
    Grid(root, items, scores, verdict, latest if args.recheck else None)
    root.mainloop()


if __name__ == "__main__":
    main()
