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

    // Page until we have enough candidates. One request returns 100 items, but
    // a query typically has far more behind it — "nebula" reports 316 total
    // hits. A single page was fine when this only ever filled a 60-image
    // playlist; under the download model a category asks for 100+ and the
    // single page became the ceiling. Start at a random page so repeat
    // downloads of the same subject reach different parts of the collection.
    const PER_PAGE = 100;
    const want = Math.ceil(count * 1.5);

    async function page(n) {
      const p = new URLSearchParams(params);
      if (n > 1) p.set('page', String(n));
      const res = await fetch(`${API}?${p.toString()}`);
      if (!res.ok) throw new Error(`NASA image search failed: HTTP ${res.status}`);
      return res.json();
    }

    const first = await page(1);
    const total = Number(first.collection?.metadata?.total_hits) || PER_PAGE;
    const lastPage = Math.max(1, Math.ceil(total / PER_PAGE));
    const needed = Math.max(1, Math.ceil(want / PER_PAGE));

    let items = first.collection?.items || [];
    if (needed > 1 && lastPage > 1) {
      // Random window inside what's available, clamped so it can't run past
      // the end and come back empty.
      const start = 1 + Math.floor(Math.random() * Math.max(1, lastPage - needed + 1));
      const rest = await Promise.all(
        Array.from({ length: needed }, (_, i) => start + i)
          .filter(n => n !== 1 && n <= lastPage)
          .map(n => page(n).then(d => d.collection?.items || []).catch(() => [])),
      );
      items = items.concat(rest.flat());
    }
    items = shuffle(items);

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
