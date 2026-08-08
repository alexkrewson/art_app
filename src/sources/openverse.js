// Openverse (api.openverse.org) — a keyless, CORS-open aggregator that indexes
// openly-licensed images from Flickr (~536M), iNaturalist (~266M), Wikimedia
// (~89M), Europeana, the Smithsonian and a dozen museums, with a
// machine-readable licence on every single record.
//
// Verified live against the real API while building this (unlike
// smithsonian.js/europeana.js/rijksmuseum.js, which were written blind):
// `Access-Control-Allow-Origin: *` confirmed, and the anonymous limits were
// measured rather than assumed — 20 req/min burst, 200 req/day sustained,
// `page_size` capped at 20 (anything larger 401s), and pagination depth capped
// at 240 results ("pagination depth may not exceed 240 for anonymous
// requests" at page 13 of 20).
//
// Those limits are per-IP, not per-key. That's the reason this source is safe
// to ship in a distributed APK when a baked-in shared API key is not: every
// install gets its own quota instead of contending for one 1,000/hour bucket
// that's also extractable from the APK (the objection already logged against
// shipping a personal api.data.gov key for Smithsonian).
import { shuffle } from './base.js';

const API = 'https://api.openverse.org/v1/images/';
const PAGE_SIZE = 20;   // anonymous cap — larger values 401
const MAX_PAGE = 12;    // anonymous depth cap is 240 results = 12 * PAGE_SIZE

// The legal gate, and the whole reason this source can exist at all.
// `commercial` drops the NC (NonCommercial) licences, because a Play Store
// listing is at best an arguable case for non-commercial use and we don't
// want to be making that argument per-image. `modification` drops the ND
// (NoDerivatives) licences, because Ken Burns pans and crops the image rather
// than displaying it whole. What survives is CC0, Public Domain Mark, CC BY
// and CC BY-SA — all of which we can display, with credit where it's due.
const LICENSE_TYPE = 'commercial,modification';

// CC0 and the Public Domain Mark carry no attribution requirement; everything
// else that survives LICENSE_TYPE (CC BY, CC BY-SA) does. Same split as
// wikimedia.js, and the ribbon renders it the same way — the creator name is
// already carried by `artist`, so this only needs the licence identifier.
function licenseLabel(license, version) {
  const id = (license || '').toLowerCase();
  if (id === 'cc0') return 'CC0';
  if (id === 'pdm') return 'Public domain';
  return `CC ${id.toUpperCase()}${version ? ` ${version}` : ''}`;
}

function requiresCredit(license) {
  const id = (license || '').toLowerCase();
  return id !== 'cc0' && id !== 'pdm';
}

function toRecord(r) {
  const license = licenseLabel(r.license, r.license_version);
  return {
    title: r.title || 'Untitled',
    artist: r.creator || '',
    // Openverse exposes `indexed_on` (when *it* crawled the image), not when
    // the photo was taken — a 2020 crawl date on a 1890 photograph would be
    // an actively wrong caption, so the ribbon's date stays empty.
    date: '',
    department: r.source || '',
    image: r.url,
    source: 'openverse',
    attribution: requiresCredit(r.license) ? license : '',
  };
}

export const openverseSource = {
  id: 'openverse',
  label: 'Openverse',
  needsApiKey: false,
  description: 'Openly-licensed photography aggregated from Flickr, iNaturalist, Wikimedia and museum collections.',

  listFilters() {
    return [
      {
        key: 'subjects', label: 'Curated subjects', type: 'checkboxGroup',
        options: [
          { value: 'landscape', label: 'Landscapes' },
          { value: 'mountain', label: 'Mountains' },
          { value: 'forest', label: 'Forests' },
          { value: 'coast ocean', label: 'Coast & ocean' },
          { value: 'aurora night sky', label: 'Night sky & aurora' },
          { value: 'desert canyon', label: 'Deserts & canyons' },
          { value: 'waterfall river', label: 'Rivers & waterfalls' },
          { value: 'wildlife', label: 'Wildlife' },
        ],
      },
      {
        key: 'query', label: 'Search', type: 'text',
        placeholder: 'e.g. glacier, autumn woodland',
        default: 'landscape',
      },
      { key: 'photosOnly', label: 'Photographs only (exclude illustrations)', type: 'checkbox', default: true },
    ];
  },

  async fetchBatch({ filters = {}, count = 24 } = {}) {
    const subjects = Array.isArray(filters.subjects) ? filters.subjects.filter(Boolean) : [];
    const freeText = (filters.query || '').trim();
    // Ticked subjects win over the free-text field, same precedence as
    // wikimedia.js' curated categories — the checkboxes are the friendly path.
    const queries = subjects.length ? subjects : [freeText || 'landscape'];
    const photosOnly = filters.photosOnly !== false;

    // Spread the target across however many subjects are ticked, then
    // over-sample by half again so the has-image/licence filtering below has
    // slack before it runs short.
    const perQuery = Math.ceil((count * 1.5) / queries.length);
    const pagesEach = Math.max(1, Math.min(Math.ceil(perQuery / PAGE_SIZE), MAX_PAGE));

    async function fetchPage(q, page) {
      const params = new URLSearchParams({
        q,
        license_type: LICENSE_TYPE,
        page_size: String(PAGE_SIZE),
        page: String(page),
        mature: 'false',
      });
      if (photosOnly) params.set('category', 'photograph');
      const res = await fetch(`${API}?${params.toString()}`);
      if (!res.ok) throw new Error(`Openverse search failed: HTTP ${res.status}`);
      const data = await res.json();
      return data.results || [];
    }

    // Always starting at page 1 would show the same top-ranked images every
    // session. Anonymous callers can reach 240 results deep, so pick a random
    // window inside that instead — the pool the user actually sees over time
    // is 240 per subject, not 20.
    const start = 1 + Math.floor(Math.random() * (MAX_PAGE - pagesEach + 1));

    const batches = await Promise.all(queries.flatMap(q =>
      Array.from({ length: pagesEach }, (_, i) => fetchPage(q, start + i))
    ));

    const results = [];
    const seen = new Set();
    for (const r of shuffle(batches.flat())) {
      if (results.length >= count) break;
      if (!r.url || seen.has(r.url)) continue;
      // Belt-and-braces on top of `mature=false`: the API applies it, but this
      // runs unattended on a wall display, so a flag that arrives set anyway
      // is not something to pass through on trust.
      if (r.mature) continue;
      seen.add(r.url);
      results.push(toRecord(r));
    }
    return results;
  },
};
