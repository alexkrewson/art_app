import { describe, it, expect, beforeEach } from 'vitest';
import { createMetadataRibbon } from './metadataRibbon.js';

// The ribbon had no tests until Alex reported captions looking wrong on the
// device. It's a pure formatter, so it's cheap to pin down exactly.

function setup() {
  document.body.innerHTML = '<div id="footer"><div id="title"></div><div id="meta"></div></div>';
  const titleEl = document.getElementById('title');
  const metaEl = document.getElementById('meta');
  return { ribbon: createMetadataRibbon(titleEl, metaEl), titleEl, metaEl };
}

const rec = (o = {}) => ({ title: 'T', artist: '', date: '', department: '', attribution: '', ...o });

describe('metadataRibbon', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('joins the fields that are present and omits the rest', () => {
    const { ribbon, titleEl, metaEl } = setup();
    ribbon.update(rec({ title: 'Starry Night', artist: 'Alma Thomas', date: '1972' }));
    expect(titleEl.textContent).toBe('Starry Night');
    expect(metaEl.textContent).toBe('Alma Thomas  —  1972');
  });

  it('shows the provider for a record with no date, which is every Openverse one', () => {
    const { ribbon, metaEl } = setup();
    // Measured live: 12 of 12 Openverse records carry no date. Without
    // department this line would read "minka6  —  CC BY 2.0" and consecutive
    // slides look near-identical.
    ribbon.update(rec({ artist: 'minka6', department: 'flickr', attribution: 'CC BY 2.0' }));
    expect(metaEl.textContent).toBe('minka6  —  flickr  —  CC BY 2.0');
  });

  it('takes only the first line of a multi-line artist credit', () => {
    const { ribbon, metaEl } = setup();
    ribbon.update(rec({ artist: 'Someone\nSecond line of wiki markup' }));
    expect(metaEl.textContent).toBe('Someone');
  });

  it('renders an empty ribbon rather than "undefined" for a bare record', () => {
    const { ribbon, titleEl, metaEl } = setup();
    ribbon.update({});
    expect(titleEl.textContent).toBe('');
    expect(metaEl.textContent).toBe('');
  });

  it('replaces the previous caption completely on each update', () => {
    const { ribbon, metaEl } = setup();
    ribbon.update(rec({ artist: 'First', date: '1900' }));
    ribbon.update(rec({ artist: 'Second' }));
    // A stale fragment left behind is exactly what "the ribbon doesn't change"
    // would look like from the sofa.
    expect(metaEl.textContent).toBe('Second');
  });

  it('names the category the image was downloaded under', () => {
    // Alex's request: the ribbon should say where an image came from, e.g.
    // "Openverse, Mountains".
    const { ribbon, metaEl } = setup();
    ribbon.update(rec({
      artist: 'someone', department: 'flickr',
      cats: ['openverse::mountain~alps~summit~glacier%20peak'],
    }));
    expect(metaEl.textContent).toBe('someone  —  flickr  —  Openverse, Mountains');
  });

  it('leaves the category out for an image that has none', () => {
    // Bundled and local-folder images are not in the library, so there is no
    // category to name and the line must not gain a dangling separator.
    const { ribbon, metaEl } = setup();
    ribbon.update(rec({ artist: 'someone', cats: [] }));
    expect(metaEl.textContent).toBe('someone');
  });

  it('survives a record from before cats was carried through', () => {
    const { ribbon, metaEl } = setup();
    ribbon.update(rec({ artist: 'someone' }));   // no cats key at all
    expect(metaEl.textContent).toBe('someone');
  });
});
