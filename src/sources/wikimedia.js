// Live queries against the Wikimedia Commons API (keyless, CORS-open via
// `origin=*` — verified directly against commons.wikimedia.org). A single
// free-text search field doubles as the general keyword source AND the
// mechanism behind the "Sci-Fi & Fantasy" preset (src/sources/presets.js),
// which just points this field at a curated category search — there's no
// dedicated public API for that genre, so this is it.
import { shuffle } from './base.js';

const API = 'https://commons.wikimedia.org/w/api.php';

// Commons' extmetadata values are raw wiki HTML (links, spans) — strip tags
// for plain-text display in the metadata ribbon.
function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, '').trim();
}

function toRecord(page) {
  const info = page.imageinfo?.[0];
  const meta = info?.extmetadata || {};
  const title = stripHtml(meta.ObjectName?.value) || page.title.replace(/^File:/, '').replace(/\.[^.]+$/, '');
  return {
    title,
    artist: stripHtml(meta.Artist?.value) || stripHtml(meta.Credit?.value) || '',
    date: stripHtml(meta.DateTimeOriginal?.value) || stripHtml(meta.DateTime?.value) || '',
    department: '',
    image: info.url,
    source: 'wikimedia',
  };
}

export const wikimediaSource = {
  id: 'wikimedia',
  label: 'Wikimedia Commons',
  needsApiKey: false,
  description: 'Live search against Wikimedia Commons\' media collection.',

  listFilters() {
    return [
      {
        key: 'query', label: 'Search or category', type: 'text',
        placeholder: 'e.g. impressionism, or Category:Science_fiction_art',
        default: 'illustration',
      },
    ];
  },

  async fetchBatch({ filters = {}, count = 24 } = {}) {
    const query = (filters.query || '').trim() || 'illustration';
    const limit = String(Math.min(count * 3, 50));

    // "Category:X" isn't valid full-text search syntax — Commons needs the
    // categorymembers generator to browse a category directly, versus the
    // search generator for a plain relevance search. Verified directly
    // against the live API while building this: gsrsearch on a bare
    // "Category:..." string returned zero results.
    const params = query.toLowerCase().startsWith('category:')
      ? new URLSearchParams({
        action: 'query', format: 'json', origin: '*',
        generator: 'categorymembers', gcmtitle: query, gcmtype: 'file', gcmlimit: limit,
        prop: 'imageinfo', iiprop: 'url|extmetadata|mime',
      })
      : new URLSearchParams({
        action: 'query', format: 'json', origin: '*',
        generator: 'search', gsrsearch: query, gsrnamespace: '6', gsrlimit: limit,
        prop: 'imageinfo', iiprop: 'url|extmetadata|mime',
      });
    const res = await fetch(`${API}?${params.toString()}`);
    if (!res.ok) throw new Error(`Wikimedia Commons search failed: HTTP ${res.status}`);
    const data = await res.json();
    const pages = Object.values(data.query?.pages || {});

    const results = [];
    for (const page of shuffle(pages)) {
      if (results.length >= count) break;
      const info = page.imageinfo?.[0];
      if (!info?.url || !info.mime?.startsWith('image/')) continue;
      results.push(toRecord(page));
    }
    return results;
  },
};
