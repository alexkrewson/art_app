// The downloaded library: what the slideshow actually plays.
//
// The model changed on 2026-08-09 at Alex's request. Previously a category
// checkbox meant "fetch from this API while playing" and a separate Download
// button meant "also keep some offline". That split never made sense — every
// image shown had to be fetched anyway, so the only real question was whether
// it was fetched predictably in advance or unpredictably mid-slideshow, on
// someone's mobile data, with the stutter that implies.
//
// Now ticking a category IS downloading it, and the slideshow only ever plays
// images already on disk. Nothing streams.
//
// A row here is one image belonging to one or more categories. Categories
// overlap in practice (Commons' Landscapes and Mountains share files, as do
// two Openverse subject searches), so membership is a list and an image only
// leaves disk when its last category does.

import { SOURCES } from '../sources/registry.js';
import { storeImage, deleteStored, resolveStored, isNative, usageBytes, freeBytes } from '../cache/fileStore.js';

const DB_NAME = 'slowframe-library';
const DB_VERSION = 1;
const IMAGES = 'images';
const BLOCKED = 'blocked';

// Measured from the live APIs on 2026-08-08 (see maintenance_todo.md's payload
// table) so the size confirmation quotes something real rather than one
// hand-waved average for everything — the sources differ by 55x, from Met's
// 0.06 MB thumbnails to NPS's 3.3 MB /proxy/hires files.
const AVG_BYTES = {
  met: 60_000,
  openverse: 240_000,
  aic: 250_000,
  wikimedia: 310_000,
  nps: 3_300_000,
  nasa: 400_000,
  smithsonian: 400_000,
  europeana: 400_000,
  rijksmuseum: 700_000,
  flickr: 300_000,
};
const AVG_FALLBACK = 400_000;

export function estimateBytes(sourceId, count) {
  return (AVG_BYTES[sourceId] || AVG_FALLBACK) * count;
}

export const DEFAULT_COUNT = 100;

// A stable key for one tickable thing. Curated-subject values contain spaces
// and punctuation ("coast ocean", "Featured pictures of landscapes|Quality
// images of landscapes"), hence the encode.
export const catId = (sourceId, subject) =>
  subject ? `${sourceId}::${encodeURIComponent(subject)}` : sourceId;

/** A source's curated-subject checkbox group, if it has one. */
export function subjectSpec(source) {
  const specs = source.listFilters?.() || [];
  return Array.isArray(specs) ? specs.find(f => f.type === 'checkboxGroup') : undefined;
}

/**
 * Everything tickable for a source: one entry per curated subject, or a single
 * whole-source entry for sources without them (Met, AIC, NASA, …), so both
 * kinds behave identically in the UI.
 */
export function categoriesOf(sourceId, source) {
  const spec = subjectSpec(source);
  if (!spec?.options?.length) {
    return [{ sourceId, subject: null, subjectKey: null, label: source.label, cat: catId(sourceId, null) }];
  }
  return spec.options.map(o => ({
    sourceId,
    subject: o.value,
    subjectKey: spec.key,
    label: o.label,
    cat: catId(sourceId, o.value),
  }));
}

