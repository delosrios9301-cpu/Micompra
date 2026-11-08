import test from 'node:test';
import assert from 'node:assert/strict';
import { getWeeklyRange, getCalendarWeek, groupShoppingItemsByDate, summarizeWeeklyPlan, compareWeeklyPlanPrices, getShoppingReminders } from '../src/weekly-plan.js';

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

test('calendar creates seven Monday-to-Sunday dates and navigates by week', () => {
  const base = getCalendarWeek(new Date(2026, 10, 7));
  assert.equal(base.length, 7);
  assert.equal(base[0].date, '2026-11-02');
  assert.equal(base[6].date, '2026-11-08');
  assert.equal(getCalendarWeek(new Date(2026, 10, 7), 1)[0].date, '2026-11-09');
  assert.equal(getCalendarWeek(new Date(2026, 10, 7), -1)[6].date, '2026-11-01');
});

test('calendar groups items by planned date and leaves unplanned items out of day groups', () => {
  const days = getCalendarWeek(new Date(2026, 10, 7));
  const groups = groupShoppingItemsByDate([
    { id: 'a', item_name: 'Arroz', planned_for: '2026-11-02' },
    { id: 'b', item_name: 'Leche', planned_for: '2026-11-05' },
    { id: 'c', item_name: 'Café', planned_for: null }
  ], days);
  assert.equal(groups[0].items[0].item_name, 'Arroz');
  assert.equal(groups[3].items[0].item_name, 'Leche');
  assert.equal(groups[6].items.length, 0);
});

test('shopping reminders group overdue, today, tomorrow and the next seven days, excluding completed items', () => {
  const reminders = getShoppingReminders([
    { item_name: 'Pan', planned_for: '2026-11-06', checked: false },
    { item_name: 'Arroz', planned_for: '2026-11-07', checked: false },
    { item_name: 'Leche', planned_for: '2026-11-08', checked: false },
    { item_name: 'Pollo', planned_for: '2026-11-14', checked: false },
    { item_name: 'Café', planned_for: '2026-11-07', checked: true },
    { item_name: 'Azúcar', planned_for: '2026-11-15', checked: false },
    { item_name: 'Sal', planned_for: null, checked: false }
  ], new Date(2026, 10, 7), 7);
  assert.deepEqual(reminders.overdue.map(item => item.item_name), ['Pan']);
  assert.deepEqual(reminders.upcoming.map(group => group.label), ['Hoy', 'Mañana', 'sábado']);
  assert.deepEqual(reminders.upcoming.map(group => group.items.map(item => item.item_name)), [['Arroz'], ['Leche'], ['Pollo']]);
  assert.equal(reminders.total, 4);
});

test('shopping reminders return empty groups when no pending dated items exist', () => {
  const result = getShoppingReminders([{ planned_for: '2026-11-07', checked: true }], new Date(2026, 10, 7));
  assert.deepEqual(result, { overdue: [], upcoming: [], total: 0 });
});
