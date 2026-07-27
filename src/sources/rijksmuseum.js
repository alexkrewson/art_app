// Rijksmuseum API (rijksmuseum.nl/api). needsApiKey: true — get one at
// https://data.rijksmuseum.nl/docs/api/.
//
// Built against the documented response shape, NOT verified against the
// live API (no key available in this environment) — see the same caveat
// in smithsonian.js/europeana.js. This one has an extra open question the
// maintenance todo already flagged: CORS support from a browser origin is
// unconfirmed. If enabling this source throws a CORS error in practice
// (same failure mode as images.metmuseum.org's image CDN did while
// building the offline cache, just at the JSON-API layer instead of the
// image layer this time), a static GitHub Pages site can't work around it
// alone — would need a small proxy (e.g. a Cloudflare Worker) in front of
// this endpoint as a follow-up.
import { shuffle } from './base.js';

const API = 'https://www.rijksmuseum.nl/api/en/collection';

function toRecord(obj) {
  return {
    title: obj.title || 'Untitled',
    artist: obj.principalOrFirstMaker || '',
    date: obj.longTitle?.match(/\b(\d{4})\b/)?.[1] || '',
    department: '',
    image: obj.webImage?.url,
    source: 'rijksmuseum',
  };
}

export const rijksmuseumSource = {
  id: 'rijksmuseum',
  label: 'Rijksmuseum',
  needsApiKey: true,
  description: 'The Rijksmuseum\'s public collection (Amsterdam).',

  listFilters() {
    return [
      { key: 'apiKey', label: 'API key', type: 'text', sensitive: true, placeholder: 'from data.rijksmuseum.nl' },
      { key: 'keyword', label: 'Keyword', type: 'text', placeholder: 'e.g. Rembrandt' },
    ];
  },

  async fetchBatch({ filters = {}, count = 24 } = {}) {
    if (!filters.apiKey) return [];
    const params = new URLSearchParams({
      key: filters.apiKey,
      q: (filters.keyword || '').trim(),
      imgonly: 'True',
      ps: String(Math.min(count * 3, 100)),
    });
    const res = await fetch(`${API}?${params.toString()}`);
    if (!res.ok) throw new Error(`Rijksmuseum search failed: HTTP ${res.status}`);
    const data = await res.json();
    const objects = shuffle(data.artObjects || []);

    const results = [];
    for (const obj of objects) {
      if (results.length >= count) break;
      const record = toRecord(obj);
      if (!record.image) continue;
      results.push(record);
    }
    return results;
  },
};