export function formatBytes(n) {
  if (!n) return '0 MB';
  const mb = n / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IMAGES)) {
        const s = db.createObjectStore(IMAGES, { keyPath: 'url' });
        // multiEntry: one image, many categories. Removing "Mountains" must not
        // delete a file "Landscapes" is still using.
        s.createIndex('cats', 'cats', { multiEntry: true });
        s.createIndex('vote', 'vote', { unique: false });
      }
      // Downvotes outlive their files: the whole point is that the image never
      // comes back, including from a different category or a later refresh.
      if (!db.objectStoreNames.contains(BLOCKED)) {
        db.createObjectStore(BLOCKED, { keyPath: 'url' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

const getAll = (db, store) => new Promise((resolve, reject) => {
  const req = db.transaction(store, 'readonly').objectStore(store).getAll();
  req.onsuccess = () => resolve(req.result || []);
  req.onerror = () => reject(req.error);
});

// ── Blocklist ────────────────────────────────────────────────────────────
export async function blockUrl(url) {
  const db = await openDB();
  await tx(db, BLOCKED, 'readwrite', s => s.put({ url, at: Date.now() }));
}

export async function blockedUrls() {
  const db = await openDB();
  return new Set((await getAll(db, BLOCKED)).map(r => r.url));
}

// ── Reading ──────────────────────────────────────────────────────────────
export async function allImages() {
  const db = await openDB();
  return getAll(db, IMAGES);
}

/**
 * The playlist: every stored image belonging to at least one active category,
 * skipping anything downvoted. Verifies each file still exists before offering
 * it, so a cleared app storage shows fewer images rather than broken frames.
 */
export async function playlistFor(activeCats) {
  const active = new Set(activeCats);
  const rows = await allImages();
  const out = [];
  for (const row of rows) {
    if (row.vote === -1) continue;
    if (!(row.cats || []).some(c => active.has(c))) continue;
    let src = row.src;
    if (isNative()) {
      src = await resolveStored(row.path);
      if (!src) continue; // file vanished under us
    }
    out.push({ ...row.record, image: src, url: row.url, vote: row.vote || 0 });
  }
  return out;
}

export async function stats() {
  const rows = await allImages();
  const byCat = {};
  let bytes = 0;
  for (const row of rows) {
    bytes += row.bytes || 0;
    for (const c of row.cats || []) byCat[c] = (byCat[c] || 0) + 1;
  }
  return {
    count: rows.length,
    bytes: isNative() ? await usageBytes() : bytes,
    free: await freeBytes(),
    upvoted: rows.filter(r => r.vote === 1).length,
    byCat,
  };
}

// ── Writing ──────────────────────────────────────────────────────────────
async function putImage(row) {
  const db = await openDB();
  await tx(db, IMAGES, 'readwrite', s => s.put(row));
}

export async function setVote(url, vote) {
  const db = await openDB();
  const existing = await new Promise((res, rej) => {
    const r = db.transaction(IMAGES, 'readonly').objectStore(IMAGES).get(url);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  if (!existing) return;

  if (vote === -1) {
    // A downvote is a deletion plus a promise: reclaim the space and make sure
    // it can't be re-downloaded by this or any other category.
    await deleteStored(existing.path);
    await tx(db, IMAGES, 'readwrite', s => s.delete(url));
    await blockUrl(url);
    return;
  }
  await putImage({ ...existing, vote });
}

/** Drops a category. Files go only when no other category still wants them. */
export async function removeCategory(cat) {
  const db = await openDB();
  const rows = await getAll(db, IMAGES);
  let deleted = 0;
  for (const row of rows) {
    const cats = row.cats || [];
    if (!cats.includes(cat)) continue;
    const rest = cats.filter(c => c !== cat);
    if (rest.length) {
      await putImage({ ...row, cats: rest });
    } else if (row.vote === 1) {
      // Upvoted images survive their category being unticked — throwing away
      // something the user explicitly liked would be the wrong default.
      await putImage({ ...row, cats: ['__kept'] });
    } else {
      await deleteStored(row.path);
      await tx(db, IMAGES, 'readwrite', s => s.delete(row.url));
      deleted++;
    }
  }
  return deleted;
}

/**
 * Downloads up to `count` images for one category.
 *
 * Reports progress per image and resolves with a summary. Never throws: a
 * download that half-succeeded is a useful outcome to report, not an error to
 * unwind — and the images already on disk stay there.
 */
export async function downloadCategory({ sourceId, subjectKey, subject, cat, count, filters = {} }, onProgress = () => {}) {
  const source = SOURCES[sourceId];
  if (!source) return { added: 0, requested: count, reason: 'unknown-source' };

  const scoped = { ...filters };
  if (subjectKey && subject) scoped[subjectKey] = [subject];

  let records;
  try {
    // Over-fetch: some records will already be held, blocked, or fail to
    // download, and asking for exactly `count` reliably returns fewer.
    records = await source.fetchBatch({ filters: scoped, count: Math.ceil(count * 1.4) });
  } catch (err) {
    console.warn(`[SlowFrame] fetch failed for ${cat}:`, err);
    return { added: 0, requested: count, reason: 'fetch-failed' };
  }
  if (!records.length) return { added: 0, requested: count, reason: 'no-results' };

  const blocked = await blockedUrls();
  const db = await openDB();
  const held = new Map((await getAll(db, IMAGES)).map(r => [r.url, r]));

  let added = 0;
  let reason = null;

  for (const record of records) {
    if (added >= count) break;
    const url = record.image;
    if (!url || blocked.has(url)) continue;

    const existing = held.get(url);
    if (existing) {
      // Already downloaded under another category — just widen its membership
      // rather than fetching the same bytes twice.
      if (!(existing.cats || []).includes(cat)) {
        await putImage({ ...existing, cats: [...(existing.cats || []), cat] });
        added++;
        onProgress({ done: added, total: count, reused: true });
      }
      continue;
    }

    const stored = await storeImage(url);
    if (!stored.ok && isNative()) {
      // A single dead URL shouldn't abort the batch; keep going.
      if (stored.reason === 'error') reason = 'some-failed';
      continue;
    }

    await putImage({
      url,
      path: stored.path || null,
      src: stored.src || url, // web keeps the remote URL; native gets a file URL
      bytes: stored.bytes || 0,
      record: { ...record, image: undefined }, // src is resolved fresh each play
      cats: [cat],
      vote: 0,
      addedAt: Date.now(),
    });
    added++;
    onProgress({ done: added, total: count });
  }

  return {
    added,
    requested: count,
    reason: reason || (added < count ? 'source-returned-fewer' : null),
  };
}

/**
 * Replaces the un-upvoted part of a category with fresh images, keeping the
 * same total. For when a set starts to feel stale — upvotes are the whole
 * point of the feature, so they survive.
 */
export async function refreshCategory(spec, onProgress = () => {}) {
  const db = await openDB();
  const rows = await getAll(db, IMAGES);
  const inCat = rows.filter(r => (r.cats || []).includes(spec.cat));
  const keep = inCat.filter(r => r.vote === 1);
  const drop = inCat.filter(r => r.vote !== 1);

  for (const row of drop) {
    const rest = (row.cats || []).filter(c => c !== spec.cat);
    if (rest.length) {
      await putImage({ ...row, cats: rest });
    } else {
      await deleteStored(row.path);
      await tx(db, IMAGES, 'readwrite', s => s.delete(row.url));
    }
  }

  // Top back up to the same size, minus what was kept.
  const want = Math.max(0, (spec.count ?? inCat.length) - keep.length);
  const result = want ? await downloadCategory({ ...spec, count: want }, onProgress) : { added: 0, requested: 0 };
  return { ...result, kept: keep.length, replaced: drop.length };
}
