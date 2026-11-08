import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCatalogSearchName, findCatalogNameMatches, findDuplicateListItem } from '../src/catalog-duplicates.js';

const catalog = [
  { id: 'coffee-250', canonical_name: 'Café molido', normalized_quantity: 250, normalized_unit_name: 'g' },
  { id: 'coffee-500', canonical_name: 'Cafe molido', normalized_quantity: 500, normalized_unit_name: 'g' },
  { id: 'rice', canonical_name: 'Arroz blanco', normalized_quantity: 1, normalized_unit_name: 'kg' },
  { id: 'milk', canonical_name: 'Leche entera', normalized_quantity: 1, normalized_unit_name: 'L' }
];

test('catalog name normalization ignores accents, case and package suffix', () => {
  assert.equal(normalizeCatalogSearchName('CAFÉ MOLIDO 250 g'), 'cafe molido');
});

test('catalog lookup finds exact names and package variants without merging them', () => {
  const matches = findCatalogNameMatches(catalog, 'Cafe molido 250 g');
  assert.equal(matches.length, 2);
  assert.ok(matches.every(item => item.isExactName));
  assert.deepEqual(matches.map(item => item.id), ['coffee-250', 'coffee-500']);
});

test('catalog lookup finds conservative partial suggestions', () => {
  const matches = findCatalogNameMatches(catalog, 'arroz');
  assert.equal(matches[0].id, 'rice');
});

test('catalog lookup ignores very short queries', () => {
  assert.deepEqual(findCatalogNameMatches(catalog, 'ar'), []);
});

test('same catalog product is detected as an existing list item', () => {
  const items = [{ id: 'row-1', product_id: 'rice', item_name: 'Arroz blanco', quantity: 2 }];
  assert.equal(findDuplicateListItem(items, 'rice').id, 'row-1');
});

test('free text duplicates are detected regardless of accents and case', () => {
  const items = [{ id: 'row-1', product_id: null, item_name: 'Café molido', quantity: 1 }];
  assert.equal(findDuplicateListItem(items, null, 'CAFE MOLIDO').id, 'row-1');
});
