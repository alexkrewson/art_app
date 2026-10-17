// Enumerates every image the app is capable of downloading, so it can be
// reviewed once on a monitor instead of one-at-a-time on a tablet.
//
// This deliberately does NOT call the adapters' fetchBatch(). That method
// samples — it takes a random window and shuffles, because at play time you
// want variety, not completeness. Here we want the opposite: a stable, total
// enumeration that a review pass can be measured against.
//
// What it DOES reuse is every part that decides what a record *is*: toRecord(),
// the licence filters, the thumbnail width, the query and category lists. That
// matters more than it looks. The blocklist is keyed on `record.image`, so if
// this file computed a URL even slightly differently from the app — a
// different iiurlwidth, a different NASA link preference — every rejection
// would key on a URL the app never produces and silently do nothing.
//
//   node curate/harvest.mjs                 # all three sources
//   node curate/harvest.mjs --source nasa   # just one
//   node curate/harvest.mjs --budget 50     # spend at most 50 requests
//
// Resumable by design: finished (query, page) pairs are recorded in
// harvest-state.json and skipped on the next run. Openverse needs 396 requests
// against a 200/day anonymous quota, so a full harvest there is a two-day job
// run twice — everything else finishes in one pass.
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openverseSource, toRecord as ovRecord, LICENSE_TYPE, PAGE_SIZE, MAX_PAGE, API as OV_API } from '../src/sources/openverse.js';
import { wikimediaSource, toRecord as wmRecord, isPermissiveLicense, getLicense, THUMB_WIDTH, API as WM_API } from '../src/sources/wikimedia.js';
import { nasaSource, toRecord as nasaRecord, bestImageUrl, API as NASA_API } from '../src/sources/nasa.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CANDIDATES = join(HERE, 'candidates.jsonl');
const STATE = join(HERE, 'harvest-state.json');

// Commons asks API clients to identify themselves; the others don't care but
// it costs nothing to be polite consistently.
const UA = 'SlowFrame-curate/1.0 (https://github.com/alexkrewson/art_app)';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const only = arg('source', null);
const budget = Number(arg('budget', Infinity));

// ── state ────────────────────────────────────────────────────────────────
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { done: [] };
const done = new Set(state.done);
const saveState = () => writeFileSync(STATE, JSON.stringify({ done: [...done] }, null, 2) + '\n');

