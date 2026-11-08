import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePantryName, isPantryLowStock, summarizePantry } from '../src/pantry.js';

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

import { findPantryListDuplicate } from '../src/pantry.js';

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
