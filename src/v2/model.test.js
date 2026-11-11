import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyWorkspace, normalizeWorkspace, mergeWorkspaces, computePurchaseTotal,
  monthSpending, inventoryAlerts, currentBudget, monthKey, csvEscape
} from './model.js';

test('el espacio 2.0 nace independiente y con todas sus colecciones', () => {
  const workspace = createEmptyWorkspace();
  assert.equal(workspace.version, 2);
  for (const key of ['products', 'stores', 'lists', 'purchases', 'inventory', 'movements', 'expenses', 'budgets', 'activity']) {
    assert.deepEqual(workspace[key], []);
  }
});

test('normaliza estructura y no conserva datos fuera de los módulos nuevos', () => {
  const workspace = normalizeWorkspace({
    version: 1,
    oldCart: [{ name: 'dato heredado' }],
    profile: { currency: 'EUR' },
    lists: [{ name: 'Quincenal', items: [{ name: 'Arroz' }] }]
  });
  assert.equal(workspace.version, 2);
  assert.equal(workspace.profile.currency, 'USD');
  assert.equal(workspace.lists[0].name, 'Quincenal');
  assert.ok(workspace.lists[0].items[0].id);
  assert.equal(Object.hasOwn(workspace, 'oldCart'), false);
});

test('fusiona registros locales y nube por identificador y actualización', () => {
  const local = {
    products: [{ id: 'p1', name: 'Arroz', updatedAt: '2026-11-10T10:00:00Z' }],
    lists: [{ id: 'l1', name: 'Lista', updatedAt: '2026-11-10T10:00:00Z', items: [{ id: 'i1', name: 'Leche' }] }]
  };
  const remote = {
    products: [
      { id: 'p1', name: 'Arroz integral', updatedAt: '2026-11-10T11:00:00Z' },
      { id: 'p2', name: 'Café', updatedAt: '2026-11-10T09:00:00Z' }
    ],
    lists: [{ id: 'l1', name: 'Lista', updatedAt: '2026-11-10T09:00:00Z', items: [{ id: 'i2', name: 'Pan' }] }]
  };
  const merged = mergeWorkspaces(local, remote);
  assert.equal(merged.products.length, 2);
  assert.equal(merged.products.find(row => row.id === 'p1').name, 'Arroz integral');
  assert.deepEqual(merged.lists[0].items.map(row => row.id).sort(), ['i1', 'i2']);
});

test('calcula totales con cantidades, descuentos y límites inferiores', () => {
  assert.equal(computePurchaseTotal([
    { quantity: 2, unitPrice: 3.5, discount: 1 },
    { quantity: 1, unitPrice: 4, discount: 0 }
  ]), 10);
  assert.equal(computePurchaseTotal([{ quantity: 1, unitPrice: 2, discount: 8 }]), 0);
});

test('finanzas contabiliza compras y evita duplicar gastos asociados a compra', () => {
  const workspace = {
    purchases: [{ date: '2026-11-10', total: 25 }],
    expenses: [
      { date: '2026-11-10', amount: 25, sourcePurchaseId: 'purchase-1' },
      { date: '2026-11-09', amount: 8 }
    ]
  };
  const result = monthSpending(workspace, '2026-11');
  assert.equal(result.purchases, 25);
  assert.equal(result.expenses, 8);
  assert.equal(result.total, 33);
});

test('identifica inventario agotado, bajo, vencido y próximo a vencer', () => {
  const today = new Date('2026-11-10T12:00:00Z');
  const alerts = inventoryAlerts([
    { id: 'a', quantity: 0, minimum: 1 },
    { id: 'b', quantity: 1, minimum: 2 },
    { id: 'c', quantity: 4, minimum: 1, expiryDate: '2026-11-09' },
    { id: 'd', quantity: 4, minimum: 1, expiryDate: '2026-11-15' },
    { id: 'e', quantity: 4, minimum: 1, expiryDate: '2026-12-15' }
  ], today);
  assert.equal(alerts.empty.length, 1);
  assert.equal(alerts.low.length, 1);
  assert.equal(alerts.expired.length, 1);
  assert.equal(alerts.expiring.length, 1);
});

test('consulta presupuesto del mes actual y escapa CSV', () => {
  const month = monthKey(new Date('2026-11-10T12:00:00Z'));
  assert.equal(currentBudget({ budgets: [{ month, amount: 175 }] }, month), 175);
  assert.equal(csvEscape('Arroz "especial"'), '"Arroz ""especial"""');
});
