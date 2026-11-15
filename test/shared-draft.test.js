import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyWorkspace, normalizeWorkspace, normalizeSharedDraft, applySharedDraftOperation } from '../src/v2/model.js';

test('las versiones antiguas no contienen el campo protegido en el workspace', () => {
  assert.equal(Object.hasOwn(createEmptyWorkspace(), 'shoppingDraft'), false);
  assert.equal(Object.hasOwn(normalizeWorkspace({ shoppingDraft: { items: [{ unitPrice: 9 }] } }), 'shoppingDraft'), false);
  assert.deepEqual(normalizeSharedDraft(), { id: '', items: [], updatedAt: '' });
});

test('dos cuentas pueden cambiar precios de líneas diferentes sin perder datos', () => {
  let draft = applySharedDraftOperation({}, {
    type: 'replace', expectedId: '', expectedUpdatedAt: '', id: 'session-1',
    items: [{ id: 'arroz', name: 'Arroz', quantity: 1, unitPrice: 0 }, { id: 'pollo', name: 'Pollo', quantity: 1, unitPrice: 0 }], at: 'T1'
  }, true);
  draft = applySharedDraftOperation(draft, { type: 'patch', draftId: 'session-1', itemId: 'arroz', changes: { unitPrice: 1.25 }, at: 'T2' }, true);
  draft = applySharedDraftOperation(draft, { type: 'patch', draftId: 'session-1', itemId: 'pollo', changes: { unitPrice: 5.75 }, at: 'T3' }, true);
  assert.deepEqual(draft.items.map(item => item.unitPrice), [1.25, 5.75]);
});

test('no se sustituye silenciosamente una lista modificada por otro usuario', () => {
  const changed = { id: 'session-1', updatedAt: 'T2', items: [{ id: 'a', unitPrice: 7 }] };
  assert.throws(() => applySharedDraftOperation(changed, {
    type: 'replace', expectedId: 'session-1', expectedUpdatedAt: 'T1', id: 'session-2', items: [], at: 'T3'
  }, true), /compra cambió/);
  assert.equal(changed.items[0].unitPrice, 7);
});

test('no se borra un borrador nuevo con una operación de cierre vieja', () => {
  const newer = { id: 'session-2', updatedAt: 'T2', items: [{ id: 'a', unitPrice: 9 }] };
  assert.throws(() => applySharedDraftOperation(newer, {
    type: 'clear', expectedId: 'session-1', expectedUpdatedAt: 'T1', at: 'T3'
  }, true), /compra cambió/);
  assert.equal(newer.items[0].unitPrice, 9);
});

test('añadir y quitar un producto preserva los demás precios', () => {
  const original = { id: 's', updatedAt: 'T1', items: [{ id: 'a', unitPrice: 1 }] };
  const added = applySharedDraftOperation(original, { type: 'add', draftId: 's', item: { id: 'b', unitPrice: 3 }, at: 'T2' }, true);
  const removed = applySharedDraftOperation(added, { type: 'remove', draftId: 's', itemId: 'a', at: 'T3' }, true);
  assert.deepEqual(removed.items.map(item => item.id), ['b']);
  assert.equal(removed.items[0].unitPrice, 3);
  assert.equal(original.items.length, 1);
});

test('un dispositivo viejo no edita una compra ya reemplazada', () => {
  assert.throws(() => applySharedDraftOperation({ id: 'new', updatedAt: 'T2', items: [] }, {
    type: 'patch', draftId: 'old', itemId: 'a', changes: { unitPrice: 5 }, at: 'T3'
  }, true), /Otra persona cambió/);
});
