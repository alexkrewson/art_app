// Live queries against the Wikimedia Commons API (keyless, CORS-open via
// `origin=*` — verified directly against commons.wikimedia.org). Two curated
// genre categories are exposed as checkboxes (the friendly path — no syntax
// to learn), plus a free-text field for anything else, including manually
// typed Category: browsing. There's no dedicated public API for the sci-fi/
// fantasy genre, so browsing real Commons categories is the closest thing.
import { shuffle } from './base.js';

const API = 'https://commons.wikimedia.org/w/api.php';

// Commons' `imageinfo.url` is the ORIGINAL file, and on this collection that is
// not a reasonable thing to put on a phone: a sample of ten "Featured pictures
// of landscapes" averaged 20.5 MB, with one 80.9 MB file at 17806x6969. Asking
// for `iiurlwidth` makes the API also return `thumburl`, a server-rendered
// scale-down — the same two files come back at 1.01 MB and 0.43 MB, i.e. 33x
// and 189x smaller.
//
// This was not a theoretical concern. It was Alex's 2026-08-08 report that the
// slideshow "gets stuck for 30 seconds" once live sources are enabled, while
// the bundled local set at the same 2s interval is perfectly smooth.
//
// 1920 is chosen to still look right on a 1080p wall display with Ken Burns
// zoomed in, while staying around half a megabyte.
const THUMB_WIDTH = 1920;

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
    // thumburl is absent for formats Commons can't render a thumbnail of;
    // falling back to the original is still better than showing nothing.
    image: info.thumburl || info.url,
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
    // 50 per request, and page with continuation — NOT one big request.
    //
    // Commons returns `extmetadata` for only the first 50 pages of any
    // response, whatever gcmlimit says. Measured against the live API:
    //
    //   gcmlimit=50  ->  50 pages,  50 with licence metadata (100%)
    //   gcmlimit=100 -> 100 pages,  50 with licence metadata  (50%)
    //   gcmlimit=200 -> 198 pages,  50 with licence metadata  (25%)
    //
    // Everything past the 50th arrives with no licence at all, and this source
    // (rightly) refuses anything whose licence it can't confirm — so a single
    // large request can never yield more than ~50 usable images regardless of
    // how many it asks for. Raising the limit to 500 on 2026-08-09 therefore
    // fixed nothing: it fetched four times as much and threw three quarters
    // away. Paging properly is what actually lifts the ceiling.
    const PAGE = 50;

    async function fetchPages(baseParams, contKey) {
      // Enough candidates to survive the licence filter and de-duplication.
      const want = Math.max(count * 2, PAGE);
      const out = [];
      let cont;
      for (let guard = 0; out.length < want && guard < 12; guard++) {
        const params = new URLSearchParams(baseParams);
        if (cont) params.set(contKey, cont);
        const res = await fetch(`${API}?${params.toString()}`);
        if (!res.ok) throw new Error(`Wikimedia Commons search failed: HTTP ${res.status}`);
        const data = await res.json();
        out.push(...Object.values(data.query?.pages || {}));
        cont = data.continue?.[contKey];
        if (!cont) break; // end of the category
      }
      return out;
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
      const batches = await Promise.all(categoryTitles.map(gcmtitle => fetchPages({
        action: 'query', format: 'json', origin: '*',
        generator: 'categorymembers', gcmtitle, gcmtype: 'file', gcmlimit: String(PAGE),
        prop: 'imageinfo', iiprop: 'url|extmetadata|mime', iiurlwidth: String(THUMB_WIDTH),
      }, 'gcmcontinue')));
      pages = batches.flat();
    } else {
      pages = await fetchPages({
        action: 'query', format: 'json', origin: '*',
        generator: 'search', gsrsearch: query, gsrnamespace: '6', gsrlimit: String(PAGE),
        prop: 'imageinfo', iiprop: 'url|extmetadata|mime', iiurlwidth: String(THUMB_WIDTH),
      }, 'gsroffset');
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
