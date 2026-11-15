import { createId, normalizeWorkspace, computePurchaseTotal } from './model.js';
import { computePurchaseBreakdown, validTaxRate } from './itbms.js';

const normalizeName = value => String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const round2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T12:00:00Z'));

function validatedItems(rows, previousItems, now) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 250) {
    throw new Error('La compra debe contener entre 1 y 250 productos. Para eliminarla completa, usa Eliminar compra.');
  }
  const seen = new Set();
  return rows.map((row, index) => {
    const name = String(row?.name || '').trim().replace(/\s+/g, ' ');
    const unit = String(row?.unit || 'unidad').trim();
    const quantity = Number(row?.quantity);
    const unitPrice = Number(row?.unitPrice);
    const discount = Number(row?.discount || 0);
    const taxRate = row?.taxRate === undefined && previousItems.find(item => item.id === row?.id)?.taxRate === undefined
      ? undefined : Number(row?.taxRate ?? previousItems.find(item => item.id === row?.id)?.taxRate);
    if (taxRate !== undefined && !validTaxRate(taxRate)) {
      throw new Error('Selecciona un ITBMS válido para el producto ' + (index + 1) + '.');
    }
    if (!name || name.length > 100 || !unit || unit.length > 24 ||
        !Number.isFinite(quantity) || quantity <= 0 ||
        !Number.isFinite(unitPrice) || unitPrice < 0 ||
        !Number.isFinite(discount) || discount < 0 || discount > quantity * unitPrice) {
      throw new Error('Revisa nombre, unidad, cantidad, precio y descuento del producto ' + (index + 1) + '.');
    }
    const id = String(row.id || '') || createId('pit');
    if (seen.has(id)) throw new Error('La compra contiene identificadores de productos duplicados.');
    seen.add(id);
    const previous = previousItems.find(item => item.id === id);
    return {
      ...previous,
      id, name, unit, quantity: round2(quantity), unitPrice: round2(unitPrice),
      discount: round2(discount),
      ...(taxRate !== undefined ? { taxRate, taxIncluded: row.taxIncluded === true } : {}),
      createdAt: previous?.createdAt || now, updatedAt: now
    };
  });
}

function inventoryLinkExists(workspace, purchase) {
  return purchase.inventoryLinked === true ||
    workspace.movements.some(move => move.reason === 'Compra ' + purchase.id && move.type === 'entrada');
}

function adjustLinkedInventory(workspace, purchase, nextItems, actor, now, isDelete) {
  if (!inventoryLinkExists(workspace, purchase)) return { items: nextItems, adjusted: 0, linked: false };
  const contributions = new Map();
  const initialReason = 'Compra ' + purchase.id;
  for (const move of workspace.movements) {
    const original = move.reason === initialReason && move.type === 'entrada';
    const correction = move.sourcePurchaseId === purchase.id && move.purchaseAdjustment === true;
    if (!original && !correction) continue;
    const key = String(move.inventoryId || '');
    if (!key) throw new Error('Esta compra tiene un movimiento de inventario sin identificador; no se puede corregir automáticamente.');
    const quantity = Number(move.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) throw new Error('Se detectó un movimiento histórico de inventario inválido.');
    const sign = move.type === 'salida' ? -1 : 1;
    contributions.set(key, round2((contributions.get(key) || 0) + quantity * sign));
  }
  const desired = new Map();
  const linkedItems = nextItems.map(item => {
    let stock = workspace.inventory.find(row => row.id === item.inventoryId);
    if (!stock || normalizeName(stock.name) !== normalizeName(item.name)) {
      stock = workspace.inventory.find(row => normalizeName(row.name) === normalizeName(item.name) && String(row.unit || 'unidad') === item.unit);
    }
    if (!stock) {
      // Las compras guardadas antes de la migración no tenían inventoryId en
      // sus líneas. Recuperar el vínculo del movimiento histórico, no duplicarlo.
      const originalMovement = workspace.movements.find(row =>
        row.reason === 'Compra ' + purchase.id && normalizeName(row.productName) === normalizeName(item.name));
      stock = originalMovement && workspace.inventory.find(row => row.id === originalMovement.inventoryId);
    }
    if (!stock) {
      let product = workspace.products.find(row => normalizeName(row.name) === normalizeName(item.name));
      if (!product) {
        product = { id: createId('prd'), name: item.name, category: '', unit: item.unit, active: true, createdAt: now, updatedAt: now };
        workspace.products.unshift(product);
      }
      stock = { id: createId('inv'), productId: product.id, name: item.name, category: product.category || '', quantity: 0, unit: item.unit, minimum: 1, location: '', expiryDate: '', createdAt: now, updatedAt: now };
      workspace.inventory.unshift(stock);
    }
    desired.set(stock.id, round2((desired.get(stock.id) || 0) + item.quantity));
    return { ...item, inventoryId: stock.id };
  });
  let adjusted = 0;
  for (const key of new Set([...contributions.keys(), ...desired.keys()])) {
    const quantityDelta = round2((desired.get(key) || 0) - (contributions.get(key) || 0));
    if (Math.abs(quantityDelta) < 0.001) continue;
    const stock = workspace.inventory.find(row => row.id === key);
    if (!stock) throw new Error('No se encontró el producto de inventario asociado a esta compra.');
    const available = Number(stock.quantity);
    if (!Number.isFinite(available)) throw new Error('El inventario actual contiene una cantidad inválida.');
    if (round2(available + quantityDelta) < 0) {
      throw new Error('No se puede ' + (isDelete ? 'eliminar' : 'editar') + ' la compra: no hay existencias suficientes de ' + stock.name + ' para revertir ' + Math.abs(quantityDelta) + ' unidades. Revisa los movimientos y ajusta el inventario antes de continuar.');
    }
    stock.quantity = round2(available + quantityDelta);
    stock.updatedAt = now;
    workspace.movements.unshift({
      id: createId('mov'), inventoryId: stock.id, productName: stock.name,
      type: quantityDelta > 0 ? 'entrada' : 'salida', quantity: Math.abs(quantityDelta),
      reason: (isDelete ? 'Eliminación compra ' : 'Corrección compra ') + purchase.id,
      sourcePurchaseId: purchase.id, purchaseAdjustment: true,
      performedByUid: actor.uid, performedByEmail: actor.email, createdAt: now, updatedAt: now
    });
    adjusted += 1;
  }
  return { items: linkedItems, adjusted, linked: true };
}

