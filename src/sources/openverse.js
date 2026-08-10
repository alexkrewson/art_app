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
        // Each subject is several narrower queries joined by `~`, not one
        // broad one. Openverse caps an anonymous caller at 240 results deep
        // PER QUERY and repeats heavily inside that window, so one broad term
        // tops out around 40-80 unique images however many are requested —
        // measured, and the reason "wildlife" sat at 60 of 100 on the tablet.
        // Several narrower terms each get their own 240-result window, which
        // multiplies the reachable set without an API key, and gives more
        // varied results into the bargain.
        options: [
          { value: 'landscape~valley~meadow~countryside', label: 'Landscapes' },
          { value: 'mountain~alps~summit~glacier peak', label: 'Mountains' },
          { value: 'forest~woodland~redwood~jungle canopy', label: 'Forests' },
          { value: 'coast~ocean waves~beach cliffs~fjord', label: 'Coast & ocean' },
          { value: 'aurora borealis~milky way~starry night sky~moonrise', label: 'Night sky & aurora' },
          { value: 'desert dunes~canyon~badlands~mesa', label: 'Deserts & canyons' },
          { value: 'waterfall~river rapids~lake reflection~stream', label: 'Rivers & waterfalls' },
          { value: 'wildlife~bird in flight~deer~big cat~whale', label: 'Wildlife' },
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
    // `~` splits one ticked subject into its constituent queries.
    const queries = subjects.length
      ? subjects.flatMap(v => String(v).split('~').map(t => t.trim()).filter(Boolean))
      : [freeText || 'landscape'];
    const photosOnly = filters.photosOnly !== false;

    // Over-sample by half again, so the filtering below has slack.
    //
    // Worth knowing before trying to raise this: Openverse repeats results
    // heavily across pages. Measured against the live API, 8 pages (160 raw
    // results) for "landscape" yielded 60 unique images — a ~62% duplicate
    // rate — so a single fetch tops out around 40-80 unique per subject
    // whatever you ask for. Raising the multiplier to 3x (using all 12 pages
    // of the anonymous window) was tried on 2026-08-10 and measured: landscape
    // stayed at 60 and aurora came back lower, within run-to-run variance. It
    // was reverted because it spends 50% more of a 200/day quota for no
    // demonstrated gain.
    //
    // The way to get more of a subject is repeated downloads, not a bigger
    // one: each pass starts at a random page and de-duplicates against what's
    // already held, so topping a category up several times does accumulate.
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
      if (!res.ok) {
        // One bad page must not sink the batch. Narrow queries have fewer
        // pages than broad ones, and asking past the end returns a 500 rather
        // than an empty list — which took down every query in the request when
        // this threw. Logged, not swallowed silently.
        console.warn(`[SlowFrame] Openverse page ${page} for "${q}" failed: HTTP ${res.status}`);
        return { results: [], pageCount: 0 };
      }
      const data = await res.json();
      return { results: data.results || [], pageCount: Math.min(data.page_count || 1, MAX_PAGE) };
    }

    // Ask page 1 first and read how many pages this particular query actually
    // has, rather than assuming every query fills the 12-page window. Then take
    // a random slice of what's really there, so repeat downloads of the same
    // subject reach different images.
    async function fetchQuery(q, pagesWanted) {
      const first = await fetchPage(q, 1);
      const out = [...first.results];
      const available = first.pageCount;
      if (pagesWanted <= 1 || available <= 1) return out;

      const take = Math.min(pagesWanted, available);
      const start = 1 + Math.floor(Math.random() * Math.max(1, available - take + 1));
      const rest = await Promise.all(
        Array.from({ length: take }, (_, i) => start + i)
          .filter(n => n !== 1 && n <= available)
          .map(n => fetchPage(q, n).then(r => r.results)),
      );
      return out.concat(rest.flat());
    }

    const batches = await Promise.all(queries.map(q => fetchQuery(q, pagesEach)));

    const results = [];
    const seen = new Set();
    for (const r of shuffle(batches.flat())) {
      if (results.length >= count) break;
      // Deduplicate on the Openverse id as well as the URL. Two subject
      // searches overlap heavily, and the same photo also turns up indexed
      // more than once with different URLs — a live batch of 12 came back with
      // the same MTAPhotos image twice, which reads on screen as the slideshow
      // having got stuck rather than as a duplicate.
      if (!r.url || seen.has(r.url) || (r.id && seen.has(r.id))) continue;
      // Belt-and-braces on top of `mature=false`: the API applies it, but this
      // runs unattended on a wall display, so a flag that arrives set anyway
      // is not something to pass through on trust.
      if (r.mature) continue;
      seen.add(r.url);
      if (r.id) seen.add(r.id);
      results.push(toRecord(r));
    }
    return results;
  },
};
