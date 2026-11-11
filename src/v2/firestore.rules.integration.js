import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';

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

test('miembro no puede restablecer el espacio sin marcadores de eliminación', async () => {
  const db = env.authenticatedContext('member', { email: 'member@example.com' }).firestore();
  const current = (await getDoc(doc(db, 'userWorkspaces/owner'))).data();
  const reset = { ...current, workspace: { ...current.workspace, products: [] } };
  await assertFails(setDoc(doc(db, 'userWorkspaces/owner'), reset));
});

test('miembro puede borrar el último registro cuando adjunta el tombstone correspondiente', async () => {
  const db = env.authenticatedContext('member', { email: 'member@example.com' }).firestore();
  const current = (await getDoc(doc(db, 'userWorkspaces/owner'))).data();
  const next = {
    ...current,
    workspace: {
      ...current.workspace,
      products: [],
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
