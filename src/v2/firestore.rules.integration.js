import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, runTransaction, writeBatch, getDocs, collection } from 'firebase/firestore';
import { mergeWorkspaces, applySharedDraftOperation, normalizeSharedDraft } from './model.js';
import { deterministicReceiptId } from './receipts.js';

const projectId = 'demo-mi-compra-rules';
let env;

before(async () => {
  const rules = await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8');
  env = await initializeTestEnvironment({
    projectId,
    firestore: { host: '127.0.0.1', port: 8080, rules }
  });
});

after(async () => { await env?.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'userWorkspaces/owner'), {
      uid: 'owner', ownerUid: 'owner',
      workspace: {
        products: [{ id: 'p1', name: 'Leche', createdAt: '2026-11-10T10:00:00.000Z' }],
        stores: [], lists: [], purchases: [], inventory: [], movements: [], expenses: [], budgets: [], activity: [], deletedRecords: {}
      }
    });
    await setDoc(doc(db, 'workspaceAccess/owner'), {
      workspaceId: 'owner', ownerUid: 'owner', role: 'owner', email: 'owner@example.com'
    });
    await setDoc(doc(db, 'workspaceAccess/member'), {
      workspaceId: 'owner', ownerUid: 'owner', role: 'member', email: 'member@example.com'
    });
    await setDoc(doc(db, 'workspaceAccess/member2'), {
      workspaceId: 'owner', ownerUid: 'owner', role: 'member', email: 'member2@example.com'
    });
  });
});

test('una cuenta cualquiera no puede darse de alta como propietaria', async () => {
  const db = env.authenticatedContext('intruso', { email: 'intruso@example.com' }).firestore();
  await assertFails(setDoc(doc(db, 'workspaceAccess/intruso'), {
    workspaceId: 'intruso', ownerUid: 'intruso', role: 'owner', email: 'intruso@example.com'
  }));
  const primaryDb = env.authenticatedContext('primary', { email: 'delosrios9301@gmail.com' }).firestore();
  await assertSucceeds(setDoc(doc(primaryDb, 'workspaceAccess/primary'), {
    workspaceId: 'primary', ownerUid: 'primary', role: 'owner', email: 'delosrios9301@gmail.com'
  }));
});

test('propietario puede invitar y revocar miembros', async () => {
  const db = env.authenticatedContext('owner', { email: 'owner@example.com' }).firestore();
  await assertSucceeds(setDoc(doc(db, 'workspaceAccess/new-member'), {
    workspaceId: 'owner', ownerUid: 'owner', role: 'member', email: 'new@example.com'
  }));
  await assertSucceeds(setDoc(doc(db, 'revokedUsers/member'), {
    uid: 'member', workspaceId: 'owner', revokedBy: 'owner', email: 'member@example.com'
  }));
  await assertSucceeds(deleteDoc(doc(db, 'workspaceAccess/member')));
});

test('miembro no puede cambiar propietario ni borrar la membresía de otro usuario', async () => {
  const db = env.authenticatedContext('member', { email: 'member@example.com' }).firestore();
  await assertFails(setDoc(doc(db, 'userWorkspaces/owner'), {
    uid: 'owner', ownerUid: 'member',
    workspace: { products: [], stores: [], lists: [], purchases: [], inventory: [], movements: [], expenses: [], budgets: [], activity: [], deletedRecords: {} }
  }));
  await assertFails(deleteDoc(doc(db, 'workspaceAccess/owner')));
});

test('miembro no puede restablecer el espacio aunque agregue tombstones falsos', async () => {
  const db = env.authenticatedContext('member', { email: 'member@example.com' }).firestore();
  const current = (await getDoc(doc(db, 'userWorkspaces/owner'))).data();
  const reset = { ...current, workspace: { ...current.workspace, products: [], deletedRecords: { 'products:inventado': { deletedAt: '2026-11-11T10:00:00.000Z' } } } };
  await assertFails(setDoc(doc(db, 'userWorkspaces/owner'), reset));
});

