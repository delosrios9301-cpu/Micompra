// ITBMS Panamá: clasificación orientativa para compras personales.
// La DGI establece 7% general, exenciones y tarifas especiales 10/15%.
// Nunca se modifican automáticamente las tasas de compras ya finalizadas.
export const PANAMA_ITBMS_RATES = Object.freeze([0, 7, 10, 15]);
const norm = value => String(value ?? '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const validTaxRate = rate => PANAMA_ITBMS_RATES.includes(Number(rate)) &&
  rate !== null && rate !== undefined && String(rate).trim() !== '';

export function suggestPanamaItbms(name, category = '') {
  const group = norm(category);
  // Las tasas especiales solo se asignan si el propio usuario confirma;
  // por ejemplo "vino" puede aparecer en el nombre de un alimento.
  if (/(^| )alimento(s)?( |$)|comida|fruta(s)?|verdura(s)?|vegetal(es)?|lacteo(s)?|carn(e|es)|pescado(s)?|panaderia|abarrotes|comestibles|medicamento(s)?|farmacia|util(es)? escolar(es)?|libros de texto/.test(group)) return 0;
  if (/limpieza|detergentes|higiene|aseo personal|electrodomesticos|electronica|hogar|ferreteria|cosmeticos/.test(group)) return 7;
  const label = norm(name);
  if (/(^| )arroz( |$)|lechuga|pollo|huevo(s)?|leche|frijol(es)?|lenteja(s)?|pan( |$)|queso|papa(s)?|tomate(s)?|cebolla(s)?|zanahoria(s)?|carne|pescado|atun|harina|azucar|sal( |$)|pasta|espagueti|manzana(s)?|platano(s)?|banano(s)?|aceite (vegetal|de oliva)|yogur|fruta(s)?|agua potable|cafe molido|cafe en grano|medicamento(s)?|paracetamol|acetaminofen|ibuprofeno/.test(label)) return 0;
  if (/detergente|cloro|jabon|champu|shampoo|papel higienico|pasta dental|cepillo de dientes|desodorante|esponja|bolsa(s)? de basura|limpiador|suavizante|desinfectante/.test(label)) return 7;
  return null; // No inventar una clasificación fiscal para un producto desconocido.
}

export function taxRateForNewItem(item, catalog = []) {
  if (validTaxRate(item?.taxRate)) return Number(item.taxRate);
  const matched = catalog.find(row => norm(row.name) === norm(item?.name) && row.active !== false);
  if (validTaxRate(matched?.taxRate)) return Number(matched.taxRate);
  const suggested = suggestPanamaItbms(item?.name, matched?.category || item?.category);
  return suggested ?? 7; // Tarifa general sugerida; siempre editable.
}

export function purchaseLineBreakdown(item = {}) {
  const quantity = Math.max(0, Number(item.quantity) || 0);
  const unitPrice = Math.max(0, Number(item.unitPrice) || 0);
  const discount = Math.max(0, Number(item.discount) || 0);
  const gross = Math.max(0, quantity * unitPrice - discount);
  const rate = validTaxRate(item.taxRate) ? Number(item.taxRate) : 0;
  const included = item.taxIncluded === true && rate > 0;
  const tax = rate === 0 ? 0 : round2(gross * rate / (included ? (100 + rate) : 100));
  return {
    base: round2(included ? gross - tax : gross),
    tax, total: round2(included ? gross : gross + tax),
    rate, taxIncluded: included
  };
}

export function computePurchaseBreakdown(items = []) {
  let rawBase = 0, tax = 0;
  for (const item of Array.isArray(items) ? items : []) {
    const line = purchaseLineBreakdown(item);
    rawBase += line.base;
    tax += line.tax;
  }
  const subtotal = round2(rawBase);
  const itbms = round2(tax);
  return { subtotal, itbms, total: round2(subtotal + itbms) };
}
