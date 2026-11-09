import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCartItemEdits } from '../src/cart-items.js';

const items = [
  { id: 'one', name: 'Arroz', store: 'Super 99', qty: 1, price: 2.5, priceUnit: 'lb', imageData: 'photo' },
  { id: 'two', name: 'Leche', store: 'Xtra', qty: 2, price: 1.8, priceUnit: 'litro' }
];

test('updates quantity and unit price without dropping existing product data', () => {
  const result = applyCartItemEdits(items, 'one', { quantity: '3', unitPrice: '2.75' });
  assert.deepEqual(result[0], { ...items[0], qty: 3, price: 2.75 });
  assert.deepEqual(result[1], items[1]);
  assert.notEqual(result, items);
});

test('blank price leaves an item pending instead of inventing a value', () => {
  const result = applyCartItemEdits(items, 'two', { quantity: '1.5', unitPrice: '' });
  assert.equal(result[1].qty, 1.5);
  assert.equal(result[1].price, null);
  assert.equal(result[1].store, 'Xtra');
});

test('rejects invalid quantities and prices', () => {
  assert.throws(() => applyCartItemEdits(items, 'one', { quantity: '0', unitPrice: '2' }), /cantidad/i);
  assert.throws(() => applyCartItemEdits(items, 'one', { quantity: '-1', unitPrice: '2' }), /cantidad/i);
  assert.throws(() => applyCartItemEdits(items, 'one', { quantity: '1', unitPrice: '0' }), /precio/i);
  assert.throws(() => applyCartItemEdits(items, 'one', { quantity: '1', unitPrice: 'abc' }), /precio/i);
});

test('returns a clear error when the product is missing', () => {
  assert.throws(() => applyCartItemEdits(items, 'missing', { quantity: 1, unitPrice: 2 }), /ya no está/i);
});

test('does not mutate the original list', () => {
  const copy = structuredClone(items);
  applyCartItemEdits(items, 'one', { quantity: 2, unitPrice: '4.25' });
  assert.deepEqual(items, copy);
});