test('miembro puede borrar un registro cuando conserva otros datos en el espacio', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const ref = doc(db, 'userWorkspaces/owner');
    const current = (await getDoc(ref)).data();
    current.workspace.products.push({ id: 'p2', name: 'Café', createdAt: '2026-11-10T11:00:00.000Z' });
    await setDoc(ref, current);
  });
  const db = env.authenticatedContext('member', { email: 'member@example.com' }).firestore();
  const current = (await getDoc(doc(db, 'userWorkspaces/owner'))).data();
  const next = {
    ...current,
    workspace: {
      ...current.workspace,
      products: current.workspace.products.filter(row => row.id !== 'p1'),
      deletedRecords: { 'products:p1': { deletedAt: '2026-11-11T10:00:00.000Z' } }
    }
  };
  await assertSucceeds(setDoc(doc(db, 'userWorkspaces/owner'), next));
});

test('miembro no puede crear ni modificar registros de revocación', async () => {
  const db = env.authenticatedContext('member', { email: 'member@example.com' }).firestore();
  await assertFails(setDoc(doc(db, 'revokedUsers/owner'), {
    uid: 'owner', workspaceId: 'owner', revokedBy: 'member'
  }));
});

test('una cuenta revocada ya no puede leer el espacio compartido', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'revokedUsers/member'), {
      uid: 'member', workspaceId: 'owner', revokedBy: 'owner'
    });
    await deleteDoc(doc(db, 'workspaceAccess/member'));
  });
  const db = env.authenticatedContext('member', { email: 'member@example.com' }).firestore();
  await assertFails(getDoc(doc(db, 'userWorkspaces/owner')));
  await assertSucceeds(getDoc(doc(db, 'revokedUsers/member')));
});

test('dos dispositivos concurrentes conservan la alta nueva y propagan el borrado', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const ref = doc(db, 'userWorkspaces/owner');
    const current = (await getDoc(ref)).data();
    current.workspace.products.push({ id: 'p2', name: 'Arroz', createdAt: '2026-11-10T11:00:00.000Z' });
    await setDoc(ref, current);
  });
  const dbA = env.authenticatedContext('member', { email: 'member@example.com' }).firestore();
  const dbB = env.authenticatedContext('member2', { email: 'member2@example.com' }).firestore();
  const refA = doc(dbA, 'userWorkspaces/owner');
  const refB = doc(dbB, 'userWorkspaces/owner');
  const initial = (await getDoc(refA)).data().workspace;
  const staleDevice = mergeWorkspaces({
    ...initial,
    products: [...initial.products, { id: 'p3', name: 'Café', updatedAt: '2026-11-11T11:00:00.000Z' }]
  }, initial);
  const deletingDevice = {
    ...initial,
    products: [],
    deletedRecords: { ...initial.deletedRecords, 'products:p1': { deletedAt: '2026-11-11T12:00:00.000Z' } }
  };
  const write = (db, ref, local) => runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.data();
    const merged = mergeWorkspaces(local, current.workspace);
    transaction.set(ref, { ...current, workspace: merged });
  });
  await Promise.all([
    write(dbA, refA, staleDevice),
    write(dbB, refB, deletingDevice)
  ]);
  const finalWorkspace = (await getDoc(refA)).data().workspace;
  assert.equal(finalWorkspace.products.some(row => row.id === 'p1'), false);
  assert.equal(finalWorkspace.products.some(row => row.id === 'p2'), true);
  assert.equal(finalWorkspace.products.some(row => row.id === 'p3'), true);
});

test('los dispositivos compatibles solo pueden registrarse bajo la identidad autenticada', async () => {
  const owner = env.authenticatedContext('owner', { email: 'owner@example.com' }).firestore();
  await assertSucceeds(setDoc(doc(owner, 'userWorkspaces/owner/clientDevices/device-owner'), {
    uid: 'owner', appVersion: '2.1.0-compat', userAgent: 'Chrome', firstSeenAt: new Date(), lastSeenAt: new Date()
  }));
  const member = env.authenticatedContext('member', { email: 'member@example.com' }).firestore();
  await assertSucceeds(setDoc(doc(member, 'userWorkspaces/owner/clientDevices/device-member'), {
    uid: 'member', appVersion: '2.1.0-compat', userAgent: 'Android', firstSeenAt: new Date(), lastSeenAt: new Date()
  }));
  await assertFails(setDoc(doc(member, 'userWorkspaces/owner/clientDevices/device-forged'), {
    uid: 'owner', appVersion: '2.1.0-compat', userAgent: 'Android', firstSeenAt: new Date(), lastSeenAt: new Date()
  }));
  await assertFails(getDoc(doc(member, 'userWorkspaces/owner/clientDevices/device-owner')));
  await assertSucceeds(getDoc(doc(owner, 'userWorkspaces/owner/clientDevices/device-member')));
});

