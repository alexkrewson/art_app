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
      { key: 'keyword', label: 'Keyword', type: 'text', placeholder: 'e.g. nebula, apollo, mars' },
    ];
  },

  async fetchBatch({ filters = {}, count = 24 } = {}) {
    const params = new URLSearchParams({ media_type: 'image' });
    const keyword = (filters.keyword || '').trim();
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
