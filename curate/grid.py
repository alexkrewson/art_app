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
    left drag      every image the rectangle touches goes the same way: off if
                   the one you started on was marked, on otherwise
    hover          a large preview on the other half of the screen
    right button   hold to see that image full screen
    → / Enter / Space   record this page and show the next one
    ←              back to the previous page, as you left it. Nothing is
                   recorded going back; what you change there is written when
                   you move forward off it again, and only what changed
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
DRAG_PX = 6         # a press that moves further than this is a drag, not a click
HOVER_MS = 250      # rest the pointer this long on an image to preview it


class Grid:
    def __init__(self, root, items, scores, verdict, current=None, recorded=None):
        self.root = root
        self.items = items          # grouped by category, in the order pages are cut from
        self.scores = scores
        self.verdict = verdict      # "reject", "keep", or "mixed": each image its own guess
        # --recheck: url -> decision already recorded. Images start marked with
        # it, and a click flips it rather than sparing it.
        self.current = current or {}
        # url -> decision as decisions.jsonl stands, kept current as pages are
        # left. Leaving a page writes only what differs from this, so going
        # back and forth never writes the same decision twice.
        self.recorded = dict(recorded if recorded is not None else self.current)
        self.pages = self._paginate()   # needs scores, verdict and current, so after them
        self.page = 0
        self.page_marks = {}        # page -> its marks when last left, for ← to bring back
        self.recs = []
        self.marks = {}             # index on page -> what leaving records for it; None = spared
        self.done = 0
        self.photos = {}            # index on page -> PhotoImage; Tk does not keep them
        self.big = None
        self.next_imgs = None       # the following page, decoded in the background
        self.loading = None
        self.press = None           # (x, y) of a left press, until its release
        self.dragging = False
        self.hover_i = None
        self.hover_job = None
        self.hover_photo = None
        self.preview_cache = {}     # url -> PIL image at preview size, a few at most

        sw, sh = root.winfo_screenwidth(), root.winfo_screenheight()
        self.sw, self.sh = sw, sh
        self.cell = min(sw // COLS, (sh - FOOTER) // ROWS)
        self.x0 = (sw - self.cell * COLS) // 2
        self.canvas = tk.Canvas(root, bg="black", highlightthickness=0, width=sw, height=sh)
        self.canvas.pack(fill="both", expand=True)
        self.status = self.canvas.create_text(24, sh - 30, anchor="w", fill="#cccccc",
                                              font=("Segoe UI", 13), text="")

        self.canvas.bind("<ButtonPress-1>", self.on_press)
        self.canvas.bind("<B1-Motion>", self.on_drag)
        self.canvas.bind("<ButtonRelease-1>", self.on_release)
        self.canvas.bind("<Motion>", self.on_motion)
        self.canvas.bind("<Leave>", lambda e: self._unhover())
        self.canvas.bind("<ButtonPress-3>", self.enlarge)
        self.canvas.bind("<ButtonRelease-3>", self.shrink)
        for key in ("<Return>", "<KP_Enter>", "<space>", "<Right>"):
            root.bind(key, lambda e: self.go(1))
        root.bind("<Left>", lambda e: self.go(-1))
        root.bind("<Escape>", lambda e: self.quit())
        root.bind("q", lambda e: self.quit())
        self.show()

    # ── pages ────────────────────────────────────────────────────────────
    def _slice(self, page):
        return self.pages[page] if 0 <= page < len(self.pages) else []

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
        self._unhover()
        recs = self._slice(self.page)
        if not recs:
            return self.finish()
        if self.loading:
            self.loading.join()
        imgs = (self.next_imgs[1] if self.next_imgs and self.next_imgs[0] == self.page
                else self._decode(recs))
        self.canvas.delete("cell", "end")
        self.photos = {}
        self.recs = recs
        # A page you come back to shows what you left it as.
        self.marks = dict(self.page_marks.get(self.page) or {
            i: self._guess(i) for i, img in enumerate(imgs) if img is not None})
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
        """Indices on this page that leaving it will record."""
        return {i for i, m in self.marks.items() if m}

    def _guess(self, i):
        return self._initial(self.recs[i])

    def _off(self, i):
        """The state a drag takes a marked image to: spared, or in a recheck,
        the other verdict."""
        if self.current:
            return {"keep": "reject", "reject": "keep"}[self._guess(i)]
        return None

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
        self.canvas.itemconfig(self.status, text=(
            f"{cat}     page {self.page + 1} / {pages}     approve {keep}   reject {reject}"
            f"   spare {spared}     {self.done:,} recorded     |     click / drag  change"
            f"   hover  preview   hold right  full screen   →  record + next   ←  back   Esc  quit"))

    # ── mouse ────────────────────────────────────────────────────────────
    def on_press(self, e):
        self._unhover()
        self.press, self.dragging = (e.x, e.y), False

    def on_drag(self, e):
        if self.press is None:
            return
        x0, y0 = self.press
        if not self.dragging and max(abs(e.x - x0), abs(e.y - y0)) < DRAG_PX:
            return
        self.dragging = True
        self.canvas.delete("lasso")
        self.canvas.create_rectangle(x0, y0, e.x, e.y, outline="white", width=2,
                                     dash=(6, 4), tags=("lasso",))

    def on_release(self, e):
        if self.press is None:
            return
        x0, y0 = self.press
        self.press = None
        self.canvas.delete("lasso")
        if self.dragging:
            self.drag_select(x0, y0, e.x, e.y)
        else:
            self.toggle(e)

    def drag_select(self, x0, y0, x1, y1):
        """Every image the rectangle touches goes the same way: off if the one
        the drag started on was marked, on otherwise."""
        lx, rx, ty, by = min(x0, x1), max(x0, x1), min(y0, y1), max(y0, y1)
        c = self.cell
        hit = []
        for i in sorted(self.photos):
            ox, oy = self._origin(i)
            if ox < rx and ox + c > lx and oy < by and oy + c > ty:
                hit.append(i)
        if not hit:
            return
        ref = self._at(x0, y0)
        ref = ref if ref in self.photos else hit[0]
        turn_off = self.marks.get(ref) == self._guess(ref)
        for i in hit:
            self.marks[i] = self._off(i) if turn_off else self._guess(i)
            self._paint(i)
        self._draw_status()

    def toggle(self, e):
        """Single-verdict grids flip between the verdict and spared. A mixed
        grid cycles from the guess to the other verdict, to spared, and back.
        A recheck flips between the two verdicts."""
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

    # ── previews ─────────────────────────────────────────────────────────
    def on_motion(self, e):
        if self.press is not None or self.big is not None:
            return
        i = self._at(e.x, e.y)
        i = i if i in self.photos else None
        if i == self.hover_i:
            return
        self._unhover()
        self.hover_i = i
        if i is not None:
            self.hover_job = self.root.after(HOVER_MS, lambda: self._hover(i))

    def _hover(self, i):
        """A large preview on the half of the screen away from the pointer,
        so it never covers the image being pointed at."""
        self.hover_job = None
        if i != self.hover_i or i >= len(self.recs):
            return
        url = self.recs[i]["url"]
        w, h = self.sw // 2 - 40, self.sh - FOOTER - 40
        img = self.preview_cache.get(url)
        if img is None:
            try:
                with Image.open(R.path_for(url)) as im:
                    img = im.convert("RGB")
                    img.thumbnail((w, h), Image.LANCZOS)
            except Exception:  # noqa: BLE001
                return
            if len(self.preview_cache) > 8:
                self.preview_cache.pop(next(iter(self.preview_cache)))
            self.preview_cache[url] = img
        ox, _ = self._origin(i)
        cx = self.sw * 3 // 4 if ox + self.cell // 2 < self.sw // 2 else self.sw // 4
        cy = (self.sh - FOOTER) // 2
        self.hover_photo = ImageTk.PhotoImage(img)
        m = self.marks.get(i)
        self.canvas.create_rectangle(cx - img.width // 2 - 6, cy - img.height // 2 - 6,
                                     cx + img.width // 2 + 6, cy + img.height // 2 + 6,
                                     fill="black", outline=MARK[m] if m else "#444444",
                                     width=4, tags=("hover",))
        self.canvas.create_image(cx, cy, image=self.hover_photo, tags=("hover",))

    def _unhover(self):
        if self.hover_job is not None:
            self.root.after_cancel(self.hover_job)
            self.hover_job = None
        self.hover_i = None
        self.canvas.delete("hover")
        self.hover_photo = None

    def enlarge(self, e):
        self._unhover()
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
    def go(self, step):
        """Show the next or previous page. Only moving forward records: going
        back to fix the page before must not commit a page you have only
        glanced at. Going back keeps this page's marks for when you return."""
        if self.big is not None or self.press is not None:
            return
        if self.recs:
            if step > 0:
                self._record_page()
            else:
                self.page_marks[self.page] = dict(self.marks)
        self.page = max(0, min(self.page + step, len(self.pages)))
        self.show()

    def confirm(self):
        self.go(1)

    def _record_page(self):
        """Writes each image whose mark differs from what is recorded. A spared
        image that had a decision gets a "skip" line, which clears it."""
        self.page_marks[self.page] = dict(self.marks)
        changes = []
        for i in sorted(self.photos):
            url = self.recs[i]["url"]
            new = self.marks.get(i)
            if new != self.recorded.get(url):
                changes.append((i, new or "skip"))
        with R.DECISIONS.open("a", encoding="utf-8") as f:
            for i, decision in changes:
                rec = self.recs[i]
                f.write(json.dumps({
                    "url": rec["url"],
                    "decision": decision,
                    "source": rec.get("source", ""),
                    "cat": rec.get("cat", ""),
                    "at": int(time.time()),
                    "via": "grid",
                }) + "\n")
        for i, decision in changes:
            url = self.recs[i]["url"]
            R.place(url, decision)
            if decision == "skip":
                self.recorded.pop(url, None)
            else:
                self.recorded[url] = decision
        self.done += len(changes)

    def finish(self):
        self.recs, self.marks, self.photos = [], {}, {}
        self.canvas.delete("cell", "end")
        self.canvas.itemconfig(self.status, text=f"{self.done:,} recorded this session     "
                                                 "←  back to the last page   Esc  quit")
        self.canvas.create_text(
            self.sw // 2, self.sh // 2, anchor="center", fill="#cccccc", justify="center",
            font=("Segoe UI", 16), tags=("end",), text=(
                "That was the last page.\n\n"
                "← goes back if you want another look.\n"
                "Esc to close; I retrain on what you did."))

    def quit(self):
        # The page on screen is left unrecorded, as before: Esc is the way out
        # without committing to it.
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
    Grid(root, items, scores, verdict, latest if args.recheck else None, latest)
    root.mainloop()


if __name__ == "__main__":
    main()