test('un usuario revocado no puede registrar dispositivos compatibles', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'revokedUsers/member'), { uid: 'member', workspaceId: 'owner', revokedBy: 'owner' });
    await deleteDoc(doc(db, 'workspaceAccess/member'));
  });
  const member = env.authenticatedContext('member', { email: 'member@example.com' }).firestore();
  await assertFails(setDoc(doc(member, 'userWorkspaces/owner/clientDevices/device-member'), {
    uid: 'member', appVersion: '2.1.0-compat', userAgent: 'Android', firstSeenAt: new Date(), lastSeenAt: new Date()
  }));
});


test('solo el propietario puede leer y escribir la copia de migración', async () => {
  const owner = env.authenticatedContext('owner', { email: 'owner@example.com' }).firestore();
  const member = env.authenticatedContext('member', { email: 'member@example.com' }).firestore();
  await assertSucceeds(setDoc(doc(owner, 'userWorkspaces/owner/records/products__p1'), {
    type: 'products', recordId: 'p1', data: { id: 'p1', name: 'Leche' }, sourceSchemaVersion: 2, migratedFrom: 'workspace-map-v2'
  }));
  await assertSucceeds(getDoc(doc(owner, 'userWorkspaces/owner/records/products__p1')));
  await assertFails(getDoc(doc(member, 'userWorkspaces/owner/records/products__p1')));
  await assertFails(setDoc(doc(member, 'userWorkspaces/owner/records/products__p2'), {
    type: 'products', recordId: 'p2', data: { id: 'p2', name: 'Café' }
  }));
  await assertSucceeds(setDoc(doc(owner, 'userWorkspaces/owner/migrations/workspace-map-v2'), {
    migrationId: 'workspace-map-v2', status: 'copied_and_verified', recordCount: 1
  }));
  await assertFails(getDoc(doc(member, 'userWorkspaces/owner/migrations/workspace-map-v2')));
});

test('ambas cuentas actualizan precios y las escrituras antiguas conservan el borrador independiente', async () => {
  const dbA = env.authenticatedContext('member', { email: 'member@example.com' }).firestore();
  const dbB = env.authenticatedContext('member2', { email: 'member2@example.com' }).firestore();
  const refA = doc(dbA, 'userWorkspaces/owner');
  const refB = doc(dbB, 'userWorkspaces/owner');
  const initial = {
    id: 'familia-1', updatedAt: 'T1',
    items: [{ id: 'arroz', name: 'Arroz', quantity: 1, unitPrice: 0 },
            { id: 'pollo', name: 'Pollo', quantity: 1, unitPrice: 0 }]
  };
  await assertSucceeds(setDoc(refA, { activePurchaseDraft: initial }, { merge: true }));
  const beforeLegacy = (await getDoc(refB)).data();
  // Una versión anterior escribe solo workspace, sin conocer el campo nuevo.
  await assertSucceeds(setDoc(refB, { workspace: beforeLegacy.workspace }, { merge: true }));
  assert.deepEqual((await getDoc(refA)).data().activePurchaseDraft.items.map(item => item.id), ['arroz', 'pollo']);

  const change = (db, ref, itemId, price) => runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    const next = applySharedDraftOperation(snap.data().activePurchaseDraft, {
      type: 'patch', draftId: 'familia-1', itemId,
      changes: { unitPrice: price }, at: 'T2'
    }, true);
    tx.set(ref, { activePurchaseDraft: next }, { merge: true });
  });
  await assertSucceeds(Promise.all([
    change(dbA, refA, 'arroz', 1.5),
    change(dbB, refB, 'pollo', 6.25)
  ]));
  const final = normalizeSharedDraft((await getDoc(refA)).data().activePurchaseDraft);
  assert.equal(final.items.find(item => item.id === 'arroz').unitPrice, 1.5);
  assert.equal(final.items.find(item => item.id === 'pollo').unitPrice, 6.25);
});

