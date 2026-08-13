// Live queries against the Art Institute of Chicago's public API (keyless,
// CORS-open — verified directly against api.artic.edu). Query shape mirrors
// the prototype in fetch.py (search endpoint + IIIF image URLs), but keeps
// filtering client-side like met.js: a quick check against the live API
// while building this showed the documented Elasticsearch-style `query`
// DSL (bool/must/range) isn't reliably honored as a strict filter by this
// endpoint — date-range and public-domain terms were both silently ignored
// in a real test — so, same as Met, this over-samples on the plain
// relevance search and filters date/public-domain/has-image itself.
import { shuffle } from './base.js';

const API = 'https://api.artic.edu/api/v1';
const IIIF = 'https://www.artic.edu/iiif/2';
const FIELDS = 'id,title,artist_display,date_display,date_start,date_end,image_id,department_title,is_public_domain';

function toRecord(obj) {
  return {
    title: obj.title || 'Untitled',
    artist: obj.artist_display || '',
    date: obj.date_display || '',
    department: obj.department_title || '',
    // `!843,843` (bounded fit, upscale disallowed) rather than a bare `843,`
    // (fixed width) — Cantaloupe (AIC's IIIF server) 403s a fixed width that
    // exceeds an image's native size ("Requests for scales in excess of 100%
    // are not allowed"), which a bare width does for any artwork narrower
    // than 843px. Confirmed live: the bounded-fit form returns 200 for an
    // image whose native width is 398px, where the bare-width form 403'd.
    image: `${IIIF}/${obj.image_id}/full/!843,843/0/default.jpg`,
    source: 'aic',
  };
}

export const aicSource = {
  id: 'aic',
  label: 'Art Institute of Chicago',
  needsApiKey: false,
  description: 'Live search against the Art Institute of Chicago\'s public collection API.',

  listFilters() {
    return [
      { key: 'keyword', label: 'Keyword', type: 'text', placeholder: 'e.g. Vermeer' },
      { key: 'dateBegin', label: 'Date from (year)', type: 'number', placeholder: 'From' },
      { key: 'dateEnd', label: 'Date to (year)', type: 'number', placeholder: 'To' },
      { key: 'publicDomainOnly', label: 'Public domain only', type: 'checkbox', default: true },
    ];
  },

  async fetchBatch({ filters = {}, count = 24 } = {}) {
    const q = (filters.keyword || '').trim() || '*';

    // Page — but only as far as AIC actually allows.
    //
    // `pagination.total_pages` reports 1,327 for an empty query, and that
    // number is a trap: anything past page 10 returns "You have requested too
    // many results. Please refine your parameters." The real reachable set is
    // 1,000 works per query, not 132,681. Measured against the live API:
    // pages 5 and 10 return 100 items each, page 11 errors.
    //
    // One request was still only reaching a tenth of that, which was invisible
    // while this filled a 60-image playlist and became the ceiling under the
    // download model.
    //
    // Over-fetch 3x because the filtering below is aggressive: public-domain
    // only, must have an image, and optional date bounds each remove more.
    const PER_PAGE = 100;
    const API_MAX_PAGE = 10;
    const needed = Math.max(1, Math.min(Math.ceil((count * 3) / PER_PAGE), API_MAX_PAGE));

    async function page(n) {
      const params = new URLSearchParams({ q, fields: FIELDS, limit: String(PER_PAGE), page: String(n) });
      // AIC's terms ask API clients to identify themselves with this header,
      // and their CDN enforces it on IIIF image requests — on-device those
      // returned 403 without it while Node got 200, so every AIC download
      // silently stored nothing. The search endpoint tolerates its absence,
      // but sending it here too keeps us on the right side of their terms.
      const res = await fetch(`${API}/artworks/search?${params.toString()}`, {
        headers: { 'AIC-User-Agent': 'SlowFrame (https://github.com/alexkrewson/art_app)' },
      });
      if (!res.ok) throw new Error(`AIC search failed: HTTP ${res.status}`);
      return res.json();
    }

    const first = await page(1);
    // Clamped: total_pages is what the collection holds, not what it will serve.
    const totalPages = Math.min(Number(first.pagination?.total_pages) || 1, API_MAX_PAGE);

    let raw = first.data || [];
    if (needed > 1 && totalPages > 1) {
      // A random window rather than always the first N pages: the top of an
      // AIC relevance search is the same works every time, and this is a
      // slideshow that should feel different on each download.
      const start = 1 + Math.floor(Math.random() * Math.max(1, totalPages - needed + 1));
      const rest = await Promise.all(
        Array.from({ length: needed }, (_, i) => start + i)
          .filter(n => n !== 1 && n <= totalPages)
          .map(n => page(n).then(d => d.data || []).catch(err => {
            // Not silent: a page failing here is how the offset cap hid itself.
            console.warn(`[SlowFrame] AIC page ${n} failed:`, err.message);
            return [];
          })),
      );
      raw = raw.concat(rest.flat());
    }
    const candidates = shuffle(raw);

    const publicDomainOnly = filters.publicDomainOnly !== false;
    const dateBegin = filters.dateBegin ? Number(filters.dateBegin) : null;
    const dateEnd = filters.dateEnd ? Number(filters.dateEnd) : null;

    const results = [];
    for (const obj of candidates) {
      if (results.length >= count) break;
      if (!obj.image_id) continue;
      if (publicDomainOnly && !obj.is_public_domain) continue;
      if (dateBegin != null && (obj.date_end ?? obj.date_start) < dateBegin) continue;
      if (dateEnd != null && (obj.date_start ?? obj.date_end) > dateEnd) continue;
      results.push(toRecord(obj));
    }
    return results;
  },
};
