#!/usr/bin/env python3
"""Adds a caption bar below each image with title, artist, and date."""
import json
import os
from PIL import Image, ImageDraw, ImageFont

OUTPUT_DIR = "images_captioned"
PADDING = 20
BG_COLOR = (20, 20, 20)
TEXT_COLOR = (240, 240, 240)
DIM_COLOR = (170, 170, 170)

os.makedirs(OUTPUT_DIR, exist_ok=True)

# Try to load a decent font, fall back to default
def load_font(size):
    for path in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
    ]:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()

font_title = load_font(28)
font_sub = load_font(22)

with open("images.json") as f:
    images = json.load(f)

for i, img_data in enumerate(images):
    src = img_data["image"]
    if not os.path.exists(src):
        print(f"[{i+1}/{len(images)}] missing {src}, skipping")
        continue

    title = img_data.get("title", "Untitled")
    artist = img_data.get("artist", "")
    date = img_data.get("date", "")

    # Build subtitle line
    sub_parts = [p for p in [artist.split("\n")[0], date] if p]
    subtitle = "  —  ".join(sub_parts)

    img = Image.open(src).convert("RGB")
    w, h = img.size

    # Measure text to size the caption bar
    tmp = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    _, title_h = tmp.textsize(title, font=font_title)
    sub_h = tmp.textsize(subtitle, font=font_sub)[1] if subtitle else 0
    caption_h = PADDING + title_h + (PADDING // 2 + sub_h if subtitle else 0) + PADDING

    out = Image.new("RGB", (w, h + caption_h), BG_COLOR)
    out.paste(img, (0, 0))

    draw = ImageDraw.Draw(out)
    y = h + PADDING
    draw.text((PADDING, y), title, font=font_title, fill=TEXT_COLOR)
    if subtitle:
        y += title_h + PADDING // 2
        draw.text((PADDING, y), subtitle, font=font_sub, fill=DIM_COLOR)

    out_path = os.path.join(OUTPUT_DIR, f"{i:04d}.jpg")
    out.save(out_path, "JPEG", quality=90)
    print(f"[{i+1}/{len(images)}] {title[:60]}")

print(f"\nDone. Saved to {OUTPUT_DIR}/")
