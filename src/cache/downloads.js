// "Download this category for offline use" — the deliberate counterpart to
// imageCache.js's incidental caching, which only ever stores what happened to
// be shown. Alex asked for the Spotify/YouTube shape: pick a category, pick how
// much, have it there when there's no connection.
//
// Everything a download stores is pinned, so the incidental 300-image cap can
// neither refuse it nor evict it. The bound is the storage budget instead.
import { SOURCES } from '../sources/registry.js';
import { cacheRecord, getStorageBudget } from './imageCache.js';

// A stable key for one downloadable thing, so re-downloading the same category
// tops it up rather than creating a second pile. Curated-subject values can
// contain spaces and punctuation ("coast ocean", "Featured pictures of
// landscapes|Quality images of landscapes"), hence the encode.
export function collectionKey(sourceId, subject) {
  return subject ? `${sourceId}::${encodeURIComponent(subject)}` : sourceId;
}

// The filter object a download should fetch with: the source's currently
// configured filters (API keys, keywords) but narrowed to the one subject being
// downloaded, so "Landscapes" doesn't quietly pull whatever else is ticked.
function filtersForSubject(source, savedFilters, subjectKey, subject) {
  const filters = { ...savedFilters };
  if (subjectKey && subject) filters[subjectKey] = [subject];
  return filters;
}

// Which filter, if any, is this source's curated-subject checkbox group? That's
// the thing worth downloading per-category; sources without one download whole.
export function subjectFilterSpec(source) {
  const specs = source.listFilters?.() || [];
  return Array.isArray(specs) ? specs.find(f => f.type === 'checkboxGroup') : undefined;
}

// Enumerates what can be downloaded: one entry per curated subject where a
// source has them, otherwise a single whole-source entry.
export function downloadableTargets(sourceId, source) {
  const spec = subjectFilterSpec(source);
  if (!spec?.options?.length) {
    return [{ sourceId, subject: null, subjectKey: null, label: source.label,
              collection: collectionKey(sourceId, null) }];
  }
  return spec.options.map(o => ({
    sourceId,
    subject: o.value,
    subjectKey: spec.key,
    label: `${source.label} — ${o.label}`,
    collection: collectionKey(sourceId, o.value),
  }));
}

/**
 * Fetches `count` records for one target and stores them pinned.
 *
 * Resolves to a summary rather than throwing on a partial result: a download
 * that got 60 of 100 because the budget filled is a useful outcome the UI
 * should report honestly, not an error. `stoppedEarly` says whether the number
 * is short of what was asked, and `reason` says why.
 */
export async function downloadTarget(target, savedFilters, count, onProgress = () => {}) {
  const source = SOURCES[target.sourceId];
  if (!source) return { added: 0, requested: count, stoppedEarly: true, reason: 'unknown-source' };

  const filters = filtersForSubject(source, savedFilters, target.subjectKey, target.subject);

  let records;
  try {
    records = await source.fetchBatch({ filters, count });
  } catch (err) {
    console.warn(`[SlowFrame] download failed for ${target.collection}:`, err);
    return { added: 0, requested: count, stoppedEarly: true, reason: 'fetch-failed' };
  }

  if (!records.length) {
    return { added: 0, requested: count, stoppedEarly: true, reason: 'no-results' };
  }

  let added = 0;
  let reason = null;
  for (let i = 0; i < records.length; i++) {
    // Sequential on purpose. This is a background convenience competing with
    // the slideshow's own image loading for the same connection, and a burst of
    // parallel fetches is exactly what would make playback stutter while a
    // download runs.
    const status = await cacheRecord(records[i], {
      pinned: true,
      collection: target.collection,
      label: target.label,
    });
    if (status === 'budget-full') { reason = 'budget-full'; break; }
    if (status === 'cached' || status === 'promoted') added += 1;
    onProgress({ done: i + 1, total: records.length, added });
  }

  return {
    added,
    requested: count,
    stoppedEarly: reason !== null || records.length < count,
    reason: reason || (records.length < count ? 'source-returned-fewer' : null),
  };
}

// Used by the UI to show a used/total bar. Kept here so the panel doesn't need
// to know how the budget is derived.
export async function storageSummary() {
  const { usage, quota, budget, available } = await getStorageBudget();
  return {
    usage, quota, budget, available,
    percent: budget ? Math.min(100, Math.round((usage / budget) * 100)) : 0,
  };
}

export function formatBytes(n) {
  if (!n) return '0 MB';
  const mb = n / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}
