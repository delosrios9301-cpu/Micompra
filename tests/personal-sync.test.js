import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeWorkspaceCollection, mergeWorkspaceSettings, hashWorkspaceRecord } from '../src/personal-sync.js';

test('first sync keeps local and remote records without duplicate IDs', () => {
  const result = mergeWorkspaceCollection([{ id: 'local', name: 'Arroz' }], [{ id: 'cloud', name: 'Leche' }], {});
  assert.deepEqual(result.items.map(row => row.id), ['local', 'cloud']);
  assert.equal(result.conflicts.length, 0);
});

test('first sync preserves two different versions of a colliding ID', () => {
  const result = mergeWorkspaceCollection([{ id: 'p1', name: 'Arroz' }], [{ id: 'p1', name: 'Arroz integral' }], {});
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].name, 'Arroz');
  assert.equal(result.items[1].name, 'Arroz integral');
  assert.equal(result.items[1].syncConflictOf, 'p1');
  assert.equal(result.conflicts.length, 1);
});

test('local edit wins when cloud still matches the last synced version', () => {
  const original = { id: 'p1', name: 'Arroz', price: 2 };
  const result = mergeWorkspaceCollection([{ ...original, price: 2.5 }], [original], { p1: hashWorkspaceRecord(original) });
  assert.deepEqual(result.items, [{ ...original, price: 2.5 }]);
});

test('cloud edit wins when local still matches the last synced version', () => {
  const original = { id: 'p1', name: 'Arroz', price: 2 };
  const result = mergeWorkspaceCollection([original], [{ ...original, price: 3 }], { p1: hashWorkspaceRecord(original) });
  assert.deepEqual(result.items, [{ ...original, price: 3 }]);
});

test('independent edits are both preserved as separate records', () => {
  const original = { id: 'p1', name: 'Arroz', price: 2 };
  const local = { ...original, price: 2.5 };
  const remote = { ...original, price: 3 };
  const result = mergeWorkspaceCollection([local], [remote], { p1: hashWorkspaceRecord(original) });
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].price, 2.5);
  assert.equal(result.items[1].price, 3);
  assert.equal(result.conflicts.length, 1);
});

test('a local deletion is propagated when cloud copy was not edited', () => {
  const original = { id: 'p1', name: 'Arroz' };
  const result = mergeWorkspaceCollection([], [original], { p1: hashWorkspaceRecord(original) });
  assert.deepEqual(result.items, []);
});

test('a cloud deletion is propagated when local copy was not edited', () => {
  const original = { id: 'p1', name: 'Arroz' };
  const result = mergeWorkspaceCollection([original], [], { p1: hashWorkspaceRecord(original) });
  assert.deepEqual(result.items, []);
});

test('a concurrent edit is preserved when the other device deletes the record', () => {
  const original = { id: 'p1', name: 'Arroz' };
  const edited = { ...original, name: 'Arroz integral' };
  const result = mergeWorkspaceCollection([], [edited], { p1: hashWorkspaceRecord(original) });
  assert.deepEqual(result.items, [edited]);
});

test('distinct records with same product name are not deduplicated by name', () => {
  const result = mergeWorkspaceCollection(
    [{ id: 'a', name: 'Leche', store: 'Super 99' }],
    [{ id: 'b', name: 'Leche', store: 'El Rey' }],
    {}
  );
  assert.deepEqual(result.items.map(row => row.id), ['a', 'b']);
});

test('concurrent settings edits preserve custom and enabled stores from both devices', () => {
  const original = { currency: 'USD', theme: 'light', defaultStore: 'Super 99', customStores: ['Tienda Central'], enabledStores: ['Super 99', 'Tienda Central'] };
  const local = { ...original, currency: 'PAB', defaultStore: 'Mercado Norte', customStores: ['Tienda Central', 'Mercado Norte'], enabledStores: ['Super 99', 'Tienda Central', 'Mercado Norte'] };
  const remote = { ...original, theme: 'dark', defaultStore: 'Mercado Sur', customStores: ['Tienda Central', 'Mercado Sur'], enabledStores: ['Super 99', 'Tienda Central', 'Mercado Sur'] };
  const merged = mergeWorkspaceSettings(local, remote, hashWorkspaceRecord(original));
  assert.deepEqual(merged.customStores, ['Tienda Central', 'Mercado Sur', 'Mercado Norte']);
  assert.deepEqual(merged.enabledStores, ['Super 99', 'Tienda Central', 'Mercado Norte']);
  assert.equal(merged.currency, 'PAB');
  assert.equal(merged.theme, 'dark');
  assert.equal(merged.defaultStore, 'Mercado Norte');
});

