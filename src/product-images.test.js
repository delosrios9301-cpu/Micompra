import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductImageSearchUrl, normalizeProductImageResults, searchProductImages } from './product-images.js';

test('builds a Wikimedia Commons image search URL for the entered product', () => {
  const url = new URL(buildProductImageSearchUrl('banana'));
  assert.equal(url.hostname, 'commons.wikimedia.org');
  assert.match(url.searchParams.get('gsrsearch'), /banana/);
  assert.equal(url.searchParams.get('gsrnamespace'), '6');
  assert.equal(url.searchParams.get('origin'), '*');
});

test('normalizes only usable HTTPS image results', () => {
  const rows = normalizeProductImageResults({ query: { pages: {
    1: { title: 'File:Banana.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/banana.jpg' }] },
    2: { title: 'File:Bad.png', imageinfo: [{ thumburl: 'http://example.com/bad.png' }] },
    3: { title: 'Page without image', imageinfo: [] }
  } } });
  assert.deepEqual(rows, [{ title: 'Banana.jpg', url: 'https://upload.wikimedia.org/banana.jpg' }]);
});

test('returns no results for a short query and fetches matching images', async () => {
  let requested = '';
  const fetchImpl = async url => {
    requested = url;
    return { ok: true, json: async () => ({ query: { pages: {
      1: { title: 'File:Banana.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/banana.jpg' }] }
    } } }) };
  };
  assert.deepEqual(await searchProductImages('a', { fetchImpl }), []);
  const results = await searchProductImages('banana', { fetchImpl });
  assert.equal(results.length, 1);
  assert.match(requested, /banana/);
});
