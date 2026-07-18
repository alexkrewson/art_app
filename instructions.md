Build a Python script that downloads classical art images with metadata from The Metropolitan Museum of Art's public API and composites artist/title labels onto each image for display on an e-ink screen.
Requirements:
Screen config (constants at top of file):

SCREEN_WIDTH = 1448
SCREEN_HEIGHT = 1072
JPEG_QUALITY = 70

Fetching:

Query the Met API (https://collectionapi.metmuseum.org/public/collection/v1/) for all public domain artworks with images, across all departments
Before downloading, fetch metadata for all matching objects and score each one, then sort descending by score and download in that order — so if interrupted at 20k, you have the best 20k
Rate-limit to ~2 req/sec

Scoring system (higher = better, download first):

+40 if isHighlight is true (Met's own curated best-of)
+20 if artist name is known (not blank/unknown)
+15 if isTimeHighlight is true
+10 if the object has an artistWikidata_URL (indicates notable enough to be in Wikidata)
+10 if high-res image is available (isPublicDomain + large image URL present)
+8 if department is in: European Paintings, Greek and Roman Art, Egyptian Art, Medieval Art, Asian Art, Islamic Art, The American Wing, Drawings and Prints
+5 if date/period is filled in
+3 if culture is filled in
-5 if title contains "Fragment" or "Fragments"
-5 if title is blank or "Untitled"

Image processing:

Download high-res image, fall back to primary image
Fit to 1448x1072 maintaining aspect ratio, letterbox/pillarbox with black fill
Composite a label in the bottom of the image: Title, Artist (or culture/period if unknown), Date — high contrast white text on semi-transparent dark background, using system font or Pillow default, readable but not dominating

Output:

Save to --output directory (default: ./art)
Filename: {score:03d}_{objectID}_{artistlastname}.jpg so files sort by quality
Save/update manifest.json mapping objectID → filename + full metadata + score
Skip already-downloaded objectIDs (resumable)
Log progress: [1234/20000] score=63 | Rembrandt | The Night Watch | European Paintings

CLI args:

--count (default: 500)
--output (default: ./art)
--min-score (optional, skip anything below threshold)
--highlights-only (optional, only fetch isHighlight works)

Dependencies: requests, Pillow. No external fonts required.