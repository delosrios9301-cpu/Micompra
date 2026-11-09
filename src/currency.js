export function normalizeCurrency(value) {
  return value === 'PAB' ? 'PAB' : 'USD';
}

export function formatCurrency(amount, currency = 'USD', locale = 'es-PA') {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: normalizeCurrency(currency),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(amount) || 0);
}

export function getStoredCurrency(storage = globalThis.localStorage) {
  try {
    const settings = JSON.parse(storage?.getItem('micompra_settings_v1') || '{}');
    return normalizeCurrency(settings?.currency);
  } catch {
    return 'USD';
  }
}

export function formatStoredCurrency(amount, storage = globalThis.localStorage) {
  return formatCurrency(amount, getStoredCurrency(storage));
}