test('concurrent store settings merge deduplicates accents and case', () => {
  const original = { customStores: ['Tienda Uno'], enabledStores: ['Tienda Uno'] };
  const local = { customStores: ['Tienda Uno', 'Mercado Ágil'], enabledStores: ['Tienda Uno', 'Mercado Ágil'] };
  const remote = { customStores: ['Tienda Uno', 'mercado agil'], enabledStores: ['Tienda Uno', 'MERCADO AGIL'] };
  const merged = mergeWorkspaceSettings(local, remote, hashWorkspaceRecord(original));
  assert.deepEqual(merged.customStores, ['Tienda Uno', 'mercado agil']);
  assert.deepEqual(merged.enabledStores, ['Tienda Uno', 'MERCADO AGIL']);
});

test('first login on another device keeps cloud preferences and merges custom stores', () => {
  const localDefaults = { currency: 'USD', theme: 'light', defaultStore: 'Super 99', customStores: ['Local Market'], enabledStores: ['Super 99', 'Local Market'] };
  const cloudSettings = { currency: 'PAB', theme: 'dark', defaultStore: 'Tienda Norte', customStores: ['Tienda Norte'], enabledStores: ['Super 99', 'Tienda Norte'] };
  const merged = mergeWorkspaceSettings(localDefaults, cloudSettings, {});
  assert.equal(merged.currency, 'PAB');
  assert.equal(merged.theme, 'dark');
  assert.equal(merged.defaultStore, 'Tienda Norte');
  assert.deepEqual(merged.customStores, ['Tienda Norte', 'Local Market']);
  assert.deepEqual(merged.enabledStores, ['Super 99', 'Tienda Norte', 'Local Market']);
});

test('first sync keeps local settings when cloud has no preference values', () => {
  const local = { currency: 'PAB', theme: 'dark', defaultStore: 'Tienda Local' };
  const merged = mergeWorkspaceSettings(local, {}, {});
  assert.deepEqual(merged, local);
});

test('three-way settings merge preserves separate currency and theme edits', () => {
  const original = { currency: 'USD', theme: 'light', defaultStore: 'Super 99', customStores: ['Tienda Central'], enabledStores: ['Super 99', 'Tienda Central'] };
  const local = { ...original, currency: 'PAB', customStores: ['Tienda Central', 'Mercado Norte'], enabledStores: ['Super 99', 'Tienda Central', 'Mercado Norte'] };
  const remote = { ...original, theme: 'dark', customStores: ['Tienda Central', 'Mercado Sur'], enabledStores: ['Super 99', 'Tienda Central', 'Mercado Sur'] };
  const merged = mergeWorkspaceSettings(local, remote, hashWorkspaceRecord(original), original);
  assert.equal(merged.currency, 'PAB');
  assert.equal(merged.theme, 'dark');
  assert.deepEqual(merged.customStores, ['Tienda Central', 'Mercado Sur', 'Mercado Norte']);
  // For conflicting enabled-store selections, the local choice wins; both
  // custom store names remain available and can be re-enabled in settings.
  assert.deepEqual(merged.enabledStores, ['Super 99', 'Tienda Central', 'Mercado Norte']);
});

test('legacy hash-only baselines keep local preference precedence but union custom stores', () => {
  const original = { currency: 'USD', customStores: ['Tienda Uno'] };
  const local = { ...original, currency: 'PAB', customStores: ['Tienda Uno', 'Tienda Local'] };
  const remote = { ...original, currency: 'USD', customStores: ['Tienda Uno', 'Tienda Remota'] };
  const merged = mergeWorkspaceSettings(local, remote, hashWorkspaceRecord(original));
  assert.equal(merged.currency, 'PAB');
  assert.deepEqual(merged.customStores, ['Tienda Uno', 'Tienda Remota', 'Tienda Local']);
});
