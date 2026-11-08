import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePantryName, isPantryLowStock, summarizePantry, findPantryListDuplicate, findPantryCatalogMatch, buildPantryRestockPlan } from '../src/pantry.js';

test('pantry names normalize accents, case and whitespace', () => {
  assert.equal(normalizePantryName('  Café   Molido '), 'cafe molido');
});

test('pantry stock status uses configured minimum and marks zero as empty', () => {
  assert.equal(isPantryLowStock({ quantity: 4, minimum_quantity: 2 }), false);
  assert.equal(isPantryLowStock({ quantity: 2, minimum_quantity: 2 }), true);
  assert.equal(isPantryLowStock({ quantity: 0, minimum_quantity: 0 }), true);
});

test('pantry summary counts all, low and empty items', () => {
  const result = summarizePantry([
    { quantity: 5, minimum_quantity: 2 },
    { quantity: 1, minimum_quantity: 2 },
    { quantity: 0, minimum_quantity: 0 }
  ]);
  assert.deepEqual({ total: result.total, low: result.low, empty: result.empty }, { total: 3, low: 2, empty: 1 });
});

test('pantry to shopping list finds duplicate by normalized name and same unit', () => {
  const rows = [
    { id: 'a', item_name: 'Café molido', unit: 'paquete' },
    { id: 'b', item_name: 'Arroz', unit: 'kg' }
  ];
  assert.equal(findPantryListDuplicate(rows, { item_name: '  CAFE MOLIDO ', unit: 'paquete' })?.id, 'a');
  assert.equal(findPantryListDuplicate(rows, { item_name: 'Arroz', unit: 'lb' }), null);
  assert.equal(findPantryListDuplicate(rows, { item_name: 'Leche', unit: 'litro' }), null);
});

test('pantry list duplicate defaults missing units to unidades', () => {
  assert.equal(findPantryListDuplicate([{ id: 'x', item_name: 'Sal' }], { item_name: 'sal', unit: 'unidades' })?.id, 'x');
});

test('bulk restock plan adds only low stock pantry items and merges matching list rows', () => {
  const plan = buildPantryRestockPlan([
    { item_name: 'Arroz', quantity: 0, minimum_quantity: 1, unit: 'kg' },
    { item_name: 'Leche', quantity: 1, minimum_quantity: 2, unit: 'L' },
    { item_name: 'Café', quantity: 5, minimum_quantity: 1, unit: 'paquete' }
  ], [
    { id: 'rice', item_name: 'ARROZ', quantity: 2, unit: 'kg', checked: true }
  ]);
  assert.equal(plan.total, 2);
  assert.deepEqual(plan.updates, [{ id: 'rice', quantity: 3, checked: false }]);
  assert.deepEqual(plan.inserts, [{
    list_id: null, product_id: null, item_name: 'Leche', quantity: 1, unit: 'L'
  }]);
});

test('bulk restock plan avoids creating duplicates among planned inserts', () => {
  const plan = buildPantryRestockPlan([
    { item_name: 'Sal', quantity: 0, minimum_quantity: 1, unit: 'paquete' },
    { item_name: 'SAL', quantity: 0, minimum_quantity: 1, unit: 'paquete' }
  ], []);
  assert.equal(plan.inserts.length, 1);
  assert.equal(plan.updates.length, 1);
});

test('pantry catalog matching requires exact name, compatible unit and unambiguous single-size package', () => {
  const products = [
    { id: 'rice-1kg', canonical_name: 'Arroz', normalized_quantity: 1, normalized_unit_name: 'kg', active: true },
    { id: 'rice-500g', canonical_name: 'Arroz', normalized_quantity: 500, normalized_unit_name: 'g', active: true },
    { id: 'milk', canonical_name: 'Leche', normalized_quantity: 1, normalized_unit_name: 'L', active: true }
  ];
  assert.equal(findPantryCatalogMatch({ item_name: 'ARROZ', unit: 'kg' }, products).product?.id, 'rice-1kg');
  assert.equal(findPantryCatalogMatch({ item_name: 'Arroz', unit: 'lb' }, products).product, null);
  assert.equal(findPantryCatalogMatch({ item_name: 'Leche', unit: 'paquete' }, products).product, null);
  assert.equal(findPantryCatalogMatch({ item_name: 'Arroz', unit: 'g' }, products).product, null);
});

test('pantry catalog matching refuses ambiguous and multi-unit packages', () => {
  const products = [
    { id: 'a', canonical_name: 'Sal', normalized_quantity: 1, normalized_unit_name: 'unidades', active: true },
    { id: 'b', canonical_name: 'Sal', normalized_quantity: 1, normalized_unit_name: 'unidad', active: true },
    { id: 'c', canonical_name: 'Azúcar', normalized_quantity: 2, normalized_unit_name: 'kg', active: true }
  ];
  assert.equal(findPantryCatalogMatch({ item_name: 'Sal', unit: 'unidad' }, products).reason, 'ambiguous');
  assert.equal(findPantryCatalogMatch({ item_name: 'Azúcar', unit: 'kg' }, products).product, null);
});

test('bulk restock plan links only safe unique catalog matches', () => {
  const plan = buildPantryRestockPlan([
    { item_name: 'Arroz', quantity: 0, minimum_quantity: 1, unit: 'kg' },
    { item_name: 'Leche', quantity: 0, minimum_quantity: 1, unit: 'L' }
  ], [], [
    { id: 'rice-1kg', canonical_name: 'Arroz', normalized_quantity: 1, normalized_unit_name: 'kg', active: true },
    { id: 'milk-half', canonical_name: 'Leche', normalized_quantity: 500, normalized_unit_name: 'ml', active: true }
  ]);
  assert.equal(plan.linked, 1);
  assert.equal(plan.unlinked, 1);
  assert.equal(plan.inserts[0].product_id, 'rice-1kg');
  assert.equal(plan.inserts[1].product_id, null);
});
