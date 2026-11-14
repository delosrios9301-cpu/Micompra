import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createEmptyWorkspace, mergeWorkspaces, inventoryAlerts } from './model.js';

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

test('inventario respeta la fecha local para caducidades y próximos siete días', () => {
  const atNight = new Date(2026, 10, 12, 23, 30);
  const alerts = inventoryAlerts([
    { id: 'a', quantity: 2, minimum: 0, expiryDate: '2026-11-11' },
    { id: 'b', quantity: 2, minimum: 0, expiryDate: '2026-11-12' },
    { id: 'c', quantity: 2, minimum: 0, expiryDate: '2026-11-19' },
    { id: 'd', quantity: 2, minimum: 0, expiryDate: '2026-11-20' }
  ], atNight);
  assert.deepEqual(alerts.expired.map(row => row.id), ['a']);
  assert.deepEqual(alerts.expiring.map(row => row.id), ['b', 'c']);
});

test('dos dispositivos agregan listas distintas sin perder ninguna', () => {
  const first = createEmptyWorkspace();
  const second = createEmptyWorkspace();
  first.lists = [{ id: 'lista-a', name: 'Mercado', createdAt: '2026-11-12T10:00:00Z', updatedAt: '2026-11-12T10:00:00Z', items: [] }];
  second.lists = [{ id: 'lista-b', name: 'Farmacia', createdAt: '2026-11-12T10:01:00Z', updatedAt: '2026-11-12T10:01:00Z', items: [] }];
  for (const result of [mergeWorkspaces(first, second), mergeWorkspaces(second, first)]) {
    assert.deepEqual(result.lists.map(row => row.id).sort(), ['lista-a', 'lista-b']);
  }
});

test('dos dispositivos agregan artículos diferentes a una misma lista', () => {
  const first = createEmptyWorkspace();
  const second = createEmptyWorkspace();
  const base = { id: 'lista', name: 'Hogar', updatedAt: '2026-11-12T10:00:00Z' };
  first.lists = [{ ...base, items: [{ id: 'arroz', name: 'Arroz', updatedAt: '2026-11-12T10:01:00Z' }] }];
  second.lists = [{ ...base, items: [{ id: 'pollo', name: 'Pollo', updatedAt: '2026-11-12T10:02:00Z' }] }];
  for (const result of [mergeWorkspaces(first, second), mergeWorkspaces(second, first)]) {
    assert.deepEqual(result.lists[0].items.map(row => row.id).sort(), ['arroz', 'pollo']);
  }
});

test('una eliminación confirmada no resucita al fusionar un dispositivo desactualizado', () => {
  const stale = createEmptyWorkspace();
  stale.products = [{ id: 'p1', name: 'Leche', updatedAt: '2026-11-10T10:00:00Z' }];
  const deleted = createEmptyWorkspace();
  deleted.deletedRecords = { 'products:p1': { deletedAt: '2026-11-12T10:00:00Z' } };
  const merged = mergeWorkspaces(stale, deleted);
  assert.equal(merged.products.length, 0);
  assert.ok(merged.deletedRecords['products:p1']);
  assert.equal(mergeWorkspaces(merged, stale).products.length, 0);
});

test('un dispositivo con reloj adelantado no puede recuperar registros ni artículos borrados', () => {
  const older = createEmptyWorkspace();
  const deleted = createEmptyWorkspace();
  const updatedAt = '2026-11-13T12:00:01Z';
  older.financeCategories = [{ id: 'mascotas', name: 'Mascotas', updatedAt }];
  older.lists = [{ id: 'hogar', items: [{ id: 'arroz', updatedAt }] }];
  deleted.deletedRecords = {
    'financeCategories:mascotas': { deletedAt: '2026-11-13T12:00:00Z' },
    'listItems:hogar:arroz': { deletedAt: '2026-11-13T12:00:00Z' }
  };
  for (const merged of [mergeWorkspaces(older, deleted), mergeWorkspaces(deleted, older)]) {
    assert.equal(merged.financeCategories.length, 0);
    assert.equal(merged.lists[0].items.length, 0);
  }
});
