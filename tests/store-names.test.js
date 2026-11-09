import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILT_IN_STORES, collectCustomStoreNames, buildStoreList } from '../src/store-names.js';

test('store lists include all built-in stores in a stable order', () => {
  assert.deepEqual(buildStoreList(), [...BUILT_IN_STORES]);
});

test('custom store names are trimmed, normalized and deduplicated case-insensitively', () => {
  assert.deepEqual(
    buildStoreList(['  Tienda Central  ', 'tienda central', ' SUPER 99 ', 'Mercado Local']),
    [...BUILT_IN_STORES, 'Tienda Central', 'Mercado Local']
  );
});

test('custom stores are recovered from synchronized settings and existing records', () => {
  const custom = collectCustomStoreNames({
    settings: { enabledStores: ['Super 99', 'Bodega Norte'], defaultStore: 'Mercado Local' },
    catalog: [{ store: 'Abarrotería San José' }],
    cart: [{ store: 'Bodega Norte' }],
    purchases: [{ items: [{ store: 'Mercado Local' }, { store: 'Tienda del Barrio' }] }]
  });
  assert.deepEqual(custom, ['Bodega Norte', 'Mercado Local', 'Abarrotería San José', 'Tienda del Barrio']);
});

test('invalid and overlong custom store names are ignored', () => {
  assert.deepEqual(buildStoreList([null, '', '   ', 'x'.repeat(51)]), [...BUILT_IN_STORES]);
});
