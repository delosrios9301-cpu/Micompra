export const WORKSPACE_VERSION = 2;

export function createEmptyWorkspace() {
  return {
    version: WORKSPACE_VERSION,
    profile: { name: 'Mi hogar', currency: 'USD' },
    products: [],
    stores: [],
    lists: [],
    purchases: [],
    inventory: [],
    movements: [],
    expenses: [],
    budgets: [],
    activity: [],
    deletedRecords: {}
  };
}

export function createId(prefix = 'mc') {
  const random = globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 11);
  return prefix + '_' + random;
}

const asArray = value => Array.isArray(value) ? value : [];
const asText = value => String(value ?? '').trim();
const asNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const stamp = value => {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
};

export function normalizeWorkspace(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const empty = createEmptyWorkspace();
  const workspace = {
    version: WORKSPACE_VERSION,
    profile: {
      name: asText(source.profile?.name) || empty.profile.name,
      currency: ['USD', 'PAB'].includes(source.profile?.currency) ? source.profile.currency : empty.profile.currency
    },
    products: asArray(source.products),
    stores: asArray(source.stores),
    lists: asArray(source.lists),
    purchases: asArray(source.purchases),
    inventory: asArray(source.inventory),
    movements: asArray(source.movements),
    expenses: asArray(source.expenses),
    budgets: asArray(source.budgets),
    activity: asArray(source.activity),
    deletedRecords: source.deletedRecords && typeof source.deletedRecords === 'object' && !Array.isArray(source.deletedRecords) ? source.deletedRecords : {}
  };
  workspace.profile.currency = ['USD', 'PAB'].includes(workspace.profile.currency) ? workspace.profile.currency : 'USD';
  workspace.products = workspace.products.map(item => ({ ...item, id: asText(item.id) || createId('prd'), name: asText(item.name), active: item.active !== false }));
  workspace.stores = workspace.stores.map(item => ({ ...item, id: asText(item.id) || createId('str'), name: asText(item.name), active: item.active !== false }));
  workspace.lists = workspace.lists.map(item => ({
    ...item,
    id: asText(item.id) || createId('lst'),
    name: asText(item.name) || 'Lista sin nombre',
    status: item.status === 'completed' ? 'completed' : 'open',
    items: asArray(item.items).map(row => ({ ...row, id: asText(row.id) || createId('itm'), name: asText(row.name) }))
  }));
  workspace.purchases = workspace.purchases.map(item => ({ ...item, id: asText(item.id) || createId('buy'), items: asArray(item.items) }));
  workspace.inventory = workspace.inventory.map(item => ({ ...item, id: asText(item.id) || createId('inv'), name: asText(item.name) }));
  workspace.movements = asArray(workspace.movements);
  workspace.expenses = asArray(workspace.expenses);
  workspace.budgets = asArray(workspace.budgets);
  workspace.activity = asArray(workspace.activity).slice(0, 1000);
  return workspace;
}

function mergeRecords(left = [], right = [], deletedRecords = {}, prefix = '') {
  const records = new Map();
  for (const item of [...asArray(left), ...asArray(right)]) {
    if (!item || typeof item !== 'object') continue;
    const id = asText(item.id) || createId('rec');
    const previous = records.get(id);
    if (!previous || stamp(item.updatedAt || item.createdAt) >= stamp(previous.updatedAt || previous.createdAt)) records.set(id, { ...item, id });
  }
  return [...records.values()].filter(item => { const tombstone = deletedRecords[prefix + String(item.id)]; return !tombstone || stamp(tombstone.deletedAt) < stamp(item.updatedAt || item.createdAt); });
}

