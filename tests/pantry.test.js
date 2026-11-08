import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePantryName, isPantryLowStock, summarizePantry, findPantryListDuplicate, buildPantryRestockPlan } from '../src/pantry.js';

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
