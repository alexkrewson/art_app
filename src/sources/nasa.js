// Live queries against NASA's Image and Video Library (images-api.nasa.gov)
// — verified directly against the live API while building this: this
// endpoint is entirely keyless and CORS-open, unlike NASA's other APIs
// (api.nasa.gov, which needs a key or DEMO_KEY) — so there's no apiKey
// filter here at all, nothing to gate. Doubles as a stand-in for
// "sci-fi/fantasy" imagery: real space photography has strong aesthetic
// overlap and there's no dedicated public API for that genre (see
// wikimedia.js's curated-category checkboxes for the other half of that).
import { shuffle } from './base.js';

const API = 'https://images-api.nasa.gov/search';

function bestImageUrl(links) {
  const byRel = links?.find(l => l.href?.includes('~medium')) || links?.[0];
  return byRel?.href;
}

function toRecord(item, image) {
  const data = item.data[0];
  return {
    title: data.title || 'Untitled',
    artist: data.secondary_creator || data.center || '',
    date: (data.date_created || '').slice(0, 10),
    department: data.center || '',
    image,
    source: 'nasa',
  };
}

export const nasaSource = {
  id: 'nasa',
  label: 'NASA Image and Video Library',
  needsApiKey: false,
  description: 'Live search against NASA\'s public image and video archive.',

  listFilters() {
    return [
      {
        // NASA has no subject taxonomy in its API, only free-text search — so
        // unlike Commons' real categories these are curated queries. Added
        // 2026-08-09: under the download model a source with no categories is
        // a single tickable entry, which for a collection this varied meant
        // "all of NASA" collapsed to one generic search. Each was checked
        // against the live API and returns a full page of results.
        key: 'subjects', label: 'Curated subjects', type: 'checkboxGroup',
        options: [
          { value: 'nebula', label: 'Nebulae' },
          { value: 'galaxy', label: 'Galaxies' },
          { value: 'hubble deep field', label: 'Deep field' },
          { value: 'mars surface', label: 'Mars' },
          { value: 'saturn jupiter', label: 'Outer planets' },
          { value: 'earth from orbit', label: 'Earth from orbit' },
          { value: 'aurora from space', label: 'Aurora from space' },
          { value: 'solar eclipse', label: 'Sun & eclipses' },
          { value: 'apollo', label: 'Apollo' },
          { value: 'international space station', label: 'Space station' },
        ],
      },
      { key: 'keyword', label: 'Keyword', type: 'text', placeholder: 'e.g. nebula, apollo, mars' },
    ];
  },

  async fetchBatch({ filters = {}, count = 24 } = {}) {
    const params = new URLSearchParams({ media_type: 'image' });
    // Ticked subjects win over the free-text field, the same precedence every
    // other curated source uses. The download model narrows to one subject per
    // call, so this is normally a single value.
    const subjects = Array.isArray(filters.subjects) ? filters.subjects.filter(Boolean) : [];
    const keyword = subjects.length ? subjects.join(' ') : (filters.keyword || '').trim();
    if (keyword) params.set('q', keyword);

    const res = await fetch(`${API}?${params.toString()}`);
    if (!res.ok) throw new Error(`NASA image search failed: HTTP ${res.status}`);
    const data = await res.json();
    const items = shuffle(data.collection?.items || []);

    const results = [];
    for (const item of items) {
      if (results.length >= count) break;
      const image = bestImageUrl(item.links);
      if (!image) continue;
      results.push(toRecord(item, image));
    }
    return results;
  },
};
