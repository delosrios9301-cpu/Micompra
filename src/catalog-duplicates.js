export function normalizeCatalogSearchName(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|kilos?|kilogramos?|g|gr|gramos?|lb|lbs|libras?|l|lt|litros?|ml|mililitros?|oz|unidades?|und)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function findCatalogNameMatches(catalog = [], query = '', limit = 5) {
  const normalizedQuery = normalizeCatalogSearchName(query);
  if (normalizedQuery.length < 3) return [];
  const queryTokens = normalizedQuery.split(' ');
  return catalog
    .map(product => ({ product, normalizedName: normalizeCatalogSearchName(product.canonical_name) }))
    .filter(({ normalizedName }) => normalizedName && (
      normalizedName === normalizedQuery ||
      (normalizedQuery.length >= 4 && (normalizedName.startsWith(normalizedQuery) || normalizedQuery.startsWith(normalizedName))) ||
      queryTokens.every(token => normalizedName.split(' ').includes(token))
    ))
    .sort((a, b) => Number(b.normalizedName === normalizedQuery) - Number(a.normalizedName === normalizedQuery) || a.normalizedName.localeCompare(b.normalizedName))
    .slice(0, limit)
    .map(({ product, normalizedName }) => ({ ...product, isExactName: normalizedName === normalizedQuery }));
}

export function findDuplicateListItem(items = [], productId = null, customName = '') {
  if (productId) return items.find(item => item.product_id === productId) || null;
  const normalizedName = normalizeCatalogSearchName(customName);
  if (!normalizedName) return null;
  return items.find(item => !item.product_id && normalizeCatalogSearchName(item.item_name) === normalizedName) || null;
}
