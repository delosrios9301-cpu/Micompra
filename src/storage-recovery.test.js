import test from 'node:test';
import assert from 'node:assert/strict';
import { readStoredArraySafely, readStoredObjectSafely, collectLocalRecoveryCopies, restoreLocalRecoveryCopies } from './storage-recovery.js';

test('conserva una copia recuperable si una lista local contiene JSON dañado', () => {
  const original = '[{"id":"p1","name":';
  const values = new Map([['micompra_personal_catalog_v1', original]]);
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value))
  };
  assert.deepEqual(readStoredArraySafely('micompra_personal_catalog_v1', storage), []);
  const copies = collectLocalRecoveryCopies(storage);
  assert.equal(copies.micompra_personal_catalog_v1.raw, original);
  values.set('micompra_personal_catalog_v1', '[]');
  assert.equal(collectLocalRecoveryCopies(storage).micompra_personal_catalog_v1.raw, original);
});

test('no altera una lista válida ni crea una copia innecesaria', () => {
  const rows = [{ id: 'p1', name: 'Arroz' }];
  const values = new Map([['micompra_guest_cart_v1', JSON.stringify(rows)]]);
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value))
  };
  assert.deepEqual(readStoredArraySafely('micompra_guest_cart_v1', storage), rows);
  assert.deepEqual(collectLocalRecoveryCopies(storage), {});
});

test('restaura las copias de recuperación incluidas en un respaldo', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value))
  };
  const raw = '[{"id":"p1","name":';
  restoreLocalRecoveryCopies({
    micompra_personal_catalog_v1: { raw, savedAt: '2026-11-08T12:00:00.000Z' },
    unrelated_key: { raw: 'ignored' }
  }, storage);
  assert.equal(collectLocalRecoveryCopies(storage).micompra_personal_catalog_v1.raw, raw);
  assert.equal(values.has('micompra_recovery_v1_unrelated_key'), false);
});

test('conserva las preferencias dañadas y devuelve valores predeterminados', () => {
  const raw = '{"currency":';
  const values = new Map([['micompra_settings_v1', raw]]);
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value))
  };
  assert.deepEqual(readStoredObjectSafely('micompra_settings_v1', { currency: 'USD' }, storage), { currency: 'USD' });
  assert.equal(collectLocalRecoveryCopies(storage).micompra_settings_v1.raw, raw);
});
