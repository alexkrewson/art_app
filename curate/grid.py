#!/usr/bin/env python
"""Confirms score.py's confident guesses a page at a time instead of one by one.

    python curate/grid.py --source nasa          # likely rejects, 40 to a page
    python curate/grid.py --source nasa --keep   # likely keeps instead

Every image on the page starts marked with the model's guess. Look over the
page, then:

    left click     spare an image: it stays undecided, for the reviewer
                   (click again to mark it once more)
    right button   hold to see that image large
    Enter / Space  record the marked ones and show the next page
    Esc / q        quit; the page on screen is NOT recorded

Only images the model is confident about are shown (outside the band score.py
checked itself on); the unsure middle is left for review.py. The pages come in
score order, so the surest guesses are first and it gets less certain as you
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
    def __init__(self, root, items, scores, verdict):
        self.root = root
        self.items = items          # in the order pages are cut from
        self.scores = scores
        self.verdict = verdict      # what Enter records: "reject" or "keep"
        self.page = 0
        self.marked = set()         # indices on this page that Enter will record
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
        n = COLS * ROWS
        return self.items[page * n:(page + 1) * n]

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
        self.marked = {i for i, img in enumerate(imgs) if img is not None}
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

    def _paint(self, i):
        on = i in self.marked
        self.canvas.itemconfig(f"frame{i}", outline=MARK[self.verdict] if on else "#444444",
                               dash=() if on else (4, 4))
        self.canvas.itemconfig(f"pct{i}", fill="white" if on else "#777777")

    def _draw_status(self):
        pages = (len(self.items) + COLS * ROWS - 1) // (COLS * ROWS)
        word = "reject" if self.verdict == "reject" else "approve"
        self.canvas.itemconfig(self.status, text=(
            f"page {self.page + 1} / {pages}     {len(self.marked)} of {len(self.recs)} marked to {word}"
            f"     {self.done:,} recorded this session     |     click  spare / re-mark"
            f"   hold right button  enlarge   Enter  {word} marked + next page   Esc  quit"))

    # ── mouse ────────────────────────────────────────────────────────────
    def toggle(self, e):
        i = self._at(e.x, e.y)
        if i is None or i not in self.photos:
            return
        self.marked ^= {i}
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
        with R.DECISIONS.open("a", encoding="utf-8") as f:
            for i in sorted(self.marked):
                rec = self.recs[i]
                f.write(json.dumps({
                    "url": rec["url"],
                    "decision": self.verdict,
                    "source": rec.get("source", ""),
                    "cat": rec.get("cat", ""),
                    "at": int(time.time()),
                    "via": "grid",
                }) + "\n")
        for i in self.marked:
            R.place(self.recs[i]["url"], self.verdict)
        self.done += len(self.marked)
        self.page += 1
        self.show()

    def finish(self):
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
    args = ap.parse_args()

    if not R.SCORES.exists():
        print("no scores yet: run `python curate/score.py` first.")
        return
    data = json.loads(R.SCORES.read_text(encoding="utf-8"))
    scores = data["scores"]
    lo, hi = R.GUESS_BAND = tuple(data.get("confident", R.GUESS_BAND))

    latest = R.latest_decisions()
    R.sync_mirror(latest)
    seen, items = set(), []
    for rec in R.load_jsonl(R.CANDIDATES):
        u = rec["url"]
        if u in seen or u in latest or u not in scores:
            continue
        seen.add(u)
        if args.source and rec.get("source") != args.source:
            continue
        if (scores[u] > hi) if args.keep else (scores[u] < lo):
            if R.path_for(u).exists():
                items.append(rec)
    items.sort(key=lambda c: scores[c["url"]], reverse=args.keep)

    verdict = "keep" if args.keep else "reject"
    print(f"{len(items):,} confident {'keeps' if args.keep else 'rejects'} to confirm, "
          f"{COLS * ROWS} to a page. Click = spare, Enter = record page, Esc = quit.")
    if not items:
        return
    root = tk.Tk()
    root.title("SlowFrame — grid")
    root.configure(bg="black")
    root.attributes("-fullscreen", True)
    Grid(root, items, scores, verdict)
    root.mainloop()


if __name__ == "__main__":
    main()
