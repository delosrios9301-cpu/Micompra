import test from 'node:test';
import assert from 'node:assert/strict';
import { getWeeklyRange, summarizeWeeklyPlan, compareWeeklyPlanPrices } from '../src/weekly-plan.js';

test('weekly range starts Monday and ends Sunday', () => {
  assert.deepEqual(getWeeklyRange(new Date(2026, 10, 7)), { start: '2026-11-02', end: '2026-11-08' });
});

test('weekly summary separates pending, completed, linked and low pantry stock', () => {
  const summary = summarizeWeeklyPlan([
    { id: 'a', product_id: 'p1', checked: false },
    { id: 'b', product_id: null, checked: false },
    { id: 'c', product_id: 'p2', checked: true }
  ], [
    { quantity: 1, minimum_quantity: 2 },
    { quantity: 5, minimum_quantity: 2 },
    { quantity: 0, minimum_quantity: 0 }
  ], new Date(2026, 10, 7));
  assert.equal(summary.pending.length, 2);
  assert.equal(summary.completed.length, 1);
  assert.equal(summary.linked.length, 1);
  assert.equal(summary.unlinked, 1);
  assert.equal(summary.lowStock.length, 2);
});

test('weekly estimate requires a complete current price set from one store', () => {
  const now = new Date().toISOString();
  const items = [{ product_id: 'rice', quantity: 2, checked: false }, { product_id: 'milk', quantity: 1, checked: false }];
  const listings = [
    { product_id: 'rice', supermarkets: { name: 'Super 99' }, supermarket_branches: { name: 'Vía España' }, price_observations: [{ price: 2, currency: 'USD', observed_at: now, is_verified: true, review_status: 'approved' }] },
    { product_id: 'milk', supermarkets: { name: 'Super 99' }, supermarket_branches: { name: 'Vía España' }, price_observations: [{ price: 1.5, currency: 'USD', observed_at: now, is_verified: true, review_status: 'approved' }] }
  ];
  assert.deepEqual(compareWeeklyPlanPrices(items, listings), { total: 5.5, store: 'Super 99 · Vía España', complete: true, covered: 2, count: 2 });
  assert.equal(compareWeeklyPlanPrices(items, listings.slice(0, 1)).complete, false);
});

test('checked items are excluded from weekly estimate and stale or unapproved prices are ignored', () => {
  const items = [{ product_id: 'rice', quantity: 1, checked: true }, { product_id: 'milk', quantity: 1, checked: false }];
  const listings = [{ product_id: 'milk', supermarkets: { name: 'El Rey' }, price_observations: [{ price: 1, currency: 'USD', observed_at: '2020-01-01T00:00:00Z', is_verified: true, review_status: 'approved' }] }];
  const result = compareWeeklyPlanPrices(items, listings);
  assert.equal(result.complete, false);
  assert.equal(result.count, 1);
});
