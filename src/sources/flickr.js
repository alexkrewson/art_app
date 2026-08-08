// Flickr photo search, filtered to the licences we can actually redistribute.
// needsApiKey: true — get one at https://www.flickr.com/services/apps/create/
// (choose the NON-commercial key: SlowFrame is free with no ads or purchases,
// and a commercial key needs Flickr's written approval).
//
// CORS was verified live while building this (`Access-Control-Allow-Origin: *`
// on api.flickr.com), but the *response shape* below is written against
// Flickr's documentation, not a real authenticated call — there was no key to
// test with. Re-check the `photos.photo[]` field paths, and particularly which
// `url_*` size variants actually come back, once a real key is in hand. This
// is the same caveat that turned out to matter for aic.js.
import { shuffle } from './base.js';

const API = 'https://api.flickr.com/services/rest/';

// Flickr licence IDs (flickr.photos.licenses.getInfo). The allowlist is the
// legal gate — same reasoning as openverse.js' license_type:
//   excluded 0        — All Rights Reserved
//   excluded 1, 2, 3  — the NonCommercial licences; a Play Store listing is at
//                       best an arguable case for non-commercial use
//   excluded 3, 6     — the NoDerivatives licences; Ken Burns pans and crops
const LICENSES = {
  4: { label: 'CC BY 2.0', credit: true },
  5: { label: 'CC BY-SA 2.0', credit: true },
  7: { label: 'No known copyright restrictions', credit: false },
  8: { label: 'United States Government Work', credit: false },
  9: { label: 'CC0 1.0', credit: false },
  10: { label: 'Public Domain Mark 1.0', credit: false },
};
const ALLOWED_LICENSE_IDS = Object.keys(LICENSES).join(',');

const MAX_PAGE = 8;

// Largest first — a wall display wants the biggest variant Flickr actually
// generated for that photo, and not every photo has every size.
function bestImage(p) {
  return p.url_k || p.url_h || p.url_l || p.url_c || '';
}

function toRecord(p) {
  const license = LICENSES[String(p.license)];
  return {
    title: p.title || 'Untitled',
    artist: p.ownername || p.owner || '',
    date: (p.datetaken || '').split(' ')[0] || '',
    department: '',
    image: bestImage(p),
    source: 'flickr',
    attribution: license?.credit ? license.label : '',
  };
}

export const flickrSource = {
  id: 'flickr',
  label: 'Flickr (Creative Commons)',
  needsApiKey: true,
  description: 'Flickr photography, filtered to CC BY / CC BY-SA / CC0 / public-domain licences.',

  listFilters() {
    return [
      { key: 'apiKey', label: 'API key', type: 'text', sensitive: true, placeholder: 'from flickr.com/services/apps' },
      {
        key: 'query', label: 'Search', type: 'text',
        placeholder: 'e.g. mountain landscape',
        default: 'landscape',
      },
      { key: 'publicDomainOnly', label: 'Public domain / CC0 only (no attribution needed)', type: 'checkbox', default: false },
    ];
  },

  async fetchBatch({ filters = {}, count = 24 } = {}) {
    if (!filters.apiKey) return [];

    // The checkbox narrows the allowlist to the four licences that carry no
    // attribution requirement at all, for anyone who'd rather not show a
    // credit line over the artwork.
    const licenseIds = filters.publicDomainOnly
      ? Object.entries(LICENSES).filter(([, v]) => !v.credit).map(([k]) => k).join(',')
      : ALLOWED_LICENSE_IDS;

    async function search(page) {
      const params = new URLSearchParams({
        method: 'flickr.photos.search',
        api_key: filters.apiKey,
        text: (filters.query || '').trim() || 'landscape',
        license: licenseIds,
        // Flickr's own "interestingness" ranking is what makes this feel like
        // a curated gallery rather than a shoebox of holiday snaps.
        sort: 'interestingness-desc',
        content_type: '1',  // photos only, no screenshots or illustrations
        media: 'photos',
        safe_search: '1',   // safe content only — this runs unattended on a wall
        extras: 'url_k,url_h,url_l,url_c,owner_name,license,date_taken',
        per_page: String(Math.min(count * 2, 500)),
        page: String(page),
        format: 'json',
        nojsoncallback: '1',
      });
      const res = await fetch(`${API}?${params.toString()}`);
      if (!res.ok) throw new Error(`Flickr search failed: HTTP ${res.status}`);
      const data = await res.json();
      // Flickr answers 200 OK with a JSON error body rather than an HTTP
      // status — an invalid key looks like a successful request otherwise.
      if (data.stat !== 'ok') throw new Error(`Flickr search failed: ${data.message || 'unknown error'}`);
      return data.photos?.photo || [];
    }

    // Page 1 every session would mean the same "most interesting" photos every
    // session. Pick a random page instead, and fall back to page 1 if the
    // query wasn't deep enough to have one.
    const page = 1 + Math.floor(Math.random() * MAX_PAGE);
    let photos = await search(page);
    if (!photos.length && page !== 1) photos = await search(1);

    const results = [];
    for (const p of shuffle(photos)) {
      if (results.length >= count) break;
      // A licence ID outside the allowlist should be impossible given the
      // `license` param, but this is the check that keeps a Flickr-side
      // change from quietly putting All Rights Reserved photos on the wall.
      if (!LICENSES[String(p.license)]) continue;
      const record = toRecord(p);
      if (!record.image) continue;
      results.push(record);
    }
    return results;
  },
};
