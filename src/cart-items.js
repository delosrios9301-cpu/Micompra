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