test('una cuenta sin acceso no puede leer ni modificar el borrador compartido', async () => {
  const intruder = env.authenticatedContext('intruso', { email: 'intruso@example.com' }).firestore();
  const ref = doc(intruder, 'userWorkspaces/owner');
  await assertFails(getDoc(ref));
  await assertFails(setDoc(ref, { activePurchaseDraft: { id: 'robo', items: [], updatedAt: 'T1' } }, { merge: true }));
});


const validInvoiceMeta = (uid = 'member') => ({
  purchaseId: 'buy_2026_11_15',
  name: 'Factura prueba.pdf',
  mimeType: 'application/pdf',
  size: 23,
  partCount: 1,
  sha256: 'a'.repeat(64),
  uploadedByUid: uid,
  uploadedByEmail: uid + '@example.com',
  uploadedAt: '2026-11-15T10:00:00.000Z'
});

test('miembro autorizado adjunta comprobante y puede verlo después desde otra cuenta del mismo espacio', async () => {
  const db = env.authenticatedContext('member', { email: 'member@example.com' }).firestore();
  const receipt = doc(db, 'userWorkspaces/owner/receiptFiles/invoice-test');
  const chunk = doc(db, 'userWorkspaces/owner/receiptFiles/invoice-test/parts/000');
  const batch = writeBatch(db);
  batch.set(receipt, validInvoiceMeta());
  batch.set(chunk, { data: 'JVBERi0xLjY=', index: 0, uploadedByUid: 'member' });
  await assertSucceeds(batch.commit());

  const otherDevice = env.authenticatedContext('member2', { email: 'member2@example.com' }).firestore();
  assert.equal((await assertSucceeds(getDoc(doc(otherDevice, receipt.path)))).data().name, 'Factura prueba.pdf');
  assert.equal((await assertSucceeds(getDoc(doc(otherDevice, chunk.path)))).data().index, 0);
  const found = await assertSucceeds(getDocs(collection(otherDevice, 'userWorkspaces/owner/receiptFiles')));
  assert.equal(found.size, 1);
});

test('intrusos y no autenticados no leen ni agregan facturas de la familia', async () => {
  const outsider = env.authenticatedContext('intruder', { email: 'intruder@example.com' }).firestore();
  const anonymous = env.unauthenticatedContext().firestore();
  const path = 'userWorkspaces/owner/receiptFiles/blocked';
  await assertFails(getDoc(doc(outsider, path)));
  await assertFails(getDoc(doc(anonymous, path)));
  await assertFails(setDoc(doc(outsider, path), validInvoiceMeta('intruder')));
  await assertFails(setDoc(doc(outsider, path + '/parts/000'), { data: 'JVBERi0=', index: 0, uploadedByUid: 'intruder' }));
});

test('no permite cambiar facturas ni subir archivos de tipos no permitidos o superar límites', async () => {
  const db = env.authenticatedContext('member', { email: 'member@example.com' }).firestore();
  const meta = doc(db, 'userWorkspaces/owner/receiptFiles/immutable');
  await assertSucceeds(setDoc(meta, validInvoiceMeta()));
  await assertFails(setDoc(meta, {...validInvoiceMeta(),name:'Facturas cambiadas.pdf'}));
  await assertFails(setDoc(doc(db, 'userWorkspaces/owner/receiptFiles/evil'), { ...validInvoiceMeta(), mimeType: 'text/html' }));
  await assertFails(setDoc(doc(db, 'userWorkspaces/owner/receiptFiles/large'), { ...validInvoiceMeta(), size: 5000000 }));
  await assertFails(setDoc(doc(db, 'userWorkspaces/owner/receiptFiles/forged'), { ...validInvoiceMeta(), uploadedByUid: 'owner' }));
  await assertFails(setDoc(doc(db, 'userWorkspaces/owner/receiptFiles/immutable/parts/000'), {data: 'AAAA', index: 0, uploadedByUid: 'member'}));
  await assertFails(deleteDoc(meta));
});

