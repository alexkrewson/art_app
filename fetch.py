#!/usr/bin/env python3
import requests
import json
import sys

BASE = "https://api.artic.edu/api/v1"
IIIF = "https://www.artic.edu/iiif/2"
PAGE_SIZE = 100

images = []
page = 1

while True:
    print(f"Fetching page {page}...")
    resp = requests.post(f"{BASE}/artworks/search", json={
        "query": {"term": {"is_boosted": True}},
        "fields": ["id", "title", "artist_display", "date_display", "image_id", "department_title"],
        "limit": PAGE_SIZE,
        "page": page,
    }, timeout=15)
    resp.raise_for_status()
    data = resp.json()

    for obj in data["data"]:
        if obj.get("image_id"):
            images.append({
                "title": obj.get("title", "Untitled"),
                "artist": obj.get("artist_display", "Unknown"),
                "date": obj.get("date_display", ""),
                "department": obj.get("department_title", ""),
                "image": f"{IIIF}/{obj['image_id']}/full/843,/0/default.jpg",
            })

    total_pages = data["pagination"]["total_pages"]
    print(f"  {len(images)} images so far (page {page}/{total_pages})")

    if page >= total_pages:
        break
    page += 1

with open("images.json", "w") as f:
    json.dump(images, f, indent=2)

print(f"\nDone. Saved {len(images)} images to images.json.")
print("Now run: python3 -m http.server 8000")
print("Then open: http://localhost:8000/slideshow.html")
