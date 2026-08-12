// Turning a stored category id back into something readable, for the ribbon.
//
// A category id is `${sourceId}::${encodeURIComponent(subject)}` (see catId in
// library.js), e.g. `openverse::mountain`. Neither half is presentable as-is:
// the source id is a slug, and the subject is the raw query value rather than
// the label the user ticked.
import { SOURCES } from '../sources/registry.js';
import { categoriesOf } from './library.js';

// Ribbon-length names. SOURCES[].label is written for the Settings list, where
// "NASA Image and Video Library" and "US National Park Service" are helpful;
// on a caption line beside an artist and a date they are just long.
const SHORT_NAMES = {
  aic: 'Art Institute',
  europeana: 'Europeana',
  flickr: 'Flickr',
  local: 'Starter Set',
  localFiles: 'Local Folder',
  met: 'The Met',
  nasa: 'NASA',
  nps: 'National Parks',
  openverse: 'Openverse',
  rijksmuseum: 'Rijksmuseum',
  smithsonian: 'Smithsonian',
  wikimedia: 'Wikimedia',
};

const MAX_SUBJECT = 32;

export function sourceName(sourceId) {
  return SHORT_NAMES[sourceId] || SOURCES[sourceId]?.label || sourceId;
}

// Last resort when a stored subject matches no current option. This is the
// COMMON case on devices in the field, not an edge case: Openverse subjects
// were rewritten into `~`-separated queries after those libraries were
// downloaded, so a tablet holds `openverse::coast%20ocean` while the options
// now offer `coast~ocean waves~beach cliffs~fjord`. Rather than show nothing,
// recover a label from the id itself.
function prettifySubject(encoded) {
  let s = encoded;
  try { s = decodeURIComponent(encoded); } catch { /* keep the raw form */ }
  // Both separators mean "several queries behind one tick"; the first names it.
  s = s.split(/[~|]/)[0].trim();
  if (!s) return '';
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return s.length > MAX_SUBJECT ? `${s.slice(0, MAX_SUBJECT - 1).trimEnd()}…` : s;
}

/** `openverse::mountain` -> `{ source: 'Openverse', subject: 'Mountains' }` */
export function describeCategory(cat) {
  if (!cat || typeof cat !== 'string') return null;
  const idx = cat.indexOf('::');
  const sourceId = idx === -1 ? cat : cat.slice(0, idx);
  const encoded = idx === -1 ? '' : cat.slice(idx + 2);
  if (!SOURCES[sourceId] && !SHORT_NAMES[sourceId]) return null;

  const source = sourceName(sourceId);
  if (!encoded) return { source, subject: '' };

  // Prefer the label the user actually ticked. categoriesOf needs the source
  // OBJECT as its second argument, not just the id — calling it with one
  // argument throws, and an over-broad catch here quietly turned that into the
  // prettify fallback, so every label looked plausible but wrong ("Nebula"
  // rather than "Nebulae").
  let subject = '';
  const def = SOURCES[sourceId];
  if (def) {
    try {
      subject = categoriesOf(sourceId, def).find(c => c.cat === cat)?.label || '';
    } catch (err) {
      // A source whose listFilters throws must not take the caption down with
      // it; the id-derived fallback below still produces something readable.
      console.warn(`[SlowFrame] could not label category "${cat}":`, err);
    }
  }

  return { source, subject: subject || prettifySubject(encoded) };
}

/**
 * The ribbon string for the categories an image belongs to, e.g.
 * "Openverse, Mountains". An image downloaded under several categories shows
 * the first two and a count, rather than growing without bound.
 */
export function describeCategories(cats, limit = 2) {
  const parts = [];
  const seen = new Set();
  for (const cat of Array.isArray(cats) ? cats : []) {
    const d = describeCategory(cat);
    if (!d) continue;
    const text = d.subject ? `${d.source}, ${d.subject}` : d.source;
    if (seen.has(text)) continue;
    seen.add(text);
    parts.push(text);
  }
  if (!parts.length) return '';
  if (parts.length <= limit) return parts.join(' · ');
  return `${parts.slice(0, limit).join(' · ')} +${parts.length - limit}`;
}
