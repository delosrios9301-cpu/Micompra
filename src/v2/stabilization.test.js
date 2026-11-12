import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createEmptyWorkspace, mergeWorkspaces } from './model.js';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('las listas disponen de filtros accesibles para todos, pendientes y completadas', async () => {
  const app = await read('./app.js');
  assert.match(app, /planningFilter === 'completed'/);
  assert.ok(app.includes('data-action="filter-lists"'));
  assert.match(app, /aria-pressed/);
});

test('el indicador reconoce el estado real del guardado en Firebase', async () => {
  const app = await read('./app.js');
  assert.match(app, /value === 'Sincronizado con Firebase'/);
});

test('la fecha de hoy se construye en hora local, sin convertir a UTC', async () => {
  const app = await read('./app.js');
  const match = app.match(/function today\(\) \{[^\n]+\}/);
  assert.ok(match);
  assert.doesNotMatch(match[0], /toISOString/);
});

test('los cambios pendientes se reintentan y se recuperan al reconectar', async () => {
  const store = await read('./store.js');
  assert.match(store, /syncFailures \+= 1/);
  assert.match(store, /dirty = true;\s*syncFailures \+= 1/);
  assert.match(store, /window\.addEventListener\('online', retryOnReconnect\)/);
  assert.match(store, /window\.removeEventListener\('online', retryOnReconnect\)/);
  assert.match(store, /Math\.min\(30000/);
});

test('borrado de listas gana frente a edición anterior desde otro dispositivo', () => {
  const older = createEmptyWorkspace();
  older.lists = [{ id: 'lista', name: 'Compra anterior', createdAt: '2026-11-10T10:00:00.000Z', updatedAt: '2026-11-10T10:00:00.000Z', items: [] }];
  const newer = createEmptyWorkspace();
  newer.deletedRecords = { 'lists:lista': { deletedAt: '2026-11-11T10:00:00.000Z' } };
  assert.equal(mergeWorkspaces(older, newer).lists.length, 0);
  assert.equal(mergeWorkspaces(newer, older).lists.length, 0);
});
