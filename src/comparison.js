export function normalizeComparisonText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('es-PA');
}

export function normalizeComparisonUnit(value) {
  const unit = normalizeComparisonText(value || 'unidad');
  const aliases = {
    unidades: 'unidad',
    'unidad(es)': 'unidad',
    kilogramo: 'kg',
    kilogramos: 'kg',
    kilo: 'kg',
    kilos: 'kg',
    libra: 'lb',
    libras: 'lb',
    lbs: 'lb',
    litro: 'litro',
    litros: 'litro',
    l: 'litro',
    paquetes: 'paquete'
  };
  return aliases[unit] || unit || 'unidad';
}

/**
 * Group only identical product names, presentations and pricing units.
 * Accent/case differences are ignored, but package/presentation differences
 * remain separate so unlike quantities are never compared as equivalent.
 */
export function groupComparableProducts(products = []) {
  if (!Array.isArray(products)) return [];
  const groups = new Map();
  for (const product of products) {
    if (!product || typeof product !== 'object') continue;
    const name = normalizeComparisonText(product.name);
    if (!name) continue;
    const presentation = normalizeComparisonText(product.presentation || 'sin presentacion');
    const unit = normalizeComparisonUnit(product.unit);
    const key = [name, presentation, unit].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(product);
  }
  return [...groups.values()].filter(group => group.length > 1);
}

export function hasComparableStorePrices(group = []) {
  // Missing package size is not enough information to claim two prices are equivalent.
  if (!Array.isArray(group) || group.length < 2 || group.some(product => !normalizeComparisonText(product?.presentation))) return false;
  const stores = new Set(
    group
      .filter(product => Number.isFinite(Number(product?.price)) && Number(product.price) > 0 && String(product?.store || '').trim())
      .map(product => normalizeComparisonText(product.store))
  );
  return stores.size > 1;
}
