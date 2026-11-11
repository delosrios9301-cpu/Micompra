import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createEmptyWorkspace, mergeWorkspaces } from './model.js';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('Firestore impide que un miembro cambie el propietario del espacio', async () => {
  const rules = await read('../../firestore.rules');
  assert.match(rules, /request\.resource\.data\.ownerUid == resource\.data\.ownerUid/);
  assert.match(rules, /allow delete: if isWorkspaceOwner\(workspaceId\)/);
});

test('Firestore reserva el restablecimiento total al propietario', async () => {
  const rules = await read('../../firestore.rules');
  assert.match(rules, /function isEmptyWorkspaceReset\(\)/);
  assert.match(rules, /\(!isEmptyWorkspaceReset\(\) \|\| isWorkspaceOwner\(workspaceId\)\)/);
});

test('el almacén valida que solo el propietario pueda borrar el espacio', async () => {
  const store = await read('./store.js');
  assert.match(store, /workspaceOwnerUid !== user\.uid/);
  assert.match(store, /Solo la cuenta propietaria puede restablecer/);
});

test('la interfaz protege restauración y muestra la confirmación de borrado solo al propietario', async () => {
  const app = await read('./app.js');
  assert.match(app, /if \(!store\.isWorkspaceOwner\(\)\) \{\s*modalName = null; return '';/);
  assert.match(app, /Solo la cuenta propietaria puede restaurar copias de seguridad/);
  assert.match(app, /Solo el propietario puede borrar los datos compartidos/);
});

test('el inicio de sesión devuelve la navegación a Inicio', async () => {
  const app = await read('./app.js');
  assert.match(app, /promise\.then\(result => \{\s*currentView = 'inicio';\s*selectedListId = null;/);
});

test('la aplicación registra el service worker para instalación PWA', async () => {
  const app = await read('./app.js');
  const html = await read('../../index.html');
  assert.match(app, /navigator\.serviceWorker\.register\('\/sw\.js'\)/);
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
});


test('el propietario puede listar y revocar miembros, y el acceso revocado queda bloqueado', async () => {
  const store = await read('./store.js');
  const rules = await read('../../firestore.rules');
  assert.match(store, /async function listAccessUsers\(\)/);
  assert.match(store, /async function revokeAccessUser\(uid\)/);
  assert.match(store, /revokedUsers/);
  assert.match(store, /Acceso revocado por el propietario/);
  assert.match(rules, /match \/revokedUsers\/\{userId\}/);
  assert.match(rules, /allow create, update: if signedIn\(\)[\s\S]*isWorkspaceOwner\(request\.resource\.data\.workspaceId\)/);
});

test('Configuración muestra usuarios y permite revocar accesos solo al propietario', async () => {
  const app = await read('./app.js');
  assert.match(app, /Usuarios con acceso/);
  assert.match(app, /data-action="revoke-access-user"/);
  assert.match(app, /Solo el propietario puede revocar accesos/);
});

test('la eliminación de un registro prevalece frente a un dispositivo atrasado', () => {
  const stale = createEmptyWorkspace();
  stale.products = [{ id: 'p1', name: 'Leche', updatedAt: '2026-11-10T10:00:00.000Z' }];
  const deleted = createEmptyWorkspace();
  deleted.deletedRecords = { 'products:p1': { deletedAt: '2026-11-11T10:00:00.000Z' } };
  const merged = mergeWorkspaces(stale, deleted);
  assert.equal(merged.products.some(row => row.id === 'p1'), false);
});

test('una edición legítima posterior a una eliminación puede recrear el registro', () => {
  const old = createEmptyWorkspace();
  old.deletedRecords = { 'products:p1': { deletedAt: '2026-11-10T10:00:00.000Z' } };
  const recreated = createEmptyWorkspace();
  recreated.products = [{ id: 'p1', name: 'Leche', updatedAt: '2026-11-11T10:00:00.000Z' }];
  recreated.deletedRecords = old.deletedRecords;
  assert.equal(mergeWorkspaces(recreated, old).products.length, 1);
});

test('los borrados de artículos dentro de listas también se propagan', () => {
  const stale = createEmptyWorkspace();
  stale.lists = [{ id: 'l1', name: 'Compra', items: [{ id: 'i1', name: 'Arroz', updatedAt: '2026-11-10T10:00:00.000Z' }] }];
  const deleted = createEmptyWorkspace();
  deleted.lists = [{ id: 'l1', name: 'Compra', items: [] }];
  deleted.deletedRecords = { 'listItems:l1:i1': { deletedAt: '2026-11-11T10:00:00.000Z' } };
  assert.equal(mergeWorkspaces(stale, deleted).lists[0].items.length, 0);
});

test('el almacén escucha revocaciones y elimina los datos cargados', async () => {
  const store = await read('./store.js');
  assert.match(store, /onSnapshot\(revokedRef/);
  assert.match(store, /onSnapshot\(accessRef/);
  assert.match(store, /workspace = createEmptyWorkspace\(\)/);
  assert.match(store, /firebaseSignOut\(auth\)/);
});

test('la sincronización conserva cambios locales pendientes al recibir una instantánea remota', async () => {
  const store = await read('./store.js');
  assert.match(store, /workspace = dirty \? mergeWorkspaces\(workspace, incoming\) : incoming/);
  assert.match(store, /dirty = true/);
  assert.match(store, /dirty = false/);
});
