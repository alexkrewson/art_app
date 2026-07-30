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
    const params = new URLSearchParams({ q, fields: FIELDS, limit: String(Math.min(count * 3, 100)) });
    const res = await fetch(`${API}/artworks/search?${params.toString()}`);
    if (!res.ok) throw new Error(`AIC search failed: HTTP ${res.status}`);
    const data = await res.json();
    const candidates = shuffle(data.data || []);

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
