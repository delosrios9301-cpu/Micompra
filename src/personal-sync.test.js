import test from 'node:test';
import assert from 'node:assert/strict';
import { hashWorkspaceRecord, mergeWorkspaceCollection, syncPersonalWorkspace, PERSONAL_WORKSPACE_KEYS } from './personal-sync.js';

test('el hash no depende del orden de las propiedades', () => {
  assert.equal(hashWorkspaceRecord({ id: 'a', name: 'Arroz' }), hashWorkspaceRecord({ name: 'Arroz', id: 'a' }));
});

test('conserva ambas versiones cuando dos dispositivos cambian el mismo registro', () => {
  const previous = hashWorkspaceRecord({ id: '1', name: 'Arroz' });
  const result = mergeWorkspaceCollection(
    [{ id: '1', name: 'Arroz integral' }],
    [{ id: '1', name: 'Arroz blanco' }],
    { '1': previous }
  );
  assert.equal(result.items.length, 2);
  assert.equal(result.conflicts.length, 1);
  assert.ok(result.items.some(row => row.name === 'Arroz integral'));
  assert.ok(result.items.some(row => row.name === 'Arroz blanco' && row.syncConflictOf === '1'));
});

test('acepta una eliminación remota si el registro local no cambió', () => {
  const original = { id: '1', name: 'Leche' };
  const result = mergeWorkspaceCollection([original], [], { '1': hashWorkspaceRecord(original) });
  assert.deepEqual(result.items, []);
});

test('conserva el registro local si fue editado después de la última sincronización', () => {
  const original = { id: '1', name: 'Leche' };
  const edited = { id: '1', name: 'Leche deslactosada' };
  const result = mergeWorkspaceCollection([edited], [], { '1': hashWorkspaceRecord(original) });
  assert.deepEqual(result.items, [edited]);
});

test('acepta una eliminación local si la copia remota no cambió', () => {
  const original = { id: '1', name: 'Pan' };
  const result = mergeWorkspaceCollection([], [original], { '1': hashWorkspaceRecord(original) });
  assert.deepEqual(result.items, []);
});

test('conserva una copia remota editada cuando el registro local fue eliminado', () => {
  const original = { id: '1', name: 'Pan' };
  const edited = { id: '1', name: 'Pan integral' };
  const result = mergeWorkspaceCollection([], [edited], { '1': hashWorkspaceRecord(original) });
  assert.deepEqual(result.items, [edited]);
});

test('no descarta registros que llegan duplicados con el mismo identificador', () => {
  const result = mergeWorkspaceCollection(
    [{ id: '1', name: 'Huevos' }, { id: '1', name: 'Huevos grandes' }],
    [],
    {}
  );
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].id, '1');
  assert.equal(result.items[1].syncConflictOf, '1');
});

test('no aplica una copia antigua si el usuario edita el dispositivo durante la consulta a la nube', async () => {
  const values = new Map([
    [PERSONAL_WORKSPACE_KEYS.catalog, JSON.stringify([{ id: 'p1', name: 'Arroz' }])],
    [PERSONAL_WORKSPACE_KEYS.cart, '[]'],
    [PERSONAL_WORKSPACE_KEYS.purchases, '[]'],
    [PERSONAL_WORKSPACE_KEYS.pantry, '[]'],
    [PERSONAL_WORKSPACE_KEYS.settings, '{}']
  ]);
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
  let releaseRead;
  const waitForRead = new Promise(resolve => { releaseRead = resolve; });
  let cloudData = null;
  const query = {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() {
      await waitForRead;
      return { data: null, error: null };
    },
    async upsert(payload) {
      cloudData = payload.data;
      return { error: null };
    }
  };
  const supabase = { from: () => query };
  const pending = syncPersonalWorkspace({ supabase, user: { id: 'user-1' }, storage });
  const newest = [{ id: 'p1', name: 'Arroz integral agregado durante la consulta' }];
  storage.setItem(PERSONAL_WORKSPACE_KEYS.catalog, JSON.stringify(newest));
  releaseRead();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.retry, true);
  assert.match(result.message, /cambios nuevos/);
  assert.deepEqual(JSON.parse(storage.getItem(PERSONAL_WORKSPACE_KEYS.catalog)), newest);
  assert.equal(cloudData.catalog[0].name, 'Arroz');
});
