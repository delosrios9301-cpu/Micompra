import test from 'node:test';
import assert from 'node:assert/strict';
import { localDateKey, getMondayDateKey, summarizeSpending, summarizeMonthlySpending } from '../src/spending.js';

test('local date key uses local calendar date', () => {
  assert.equal(localDateKey(new Date(2026, 10, 7)), '2026-11-07');
});

test('week starts on Monday', () => {
  assert.equal(getMondayDateKey(new Date(2026, 10, 7)), '2026-11-02');
  assert.equal(getMondayDateKey(new Date(2026, 10, 2)), '2026-11-02');
});

test('spending summary calculates week, month, product and category totals', () => {
  const purchases = [
    { purchase_date: '2026-11-06', purchase_items: [
      { item_name: 'Arroz', quantity: 2, unit_price: 2, line_total: 4, products: { category: 'Granos' } },
      { item_name: 'Pollo', quantity: 1, unit_price: 5, line_total: 5, products: { category: 'Carnes' } }
    ] },
    { purchase_date: '2026-10-30', purchase_items: [
      { item_name: 'Arroz', quantity: 1, unit_price: 2, line_total: null, products: { category: 'Granos' } }
    ] }
  ];
  const result = summarizeSpending(purchases, new Date(2026, 10, 7));
  assert.equal(result.week, 9);
  assert.equal(result.month, 9);
  assert.equal(result.totalItems, 3);
  assert.deepEqual(result.topProducts, [{ name: 'Pollo', amount: 5 }, { name: 'Arroz', amount: 4 }]);
  assert.deepEqual(result.categories, [{ name: 'Carnes', amount: 5 }, { name: 'Granos', amount: 4 }]);
});

test('invalid or empty purchase data produces zero totals', () => {
  const result = summarizeSpending([], new Date(2026, 10, 7));
  assert.equal(result.week, 0);
  assert.equal(result.month, 0);
  assert.deepEqual(result.topProducts, []);
});

test('monthly history includes six calendar months and aggregates purchases', () => {
  const purchases = [
    { purchase_date: '2026-11-06', purchase_items: [{ quantity: 2, unit_price: 3 }] },
    { purchase_date: '2026-10-02', purchase_items: [{ line_total: 8 }] },
    { purchase_date: '2026-09-12', purchase_items: [{ line_total: 5 }, { line_total: 2 }] },
    { purchase_date: '2026-05-31', purchase_items: [{ line_total: 100 }] }
  ];
  const history = summarizeMonthlySpending(purchases, new Date(2026, 10, 7));
  assert.equal(history.length, 6);
  assert.deepEqual(history.map(month => month.key), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  assert.equal(history[3].amount, 7);
  assert.equal(history[4].amount, 8);
  assert.equal(history[5].amount, 6);
  assert.equal(history[5].purchases, 1);
});

test('monthly history is zero-filled and supports a bounded custom range', () => {
  const history = summarizeMonthlySpending([], new Date(2026, 10, 7), 30);
  assert.equal(history.length, 24);
  assert.ok(history.every(month => month.amount === 0 && month.purchases === 0));
});