test('propietario puede retirar comprobante y partes, mientras que los demás no', async () => {
  const db = env.authenticatedContext('member', { email: 'member@example.com' }).firestore();
  const receipt = doc(db, 'userWorkspaces/owner/receiptFiles/owned');
  const chunk = doc(db, 'userWorkspaces/owner/receiptFiles/owned/parts/000');
  const created = writeBatch(db);
  created.set(receipt, validInvoiceMeta());
  created.set(chunk, { data: 'JVBERi0=', index: 0, uploadedByUid: 'member' });
  await assertSucceeds(created.commit());
  await assertFails(deleteDoc(chunk));
  const owner = env.authenticatedContext('owner', { email: 'owner@example.com' }).firestore();
  const deleted = writeBatch(owner);
  deleted.delete(doc(owner, chunk.path));
  deleted.delete(doc(owner, receipt.path));
  await assertSucceeds(deleted.commit());
});


test('permite la carga atómica de los 17 fragmentos del tamaño máximo autorizado', async () => {
  const db = env.authenticatedContext('member', { email: 'member@example.com' }).firestore();
  const metadata = doc(db, 'userWorkspaces/owner/receiptFiles/seventeen-part-invoice');
  const batch = writeBatch(db);
  batch.set(metadata, {...validInvoiceMeta(),size:3145728,partCount:17});
  for(let index=0;index<17;index++){
    const partId=String(index).padStart(3,'0');
    batch.set(doc(metadata,'parts',partId),{data:'AAAA',index,uploadedByUid:'member'});
  }
  await assertSucceeds(batch.commit());
  const owner = env.authenticatedContext('owner', { email: 'owner@example.com' }).firestore();
  const parts = await assertSucceeds(getDocs(collection(owner, metadata.path, 'parts')));
  assert.equal(parts.size,17);
});


test('dos dispositivos no pueden crear dos copias con el mismo identificador de factura', async () => {
  const digest = 'f'.repeat(64);
  const id = await deterministicReceiptId('buy_2026_11_15', digest);
  const writer = env.authenticatedContext('member', { email: 'member@example.com' }).firestore();
  const otherWriter = env.authenticatedContext('member2', { email: 'member2@example.com' }).firestore();
  const receiptPath = 'userWorkspaces/owner/receiptFiles/' + id;
  const original = doc(writer, receiptPath);
  const batch = writeBatch(writer);
  batch.set(original, { ...validInvoiceMeta('member'), sha256: digest });
  batch.set(doc(original, 'parts', '000'), {data:'JVBERi0xLjY=',index:0,uploadedByUid:'member'});
  await assertSucceeds(batch.commit());

  const duplicate = writeBatch(otherWriter);
  duplicate.set(doc(otherWriter, receiptPath), {
    ...validInvoiceMeta('member2'), sha256: digest,
    name: 'La misma factura con otro nombre.pdf'
  });
  duplicate.set(doc(otherWriter, receiptPath, 'parts', '000'), {data:'JVBERi0xLjY=',index:0,uploadedByUid:'member2'});
  await assertFails(duplicate.commit());

  const saved = (await assertSucceeds(getDoc(original))).data();
  assert.equal(saved.name, 'Factura prueba.pdf');
  const allReceipts = await assertSucceeds(getDocs(collection(writer, 'userWorkspaces/owner/receiptFiles')));
  assert.equal(allReceipts.size,1);
  // Otro contenido conserva un SHA diferente y permite otra factura distinta.
  const another = doc(otherWriter, 'userWorkspaces/owner/receiptFiles/' + await deterministicReceiptId('buy_2026_11_15', 'e'.repeat(64)));
  const second = writeBatch(otherWriter);
  second.set(another, { ...validInvoiceMeta('member2'), sha256:'e'.repeat(64),name:'Factura diferente.pdf' });
  second.set(doc(another,'parts','000'), {data:'JVBERi0yLjY=',index:0,uploadedByUid:'member2'});
  await assertSucceeds(second.commit());
  assert.equal((await assertSucceeds(getDocs(collection(writer, 'userWorkspaces/owner/receiptFiles')))).size,2);
});
