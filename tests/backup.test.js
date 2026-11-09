import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBackupPayload, writeStorageEntriesAtomically } from '../src/backup.js';

const validBackup = () => ({
  format: 'micompra-backup-v1',
  catalog: [{ id: 'p1', name: 'Arroz' }],
  cart: [],
  purchases: [],
  pantry: [],
  settings: { currency: 'USD' },
  customStores: ['Tienda Norte']
});

test('accepts a complete Mi Compra backup', () => {
  assert.deepEqual(validateBackupPayload(validBackup()), { valid: true, message: '' });
});

test('accepts legacy backups without pantry and preserves their compatibility', () => {
  const backup = validBackup();
  delete backup.pantry;
  assert.equal(validateBackupPayload(backup).valid, true);
});

test('rejects malformed collections and invalid records before writing', () => {
  const backup = validBackup();
  backup.purchases = [{ id: 'ok' }, null];
  assert.equal(validateBackupPayload(backup).valid, false);
  backup.purchases = 'not-an-array';
  assert.match(validateBackupPayload(backup).message, /purchases/);
});

test('rejects invalid settings, custom stores and recovery copies', () => {
  const backup = validBackup();
  backup.settings = [];
  assert.equal(validateBackupPayload(backup).valid, false);
  backup.settings = {};
  backup.customStores = ['Valid', 4];
  assert.equal(validateBackupPayload(backup).valid, false);
  backup.customStores = [];
  backup.recoveryCopies = [];
  assert.equal(validateBackupPayload(backup).valid, false);
});

test('writes all backup keys together', () => {
  const values = new Map([['old', 'value']]);
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
  const result = writeStorageEntriesAtomically(storage, { first: '1', second: '2' });
  assert.equal(result.written, 2);
  assert.equal(values.get('first'), '1');
  assert.equal(values.get('second'), '2');
});

test('rolls back earlier writes when a later backup write fails', () => {
  const values = new Map([['first', 'old-first'], ['second', 'old-second']]);
  let fail = true;
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => {
      if (key === 'second' && fail) { fail = false; throw new Error('quota'); }
      values.set(key, String(value));
    },
    removeItem: key => values.delete(key)
  };
  assert.throws(() => writeStorageEntriesAtomically(storage, { first: 'new-first', second: 'new-second' }), /datos anteriores se conservaron/);
  assert.equal(values.get('first'), 'old-first');
  assert.equal(values.get('second'), 'old-second');
});
