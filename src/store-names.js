export const BUILT_IN_STORES = Object.freeze([
  'Super 99',
  'El Rey',
  'Xtra',
  'Riba Smith',
  'Machetazo',
  'Jumbo'
]);

function cleanStoreName(value) {
  if (typeof value !== 'string') return '';
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 50) return '';
  return name;
}

function addNames(target, seen, values) {
  for (const value of Array.isArray(values) ? values : []) {
    const name = cleanStoreName(value);
    if (!name) continue;
    const key = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-PA');
    if (seen.has(key)) continue;
    seen.add(key);
    target.push(name);
  }
}

/**
 * Recover custom store names from both current and older personal data layouts.
 * Store names are metadata, so this only collects labels; it never rewrites
 * product, shopping list, purchase or price records.
 */
export function collectCustomStoreNames({
  localStores = [],
  settings = {},
  catalog = [],
  cart = [],
  purchases = []
} = {}) {
  const builtInKeys = new Set(BUILT_IN_STORES.map(name =>
    name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-PA')
  ));
  const names = [];
  const seen = new Set(builtInKeys);
  addNames(names, seen, localStores);
  addNames(names, seen, settings.customStores);
  addNames(names, seen, settings.enabledStores);
  addNames(names, seen, [settings.defaultStore]);
  addNames(names, seen, catalog.map(item => item?.store));
  addNames(names, seen, cart.map(item => item?.store));
  for (const purchase of purchases) {
    addNames(names, seen, [purchase?.store]);
    addNames(names, seen, (purchase?.items || []).map(item => item?.store));
  }
  return names;
}

export function buildStoreList(customStores = []) {
  const result = [...BUILT_IN_STORES];
  const seen = new Set(BUILT_IN_STORES.map(name =>
    name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-PA')
  ));
  addNames(result, seen, customStores);
  return result;
}