// Every URL already written, so a resumed or repeated run appends only what's
// new rather than duplicating the file.
const seen = new Set();
if (existsSync(CANDIDATES)) {
  for (const line of readFileSync(CANDIDATES, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { seen.add(JSON.parse(line).url); } catch { /* half-written last line */ }
  }
}
console.log(`${seen.size} candidates already harvested, ${done.size} pages already walked.`);

let written = 0;
function emit(record, cat) {
  const url = record.image;
  if (!url || seen.has(url)) return false;
  seen.add(url);
  appendFileSync(CANDIDATES, JSON.stringify({
    url,
    source: record.source,
    cat,
    title: record.title || '',
    artist: record.artist || '',
    date: record.date || '',
    department: record.department || '',
    attribution: record.attribution || '',
  }) + '\n');
  written++;
  return true;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

let spent = 0;
class BudgetSpent extends Error {}
async function get(url, gapMs) {
  if (spent >= budget) throw new BudgetSpent();
  spent++;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (gapMs) await sleep(gapMs);
  return res;
}

// ── Openverse ────────────────────────────────────────────────────────────
//
// Bounded, and that is the whole reason a review pass can ever be "finished":
// the anonymous API refuses to paginate past 240 results and reports
// result_count: 240 even for queries with millions behind them. 12 pages of 20
// is therefore not a sample of this source, it IS this source.
//
// 3.2s between requests keeps us under the measured 20/min burst limit. The
// 200/day sustained limit is the binding one, hence --budget.
async function harvestOpenverse() {
  const spec = openverseSource.listFilters().find(f => f.key === 'subjects');
  for (const opt of spec.options) {
    const queries = opt.value.split('~').map(s => s.trim()).filter(Boolean);
    for (const q of queries) {
      for (let page = 1; page <= MAX_PAGE; page++) {
        const key = `openverse|${q}|${page}`;
        if (done.has(key)) continue;
        const params = new URLSearchParams({
          q, license_type: LICENSE_TYPE, page_size: String(PAGE_SIZE),
          page: String(page), mature: 'false', category: 'photograph',
        });
        const res = await get(`${OV_API}?${params}`, 3200);
        if (res.status === 429) {
          console.log('  Openverse rate-limited — stopping this run, rerun tomorrow.');
          return;
        }
        if (!res.ok) {
          // Asking past the real end of a narrow query 500s rather than
          // returning empty. Not an error: it means this query is exhausted.
          console.log(`  ${q} p${page}: HTTP ${res.status} — treating as end of query`);
          done.add(key);
          break;
        }
        const data = await res.json();
        let added = 0;
        for (const r of data.results || []) {
          if (r.mature) continue;
          if (emit(ovRecord(r), `openverse::${opt.value}`)) added++;
        }
        done.add(key);
        saveState();
        const pages = Math.min(data.page_count || 1, MAX_PAGE);
        console.log(`  openverse "${q}" p${page}/${pages}: +${added} (${written} new this run, ${spent} reqs)`);
        if (page >= pages) break;
      }
    }
  }
}

// ── Wikimedia Commons ────────────────────────────────────────────────────
//
// Every curated category is smaller than the 600 members the adapter can
// already reach (largest measured 2026-08-23: 566), so walking each one to
// exhaustion enumerates exactly what the app can see, and then stops.
async function harvestWikimedia() {
  const spec = wikimediaSource.listFilters().find(f => f.key === 'categories');
  for (const opt of spec.options) {
    const titles = opt.value.split('|').map(s => s.trim()).filter(Boolean);
    for (const title of titles) {
      const key = `wikimedia|${title}`;
      if (done.has(key)) continue;
      let cont;
      let guard = 0;
      let added = 0;
      do {
        const params = new URLSearchParams({
          action: 'query', format: 'json', origin: '*',
          generator: 'categorymembers', gcmtitle: `Category:${title}`,
          gcmtype: 'file', gcmlimit: '50',
          prop: 'imageinfo', iiprop: 'url|extmetadata|mime', iiurlwidth: String(THUMB_WIDTH),
        });
        if (cont) params.set('gcmcontinue', cont);
        const res = await get(`${WM_API}?${params}`, 250);
        if (!res.ok) { console.log(`  ${title}: HTTP ${res.status}`); break; }
        const data = await res.json();
        for (const page of Object.values(data.query?.pages || {})) {
          const info = page.imageinfo?.[0];
          if (!info?.url || !info.mime?.startsWith('image/')) continue;
          if (!isPermissiveLicense(getLicense(info.extmetadata || {}))) continue;
          if (emit(wmRecord(page), `wikimedia::${opt.value}`)) added++;
        }
        cont = data.continue?.gcmcontinue;
      } while (cont && ++guard < 100);
      done.add(key);
      saveState();
      console.log(`  wikimedia "${title}": +${added} (${written} new this run)`);
    }
  }
}

// ── NASA ─────────────────────────────────────────────────────────────────
//
// Only enumerable at all because the curated subjects were narrowed on
// 2026-08-23 — see the comment in nasa.js. The old list totalled 87,286 hits
// and could only ever be sampled.
async function harvestNasa() {
  const spec = nasaSource.listFilters().find(f => f.key === 'subjects');
  for (const opt of spec.options) {
    const base = new URLSearchParams({ media_type: 'image', q: opt.value });
    const firstRes = await get(`${NASA_API}?${base}`, 300);
    if (!firstRes.ok) { console.log(`  ${opt.value}: HTTP ${firstRes.status}`); continue; }
    const first = await firstRes.json();
    const total = Number(first.collection?.metadata?.total_hits) || 0;
    const lastPage = Math.max(1, Math.ceil(total / 100));
    let added = 0;
    for (let page = 1; page <= lastPage; page++) {
      const key = `nasa|${opt.value}|${page}`;
      if (done.has(key)) continue;
      let items;
      if (page === 1) {
        items = first.collection?.items || [];
      } else {
        const p = new URLSearchParams(base);
        p.set('page', String(page));
        const res = await get(`${NASA_API}?${p}`, 300);
        if (!res.ok) break;
        items = (await res.json()).collection?.items || [];
      }
      for (const item of items) {
        const image = bestImageUrl(item.links);
        if (!image) continue;
        if (emit(nasaRecord(item, image), `nasa::${opt.value}`)) added++;
      }
      done.add(key);
    }
    saveState();
    console.log(`  nasa "${opt.value}" (${total} hits, ${lastPage} pages): +${added} (${written} new this run)`);
  }
}

// ── run ──────────────────────────────────────────────────────────────────
const RUNNERS = { wikimedia: harvestWikimedia, nasa: harvestNasa, openverse: harvestOpenverse };
// Cheapest and fastest first, so a review session can start while Openverse —
// the slow one, quota-bound to two days — is still trickling in behind it.
const order = only ? [only] : ['wikimedia', 'nasa', 'openverse'];

for (const name of order) {
  if (!RUNNERS[name]) { console.error(`unknown source: ${name}`); process.exit(1); }
  console.log(`\n=== ${name} ===`);
  try {
    await RUNNERS[name]();
  } catch (err) {
    if (err instanceof BudgetSpent) { console.log(`  budget of ${budget} requests spent — stopping.`); break; }
    throw err;
  }
}

saveState();
console.log(`\n${written} new candidates written, ${seen.size} total in candidates.jsonl (${spent} requests this run).`);
