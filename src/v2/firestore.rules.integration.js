import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, runTransaction } from 'firebase/firestore';
import { mergeWorkspaces } from './model.js';

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
