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

async function fetchObject(id) {
  const res = await fetch(`${API}/objects/${id}`);
  if (!res.ok) return null;
  return res.json();
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

    // Over-sample: some objectIDs won't have a usable image or won't pass
    // the public-domain filter, so fetch more candidates than we need.
    const candidates = shuffle(ids).slice(0, Math.min(count * 3, ids.length));
    const publicDomainOnly = filters.publicDomainOnly !== false;

    const results = [];
    const CONCURRENCY = 5;
    let cursor = 0;
    async function worker() {
      while (cursor < candidates.length && results.length < count) {
        const obj = await fetchObject(candidates[cursor++]);
        if (!obj || !(obj.primaryImageSmall || obj.primaryImage)) continue;
        if (publicDomainOnly && !obj.isPublicDomain) continue;
        results.push(toRecord(obj));
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return results.slice(0, count);
  },
};
