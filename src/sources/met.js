// Live queries against the Met's public Open Access API (keyless, CORS-open —
// verified directly: collectionapi.metmuseum.org sends
// Access-Control-Allow-Origin: *). Distinct from localManifest.js, which
// serves the pre-fetched offline starter set.
import { shuffle } from './base.js';

const API = 'https://collectionapi.metmuseum.org/public/collection/v1';

let departmentsCache = null;
async function fetchDepartments() {
  if (departmentsCache) return departmentsCache;
  const res = await fetch(`${API}/departments`);
  const data = await res.json();
  departmentsCache = data.departments || [];
  return departmentsCache;
}

function buildSearchParams(filters) {
  const p = new URLSearchParams();
  p.set('hasImages', 'true');
  // /search 502s if q is omitted entirely — '*' is the documented way to
  // mean "no keyword, browse everything matching the other filters".
  p.set('q', (filters.keyword || '').trim() || '*');
  if (filters.departmentId) p.set('departmentId', filters.departmentId);
  if (filters.medium) p.set('medium', filters.medium);
  if (filters.dateBegin) p.set('dateBegin', filters.dateBegin);
  if (filters.dateEnd) p.set('dateEnd', filters.dateEnd);
  return p;
}

// Met needs one request per object, so a large download makes hundreds of
// calls and their CDN starts refusing. Measured on the CP80 on 2026-08-13:
// asking for 100 images (up to ~420 object calls) got the whole API blocked
// for several minutes, including the search endpoint, while the same requests
// from Node kept returning 200 — a throttle response without CORS headers
// reads in a WebView as an opaque "Failed to fetch" with no status at all.
//
// `null` used to mean both "no such object" and "we are being throttled",
// which is why a rate-limited batch looked exactly like a source that had run
// out of images: it quietly returned 8 of 38 and reported no error.
const MISSING = null;
const THROTTLED = Symbol('throttled');

async function fetchObject(id) {
  let res;
  try {
    res = await fetch(`${API}/objects/${id}`);
  } catch {
    // An opaque network failure here is overwhelmingly a throttle, not a dead
    // object — a single missing id does not break the connection.
    return THROTTLED;
  }
  if (res.status === 429 || res.status === 403) return THROTTLED;
  if (!res.ok) return MISSING;
  try {
    return await res.json();
  } catch {
    return MISSING;
  }
}

function toRecord(obj) {
  return {
    title: obj.title || 'Untitled',
    artist: [obj.artistDisplayName, obj.artistDisplayBio].filter(Boolean).join('\n') || obj.culture || '',
    date: obj.objectDate || '',
    department: obj.department || '',
    image: obj.primaryImageSmall || obj.primaryImage,
    source: 'met',
  };
}

export const metSource = {
  id: 'met',
  label: 'The Metropolitan Museum of Art',
  needsApiKey: false,
  description: 'Live search against the Met\'s Open Access collection API.',

  async listFilters() {
    const departments = await fetchDepartments();
    return [
      {
        key: 'departmentId', label: 'Department', type: 'select',
        options: [{ value: '', label: 'Any department' },
          ...departments.map(d => ({ value: String(d.departmentId), label: d.displayName }))],
      },
      { key: 'keyword', label: 'Keyword', type: 'text', placeholder: 'e.g. sunflowers' },
      { key: 'medium', label: 'Medium', type: 'text', placeholder: 'e.g. woodblock print' },
      { key: 'dateBegin', label: 'Date from (year)', type: 'number', placeholder: 'From' },
      { key: 'dateEnd', label: 'Date to (year)', type: 'number', placeholder: 'To' },
      { key: 'publicDomainOnly', label: 'Public domain only', type: 'checkbox', default: true },
    ];
  },

  async fetchBatch({ filters = {}, count = 24 } = {}) {
    const params = buildSearchParams(filters);
    const res = await fetch(`${API}/search?${params.toString()}`);
    if (!res.ok) throw new Error(`Met search failed: HTTP ${res.status}`);
    const data = await res.json();
    const ids = data.objectIDs || [];
    if (!ids.length) return [];

    // Over-sample, because some objectIDs have no usable image or fail the
    // public-domain filter. 3x was the original figure; at count=100 that is
    // 420 object requests, which is what got us blocked. 2x still leaves
    // plenty of slack — the measured hit rate is well above half — and nearly
    // halves the traffic.
    const candidates = shuffle(ids).slice(0, Math.min(count * 2, ids.length));
    const publicDomainOnly = filters.publicDomainOnly !== false;

    const results = [];
    const CONCURRENCY = 5;
    const PACE_MS = 120;        // per worker, so ~40 requests/second at most
    let cursor = 0;
    let throttled = false;

    async function worker() {
      while (cursor < candidates.length && results.length < count && !throttled) {
        const obj = await fetchObject(candidates[cursor++]);
        if (obj === THROTTLED) {
          // Stop the whole batch rather than grinding through hundreds more
          // refusals: once they start saying no, continuing only deepens it.
          throttled = true;
          break;
        }
        if (!obj || !(obj.primaryImageSmall || obj.primaryImage)) continue;
        if (publicDomainOnly && !obj.isPublicDomain) continue;
        results.push(toRecord(obj));
        if (PACE_MS) await new Promise(r => setTimeout(r, PACE_MS));
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    if (throttled) {
      // Loud, and distinguishable from "the source had nothing left". Partial
      // results are still returned — they are perfectly good images.
      console.warn(`[SlowFrame] Met is rate-limiting; stopped at ${results.length} of ${count}. Try again in a few minutes.`);
    }
    return results.slice(0, count);
  },
};