export function mergeWorkspaces(local = {}, remote = {}) {
  const a = normalizeWorkspace(local);
  const b = normalizeWorkspace(remote);
  const deletedRecords = { ...b.deletedRecords, ...a.deletedRecords };
  for (const key of Object.keys(deletedRecords)) {
    const leftStamp = stamp(a.deletedRecords[key]?.deletedAt);
    const rightStamp = stamp(b.deletedRecords[key]?.deletedAt);
    deletedRecords[key] = leftStamp >= rightStamp ? a.deletedRecords[key] : b.deletedRecords[key];
  }
  const merged = {
    ...b, ...a, deletedRecords, profile: { ...b.profile, ...a.profile },
    products: mergeRecords(a.products, b.products, deletedRecords, 'products:'),
    stores: mergeRecords(a.stores, b.stores, deletedRecords, 'stores:'),
    lists: mergeRecords(a.lists, b.lists, deletedRecords, 'lists:').map(list => {
      const remoteList = b.lists.find(row => row.id === list.id);
      const localList = a.lists.find(row => row.id === list.id);
      return { ...list, items: mergeRecords(localList?.items || [], remoteList?.items || [], deletedRecords, 'listItems:' + list.id + ':') };
    }),
    purchases: mergeRecords(a.purchases, b.purchases, deletedRecords, 'purchases:'),
    inventory: mergeRecords(a.inventory, b.inventory, deletedRecords, 'inventory:'),
    movements: mergeRecords(a.movements, b.movements, deletedRecords, 'movements:'),
    expenses: mergeRecords(a.expenses, b.expenses, deletedRecords, 'expenses:'),
    budgets: mergeRecords(a.budgets, b.budgets, deletedRecords, 'budgets:'),
    activity: mergeRecords(a.activity, b.activity, deletedRecords, 'activity:').sort((x, y) => stamp(y.createdAt) - stamp(x.createdAt)).slice(0, 1000)
  };
  return normalizeWorkspace(merged);
}

export function computePurchaseTotal(items = []) {
  return Math.round(asArray(items).reduce((sum, item) => {
    const quantity = Math.max(0, asNumber(item.quantity));
    const unitPrice = Math.max(0, asNumber(item.unitPrice));
    const discount = Math.max(0, asNumber(item.discount));
    return sum + Math.max(0, quantity * unitPrice - discount);
  }, 0) * 100) / 100;
}

export function monthKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

export function monthSpending(workspace, month = monthKey()) {
  const purchases = asArray(workspace?.purchases).filter(row => String(row.date || row.createdAt || '').slice(0, 7) === month);
  const expenses = asArray(workspace?.expenses).filter(row =>
    String(row.date || '').slice(0, 7) === month && !row.sourcePurchaseId
  );
  const purchaseTotal = purchases.reduce((sum, row) => sum + Math.max(0, asNumber(row.total)), 0);
  const expenseTotal = expenses.reduce((sum, row) => sum + Math.max(0, asNumber(row.amount)), 0);
  return {
    purchases: Math.round(purchaseTotal * 100) / 100,
    expenses: Math.round(expenseTotal * 100) / 100,
    total: Math.round((purchaseTotal + expenseTotal) * 100) / 100,
    purchaseCount: purchases.length,
    expenseCount: expenses.length
  };
}

export function inventoryAlerts(items = [], today = new Date()) {
  const localDateKey = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  const todayKey = localDateKey(today);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 7);
  const horizonKey = localDateKey(horizon);
  const rows = asArray(items);
  return {
    low: rows.filter(row => Number(row.quantity || 0) > 0 && Number(row.quantity || 0) <= Number(row.minimum || 0)),
    empty: rows.filter(row => Number(row.quantity || 0) <= 0),
    expired: rows.filter(row => row.expiryDate && row.expiryDate < todayKey),
    expiring: rows.filter(row => row.expiryDate && row.expiryDate >= todayKey && row.expiryDate <= horizonKey)
  };
}

export function currentBudget(workspace, month = monthKey()) {
  const row = asArray(workspace?.budgets).find(item => item.month === month);
  return Math.max(0, asNumber(row?.amount));
}

export function formatMoney(value, currency = 'USD') {
  return new Intl.NumberFormat('es-PA', {
    style: 'currency',
    currency: currency === 'PAB' ? 'USD' : currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(asNumber(value));
}

export function csvEscape(value) {
  const text = String(value ?? '');
  return '"' + text.replace(/"/g, '""') + '"';
}
