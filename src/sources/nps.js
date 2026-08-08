// US National Park Service multimedia gallery (developer.nps.gov).
// needsApiKey: true — the same api.data.gov key that smithsonian.js wants,
// from https://api.data.gov/signup/. One key covers both.
//
// Verified live against the real API while building this, using api.data.gov's
// public DEMO_KEY: `Access-Control-Allow-Origin: *` confirmed, ~205k assets
// indexed, `q` search works, and the images serve 200 image/jpeg with a
// foreign Referer header (i.e. no hotlink protection — unlike AIC, which
// needed the `referrerpolicy="no-referrer"` fix).
import { shuffle } from './base.js';

const API = 'https://developer.nps.gov/api/v1/multimedia/galleries/assets';

// NPS ships a blanket `copyright` warning on every asset ("Permission must be
// secured from the individual copyright owners…") because the gallery mixes
// staff photography with donated third-party work. The per-asset field that
// actually discriminates is `constraintsInfo`, and it's machine-readable —
// which is what makes this source usable at all. Both halves are required:
// `grantingRights: "Unknown"` appears on real records and is not a yes.
// Measured while building: a 200-asset sample came back "Public domain" /
// "Full" across the board, but a separate 3-asset spot check turned up an
// "Unknown", so the second half of this check is not redundant.
function isPublicDomain(asset) {
  const c = asset.constraintsInfo || {};
  return c.constraint === 'Public domain' && c.grantingRights === 'Full';
}

// The bare GetAsset URL serves the original — ~2MB for a typical photo, which
// is a lot to pull 60 of onto a tablet. `/proxy/hires` is the same image at
// ~220KB and still comfortably bigger than any display this runs on.
// (`/proxy/large` also exists at ~84KB, too soft for full-screen Ken Burns.)
function scaledUrl(url) {
  return url ? `${url.replace(/\/+$/, '')}/proxy/hires` : '';
}

function toRecord(asset) {
  const park = (asset.relatedParks || [])[0];
  return {
    title: asset.title || 'Untitled',
    artist: (asset.credit || '').trim(),
    // NPS assets carry no capture date — only `ordinal`, a gallery sort key.
    date: '',
    department: park?.fullName || park?.name || '',
    image: scaledUrl(asset.fileInfo?.url),
    source: 'nps',
    // Public domain: no attribution obligation. The credit line, where NPS
    // supplied one, is already carried by `artist` above.
    attribution: '',
  };
}

export const npsSource = {
  id: 'nps',
  label: 'US National Park Service',
  needsApiKey: true,
  description: 'Public-domain landscape and wildlife photography from the US national parks.',

  listFilters() {
    return [
      { key: 'apiKey', label: 'API key', type: 'text', sensitive: true, placeholder: 'from api.data.gov (same key as Smithsonian)' },
      {
        key: 'subjects', label: 'Curated subjects', type: 'checkboxGroup',
        options: [
          { value: 'landscape', label: 'Landscapes' },
          { value: 'mountain', label: 'Mountains' },
          { value: 'canyon desert', label: 'Canyons & deserts' },
          { value: 'coast shoreline', label: 'Coast & shoreline' },
          { value: 'waterfall river', label: 'Rivers & waterfalls' },
          { value: 'night sky stars', label: 'Night sky' },
          { value: 'wildlife', label: 'Wildlife' },
          { value: 'autumn foliage', label: 'Autumn colour' },
        ],
      },
      { key: 'query', label: 'Search', type: 'text', placeholder: 'e.g. yosemite, glacier', default: 'landscape' },
    ];
  },

  async fetchBatch({ filters = {}, count = 24 } = {}) {
    if (!filters.apiKey) return [];

    const subjects = Array.isArray(filters.subjects) ? filters.subjects.filter(Boolean) : [];
    const freeText = (filters.query || '').trim();
    const queries = subjects.length ? subjects : [freeText || 'landscape'];
    const perQuery = Math.ceil((count * 2) / queries.length);

    async function search(q, start) {
      const params = new URLSearchParams({
        api_key: filters.apiKey,
        q,
        limit: String(Math.min(perQuery, 100)),
        start: String(start),
      });
      const res = await fetch(`${API}?${params.toString()}`);
      if (!res.ok) throw new Error(`NPS search failed: HTTP ${res.status}`);
      const data = await res.json();
      return data.data || [];
    }

    // A fixed start=0 would replay the same assets every session. Typical
    // subject searches return several thousand hits, so a random offset in
    // the low thousands stays inside the result set; if a narrower query
    // overshoots it, fall back to the top of the list.
    const batches = await Promise.all(queries.map(async q => {
      const start = Math.floor(Math.random() * 1000);
      const first = await search(q, start);
      return first.length ? first : search(q, 0);
    }));

    const results = [];
    const seen = new Set();
    for (const asset of shuffle(batches.flat())) {
      if (results.length >= count) break;
      if (!isPublicDomain(asset)) continue;
      if (!asset.fileInfo?.fileType?.startsWith('image/')) continue;
      const record = toRecord(asset);
      if (!record.image || seen.has(record.image)) continue;
      seen.add(record.image);
      results.push(record);
    }
    return results;
  },
};
