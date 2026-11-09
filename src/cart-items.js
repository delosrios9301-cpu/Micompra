export function applyCartItemEdits(items, itemId, fields = {}) {
  if (!Array.isArray(items)) throw new TypeError('La lista de compra no es válida.');
  const id = String(itemId ?? '');
  if (!id) throw new Error('No se encontró el artículo que deseas actualizar.');
  const current = items.find(item => String(item?.id ?? '') === id);
  if (!current) throw new Error('El artículo ya no está en la lista. Actualiza la pantalla e inténtalo de nuevo.');

  const quantity = Number(fields.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000) {
    throw new Error('La cantidad debe ser mayor que cero.');
  }

  const rawPrice = String(fields.unitPrice ?? '').trim();
  let unitPrice = null;
  if (rawPrice !== '') {
    unitPrice = Number(rawPrice.replace(',', '.'));
    if (!Number.isFinite(unitPrice) || unitPrice <= 0 || unitPrice > 10000000) {
      throw new Error('El precio debe ser mayor que cero. Déjalo vacío si todavía no conoces el precio.');
    }
  }

  return items.map(item => String(item?.id ?? '') === id
    ? { ...item, qty: quantity, price: unitPrice }
    : item
  );
}

export function summarizeCartItems(items = []) {
  const rows = Array.isArray(items) ? items : [];
  const storeMap = new Map();
  let total = 0, pricedCount = 0;
  for (const item of rows) {
    const store = String(item?.store ?? '').trim();
    const quantity = Number(item?.qty);
    const price = item?.price === null || item?.price === undefined || item?.price === ''
      ? NaN
      : Number(item.price);
    const validQuantity = Number.isFinite(quantity) && quantity > 0;
    const validPrice = Number.isFinite(price) && price > 0;
    const priced = validQuantity && validPrice;
    if (priced) {
      const subtotal = quantity * price;
      total += subtotal;
      pricedCount += 1;
    }
    if (!store) continue;
    if (!storeMap.has(store)) storeMap.set(store, { store, total: 0, count: 0, priced: 0 });
    const group = storeMap.get(store);
    group.count += 1;
    if (priced) {
      group.total += quantity * price;
      group.priced += 1;
    }
  }
  return {
    total,
    count: rows.length,
    priced: pricedCount,
    pending: rows.length - pricedCount,
    stores: [...storeMap.values()]
  };
}
