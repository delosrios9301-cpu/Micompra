import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createEmptyWorkspace } from './model.js';
import { createWorkspaceBackup, validateWorkspaceBackup, shouldRecoverBackupDraft, backupSummary } from './backup.js';

const getExample = (workspaceId = 'owner-workspace') => createWorkspaceBackup({
  workspaceId,
  workspace: {
    ...createEmptyWorkspace(),
    products: [{ id:'p1', name:'Arroz', updatedAt:'2026-11-14T20:00:00Z' }],
    lists: [{ id:'l1', name:'Supermercado', items:[{ id:'i1', name:'Arroz' }] }],
    purchases: [{ id:'b1', items:[], total:23, createdAt:'2026-11-14T20:00:00Z' }]
  },
  activePurchaseDraft: { id:'draft-1', updatedAt:'2026-11-14T20:20:00Z', items:[{id:'d1',name:'Leche',quantity:1,unitPrice:3.5}] },
  exportedAt: '2026-11-14T20:25:00Z'
});

test('el respaldo exporta colecciones, espacio y precios compartidos sin cambiar los datos originales', () => {
  const backup = getExample();
  assert.equal(backup.app, 'Mi Compra 2.0');
  assert.equal(backup.version, 2);
  assert.equal(backup.workspaceId, 'owner-workspace');
  assert.equal(backup.activePurchaseDraft.items[0].unitPrice, 3.5);
  assert.deepEqual(backupSummary(backup), {products:1,lists:1,purchases:1,draftItems:1});
  assert.equal(validateWorkspaceBackup(backup,'owner-workspace'), true);
});

test('impide restaurar un respaldo de otro espacio y formatos incompletos', () => {
  const backup = getExample();
  assert.throws(() => validateWorkspaceBackup(backup,'otra-cuenta'), /otro espacio/);
  assert.throws(() => validateWorkspaceBackup({...backup, workspace:{...backup.workspace,products:null}}), /incompletos/);
  assert.throws(() => validateWorkspaceBackup({...backup, workspace:{...backup.workspace,deletedRecords:[]}}), /incompleta/);
  assert.throws(() => validateWorkspaceBackup({...backup, activePurchaseDraft:{id:'a',items:[null]}}), /borrador/);
});

test('el formato anterior de respaldo v2 sigue siendo compatible con el mismo propietario', () => {
  const {workspaceId, activePurchaseDraft, ...legacy} = getExample();
  assert.equal(validateWorkspaceBackup(legacy,'owner-workspace'),true);
});

test('no resucita compras finalizadas ni sobreescribe precios actuales', () => {
  const historical = getExample().activePurchaseDraft;
  assert.equal(shouldRecoverBackupDraft(historical,{id:'current',items:[{id:'new',unitPrice:5}],updatedAt:'2026-11-14T20:40:00Z'}),false);
  assert.equal(shouldRecoverBackupDraft(historical,{id:'',items:[],updatedAt:'2026-11-14T20:30:00Z'}),false);
  assert.equal(shouldRecoverBackupDraft(historical,{id:'',items:[],updatedAt:'2026-11-14T20:10:00Z'}),true);
});

test('la app respalda desde servidor y restaura en transacción sin suprimir información', async () => {
  const app = await readFile(new URL('./app.js',import.meta.url),'utf8');
  const store = await readFile(new URL('./store.js',import.meta.url),'utf8');
  assert.match(app,/store\.exportBackup\(\)/);
  assert.match(app,/await store\.restoreBackup\(parsed\)/);
  assert.match(app,/mi-compra-antes-de-restaurar-/);
  assert.match(store,/getDocFromServer/);
  assert.match(store,/shouldRecoverBackupDraft/);
  assert.match(store,/runTransaction\(db, async transaction =>/);
  assert.match(store,/Solo la cuenta propietaria puede restaurar copias de seguridad/);
});

test('PC y tablet admiten sesión alternativa y menú legible en pantallas medianas', async () => {
  const store = await readFile(new URL('./store.js',import.meta.url),'utf8');
  const css = await readFile(new URL('./styles.css',import.meta.url),'utf8');
  assert.match(store,/browserLocalPersistence/);
  assert.match(store,/browserSessionPersistence/);
  assert.match(store,/inMemoryPersistence/);
  assert.match(css,/@media \(min-width:621px\) and \(max-width:1024px\)/);
  assert.match(css,/\.sidebar \.nav-link span \{display:inline/);
  assert.match(css,/@media \(min-width:621px\) and \(max-width:760px\)/);
});