/**
 * Operación pura sobre un estado obtenido dentro de una transacción de Firestore.
 * Nunca usa una copia de otro dispositivo para decidir qué compra editar.
 * Los movimientos originales permanecen inmutables y cada corrección deja
 * movimientos compensatorios y auditoría.
 */
export function applySavedPurchaseChange(originalWorkspace, request, actor, at = new Date().toISOString()) {
  const workspace = normalizeWorkspace(originalWorkspace);
  const purchase = workspace.purchases.find(row => row.id === request?.id);
  if (!purchase) throw new Error('La compra ya no existe o fue eliminada desde otro dispositivo.');
  const revision = String(purchase.updatedAt || purchase.createdAt || '');
  if (revision !== String(request.expectedUpdatedAt || '')) {
    throw new Error('Esta compra cambió en otro dispositivo. Ábrela nuevamente para evitar sobrescribir cambios recientes.');
  }
  const kind = request.kind;
  if (kind !== 'edit' && kind !== 'delete') throw new Error('Operación de compra no reconocida.');
  if (kind === 'delete' && !actor.isOwner) {
    throw new Error('Solo el propietario puede eliminar compras confirmadas.');
  }
  const previousTimestamp = Date.parse(revision);
  const now = Number.isFinite(previousTimestamp) && Date.parse(at) <= previousTimestamp
    ? new Date(previousTimestamp + 1).toISOString() : at;
  const previous = structuredClone(purchase);
  const edits = request.changes || {};
  let nextPurchase = null;
  let nextItems = [];
  if (kind === 'edit') {
    const date = String(edits.date || '');
    if (!validDate(date)) throw new Error('Selecciona una fecha válida para la compra.');
    const storeId = String(edits.storeId || '');
    const selectedStore = workspace.stores.find(row => row.id === storeId);
    if (storeId && !selectedStore && storeId !== purchase.storeId) {
      throw new Error('El establecimiento ya no existe; selecciona uno válido.');
    }
    nextItems = validatedItems(edits.items, purchase.items || [], now);
    const stockResult = adjustLinkedInventory(workspace, purchase, nextItems, actor, now, false);
    nextItems = stockResult.items;
    nextPurchase = {
      ...purchase, date, storeId,
      storeName: selectedStore?.name || (storeId && storeId === purchase.storeId ? purchase.storeName : 'Compra sin establecimiento'),
      paid: edits.paid === true, items: nextItems,
      total: computePurchaseTotal(nextItems),
      ...(nextItems.some(item => item.taxRate !== undefined) ? {
        subtotal: computePurchaseBreakdown(nextItems).subtotal,
        itbms: computePurchaseBreakdown(nextItems).itbms
      } : {}),
      inventoryLinked: stockResult.linked,
      updatedAt: now
    };
    workspace.purchases = workspace.purchases.map(row => row.id === purchase.id ? nextPurchase : row);
  } else {
    adjustLinkedInventory(workspace, purchase, [], actor, now, true);
    workspace.purchases = workspace.purchases.filter(row => row.id !== purchase.id);
    workspace.deletedRecords['purchases:' + purchase.id] = { deletedAt: now };
  }

  workspace.activity.unshift({
    id: createId('act'), module: 'Comprar',
    action: kind === 'edit' ? 'Compra corregida' : 'Compra eliminada',
    description: (kind === 'edit' ? 'Compra editada' : 'Compra eliminada') +
      ' por ' + String(actor.email || actor.uid || 'usuario') + ': ' + purchase.storeName +
      ' · antes ' + round2(purchase.total || 0) + ' ' + (workspace.profile.currency || 'USD') +
      (nextPurchase ? ' · ahora ' + nextPurchase.total + ' ' + (workspace.profile.currency || 'USD') : ''),
    performedByUid: actor.uid, performedByEmail: actor.email,
    sourcePurchaseId: purchase.id,
    before: previous,
    after: nextPurchase ? structuredClone(nextPurchase) : null,
    createdAt: now, updatedAt: now
  });
  workspace.activity = workspace.activity.slice(0, 1000);
  return { workspace: normalizeWorkspace(workspace), purchase: nextPurchase, deleted: kind === 'delete' };
}
