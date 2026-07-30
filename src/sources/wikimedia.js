// Live queries against the Wikimedia Commons API (keyless, CORS-open via
// `origin=*` — verified directly against commons.wikimedia.org). A single
// free-text search field doubles as the general keyword source AND the
// mechanism behind the "Sci-Fi & Fantasy" preset (src/sources/presets.js),
// which just points this field at a curated category search — there's no
// dedicated public API for that genre, so this is it.
import { shuffle } from './base.js';

const API = 'https://commons.wikimedia.org/w/api.php';

// Commons' extmetadata values are raw wiki HTML (links, spans) — strip tags
// for plain-text display in the metadata ribbon.
function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, '').trim();
}

// Commons hosts a mix of Public domain/CC0 and attribution-required licenses
// (CC BY, CC BY-SA) — unlike the museum sources, which are pre-filtered to
// CC0/public-domain only by their own APIs. Anything outside this allowlist
// (or with no license at all) is excluded rather than risk redistributing
// something without the terms it requires.
function isPermissiveLicense(license) {
  if (!license) return false;
  const l = license.trim().toLowerCase();
  return l === 'public domain' || l === 'cc0' || l.startsWith('cc by');
}

function getLicense(meta) {
  return stripHtml(meta.LicenseShortName?.value);
}

function toRecord(page) {
  const info = page.imageinfo?.[0];
  const meta = info?.extmetadata || {};
  const title = stripHtml(meta.ObjectName?.value) || page.title.replace(/^File:/, '').replace(/\.[^.]+$/, '');
  const artist = stripHtml(meta.Artist?.value) || stripHtml(meta.Credit?.value) || '';
  const license = getLicense(meta);
  // Public domain/CC0 need no attribution; CC BY/CC BY-SA do. The creator
  // name is already covered by `artist` below — this only needs to add the
  // license identifier itself, not repeat the name.
  const requiresCredit = license && !/^public domain$/i.test(license) && license.toLowerCase() !== 'cc0';
  return {
    title,
    artist,
    date: stripHtml(meta.DateTimeOriginal?.value) || stripHtml(meta.DateTime?.value) || '',
    department: '',
    image: info.url,
    source: 'wikimedia',
    attribution: requiresCredit ? license : '',
  };
}

export const wikimediaSource = {
  id: 'wikimedia',
  label: 'Wikimedia Commons',
  needsApiKey: false,
  description: 'Live search against Wikimedia Commons\' media collection.',

  listFilters() {
    return [
      {
        key: 'query', label: 'Search or category', type: 'text',
        placeholder: 'e.g. impressionism, or Category:Science_fiction_art',
        default: 'illustration',
      },
    ];
  },

  async fetchBatch({ filters = {}, count = 24 } = {}) {
    const query = (filters.query || '').trim() || 'illustration';
    const limit = String(Math.min(count * 3, 50));

    // "Category:X" isn't valid full-text search syntax — Commons needs the
    // categorymembers generator to browse a category directly, versus the
    // search generator for a plain relevance search. Verified directly
    // against the live API while building this: gsrsearch on a bare
    // "Category:..." string returned zero results.
    // A `|`-separated list of Category: entries (e.g. the Sci-Fi & Fantasy
    // preset's "Category:Science fiction art|Category:Fantasy art") browses
    // each and merges the results — free-text search alone was surfacing
    // off-topic matches (author photos, library-shelf photos) alongside the
    // actual art, since Commons' relevance search has no genre concept.
    const segments = query.split('|').map(s => s.trim()).filter(Boolean);
    const isCategoryQuery = segments.length > 0 && segments.every(s => s.toLowerCase().startsWith('category:'));

    async function fetchPages(params) {
      const res = await fetch(`${API}?${params.toString()}`);
      if (!res.ok) throw new Error(`Wikimedia Commons search failed: HTTP ${res.status}`);
      const data = await res.json();
      return Object.values(data.query?.pages || {});
    }

    let pages;
    if (isCategoryQuery) {
      const batches = await Promise.all(segments.map(gcmtitle => fetchPages(new URLSearchParams({
        action: 'query', format: 'json', origin: '*',
        generator: 'categorymembers', gcmtitle, gcmtype: 'file', gcmlimit: limit,
        prop: 'imageinfo', iiprop: 'url|extmetadata|mime',
      }))));
      pages = batches.flat();
    } else {
      pages = await fetchPages(new URLSearchParams({
        action: 'query', format: 'json', origin: '*',
        generator: 'search', gsrsearch: query, gsrnamespace: '6', gsrlimit: limit,
        prop: 'imageinfo', iiprop: 'url|extmetadata|mime',
      }));
    }

    const results = [];
    for (const page of shuffle(pages)) {
      if (results.length >= count) break;
      const info = page.imageinfo?.[0];
      if (!info?.url || !info.mime?.startsWith('image/')) continue;
      if (!isPermissiveLicense(getLicense(info.extmetadata || {}))) continue;
      results.push(toRecord(page));
    }
    return results;
  },
};
