import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeWorkspaceCollection, hashWorkspaceRecord } from '../src/personal-sync.js';

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
