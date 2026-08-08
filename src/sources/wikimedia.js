// Live queries against the Wikimedia Commons API (keyless, CORS-open via
// `origin=*` — verified directly against commons.wikimedia.org). Two curated
// genre categories are exposed as checkboxes (the friendly path — no syntax
// to learn), plus a free-text field for anything else, including manually
// typed Category: browsing. There's no dedicated public API for the sci-fi/
// fantasy genre, so browsing real Commons categories is the closest thing.
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
        key: 'categories', label: 'Curated categories', type: 'checkboxGroup',
        options: [
          { value: 'Science fiction art', label: 'Sci-Fi art' },
          { value: 'Fantasy art', label: 'Fantasy art' },
          // Commons' "Featured pictures" and "Quality images" are its own
          // peer-reviewed quality tiers, which is what makes these worth
          // browsing as categories rather than searching — they're the
          // closest legitimate equivalent to what a photography subreddit
          // surfaces, minus the licensing problem. One checkbox pairs both
          // tiers via the `|` split below. File counts verified live against
          // the API while adding these; categories that sound like they
          // should exist but don't (seascapes, skies, aurorae, deserts) were
          // dropped rather than shipped as silently-empty checkboxes.
          { value: 'Featured pictures of landscapes|Quality images of landscapes', label: 'Landscapes' },
          { value: 'Featured pictures of mountains|Quality images of mountains', label: 'Mountains' },
          { value: 'Featured pictures of forests|Quality images of forests', label: 'Forests' },
          { value: 'Quality images of waterfalls', label: 'Waterfalls' },
        ],
      },
      {
        key: 'query', label: 'Search or category', type: 'text',
        placeholder: 'e.g. impressionism, or Category:Science_fiction_art',
        default: 'illustration',
      },
    ];
  },

  async fetchBatch({ filters = {}, count = 24 } = {}) {
    const checkedCategories = Array.isArray(filters.categories) ? filters.categories.filter(Boolean) : [];
    const query = (filters.query || '').trim() || 'illustration';
    const limit = String(Math.min(count * 3, 50));

    async function fetchPages(params) {
      const res = await fetch(`${API}?${params.toString()}`);
      if (!res.ok) throw new Error(`Wikimedia Commons search failed: HTTP ${res.status}`);
      const data = await res.json();
      return Object.values(data.query?.pages || {});
    }

    // "Category:X" isn't valid full-text search syntax — Commons needs the
    // categorymembers generator to browse a category directly, versus the
    // search generator for a plain relevance search. Verified directly
    // against the live API while building this: gsrsearch on a bare
    // "Category:..." string returned zero results.
    // Checked category checkboxes win over the free-text field — they're
    // the friendly path for the two curated genres. The free-text field
    // still supports a manually typed "Category:X" or `|`-joined list for
    // anything else, as a fallback when no checkbox is ticked. Free-text
    // relevance search alone was surfacing off-topic matches (author
    // photos, a library-shelf photo) alongside the actual art, since
    // Commons' relevance search has no genre concept — categories fix that.
    let categoryTitles = null;
    if (checkedCategories.length > 0) {
      // A single checkbox may name several categories, `|`-separated — the
      // quality-tier options above pair Commons' "Featured pictures of X"
      // with "Quality images of X" so one tick means "the good ones", rather
      // than making the user reason about Commons' internal review tiers.
      categoryTitles = checkedCategories
        .flatMap(c => c.split('|').map(s => s.trim()).filter(Boolean))
        .map(c => `Category:${c}`);
    } else {
      const segments = query.split('|').map(s => s.trim()).filter(Boolean);
      if (segments.length > 0 && segments.every(s => s.toLowerCase().startsWith('category:'))) {
        categoryTitles = segments;
      }
    }

    let pages;
    if (categoryTitles) {
      const batches = await Promise.all(categoryTitles.map(gcmtitle => fetchPages(new URLSearchParams({
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
