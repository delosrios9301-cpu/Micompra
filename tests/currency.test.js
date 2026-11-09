import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCurrency, formatCurrency, getStoredCurrency, formatStoredCurrency } from '../src/currency.js';

const memoryStorage = value => ({ getItem: key => key === 'micompra_settings_v1' ? value : null });

test('only supported currencies are accepted', () => {
  assert.equal(normalizeCurrency('PAB'), 'PAB');
  assert.equal(normalizeCurrency('USD'), 'USD');
  assert.equal(normalizeCurrency('EUR'), 'USD');
  assert.equal(normalizeCurrency(null), 'USD');
});

test('currency formatter produces consistent Panama currency labels', () => {
  assert.match(formatCurrency(12.5, 'USD'), /US\$/);
  assert.match(formatCurrency(12.5, 'PAB'), /B\/?\.?/);
});

test('stored currency preference is read safely', () => {
  assert.equal(getStoredCurrency(memoryStorage('{"currency":"PAB"}')), 'PAB');
  assert.equal(getStoredCurrency(memoryStorage('{"currency":"EUR"}')), 'USD');
  assert.equal(getStoredCurrency(memoryStorage('{invalid')), 'USD');
});

test('storage failures fall back to USD instead of breaking the UI', () => {
  const brokenStorage = { getItem() { throw new Error('storage unavailable'); } };
  assert.equal(getStoredCurrency(brokenStorage), 'USD');
  assert.match(formatStoredCurrency(1, brokenStorage), /US\$/);
});
