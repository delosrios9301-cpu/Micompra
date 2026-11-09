import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeComparisonText,
  normalizeComparisonUnit,
  groupComparableProducts,
  hasComparableStorePrices
} from '../src/comparison.js';

test('comparison search normalization ignores accents, case and extra spaces', () => {
  assert.equal(normalizeComparisonText('  CAFÉ   MOLIDO  '), 'cafe molido');
});

test('comparison units normalize common Spanish aliases', () => {
  assert.equal(normalizeComparisonUnit('kilogramos'), 'kg');
  assert.equal(normalizeComparisonUnit('LIBRAS'), 'lb');
  assert.equal(normalizeComparisonUnit('Litros'), 'litro');
});

test('only identical product, presentation and unit records are grouped', () => {
  const products = [
    { id: 'a', name: 'Café molido', presentation: 'Bolsa 250 g', unit: 'unidad', store: 'Super 99', price: 2.5 },
    { id: 'b', name: 'Cafe molido', presentation: 'Bolsa 250 g', unit: 'UNIDAD', store: 'Xtra', price: 2.3 },
    { id: 'c', name: 'Café molido', presentation: 'Bolsa 500 g', unit: 'unidad', store: 'El Rey', price: 4.2 },
    { id: 'd', name: 'Café molido', presentation: 'Bolsa 250 g', unit: 'kg', store: 'Jumbo', price: 3.1 }
  ];
  const groups = groupComparableProducts(products);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map(product => product.id), ['a', 'b']);
  assert.equal(hasComparableStorePrices(groups[0]), true);
});

test('products without a specified presentation are never compared as equivalent', () => {
  const products = [
    { id: 'a', name: 'Leche', store: 'Super 99', price: 1.25 },
    { id: 'b', name: 'Leche', store: 'Xtra', price: 1.1 }
  ];
  const groups = groupComparableProducts(products);
  assert.equal(groups.length, 1);
  assert.equal(hasComparableStorePrices(groups[0]), false);
});

test('duplicate records from one store do not create a valid store comparison', () => {
  const group = [
    { store: 'Super 99', price: 2.5 },
    { store: ' super 99 ', price: 2.3 }
  ];
  assert.equal(hasComparableStorePrices(group), false);
});

test('unpriced and blank-store records do not count as comparable stores', () => {
  const group = [
    { store: 'Super 99', price: 0 },
    { store: 'Xtra', price: null },
    { store: '', price: 2 }
  ];
  assert.equal(hasComparableStorePrices(group), false);
});
