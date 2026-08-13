import { describe, it, expect } from 'vitest';
import { headersFor } from './fileStore.js';

// Measured on the CP80 on 2026-08-13: an AIC IIIF image URL returns 403 with
// no headers, 403 with a generic or browser-like User-Agent, and 200 only with
// AIC-User-Agent. Node gets 200 regardless, which is exactly why this survived
// until it was tested on a device.
describe('headersFor', () => {
  it('identifies us to the Art Institute of Chicago', () => {
    const h = headersFor('https://www.artic.edu/iiif/2/abc/full/!843,843/0/default.jpg');
    expect(h['AIC-User-Agent']).toBeTruthy();
  });

  it('covers the bare domain and its subdomains', () => {
    expect(headersFor('https://artic.edu/x.jpg')['AIC-User-Agent']).toBeTruthy();
    expect(headersFor('https://api.artic.edu/x.jpg')['AIC-User-Agent']).toBeTruthy();
  });

  it('does not leak the header to a lookalike domain', () => {
    // A plain `includes('artic.edu')` would match this and send our header to
    // someone else entirely.
    expect(headersFor('https://notartic.edu/x.jpg')).toEqual({});
    expect(headersFor('https://artic.edu.evil.example/x.jpg')).toEqual({});
  });

  it('sends nothing for hosts that need nothing', () => {
    expect(headersFor('https://images.metmuseum.org/CRDImages/dp/web-large/x.jpg')).toEqual({});
    expect(headersFor('https://upload.wikimedia.org/thumb/x.jpg')).toEqual({});
  });

  it('carries no personal information', () => {
    const v = headersFor('https://www.artic.edu/x.jpg')['AIC-User-Agent'];
    expect(v).not.toMatch(/@/);           // no email address in a public repo
  });

  it('survives a malformed url instead of throwing mid-download', () => {
    expect(headersFor('not a url')).toEqual({});
    expect(headersFor('')).toEqual({});
  });
});
