import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
