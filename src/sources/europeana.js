// Europeana Search API (api.europeana.eu). needsApiKey: true — get one at
// https://pro.europeana.eu/get-api.
//
// Built against the documented response shape, NOT verified against the
// live API (no key available in this environment) — see the same caveat
// in smithsonian.js. Re-verify field paths (particularly edmPreview vs.
// edmIsShownBy for the actual displayable image, and the `qf` rights
// filter syntax for CC-licensed-only results) once a real key is in hand.
import { shuffle } from './base.js';

const API = 'https://api.europeana.eu/record/v2/search.json';

function toRecord(item) {
  return {
    title: item.title?.[0] || 'Untitled',
    artist: item.dcCreator?.[0] || item.dataProvider?.[0] || '',
    date: item.year?.[0] || '',
    department: item.dataProvider?.[0] || '',
    image: item.edmIsShownBy?.[0] || item.edmPreview?.[0],
    source: 'europeana',
  };
}

export const europeanaSource = {
  id: 'europeana',
  label: 'Europeana',
  needsApiKey: true,
  description: 'Europe\'s digital cultural heritage collection.',

  listFilters() {
    return [
      { key: 'apiKey', label: 'API key', type: 'text', sensitive: true, placeholder: 'from pro.europeana.eu' },
      { key: 'keyword', label: 'Keyword', type: 'text', placeholder: 'e.g. tapestry' },
    ];
  },

  async fetchBatch({ filters = {}, count = 24 } = {}) {
    if (!filters.apiKey) return [];
    const params = new URLSearchParams({
      wskey: filters.apiKey,
      query: (filters.keyword || '').trim() || 'art',
      media: 'true',
      rows: String(Math.min(count * 3, 100)),
    });
    const res = await fetch(`${API}?${params.toString()}`);
    if (!res.ok) throw new Error(`Europeana search failed: HTTP ${res.status}`);
    const data = await res.json();
    const items = shuffle(data.items || []);

    const results = [];
    for (const item of items) {
      if (results.length >= count) break;
      const record = toRecord(item);
      if (!record.image) continue;
      results.push(record);
    }
    return results;
  },
};
