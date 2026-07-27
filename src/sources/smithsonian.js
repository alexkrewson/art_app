// Smithsonian Open Access API (api.si.edu). needsApiKey: true — get one at
// https://api.data.gov/signup/, tied to Smithsonian's Open Access program.
//
// Built against the documented response shape, NOT verified against the
// live API (no key available in this environment) — unlike met.js/aic.js/
// wikimedia.js/nasa.js, which were all exercised against the real APIs
// while building this. Re-verify the field paths below (particularly
// which `online_media.media[]` entries are actually images vs. other
// media, and the exact rights/CC0 field name) once a real key is in hand.
import { shuffle } from './base.js';

const API = 'https://api.si.edu/openaccess/api/v1.0/search';

function firstImage(media) {
  return (media || []).find(m => m.type === 'Images')?.content;
}

function toRecord(row) {
  const desc = row.content?.descriptiveNonRepeating || {};
  const indexed = row.content?.indexedStructured || {};
  const freetext = row.content?.freetext || {};
  return {
    title: desc.title?.content || 'Untitled',
    artist: (indexed.name || freetext.name?.map(n => n.content))?.[0] || '',
    date: (indexed.date || [])[0] || '',
    department: desc.unit_code || '',
    image: firstImage(desc.online_media?.media),
    source: 'smithsonian',
  };
}

export const smithsonianSource = {
  id: 'smithsonian',
  label: 'Smithsonian Open Access',
  needsApiKey: true,
  description: 'Smithsonian Institution\'s open-access image collection.',

  listFilters() {
    return [
      { key: 'apiKey', label: 'API key', type: 'text', sensitive: true, placeholder: 'from api.data.gov' },
      { key: 'keyword', label: 'Keyword', type: 'text', placeholder: 'e.g. porcelain' },
    ];
  },

  async fetchBatch({ filters = {}, count = 24 } = {}) {
    if (!filters.apiKey) return [];
    const params = new URLSearchParams({
      api_key: filters.apiKey,
      q: (filters.keyword || '').trim() || 'art',
      rows: String(Math.min(count * 3, 100)),
    });
    const res = await fetch(`${API}?${params.toString()}`);
    if (!res.ok) throw new Error(`Smithsonian search failed: HTTP ${res.status}`);
    const data = await res.json();
    const rows = shuffle(data.response?.rows || []);

    const results = [];
    for (const row of rows) {
      if (results.length >= count) break;
      const record = toRecord(row);
      if (!record.image) continue;
      results.push(record);
    }
    return results;
  },
};
