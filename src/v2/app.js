import './styles.css';
import { createWorkspaceStore } from './store.js';
import {
  createEmptyWorkspace, createId, normalizeWorkspace, mergeWorkspaces, computePurchaseTotal,
  monthKey, monthSpending, inventoryAlerts, currentBudget, formatMoney, csvEscape
} from './model.js';

const root = document.querySelector('#app');
let workspace = createEmptyWorkspace();
let currentView = 'inicio';
let selectedListId = null;
let modalName = null;
let modalData = {};
let authMode = 'signin';
let authReady = false;
let purchaseDraft = [];
let toastTimer = null;
let searchValue = '';
let accessUsers = [];
let accessUsersLoading = false;

const nav = [
  { id: 'inicio', label: 'Inicio', icon: 'home' },
  { id: 'planificar', label: 'Planificar', icon: 'calendar' },
  { id: 'comprar', label: 'Comprar', icon: 'cart' },
  { id: 'inventario', label: 'Inventario', icon: 'box' },
  { id: 'finanzas', label: 'Finanzas', icon: 'wallet' },
  { id: 'actividad', label: 'Actividad', icon: 'clock' }
];

const secondary = [
  { id: 'catalogo', label: 'Catálogo', icon: 'grid' },
  { id: 'establecimientos', label: 'Establecimientos', icon: 'store' },
  { id: 'reportes', label: 'Reportes', icon: 'chart' },
  { id: 'configuracion', label: 'Configuración', icon: 'settings' }
];

const icons = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  cart: '<circle cx="9" cy="20" r="1"/><circle cx="19" cy="20" r="1"/><path d="M2 3h2l2.4 12.2a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 2-1.6L22 8H5"/>',
  box: '<path d="m12 3 9 5v8l-9 5-9-5V8z"/><path d="m3 8 9 5 9-5M12 13v8M7.5 5.5l9 5"/>',
  wallet: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 8h18M16 14h5M6 3h12"/><circle cx="16" cy="14" r=".7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  grid: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
  store: '<path d="M3 10h18l-1.5-6h-15zM5 10v10h14V10M9 20v-6h6v6"/><path d="M3 10a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 6-7"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.5.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.5-.9l-1.7.7-1.4-2.4L7.7 15a8 8 0 0 1 0-1.8l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.5-.9l.3-1.8H14l.3 1.8a8 8 0 0 1 1.5.9l1.7-.7 1.4 2.4-1.4 1.1a8 8 0 0 1-.1 1.8z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  leaf: '<path d="M20 4c-8 0-14 3-14 10a6 6 0 0 0 6 6c7 0 10-6 8-16z"/><path d="M4 21c3-5 6-8 12-11"/>',
  bell: '<path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 20h16"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 20h16"/>',
  filter: '<path d="M4 6h16M7 12h10m-7 6h4"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>'
};

function icon(name, size = 20) {
  return '<svg class="icon" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (icons[name] || icons.grid) + '</svg>';
}
function safe(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function today() { return new Date().toISOString().slice(0, 10); }
function money(value) { return formatMoney(value, workspace.profile.currency || 'USD'); }
function dateLabel(value) {
  const parsed = new Date((value || today()) + 'T12:00:00');
  return Number.isNaN(parsed.getTime()) ? 'Sin fecha' : parsed.toLocaleDateString('es-PA', { day: 'numeric', month: 'short', year: 'numeric' });
}
function monthLabel(key = monthKey()) {
  const parts = key.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, 1).toLocaleDateString('es-PA', { month: 'long', year: 'numeric' });
}
function initials(value) {
  return String(value || 'MC').split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('') || 'MC';
}
function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
function itemProgress(list) {
  const total = (list.items || []).length;
  const done = (list.items || []).filter(item => item.checked).length;
  return { total, done, percent: total ? Math.round(done / total * 100) : 0 };
}
function logActivity(module, action, description) {
  workspace.activity.unshift({
    id: createId('act'), module, action, description,
    createdAt: new Date().toISOString()
  });
  workspace.activity = workspace.activity.slice(0, 1000);
}
function persist(message) {
  workspace = normalizeWorkspace(workspace);
  store.save(workspace);
  render();
  if (message) showToast(message);
}
function showToast(message, type = 'success') {
  const host = document.querySelector('#toast-region');
  if (!host) return;
  host.innerHTML = '<div class="toast toast-' + type + '">' + (type === 'success' ? icon('check', 16) : icon('bell', 16)) + '<span>' + safe(message) + '</span></div>';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (host) host.innerHTML = ''; }, 3200);
}
function emptyState(title, detail, action, label) {
  return '<div class="empty-state"><span class="empty-state-icon">' + icon('box', 25) + '</span><h3>' + safe(title) + '</h3><p>' + safe(detail) + '</p>' +
    (action ? '<button class="btn btn-primary" data-action="' + action + '">' + icon('plus', 16) + safe(label || 'Crear') + '</button>' : '') + '</div>';
}
function sectionHeading(eyebrow, title, description, action, label) {
  return '<div class="page-heading"><div><span class="eyebrow">' + safe(eyebrow) + '</span><h1>' + safe(title) + '</h1><p>' + safe(description) + '</p></div>' +
    (action ? '<button class="btn btn-primary" data-action="' + action + '">' + icon('plus', 16) + safe(label || 'Nuevo') + '</button>' : '') + '</div>';
}
function navButton(item, mobile = false) {
  return '<button class="nav-link ' + (currentView === item.id ? 'active' : '') + '" data-action="navigate" data-view="' + item.id + '" aria-current="' + (currentView === item.id ? 'page' : 'false') + '">' +
    icon(item.icon, 19) + '<span>' + item.label + '</span></button>';
}
function sidebar() {
  return '<aside class="sidebar"><a class="brand" href="#" data-action="navigate" data-view="inicio"><span class="brand-mark">' + icon('leaf', 23) + '</span><span class="brand-name">mi<span>compra</span></span></a>' +
    '<div class="workspace-label">ESPACIO PERSONAL</div><nav class="side-nav">' + nav.map(item => navButton(item)).join('') + '</nav>' +
    '<div class="side-divider"></div><div class="workspace-label">HERRAMIENTAS</div><nav class="side-nav side-tools">' + secondary.map(item => navButton(item)).join('') + '</nav>' +
    '<div class="sidebar-footer"><div class="side-avatar">' + initials(store.getUser()?.email) + '</div><div class="side-user"><strong>' + safe(store.getUser()?.email || 'Espacio local') + '</strong><small>' + (store.getUser() ? 'Cuenta sincronizada' : 'Sin iniciar sesión') + '</small></div><button class="icon-button side-account" data-action="open-auth" aria-label="Cuenta">' + icon('settings', 17) + '</button></div></aside>';
}
function mobileNav() {
  const items = nav.slice(0, 5);
  return '<nav class="mobile-nav">' + items.map(item => navButton(item, true)).join('') +
    '<button class="nav-link ' + (['mas', 'actividad', ...secondary.map(row => row.id)].includes(currentView) ? 'active' : '') + '" data-action="navigate" data-view="mas">' + icon('menu', 19) + '<span>Más</span></button></nav>';
}
function statusLabel() {
  const value = store.getStatus();
  const online = value === 'Sincronizado';
  return '<span class="sync-status ' + (online ? 'is-online' : 'is-pending') + '"><i></i>' + safe(value) + '</span>';
}
function pageTitle() {
  const item = [...nav, ...secondary, { id: 'mas', label: 'Más herramientas' }].find(row => row.id === currentView);
  return item?.label || 'Inicio';
}
function renderDashboard() {
  const now = new Date();
  const month = monthKey(now);
  const spending = monthSpending(workspace, month);
  const budget = currentBudget(workspace, month);
  const balance = budget - spending.total;
  const alerts = inventoryAlerts(workspace.inventory, now);
  const openLists = workspace.lists.filter(list => list.status !== 'completed');
  const purchaseCount = workspace.purchases.length;
  const budgetPercent = budget > 0 ? Math.min(100, Math.round(spending.total / budget * 100)) : 0;
  const months = Array.from({ length: 6 }, (_, index) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    const key = monthKey(d);
    return { key, label: d.toLocaleDateString('es-PA', { month: 'short' }).replace('.', ''), total: monthSpending(workspace, key).total };
  });
  const maxSpend = Math.max(1, ...months.map(row => row.total));
  const chart = months.map(row => '<div class="chart-column"><strong>' + money(row.total) + '</strong><div class="chart-track"><i style="height:' + Math.max(4, row.total / maxSpend * 100) + '%"></i></div><span>' + safe(row.label) + '</span></div>').join('');
  const latest = workspace.activity.slice(0, 4);
  const alertCount = alerts.low.length + alerts.empty.length + alerts.expiring.length + alerts.expired.length;
  const alertText = alertCount ? alertCount + ' elemento(s) requieren atención' : 'Inventario bajo control';
  const listPreview = openLists.slice(0, 3).map(list => {
    const progress = itemProgress(list);
    return '<button class="list-preview" data-action="open-list" data-id="' + list.id + '"><span class="list-preview-icon">' + icon('calendar', 17) + '</span><span class="list-preview-copy"><strong>' + safe(list.name) + '</strong><small>' + progress.done + ' de ' + progress.total + ' productos</small></span><span class="mini-progress"><i style="width:' + progress.percent + '%"></i></span>' + icon('chevron', 16) + '</button>';
  }).join('');
  const activityPreview = latest.map(row => '<div class="activity-preview"><span class="activity-dot"></span><div><strong>' + safe(row.description) + '</strong><small>' + dateLabel(String(row.createdAt || '').slice(0, 10)) + ' · ' + safe(row.module) + '</small></div></div>').join('');
  return '<section class="welcome-hero"><div class="welcome-copy"><span class="hero-kicker">TU HOGAR, MEJOR ORGANIZADO</span><h1>Todo bajo control.<br><em>Compra con intención.</em></h1><p>Planifica lo que necesitas, registra tus compras y mantén tu inventario al día.</p><div class="hero-actions"><button class="btn btn-light" data-action="navigate" data-view="planificar">' + icon('plus', 16) + 'Crear una lista</button><button class="btn btn-hero-ghost" data-action="navigate" data-view="comprar">Registrar compra ' + icon('arrow', 15) + '</button></div></div><div class="hero-art" aria-hidden="true"><div class="hero-orbit orbit-one"></div><div class="hero-orbit orbit-two"></div><div class="hero-bag"><div class="bag-handle"></div><div class="bag-leaf">' + icon('leaf', 42) + '</div><span></span></div><div class="hero-art-chip chip-top">' + icon('check', 15) + ' Organizado</div><div class="hero-art-chip chip-bottom">' + icon('chart', 15) + ' En equilibrio</div></div></section>' +
    '<div class="section-intro"><div><span class="eyebrow">RESUMEN DEL MES</span><h2>' + safe(monthLabel(month)) + '</h2></div><span class="subtle-text">Actualizado con tus registros</span></div>' +
    '<section class="metric-grid"><article class="metric-card metric-green"><div class="metric-icon">' + icon('wallet', 19) + '</div><span>Gasto registrado</span><strong>' + money(spending.total) + '</strong><small>' + spending.purchaseCount + ' compras · ' + spending.expenseCount + ' gastos adicionales</small></article>' +
    '<article class="metric-card"><div class="metric-icon">' + icon('chart', 19) + '</div><span>Presupuesto disponible</span><strong>' + (budget ? money(balance) : '—') + '</strong><small>' + (budget ? money(budget) + ' asignados este mes' : 'Configura tu presupuesto mensual') + '</small></article>' +
    '<article class="metric-card"><div class="metric-icon">' + icon('calendar', 19) + '</div><span>Listas por completar</span><strong>' + openLists.length + '</strong><small>' + workspace.lists.length + ' listas creadas en total</small></article>' +
    '<article class="metric-card ' + (alertCount ? 'metric-warning' : '') + '"><div class="metric-icon">' + icon('box', 19) + '</div><span>Alertas de inventario</span><strong>' + alertCount + '</strong><small>' + safe(alertText) + '</small></article></section>' +
    '<div class="dashboard-grid"><section class="surface-panel spending-panel"><div class="panel-heading"><div><span class="eyebrow">HÁBITOS DE GASTO</span><h3>Tu evolución</h3></div><span class="period-chip">6 meses</span></div><div class="spend-summary"><strong>' + money(spending.total) + '</strong><span>Este mes</span></div><div class="spending-chart">' + chart + '</div>' +
    (budget ? '<div class="budget-track"><div><span>Uso del presupuesto</span><strong>' + budgetPercent + '%</strong></div><i><b style="width:' + budgetPercent + '%"></b></i></div>' : '<p class="panel-footnote">Define un presupuesto para medir tu avance mensual.</p>') + '</section>' +
    '<section class="surface-panel lists-panel"><div class="panel-heading"><div><span class="eyebrow">PLANIFICACIÓN</span><h3>Listas activas</h3></div><button class="text-action" data-action="navigate" data-view="planificar">Ver todas ' + icon('arrow', 14) + '</button></div>' +
    (listPreview || '<div class="panel-empty"><span>' + icon('calendar', 22) + '</span><strong>Sin listas pendientes</strong><small>Crea una lista para organizar tu próxima compra.</small></div>') + '</section>' +
    '<section class="surface-panel alerts-panel"><div class="panel-heading"><div><span class="eyebrow">INVENTARIO</span><h3>Atención en casa</h3></div><button class="text-action" data-action="navigate" data-view="inventario">Ver inventario ' + icon('arrow', 14) + '</button></div>' +
    '<div class="alert-row"><span class="alert-symbol alert-red">' + icon('box', 17) + '</span><div><strong>' + alerts.empty.length + ' agotados</strong><small>Productos sin existencias</small></div></div><div class="alert-row"><span class="alert-symbol alert-amber">' + icon('filter', 17) + '</span><div><strong>' + alerts.low.length + ' con stock bajo</strong><small>Por debajo del mínimo configurado</small></div></div><div class="alert-row"><span class="alert-symbol alert-blue">' + icon('clock', 17) + '</span><div><strong>' + (alerts.expiring.length + alerts.expired.length) + ' por vencer o vencidos</strong><small>Revisa las fechas de tus productos</small></div></div></section>' +
    '<section class="surface-panel activity-panel"><div class="panel-heading"><div><span class="eyebrow">ÚLTIMOS MOVIMIENTOS</span><h3>Actividad reciente</h3></div><button class="text-action" data-action="navigate" data-view="actividad">Historial ' + icon('arrow', 14) + '</button></div>' +
    (activityPreview || '<div class="panel-empty"><span>' + icon('clock', 22) + '</span><strong>Aún no hay actividad</strong><small>Las operaciones que registres aparecerán aquí.</small></div>') + '</section></div>';
}
function renderPlanning() {
  const list = workspace.lists.find(row => row.id === selectedListId);
  if (list) {
    const progress = itemProgress(list);
    const items = list.items.map(item => '<div class="list-item-row ' + (item.checked ? 'is-checked' : '') + '"><button class="check-circle ' + (item.checked ? 'checked' : '') + '" data-action="toggle-list-item" data-id="' + item.id + '" aria-label="Marcar producto">' + (item.checked ? icon('check', 14) : '') + '</button><div class="list-item-main"><strong>' + safe(item.name) + '</strong><small>' + safe(item.quantity) + ' ' + safe(item.unit || 'unidad') + (item.estimatedPrice ? ' · Estimado ' + money(item.quantity * item.estimatedPrice) : '') + '</small></div><span class="priority-dot priority-' + (item.priority || 'normal') + '"></span><button class="icon-button danger-ghost" data-action="remove-list-item" data-id="' + item.id + '" aria-label="Eliminar producto">' + icon('close', 15) + '</button></div>').join('');
    return '<div class="backline"><button class="back-button" data-action="back-lists">← Todas las listas</button><span class="status-chip ' + (list.status === 'completed' ? 'chip-done' : 'chip-open') + '">' + (list.status === 'completed' ? 'Completada' : 'En progreso') + '</span></div>' +
      '<div class="list-detail-heading"><div><span class="eyebrow">DETALLE DE LISTA</span><h1>' + safe(list.name) + '</h1><p>' + (list.plannedDate ? 'Compra prevista para ' + dateLabel(list.plannedDate) : 'Sin fecha definida') + (list.storeName ? ' · ' + safe(list.storeName) : '') + '</p></div><div class="list-progress-circle" style="--progress:' + progress.percent + '%"><strong>' + progress.percent + '%</strong></div></div>' +
      '<div class="surface-panel list-add-panel"><form data-form="list-item" class="inline-add-form"><label class="field grow"><span>Producto que necesitas</span><input name="name" placeholder="Ej. Leche entera" required maxlength="100"></label><label class="field qty-field"><span>Cantidad</span><input name="quantity" type="number" min="0.01" step="0.01" value="1" required></label><label class="field unit-field"><span>Unidad</span><input name="unit" value="unidad" maxlength="24"></label><button class="btn btn-primary add-inline-btn" type="submit">' + icon('plus', 16) + 'Añadir</button></form></div>' +
      '<section class="surface-panel list-items-panel"><div class="panel-heading"><div><span class="eyebrow">PRODUCTOS</span><h3>' + progress.done + ' de ' + progress.total + ' completados</h3></div><span class="subtle-text">' + (list.budget ? 'Presupuesto ' + money(list.budget) : 'Sin presupuesto') + '</span></div>' +
      (items || '<div class="panel-empty"><span>' + icon('cart', 22) + '</span><strong>Empieza añadiendo productos</strong><small>Tu lista se irá organizando a medida que avances.</small></div>') +
      '<div class="list-footer-actions"><button class="btn btn-secondary" data-action="duplicate-list">' + icon('grid', 15) + 'Duplicar</button><button class="btn btn-secondary" data-action="make-purchase">' + icon('cart', 15) + 'Preparar compra</button>' +
      (list.status === 'completed' ? '<button class="btn btn-primary" data-action="reopen-list">Reabrir lista</button>' : '<button class="btn btn-primary" data-action="complete-list">' + icon('check', 15) + 'Completar lista</button>') + '</div></section>';
  }
  const rows = workspace.lists.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).map(row => {
    const p = itemProgress(row);
    return '<article class="entity-card list-card"><button class="entity-card-main" data-action="open-list" data-id="' + row.id + '"><span class="entity-symbol symbol-green">' + icon('calendar', 20) + '</span><span class="entity-copy"><strong>' + safe(row.name) + '</strong><small>' + dateLabel(row.plannedDate || row.createdAt?.slice(0, 10)) + ' · ' + p.total + ' productos</small><span class="entity-progress"><i style="width:' + p.percent + '%"></i></span></span><span class="entity-side"><strong>' + p.percent + '%</strong><small>' + p.done + '/' + p.total + '</small></span></button><span class="status-chip ' + (row.status === 'completed' ? 'chip-done' : 'chip-open') + '">' + (row.status === 'completed' ? 'Terminada' : 'Pendiente') + '</span></article>';
  }).join('');
  return sectionHeading('ORGANIZA ANTES DE SALIR', 'Planificar', 'Convierte tus necesidades en listas claras y prepara cada compra con anticipación.', 'new-list', 'Nueva lista') +
    '<div class="filter-pills"><span class="filter-pill active">Todas las listas · ' + workspace.lists.length + '</span><span class="filter-pill">Pendientes · ' + workspace.lists.filter(row => row.status !== 'completed').length + '</span><span class="filter-pill">Completadas · ' + workspace.lists.filter(row => row.status === 'completed').length + '</span></div>' +
    (rows || emptyState('Todavía no tienes listas', 'Crea tu primera lista y empieza a organizar lo que necesitas para el hogar.', 'new-list', 'Crear primera lista'));
}
function storeOptions(selected = '') {
  return '<option value="">Sin establecimiento</option>' + workspace.stores.filter(row => row.active !== false).map(row => '<option value="' + row.id + '" ' + (selected === row.id ? 'selected' : '') + '>' + safe(row.name) + '</option>').join('');
}
function renderShopping() {
  const storeSelect = '<select name="storeId">' + storeOptions() + '</select>';
  const draftRows = purchaseDraft.map((item, index) => '<div class="draft-line"><div class="draft-product-copy"><strong>' + safe(item.name) + '</strong><div class="draft-quantity-control"><span>Cantidad</span><button type="button" class="draft-qty-button" data-action="draft-qty-minus" data-index="' + index + '" aria-label="Restar una unidad">−</button><input type="number" min="0.01" step="1" inputmode="decimal" aria-label="Cantidad de ' + safe(item.name) + '" data-draft-qty="' + index + '" value="' + item.quantity + '"><button type="button" class="draft-qty-button" data-action="draft-qty-plus" data-index="' + index + '" aria-label="Sumar una unidad">+</button><small>' + safe(item.unit) + '</small></div><label class="draft-price-field"><span>Precio unitario</span><input type="number" min="0" step="0.01" inputmode="decimal" placeholder="" aria-label="Precio unitario de ' + safe(item.name) + '" data-draft-price="' + index + '" value="' + (Number(item.unitPrice) > 0 ? Number(item.unitPrice) : '') + '"></label></div><strong class="draft-line-total" data-line-total="' + index + '">' + money(Math.max(0, item.quantity * item.unitPrice - item.discount)) + '</strong><button class="icon-button danger-ghost" data-action="remove-draft-line" data-index="' + index + '" aria-label="Quitar ' + safe(item.name) + '">' + icon('close', 15) + '</button></div>').join('');
  const draftTotal = computePurchaseTotal(purchaseDraft);
  const history = workspace.purchases.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).map(item =>
    '<article class="purchase-history-row"><span class="entity-symbol symbol-green">' + icon('cart', 18) + '</span><div class="entity-copy"><strong>' + safe(item.storeName || 'Compra sin establecimiento') + '</strong><small>' + dateLabel(item.date) + ' · ' + item.items.length + ' productos · ' + (item.paid ? 'Pagada' : 'Pendiente de pago') + '</small></div><strong class="purchase-total">' + money(item.total) + '</strong></article>'
  ).join('');
  return sectionHeading('REGISTRA LO QUE REALMENTE COMPRASTE', 'Comprar', 'Introduce los importes de tu recibo. Los precios siempre los escribes tú.', null, '') +
    '<div class="buy-layout"><section class="surface-panel purchase-builder"><div class="panel-heading"><div><span class="eyebrow">NUEVA OPERACIÓN</span><h3>Detalle de compra</h3></div><span class="step-chip">01 · Registro</span></div>' +
    '<div class="form-grid"><label class="field"><span>Establecimiento</span>' + storeSelect + '</label><label class="field"><span>Fecha de compra</span><input id="purchase-date" type="date" value="' + today() + '"></label></div>' +
    '<form data-form="purchase-line" class="purchase-line-form"><div class="form-grid purchase-fields"><label class="field span-two"><span>Producto</span><input name="name" placeholder="Nombre del producto" maxlength="100" required></label><label class="field"><span>Cantidad</span><input name="quantity" type="number" min="0.01" step="0.01" value="1" required></label><label class="field"><span>Unidad</span><input name="unit" value="unidad" maxlength="24"></label><label class="field"><span>Precio unitario</span><input name="unitPrice" type="number" min="0" step="0.01" placeholder="0.00" required></label><label class="field"><span>Descuento total</span><input name="discount" type="number" min="0" step="0.01" value="0"></label></div><button class="btn btn-secondary btn-wide" type="submit">' + icon('plus', 16) + 'Añadir producto a la compra</button></form>' +
    '<div class="draft-list"><div class="draft-title"><strong>Productos registrados</strong><span>' + purchaseDraft.length + '</span></div>' + (draftRows || '<p class="draft-empty">Aún no has agregado productos a esta compra.</p>') + '</div>' +
    '<div class="purchase-summary"><div><span>Total de la compra</span><strong id="purchase-draft-total">' + money(draftTotal) + '</strong></div><label class="check-option"><input id="purchase-paid" type="checkbox" checked><span>Compra pagada</span></label><label class="check-option"><input id="purchase-to-inventory" type="checkbox" checked><span>Sumar productos al inventario</span></label><button class="btn btn-primary btn-wide" data-action="confirm-purchase" ' + (!purchaseDraft.length ? 'disabled' : '') + '>Confirmar y guardar compra ' + icon('arrow', 16) + '</button></div></section>' +
    '<aside class="buy-aside"><div class="aside-card"><span class="aside-icon">' + icon('shield', 20) + '</span><strong>Registro transparente</strong><p>Este módulo no consulta tiendas ni descarga precios. Cada importe proviene de lo que introduces.</p></div><div class="aside-card"><span class="aside-icon">' + icon('box', 20) + '</span><strong>Inventario conectado</strong><p>Al confirmar, puedes sumar los productos al inventario con un movimiento registrado.</p></div></aside></div>' +
    '<section class="surface-panel history-panel"><div class="panel-heading"><div><span class="eyebrow">REGISTRO REAL</span><h3>Compras recientes</h3></div><span class="period-chip">' + workspace.purchases.length + ' registros</span></div>' + (history || '<div class="panel-empty"><span>' + icon('cart', 22) + '</span><strong>Aún no tienes compras guardadas</strong><small>Las compras confirmadas se conservarán en tu historial.</small></div>') + '</section>';
}
function renderInventory() {
  const alerts = inventoryAlerts(workspace.inventory);
  const filtered = workspace.inventory.filter(row => normalizeText(row.name + ' ' + (row.category || '') + ' ' + (row.location || '')).includes(normalizeText(searchValue)));
  const rows = filtered.map(row => {
    const qty = Number(row.quantity) || 0;
    const minimum = Number(row.minimum) || 0;
    const status = row.expiryDate && row.expiryDate < today() ? 'Vencido' : qty <= 0 ? 'Agotado' : qty <= minimum ? 'Stock bajo' : 'Disponible';
    const klass = status === 'Disponible' ? 'chip-done' : status === 'Stock bajo' ? 'chip-warn' : 'chip-danger';
    return '<article class="inventory-row"><span class="product-avatar">' + icon('box', 19) + '</span><div class="entity-copy"><strong>' + safe(row.name) + '</strong><small>' + safe(row.category || 'Sin categoría') + ' · ' + safe(row.location || 'Sin ubicación') + (row.expiryDate ? ' · Vence ' + dateLabel(row.expiryDate) : '') + '</small><span class="status-chip ' + klass + '">' + status + '</span></div><div class="stock-count"><strong>' + qty + '</strong><small>' + safe(row.unit || 'unidad') + '</small></div><div class="stock-actions"><button class="stock-btn" data-action="stock-in" data-id="' + row.id + '" aria-label="Agregar una unidad">+</button><button class="stock-btn" data-action="stock-out" data-id="' + row.id + '" aria-label="Consumir una unidad">−</button><button class="icon-button" data-action="adjust-inventory" data-id="' + row.id + '" aria-label="Ajustar inventario">' + icon('settings', 16) + '</button></div></article>';
  }).join('');
  return sectionHeading('EXISTENCIAS DE TU HOGAR', 'Inventario', 'Conoce qué tienes, dónde está y cuándo necesitas reponerlo.', 'new-inventory', 'Añadir producto') +
    '<div class="inventory-kpis"><div><span>Total de productos</span><strong>' + workspace.inventory.length + '</strong></div><div><span>Stock bajo</span><strong>' + (alerts.low.length + alerts.empty.length) + '</strong></div><div><span>Vencidos</span><strong>' + alerts.expired.length + '</strong></div><div><span>Por vencer</span><strong>' + alerts.expiring.length + '</strong></div></div>' +
    '<section class="surface-panel inventory-panel"><div class="panel-heading"><div><span class="eyebrow">CONTROL DE EXISTENCIAS</span><h3>Productos en casa</h3></div><label class="search-field">' + icon('search', 16) + '<input id="inventory-search" type="search" value="' + safe(searchValue) + '" placeholder="Buscar producto"></label></div>' +
    (rows || emptyState('Inventario vacío', 'Añade productos y registra entradas o consumos para conocer tus existencias.', 'new-inventory', 'Añadir primer producto')) + '</section>' +
    '<p class="data-note">Cada entrada, consumo o ajuste queda registrado en los movimientos de inventario.</p>';
}
function renderFinance() {
  const month = monthKey();
  const spend = monthSpending(workspace, month);
  const budget = currentBudget(workspace, month);
  const percent = budget ? Math.round(spend.total / budget * 100) : 0;
  const expenses = workspace.expenses.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).map(row =>
    '<div class="expense-row"><span class="expense-symbol">' + icon('wallet', 17) + '</span><div class="entity-copy"><strong>' + safe(row.title) + '</strong><small>' + safe(row.category || 'Otros') + ' · ' + dateLabel(row.date) + (row.paid ? ' · Pagado' : ' · Pendiente') + '</small></div><strong>' + money(row.amount) + '</strong><button class="icon-button danger-ghost" data-action="delete-expense" data-id="' + row.id + '" aria-label="Eliminar gasto">' + icon('close', 15) + '</button></div>'
  ).join('');
  return sectionHeading('CONTROL ECONÓMICO DEL HOGAR', 'Finanzas', 'Presupuesta, registra y entiende en qué se utiliza tu dinero.', 'new-expense', 'Registrar gasto') +
    '<div class="finance-summary-grid"><article class="finance-highlight"><span>Gasto total del mes</span><strong>' + money(spend.total) + '</strong><small>' + spend.purchaseCount + ' compras y ' + spend.expenseCount + ' gastos adicionales</small><div class="finance-progress"><i style="width:' + (budget ? Math.min(100, percent) : 0) + '%"></i></div><small>' + (budget ? percent + '% del presupuesto utilizado' : 'Configura tu presupuesto para comenzar') + '</small></article>' +
    '<article class="finance-number"><span>Presupuesto mensual</span><strong>' + (budget ? money(budget) : 'Sin configurar') + '</strong><small>' + safe(monthLabel(month)) + '</small><button class="text-action" data-action="edit-budget">Editar presupuesto ' + icon('arrow', 14) + '</button></article>' +
    '<article class="finance-number"><span>Disponible</span><strong class="' + (budget && spend.total > budget ? 'negative-value' : '') + '">' + (budget ? money(budget - spend.total) : '—') + '</strong><small>Presupuesto menos gasto registrado</small></article></div>' +
    '<section class="surface-panel finance-table"><div class="panel-heading"><div><span class="eyebrow">OTROS GASTOS</span><h3>Registros adicionales</h3></div><button class="btn btn-secondary btn-small" data-action="new-expense">' + icon('plus', 15) + 'Añadir gasto</button></div>' +
    (expenses || '<div class="panel-empty"><span>' + icon('wallet', 22) + '</span><strong>No hay gastos adicionales</strong><small>Las compras se contabilizan desde el módulo Comprar; registra aquí otros gastos del hogar.</small></div>') + '</section>' +
    '<div class="finance-note">' + icon('shield', 17) + '<span>Las compras se contabilizan una sola vez. Los gastos adicionales se registran por separado para evitar duplicar importes.</span></div>';
}
function renderActivity() {
  const filter = normalizeText(searchValue);
  const rows = workspace.activity.filter(row => normalizeText(row.module + ' ' + row.action + ' ' + row.description).includes(filter)).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).map(row =>
    '<div class="timeline-row"><span class="timeline-dot"></span><div class="timeline-content"><div><strong>' + safe(row.description) + '</strong><span class="timeline-module">' + safe(row.module) + '</span></div><small>' + new Date(row.createdAt).toLocaleString('es-PA', { dateStyle: 'medium', timeStyle: 'short' }) + '</small></div></div>'
  ).join('');
  return sectionHeading('HISTORIAL CENTRALIZADO', 'Actividad', 'Consulta los cambios y operaciones realizados dentro de tu espacio.', null, '') +
    '<section class="surface-panel timeline-panel"><div class="panel-heading"><div><span class="eyebrow">REGISTRO DE OPERACIONES</span><h3>Todo lo que ha ocurrido</h3></div><label class="search-field">' + icon('search', 16) + '<input id="activity-search" type="search" value="' + safe(searchValue) + '" placeholder="Filtrar historial"></label></div>' +
    (rows || '<div class="panel-empty"><span>' + icon('clock', 22) + '</span><strong>Sin movimientos registrados</strong><small>Cuando realices operaciones, aparecerán aquí en orden cronológico.</small></div>') + '</section>';
}
function renderMore() {
  const links = [
    { id: 'actividad', title: 'Actividad', text: 'Historial de operaciones y cambios.', icon: 'clock' },
    { id: 'catalogo', title: 'Catálogo de productos', text: 'Organiza productos, categorías y unidades.', icon: 'grid' },
    { id: 'establecimientos', title: 'Establecimientos', text: 'Administra los lugares donde compras.', icon: 'store' },
    { id: 'reportes', title: 'Reportes', text: 'Descarga resúmenes y respaldos.', icon: 'chart' },
    { id: 'configuracion', title: 'Configuración', text: 'Cuenta, moneda y preferencias.', icon: 'settings' }
  ];
  return sectionHeading('HERRAMIENTAS DE MI COMPRA', 'Más opciones', 'Herramientas adicionales para gestionar tu espacio personal.', null, '') +
    '<div class="tools-grid">' + links.map(row => '<button class="tool-card" data-action="navigate" data-view="' + row.id + '"><span class="tool-icon">' + icon(row.icon, 22) + '</span><strong>' + row.title + '</strong><small>' + row.text + '</small><span class="tool-arrow">' + icon('arrow', 16) + '</span></button>').join('') + '</div>';
}
function renderCatalog() {
  const rows = workspace.products.filter(row => row.active !== false && normalizeText(row.name + ' ' + (row.category || '')).includes(normalizeText(searchValue))).map(row =>
    '<div class="catalog-row"><span class="product-avatar">' + icon('grid', 18) + '</span><div class="entity-copy"><strong>' + safe(row.name) + '</strong><small>' + safe(row.category || 'Sin categoría') + ' · ' + safe(row.unit || 'unidad') + '</small></div><button class="icon-button danger-ghost" data-action="deactivate-product" data-id="' + row.id + '" aria-label="Desactivar producto">' + icon('close', 16) + '</button></div>'
  ).join('');
  return sectionHeading('CATÁLOGO CENTRAL', 'Productos', 'Un solo catálogo para listas, compras e inventario. Sin registros duplicados.', 'new-product', 'Nuevo producto') +
    '<section class="surface-panel inventory-panel"><div class="panel-heading"><div><span class="eyebrow">PRODUCTOS ACTIVOS</span><h3>' + workspace.products.filter(row => row.active !== false).length + ' productos</h3></div><label class="search-field">' + icon('search', 16) + '<input id="catalog-search" type="search" value="' + safe(searchValue) + '" placeholder="Buscar"></label></div>' +
    (rows || emptyState('Catálogo vacío', 'Añade tus productos más habituales para reutilizarlos en listas y compras.', 'new-product', 'Crear producto')) + '</section>';
}
function renderStores() {
  const rows = workspace.stores.map(row => '<div class="catalog-row"><span class="product-avatar store-avatar">' + icon('store', 18) + '</span><div class="entity-copy"><strong>' + safe(row.name) + '</strong><small>' + safe(row.location || 'Sin ubicación adicional') + '</small></div><button class="icon-button danger-ghost" data-action="delete-store" data-id="' + row.id + '" aria-label="Eliminar establecimiento">' + icon('close', 16) + '</button></div>').join('');
  return sectionHeading('LUGARES DE COMPRA', 'Establecimientos', 'Guarda los lugares donde sueles realizar tus compras.', 'new-store', 'Añadir establecimiento') +
    '<section class="surface-panel inventory-panel"><div class="panel-heading"><div><span class="eyebrow">TUS ESTABLECIMIENTOS</span><h3>' + workspace.stores.length + ' registrados</h3></div></div>' +
    (rows || emptyState('Sin establecimientos', 'Registra tiendas o comercios para asociarlos a tus compras.', 'new-store', 'Añadir primero')) + '</section>';
}
function renderReports() {
  const month = monthKey();
  const stats = monthSpending(workspace, month);
  return sectionHeading('TUS DATOS, SIEMPRE DISPONIBLES', 'Reportes', 'Consulta y exporta la información de tu espacio en formatos reutilizables.', null, '') +
    '<div class="report-overview"><article><span>Compras registradas</span><strong>' + workspace.purchases.length + '</strong></article><article><span>Productos en inventario</span><strong>' + workspace.inventory.length + '</strong></article><article><span>Gasto este mes</span><strong>' + money(stats.total) + '</strong></article><article><span>Listas creadas</span><strong>' + workspace.lists.length + '</strong></article></div>' +
    '<div class="report-grid"><article class="report-card"><span class="report-icon">' + icon('download', 21) + '</span><h3>Exportar compras</h3><p>Descarga el historial de compras y el detalle de sus productos en CSV.</p><button class="btn btn-secondary" data-action="export-purchases">Descargar CSV</button></article>' +
    '<article class="report-card"><span class="report-icon">' + icon('box', 21) + '</span><h3>Exportar inventario</h3><p>Guarda tus existencias, mínimos, ubicaciones y vencimientos.</p><button class="btn btn-secondary" data-action="export-inventory">Descargar CSV</button></article>' +
    '<article class="report-card"><span class="report-icon">' + icon('wallet', 21) + '</span><h3>Exportar finanzas</h3><p>Descarga tus gastos adicionales y presupuestos mensuales.</p><button class="btn btn-secondary" data-action="export-finance">Descargar CSV</button></article>' +
    '<article class="report-card report-backup"><span class="report-icon">' + icon('shield', 21) + '</span><h3>Copia completa de seguridad</h3><p>Descarga una copia JSON de todos los datos de Mi Compra 2.0.</p><button class="btn btn-primary" data-action="download-backup">Descargar respaldo</button></article></div>';
}

async function refreshAccessUsers() {
  if (!store.isWorkspaceOwner()) { accessUsers = []; return; }
  accessUsersLoading = true;
  render();
  try {
    accessUsers = await store.listAccessUsers();
  } catch (error) {
    showToast(error.message || 'No se pudo cargar la lista de usuarios.', 'info');
  } finally {
    accessUsersLoading = false;
    render();
  }
}
function renderSettings() {
  const user = store.getUser();
  const isOwner = store.isWorkspaceOwner();
  const accessLabel = isOwner ? 'Propietario' : (user ? 'Miembro' : 'Acceso limitado');
  return sectionHeading('PREFERENCIAS Y SEGURIDAD', 'Configuración', 'Administra tu cuenta, la moneda y la protección de tus datos.', null, '') +
    '<div class="settings-layout"><section class="surface-panel settings-card"><div class="panel-heading"><div><span class="eyebrow">CUENTA</span><h3>Acceso y sincronización</h3></div><span class="status-chip ' + (user ? 'chip-done' : 'chip-open') + '">' + (user ? 'Conectada' : 'Sin cuenta') + '</span></div>' +
    '<div class="account-summary"><span class="account-avatar">' + initials(user?.email) + '</span><div><strong>' + safe(user?.email || 'Modo local') + '</strong><small>' + (user ? 'Tus datos se sincronizan con esta cuenta.' : 'Inicia sesión para sincronizar entre dispositivos.') + '</small></div></div>' +
    '<button class="btn btn-secondary" data-action="open-auth">' + (user ? 'Administrar cuenta' : 'Iniciar sesión o crear cuenta') + '</button></section>' +
    '<section class="surface-panel settings-card"><div class="panel-heading"><div><span class="eyebrow">ADMINISTRACIÓN</span><h3>Gestión de usuarios y accesos</h3></div><span class="status-chip ' + (isOwner ? 'chip-done' : 'chip-open') + '">' + accessLabel + '</span></div><p class="settings-description">Administra quién puede ingresar a Mi Compra y compartir la información autorizada. Cada persona utiliza su propia cuenta y contraseña.</p>' + (!isOwner ? '<p class="settings-description">Solo la cuenta propietaria puede enviar invitaciones a nuevos usuarios.</p>' : '') + '<div class="settings-actions"><button class="btn btn-primary" data-action="new-access-user" ' + (!isOwner ? 'disabled' : '') + '>Invitar usuario por correo</button><button class="btn btn-secondary" data-action="refresh-access-users" ' + (!isOwner ? 'disabled' : '') + '>Actualizar lista</button></div>' +
     (isOwner ? '<div class="access-user-list"><h4>Usuarios con acceso</h4>' + (accessUsersLoading ? '<p class="settings-description">Cargando usuarios…</p>' : accessUsers.length ? accessUsers.map(member => '<div class="access-user-row"><div class="account-avatar">' + initials(member.email) + '</div><div class="access-user-info"><strong>' + safe(member.email || 'Correo no disponible') + '</strong><small>Acceso activo · ' + safe(member.role || 'Miembro') + '</small></div><button class="btn btn-danger btn-small" data-action="revoke-access-user" data-id="' + safe(member.uid) + '">Revocar</button></div>').join('') : '<p class="settings-description">Todavía no hay otros usuarios autorizados en este espacio.</p>') + '</div>' : '<p class="settings-description">La lista de usuarios solo está disponible para el propietario.</p>') + '</section>' +
    '<section class="surface-panel settings-card"><div class="panel-heading"><div><span class="eyebrow">PREFERENCIAS</span><h3>Moneda de visualización</h3></div></div><form data-form="currency" class="settings-form"><label class="field"><span>Moneda</span><select name="currency"><option value="USD" ' + (workspace.profile.currency === 'USD' ? 'selected' : '') + '>Dólar estadounidense (USD)</option><option value="PAB" ' + (workspace.profile.currency === 'PAB' ? 'selected' : '') + '>Balboa panameño (PAB)</option></select></label><button class="btn btn-primary" type="submit">Guardar preferencia</button></form></section>' +
    '<section class="surface-panel settings-card"><div class="panel-heading"><div><span class="eyebrow">TUS DATOS</span><h3>Respaldo y recuperación</h3></div></div><p class="settings-description">Mantén una copia de seguridad antes de cambiar de dispositivo o restaurar información.</p><div class="settings-actions"><button class="btn btn-secondary" data-action="download-backup">' + icon('download', 15) + 'Descargar copia</button><label class="btn btn-secondary file-button">' + icon('upload', 15) + 'Restaurar copia<input id="restore-file" type="file" accept="application/json,.json" hidden></label></div></section>' +
    '<section class="surface-panel settings-card"><div class="panel-heading"><div><span class="eyebrow">RESTABLECIMIENTO</span><h3>Restablecer aplicación</h3></div><span class="status-chip chip-open">Acción irreversible</span></div><p class="settings-description">Borra todos los datos de Mi Compra: listas, catálogo, establecimientos, compras, inventario, movimientos, gastos, presupuestos e historial. El borrado también se sincroniza con la nube y los demás dispositivos.</p><div class="settings-actions"><button class="btn btn-danger" data-action="open-reset">Restablecer y borrar todos los datos</button></div><p class="settings-description">Tu cuenta y contraseña seguirán activas. Se eliminará únicamente la información guardada dentro de la aplicación.</p></section>' +
    '<section class="surface-panel settings-card"><div class="panel-heading"><div><span class="eyebrow">PLATAFORMA</span><h3>Mi Compra 2.0</h3></div><span class="version-tag">v2.0</span></div><p class="settings-description">Nueva estructura de planificación, compras, inventario y finanzas. Las funcionalidades de la versión anterior ya no forman parte de la navegación de esta aplicación.</p><div class="settings-footnote">' + statusLabel() + '</div></section></div>';
}
function viewContent() {
  switch (currentView) {
    case 'inicio': return renderDashboard();
    case 'planificar': return renderPlanning();
    case 'comprar': return renderShopping();
    case 'inventario': return renderInventory();
    case 'finanzas': return renderFinance();
    case 'actividad': return renderActivity();
    case 'mas': return renderMore();
    case 'catalogo': return renderCatalog();
    case 'establecimientos': return renderStores();
    case 'reportes': return renderReports();
    case 'configuracion': return renderSettings();
    default: currentView = 'inicio'; return renderDashboard();
  }
}
function modalHtml() {
  if (!modalName) return '';
  const close = '<button class="icon-button modal-close" type="button" data-action="close-modal" aria-label="Cerrar">' + icon('close', 19) + '</button>';
  if (modalName === 'auth') {
    const user = store.getUser();
    if (user) return '<div class="modal-backdrop" data-action="close-modal"><section class="modal-card" role="dialog" aria-modal="true" aria-label="Cuenta" data-modal-card><div class="modal-heading"><div><span class="eyebrow">TU ESPACIO PERSONAL</span><h2>Cuenta conectada</h2></div>' + close + '</div><div class="account-summary account-summary-modal"><span class="account-avatar">' + initials(user.email) + '</span><div><strong>' + safe(user.email) + '</strong><small>Sincronización entre tus dispositivos activada.</small></div></div><button class="btn btn-danger btn-wide" data-action="sign-out">Cerrar sesión</button></section></div>';
    const isSignup = authMode === 'signup';
    return '<div class="modal-backdrop" data-action="close-modal"><section class="modal-card auth-modal" role="dialog" aria-modal="true" aria-label="Acceso a Mi Compra" data-modal-card><div class="modal-heading"><div><span class="eyebrow">SINCRONIZA TU ESPACIO</span><h2>' + (isSignup ? 'Crear cuenta' : 'Bienvenido de nuevo') + '</h2><p>' + (isSignup ? 'Crea una cuenta para acceder a tus datos desde todos tus dispositivos.' : 'Inicia sesión para recuperar tus listas, compras e inventario.') + '</p></div>' + close + '</div><form data-form="auth"><label class="field"><span>Correo electrónico</span><input name="email" type="email" required autocomplete="email" placeholder="tu@correo.com"></label><label class="field"><span>Contraseña</span><input name="password" type="password" required minlength="8" autocomplete="' + (isSignup ? 'new-password' : 'current-password') + '" placeholder="Mínimo 8 caracteres"></label><button class="btn btn-primary btn-wide" type="submit">' + (isSignup ? 'Crear cuenta' : 'Iniciar sesión') + ' ' + icon('arrow', 15) + '</button></form><div class="auth-links">' + (!isSignup ? '<button data-action="forgot-password">¿Olvidaste tu contraseña?</button>' : '') + '<button data-action="switch-auth-mode">' + (isSignup ? 'Ya tengo una cuenta · Iniciar sesión' : '¿Primera vez? Crear una cuenta') + '</button></div><p class="auth-note">Tu información está protegida por tu cuenta y las reglas de acceso de la base de datos.</p></section></div>';
  }
  if (modalName === 'access-user') {
    return '<div class="modal-backdrop" data-action="close-modal"><section class="modal-card" role="dialog" aria-modal="true" aria-label="Invitar usuario" data-modal-card><div class="modal-heading"><div><span class="eyebrow">GESTIÓN DE ACCESOS</span><h2>Enviar invitación</h2><p>La persona recibirá un correo para crear su propia contraseña y acceder al espacio compartido.</p></div>' + close + '</div><form data-form="access-user"><label class="field"><span>Correo electrónico</span><input name="email" type="email" required autocomplete="email" placeholder="correo@ejemplo.com"></label><p class="settings-description">No necesitas crear ni compartir una contraseña. El enlace llegará directamente a su correo.</p><button class="btn btn-primary btn-wide" type="submit">Enviar invitación por correo</button></form></section></div>';
  }
  if (modalName === 'reset-workspace') {
    if (!store.isWorkspaceOwner()) { modalName = null; return ''; }
    return '<div class="modal-backdrop" data-action="close-modal"><section class="modal-card" role="dialog" aria-modal="true" aria-label="Confirmar restablecimiento" data-modal-card><div class="modal-heading"><div><span class="eyebrow">BORRADO DEFINITIVO</span><h2>¿Restablecer Mi Compra?</h2><p>Se eliminarán los datos de esta cuenta en la nube y en este dispositivo. Esta acción no se puede deshacer.</p></div>' + close + '</div><div class="modal-description"><strong>Se borrarán:</strong> listas, productos, establecimientos, compras, inventario, movimientos, gastos, presupuestos y actividad.</div><p class="modal-description">Para confirmar, escribe <strong>RESTABLECER</strong> en el campo siguiente. Tu cuenta no será eliminada.</p><form data-form="reset-workspace"><label class="field"><span>Confirmación</span><input name="confirmation" required autocomplete="off" placeholder="Escribe RESTABLECER"></label><button class="btn btn-danger btn-wide" type="submit">Sí, borrar todos los datos</button></form></section></div>';
  }
  if (modalName === 'password-reset') {
    return '<div class="modal-backdrop" data-action="close-modal"><section class="modal-card" role="dialog" aria-modal="true" data-modal-card><div class="modal-heading"><div><span class="eyebrow">RECUPERACIÓN DE ACCESO</span><h2>Restablecer contraseña</h2><p>Te enviaremos un enlace a tu correo.</p></div>' + close + '</div><form data-form="password-reset"><label class="field"><span>Correo electrónico</span><input name="email" type="email" required placeholder="tu@correo.com"></label><button class="btn btn-primary btn-wide" type="submit">Enviar enlace</button></form></section></div>';
  }
  let title = '';
  let body = '';
  if (modalName === 'new-list') {
    title = 'Nueva lista de compras';
    body = '<form data-form="create-list"><label class="field"><span>Nombre de la lista</span><input name="name" required maxlength="80" placeholder="Ej. Compra quincenal"></label><div class="form-grid"><label class="field"><span>Fecha prevista</span><input name="plannedDate" type="date" value="' + today() + '"></label><label class="field"><span>Presupuesto estimado</span><input name="budget" type="number" min="0" step="0.01" placeholder="0.00"></label></div><label class="field"><span>Establecimiento (opcional)</span><select name="storeId">' + storeOptions() + '</select></label><label class="field"><span>Notas</span><textarea name="notes" rows="2" placeholder="Detalles de esta compra"></textarea></label><button class="btn btn-primary btn-wide" type="submit">Crear lista ' + icon('arrow', 15) + '</button></form>';
  } else if (modalName === 'new-product') {
    title = 'Añadir producto al catálogo';
    body = '<form data-form="create-product"><label class="field"><span>Nombre del producto</span><input name="name" required maxlength="100" placeholder="Ej. Arroz integral"></label><div class="form-grid"><label class="field"><span>Categoría</span><input name="category" maxlength="50" placeholder="Alimentos"></label><label class="field"><span>Unidad habitual</span><input name="unit" maxlength="24" value="unidad"></label></div><button class="btn btn-primary btn-wide" type="submit">Guardar producto</button></form>';
  } else if (modalName === 'new-store') {
    title = 'Nuevo establecimiento';
    body = '<form data-form="create-store"><label class="field"><span>Nombre</span><input name="name" required maxlength="80" placeholder="Nombre del comercio"></label><label class="field"><span>Ubicación o sucursal (opcional)</span><input name="location" maxlength="100" placeholder="Zona o sucursal"></label><button class="btn btn-primary btn-wide" type="submit">Guardar establecimiento</button></form>';
  } else if (modalName === 'new-inventory') {
    title = 'Añadir al inventario';
    body = '<form data-form="create-inventory"><label class="field"><span>Producto</span><input name="name" required maxlength="100" placeholder="Ej. Detergente"></label><div class="form-grid"><label class="field"><span>Categoría</span><input name="category" maxlength="50" placeholder="Limpieza"></label><label class="field"><span>Unidad</span><input name="unit" maxlength="24" value="unidad"></label><label class="field"><span>Existencia inicial</span><input name="quantity" type="number" min="0" step="0.01" value="0" required></label><label class="field"><span>Mínimo de existencias</span><input name="minimum" type="number" min="0" step="0.01" value="1"></label></div><div class="form-grid"><label class="field"><span>Ubicación</span><input name="location" maxlength="60" placeholder="Despensa, baño..."></label><label class="field"><span>Fecha de vencimiento</span><input name="expiryDate" type="date"></label></div><button class="btn btn-primary btn-wide" type="submit">Guardar en inventario</button></form>';
  } else if (modalName === 'edit-budget') {
    title = 'Presupuesto mensual';
    body = '<form data-form="update-budget"><p class="modal-description">Define cuánto deseas destinar a tus compras y gastos durante ' + safe(monthLabel()) + '.</p><label class="field"><span>Presupuesto del mes</span><input name="amount" type="number" min="0" step="0.01" value="' + currentBudget(workspace) + '" required></label><button class="btn btn-primary btn-wide" type="submit">Guardar presupuesto</button></form>';
  } else if (modalName === 'new-expense') {
    title = 'Registrar gasto adicional';
    body = '<form data-form="create-expense"><label class="field"><span>Descripción</span><input name="title" required maxlength="90" placeholder="Ej. Gas doméstico"></label><div class="form-grid"><label class="field"><span>Importe</span><input name="amount" type="number" min="0.01" step="0.01" required placeholder="0.00"></label><label class="field"><span>Fecha</span><input name="date" type="date" value="' + today() + '"></label></div><label class="field"><span>Categoría</span><select name="category"><option>Hogar</option><option>Servicios</option><option>Transporte</option><option>Salud</option><option>Educación</option><option>Otros</option></select></label><label class="check-option"><input name="paid" type="checkbox" checked><span>Gasto pagado</span></label><label class="field"><span>Notas (opcional)</span><textarea name="notes" rows="2"></textarea></label><button class="btn btn-primary btn-wide" type="submit">Guardar gasto</button></form>';
  } else if (modalName === 'adjust-inventory') {
    const row = workspace.inventory.find(item => item.id === modalData.id);
    title = 'Ajustar existencias';
    body = row ? '<p class="modal-description">Producto: <strong>' + safe(row.name) + '</strong> · Existencia actual: <strong>' + safe(row.quantity) + ' ' + safe(row.unit) + '</strong></p><form data-form="inventory-adjust"><input type="hidden" name="id" value="' + row.id + '"><div class="form-grid"><label class="field"><span>Movimiento</span><select name="direction"><option value="in">Entrada</option><option value="out">Consumo o salida</option><option value="set">Ajuste exacto</option></select></label><label class="field"><span>Cantidad</span><input name="quantity" type="number" min="0.01" step="0.01" required value="1"></label></div><label class="field"><span>Motivo</span><input name="reason" maxlength="90" placeholder="Compra, consumo, corrección..."></label><button class="btn btn-primary btn-wide" type="submit">Aplicar movimiento</button></form>' : '<p>Producto no encontrado.</p>';
  }
  return '<div class="modal-backdrop" data-action="close-modal"><section class="modal-card" role="dialog" aria-modal="true" aria-label="' + safe(title) + '" data-modal-card><div class="modal-heading"><div><span class="eyebrow">MI COMPRA 2.0</span><h2>' + safe(title) + '</h2></div>' + close + '</div>' + body + '</section></div>';
}

function authScreen() {
  const isSignup = authMode === 'signup';
  return '<main class="auth-gate"><section class="auth-card"><div class="auth-brand"><span class="brand-mark">' + icon('leaf', 25) + '</span><span class="brand-name">mi<span>compra</span></span></div><p class="eyebrow">ACCESO SEGURO</p><h1>' + (isSignup ? 'Crear tu cuenta' : 'Bienvenido de nuevo') + '</h1><p class="auth-gate-copy">' + (isSignup ? 'Registra tu cuenta para guardar y sincronizar tus compras.' : 'Inicia sesión para acceder a tus listas, compras, inventario y finanzas.') + '</p><form data-form="auth"><label class="field"><span>Correo electrónico</span><input name="email" type="email" required autocomplete="email" placeholder="tu@correo.com"></label><label class="field"><span>Contraseña</span><input name="password" type="password" required minlength="8" autocomplete="' + (isSignup ? 'new-password' : 'current-password') + '" placeholder="Mínimo 8 caracteres"></label><button class="btn btn-primary btn-wide" type="submit">' + (isSignup ? 'Crear cuenta' : 'Iniciar sesión') + ' ' + icon('arrow', 15) + '</button></form><div class="auth-links">' + (!isSignup ? '<button data-action="forgot-password">¿Olvidaste tu contraseña?</button>' : '') + '<button data-action="switch-auth-mode">' + (isSignup ? 'Ya tengo una cuenta · Iniciar sesión' : '¿Primera vez? Crear una cuenta') + '</button></div><p class="auth-note">Acceso exclusivo a tu espacio personal. Tu sesión se mantendrá activa hasta que cierres sesión.</p></section><div id="modal-root">' + modalHtml() + '</div><div id="toast-region" aria-live="polite"></div></main>';
}

function render() {
  if (!root) return;
  if (!authReady) {
    root.innerHTML = '<main class="auth-gate"><section class="auth-card auth-loading"><span class="brand-name">mi<span>compra</span></span><p>Comprobando tu sesión segura…</p></section></main>';
    return;
  }
  if (store.isConfigured && !store.getUser()) {
    root.innerHTML = authScreen();
    return;
  }
  const page = viewContent();
  root.innerHTML = '<div class="app-shell">' + sidebar() + '<main class="main-workspace"><header class="topbar"><div class="topbar-title"><span class="eyebrow">MI COMPRA 2.0</span><strong>' + safe(pageTitle()) + '</strong></div><div class="topbar-actions">' + statusLabel() + '<button class="icon-button notification-button" data-action="navigate" data-view="actividad" aria-label="Actividad">' + icon('bell', 19) + (workspace.activity.length ? '<i></i>' : '') + '</button><button class="account-button" data-action="open-auth"><span class="account-mini-avatar">' + initials(store.getUser()?.email) + '</span><span>' + safe(store.getUser()?.email ? store.getUser().email.split('@')[0] : 'Mi cuenta') + '</span>' + icon('chevron', 14) + '</button></div></header><div class="page-container">' + page + '<footer class="app-footer"><span>Mi Compra 2.0</span><span>Planifica · Compra · Controla</span></footer></div></main>' + mobileNav() + '<div id="modal-root">' + modalHtml() + '</div><div id="toast-region" aria-live="polite"></div></div>';
}
function openModal(name, data = {}) { modalName = name; modalData = data; render(); }
function closeModal() { modalName = null; modalData = {}; render(); }
function findOrCreateProduct(name, unit, category = '') {
  const normalized = normalizeText(name);
  let product = workspace.products.find(row => normalizeText(row.name) === normalized);
  if (!product) {
    product = { id: createId('prd'), name: String(name).trim(), category, unit: unit || 'unidad', active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    workspace.products.unshift(product);
  }
  return product;
}
function saveExpense(data) {
  workspace.expenses.unshift({
    id: createId('exp'), title: data.title, category: data.category || 'Otros',
    amount: Number(data.amount), date: data.date || today(), paid: Boolean(data.paid),
    notes: data.notes || '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
  logActivity('Finanzas', 'Gasto registrado', 'Registraste ' + data.title + ' por ' + money(data.amount));
}
function downloadFile(name, content, type) {
  const blob = new Blob([content], { type: type || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
  URL.revokeObjectURL(url);
}
function exportCsv(name, rows) {
  if (!rows.length) { showToast('No hay datos para exportar.', 'info'); return; }
  const csv = rows.map(row => row.map(csvEscape).join(',')).join('\r\n');
  downloadFile(name, '\uFEFF' + csv, 'text/csv;charset=utf-8');
  showToast('Archivo CSV preparado.');
}
function exportPurchases() {
  const rows = [['Fecha', 'Establecimiento', 'Producto', 'Cantidad', 'Unidad', 'Precio unitario', 'Descuento', 'Total de línea', 'Total de compra', 'Pagada']];
  workspace.purchases.forEach(purchase => purchase.items.forEach(item => rows.push([
    purchase.date, purchase.storeName, item.name, item.quantity, item.unit, item.unitPrice, item.discount,
    Math.max(0, Number(item.quantity) * Number(item.unitPrice) - Number(item.discount)), purchase.total, purchase.paid ? 'Sí' : 'No'
  ])));
  exportCsv('mi-compra-compras.csv', rows);
}
function exportInventory() {
  exportCsv('mi-compra-inventario.csv', [
    ['Producto', 'Categoría', 'Existencia', 'Unidad', 'Mínimo', 'Ubicación', 'Vencimiento'],
    ...workspace.inventory.map(row => [row.name, row.category, row.quantity, row.unit, row.minimum, row.location, row.expiryDate])
  ]);
}
function exportFinance() {
  exportCsv('mi-compra-finanzas.csv', [
    ['Tipo', 'Fecha', 'Descripción', 'Categoría', 'Importe', 'Estado'],
    ...workspace.purchases.map(row => ['Compra', row.date, row.storeName, 'Compra', row.total, row.paid ? 'Pagada' : 'Pendiente']),
    ...workspace.expenses.map(row => ['Gasto adicional', row.date, row.title, row.category, row.amount, row.paid ? 'Pagado' : 'Pendiente']),
    ...workspace.budgets.map(row => ['Presupuesto', row.month, 'Presupuesto mensual', '', row.amount, 'Configurado'])
  ]);
}
function backupWorkspace() {
  downloadFile('mi-compra-2-respaldo-' + today() + '.json', JSON.stringify({
    app: 'Mi Compra 2.0',
    version: 2,
    exportedAt: new Date().toISOString(),
    workspace
  }, null, 2), 'application/json;charset=utf-8');
  showToast('Copia de seguridad descargada.');
}
function handleAction(action, target) {
  const id = target.dataset.id;
  if (action === 'navigate') { currentView = target.dataset.view || 'inicio'; selectedListId = null; searchValue = ''; render(); if (currentView === 'configuracion') void refreshAccessUsers(); }
  else if (action === 'open-auth') openModal('auth');
  else if (action === 'close-modal') closeModal();
  else if (action === 'open-reset') openModal('reset-workspace');
  else if (action === 'refresh-access-users') { void refreshAccessUsers(); }
  else if (action === 'revoke-access-user') {
    if (!store.isWorkspaceOwner()) { showToast('Solo el propietario puede revocar accesos.', 'info'); return; }
    const member = accessUsers.find(row => row.uid === id);
    if (!member || !window.confirm('¿Revocar el acceso de ' + (member.email || 'este usuario') + '? Ya no podrá entrar a este espacio ni ver sus datos.')) return;
    store.revokeAccessUser(id).then(result => { accessUsers = accessUsers.filter(row => row.uid !== id); render(); showToast('Acceso revocado para ' + result.email + '.'); }).catch(error => showToast(error.message || 'No se pudo revocar el acceso.', 'info'));
  }
  else if (action === 'new-access-user') {
    if (!store.isWorkspaceOwner()) showToast('Solo la cuenta propietaria puede enviar invitaciones.', 'info');
    else openModal('access-user');
  }
  else if (action === 'new-list') openModal('new-list');
  else if (action === 'new-product') openModal('new-product');
  else if (action === 'new-store') openModal('new-store');
  else if (action === 'new-inventory') openModal('new-inventory');
  else if (action === 'new-expense') openModal('new-expense');
  else if (action === 'edit-budget') openModal('edit-budget');
  else if (action === 'adjust-inventory') openModal('adjust-inventory', { id });
  else if (action === 'open-list') { selectedListId = id; currentView = 'planificar'; render(); }
  else if (action === 'back-lists') { selectedListId = null; render(); }
  else if (action === 'toggle-list-item') {
    const list = workspace.lists.find(row => row.id === selectedListId);
    const item = list?.items.find(row => row.id === id);
    if (item) { item.checked = !item.checked; item.updatedAt = new Date().toISOString(); list.updatedAt = new Date().toISOString(); logActivity('Planificar', item.checked ? 'Producto completado' : 'Producto reabierto', item.name + ' · ' + list.name); persist(item.checked ? 'Producto marcado como comprado.' : 'Producto reabierto.'); }
  } else if (action === 'remove-list-item') {
    const list = workspace.lists.find(row => row.id === selectedListId);
    if (list) { list.items = list.items.filter(row => row.id !== id); list.updatedAt = new Date().toISOString(); logActivity('Planificar', 'Producto eliminado', 'Quitaste un producto de ' + list.name); persist('Producto eliminado de la lista.'); }
  } else if (action === 'complete-list' || action === 'reopen-list') {
    const list = workspace.lists.find(row => row.id === selectedListId);
    if (list) { list.status = action === 'complete-list' ? 'completed' : 'open'; list.updatedAt = new Date().toISOString(); logActivity('Planificar', action === 'complete-list' ? 'Lista completada' : 'Lista reabierta', list.name); persist(action === 'complete-list' ? 'Lista completada.' : 'Lista reabierta.'); }
  } else if (action === 'duplicate-list') {
    const list = workspace.lists.find(row => row.id === selectedListId);
    if (list) {
      const copy = { ...list, id: createId('lst'), name: list.name + ' (copia)', status: 'open', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), items: list.items.map(row => ({ ...row, id: createId('itm'), checked: false })) };
      workspace.lists.unshift(copy); selectedListId = copy.id; logActivity('Planificar', 'Lista duplicada', copy.name); persist('Lista duplicada.'); 
    }
  } else if (action === 'make-purchase') {
    const list = workspace.lists.find(row => row.id === selectedListId);
    if (list) {
      purchaseDraft = list.items.map(item => ({ name: item.name, quantity: Number(item.quantity) || 1, unit: item.unit || 'unidad', unitPrice: Number(item.estimatedPrice) || 0, discount: 0 }));
      currentView = 'comprar';
      render();
      showToast('Lista preparada. Revisa y completa los precios reales.');
    }
  } else if (action === 'draft-qty-plus' || action === 'draft-qty-minus') {
    const item = purchaseDraft[Number(target.dataset.index)];
    if (item) { item.quantity = Math.max(0.01, Math.round((Number(item.quantity || 1) + (action === 'draft-qty-plus' ? 1 : -1)) * 100) / 100); render(); }
  } else if (action === 'remove-draft-line') {
    purchaseDraft.splice(Number(target.dataset.index), 1); render();
  } else if (action === 'confirm-purchase') confirmPurchase();
  else if (action === 'stock-in' || action === 'stock-out') {
    const row = workspace.inventory.find(item => item.id === id);
    if (row) {
      const delta = action === 'stock-in' ? 1 : -1;
      const next = Number(row.quantity || 0) + delta;
      if (next < 0) { showToast('No puedes dejar existencias negativas.', 'info'); return; }
      row.quantity = next; row.updatedAt = new Date().toISOString();
      workspace.movements.unshift({ id: createId('mov'), inventoryId: row.id, productName: row.name, type: delta > 0 ? 'entrada' : 'consumo', quantity: 1, reason: delta > 0 ? 'Entrada manual' : 'Consumo doméstico', createdAt: new Date().toISOString() });
      logActivity('Inventario', delta > 0 ? 'Entrada registrada' : 'Consumo registrado', row.name + ' · ' + (delta > 0 ? '+1' : '-1') + ' ' + row.unit);
      persist(delta > 0 ? 'Existencia actualizada.' : 'Consumo registrado.');
    }
  } else if (action === 'delete-expense') {
    const row = workspace.expenses.find(item => item.id === id);
    if (row && window.confirm('¿Eliminar el gasto "' + row.title + '"? Esta acción se registrará en el historial.')) {
      workspace.expenses = workspace.expenses.filter(item => item.id !== id);
      logActivity('Finanzas', 'Gasto eliminado', row.title + ' · ' + money(row.amount));
      persist('Gasto eliminado.');
    }
  } else if (action === 'deactivate-product') {
    const row = workspace.products.find(item => item.id === id);
    if (row) {
      row.active = false; row.updatedAt = new Date().toISOString();
      logActivity('Catálogo', 'Producto desactivado', row.name);
      persist('Producto retirado del catálogo. El historial se conserva.');
    }
  } else if (action === 'delete-store') {
    const row = workspace.stores.find(item => item.id === id);
    if (row && window.confirm('¿Retirar "' + row.name + '" de tus establecimientos? El historial de compras se conserva.')) {
      workspace.stores = workspace.stores.filter(item => item.id !== id);
      logActivity('Establecimientos', 'Establecimiento eliminado', row.name);
      persist('Establecimiento retirado.');
    }
  } else if (action === 'export-purchases') exportPurchases();
  else if (action === 'export-inventory') exportInventory();
  else if (action === 'export-finance') exportFinance();
  else if (action === 'download-backup') backupWorkspace();
  else if (action === 'switch-auth-mode') { authMode = authMode === 'signup' ? 'signin' : 'signup'; render(); }
  else if (action === 'forgot-password') openModal('password-reset');
  else if (action === 'sign-out') {
    store.signOut().then(() => { closeModal(); showToast('Sesión cerrada. Los datos locales se conservan.'); }).catch(error => showToast(error.message, 'info'));
  }
}
function confirmPurchase() {
  if (!purchaseDraft.length) { showToast('Añade al menos un producto a la compra.', 'info'); return; }
  const storeId = document.querySelector('[name="storeId"]')?.value || '';
  const store = workspace.stores.find(row => row.id === storeId);
  const date = document.querySelector('#purchase-date')?.value || today();
  const paid = Boolean(document.querySelector('#purchase-paid')?.checked);
  const addInventory = Boolean(document.querySelector('#purchase-to-inventory')?.checked);
  const items = purchaseDraft.map(item => ({
    id: createId('pit'), name: item.name, quantity: Number(item.quantity), unit: item.unit,
    unitPrice: Number(item.unitPrice), discount: Number(item.discount) || 0
  }));
  const total = computePurchaseTotal(items);
  const purchase = {
    id: createId('buy'), date, storeId, storeName: store?.name || 'Compra sin establecimiento',
    items, total, paid, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  workspace.purchases.unshift(purchase);
  if (addInventory) {
    items.forEach(item => {
      const product = findOrCreateProduct(item.name, item.unit);
      let row = workspace.inventory.find(entry => normalizeText(entry.name) === normalizeText(item.name));
      if (!row) {
        row = { id: createId('inv'), productId: product.id, name: item.name, category: product.category || '', quantity: 0, unit: item.unit, minimum: 1, location: '', expiryDate: '', createdAt: new Date().toISOString() };
        workspace.inventory.unshift(row);
      }
      row.quantity = Math.round((Number(row.quantity || 0) + item.quantity) * 100) / 100;
      row.updatedAt = new Date().toISOString();
      workspace.movements.unshift({ id: createId('mov'), inventoryId: row.id, productName: row.name, type: 'entrada', quantity: item.quantity, reason: 'Compra ' + purchase.id, createdAt: new Date().toISOString() });
    });
  }
  logActivity('Comprar', 'Compra confirmada', purchase.storeName + ' · ' + money(total));
  purchaseDraft = [];
  persist('Compra guardada correctamente.');
}
function handleSubmit(event) {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  const action = form.dataset.form;
  if (action === 'auth') {
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    const promise = authMode === 'signup' ? store.signUp(data.email, data.password) : store.signIn(data.email, data.password);
    promise.then(result => {
      currentView = 'inicio';
      selectedListId = null;
      closeModal();
      if (authMode === 'signup' && !result.session) showToast('Cuenta creada. Revisa tu correo para confirmar el acceso.');
      else showToast('Sesión iniciada. Tus datos se están sincronizando.');
    }).catch(error => {
      if (button) button.disabled = false;
      showToast(error.message || 'No se pudo completar el acceso.', 'info');
    });
  } else if (action === 'access-user') {
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    store.createAccessUser(data.email).then(result => {
      closeModal();
      showToast('Invitación enviada a ' + result.email + '. La persona podrá crear su contraseña desde el correo.');
      void refreshAccessUsers();
    }).catch(error => {
      if (button) button.disabled = false;
      showToast(error.message || 'No se pudo crear el usuario.', 'info');
    });
  } else if (action === 'reset-workspace') {
    if (!store.isWorkspaceOwner()) { showToast('Solo el propietario puede borrar los datos compartidos.', 'info'); return; }
    if (String(data.confirmation || '').trim() !== 'RESTABLECER') {
      showToast('Escribe RESTABLECER exactamente para confirmar.', 'info');
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    store.resetWorkspace().then(() => {
      selectedListId = null;
      purchaseDraft = [];
      searchValue = '';
      currentView = 'inicio';
      closeModal();
      showToast('Aplicación restablecida. Todos los datos fueron borrados.');
    }).catch(error => {
      if (button) button.disabled = false;
      showToast('No se pudo completar el borrado: ' + (error.message || 'error de sincronización'), 'info');
    });
  } else if (action === 'password-reset') {
    store.resetPassword(data.email).then(() => { closeModal(); showToast('Enlace de recuperación enviado.'); }).catch(error => showToast(error.message, 'info'));
  } else if (action === 'create-list') {
    const selectedStore = workspace.stores.find(row => row.id === data.storeId);
    const list = {
      id: createId('lst'), name: data.name.trim(), plannedDate: data.plannedDate || '',
      budget: Math.max(0, Number(data.budget) || 0), storeId: data.storeId || '',
      storeName: selectedStore?.name || '', notes: data.notes || '', status: 'open', items: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    workspace.lists.unshift(list); selectedListId = list.id; currentView = 'planificar';
    logActivity('Planificar', 'Lista creada', list.name); closeModal(); persist('Lista creada. Añade los productos que necesitas.');
  } else if (action === 'list-item') {
    const list = workspace.lists.find(row => row.id === selectedListId);
    if (!list) return;
    const product = findOrCreateProduct(data.name, data.unit);
    list.items.push({
      id: createId('itm'), productId: product.id, name: data.name.trim(),
      quantity: Math.max(0.01, Number(data.quantity) || 1), unit: data.unit || 'unidad',
      estimatedPrice: 0, priority: 'normal', checked: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
    list.updatedAt = new Date().toISOString();
    logActivity('Planificar', 'Producto añadido', data.name + ' · ' + list.name);
    persist('Producto añadido a la lista.');
  } else if (action === 'create-product') {
    const exists = workspace.products.find(row => normalizeText(row.name) === normalizeText(data.name));
    if (exists) { showToast('Ese producto ya existe en el catálogo.', 'info'); return; }
    workspace.products.unshift({ id: createId('prd'), name: data.name.trim(), category: data.category || '', unit: data.unit || 'unidad', active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    logActivity('Catálogo', 'Producto creado', data.name);
    closeModal(); persist('Producto añadido al catálogo.');
  } else if (action === 'create-store') {
    if (workspace.stores.some(row => normalizeText(row.name) === normalizeText(data.name))) { showToast('Ese establecimiento ya está registrado.', 'info'); return; }
    workspace.stores.unshift({ id: createId('str'), name: data.name.trim(), location: data.location || '', active: true, createdAt: new Date().toISOString() });
    logActivity('Establecimientos', 'Establecimiento creado', data.name);
    closeModal(); persist('Establecimiento guardado.');
  } else if (action === 'create-inventory') {
    const product = findOrCreateProduct(data.name, data.unit, data.category || '');
    let row = workspace.inventory.find(item => normalizeText(item.name) === normalizeText(data.name));
    if (row) {
      row.quantity = Math.round((Number(row.quantity) + Number(data.quantity)) * 100) / 100;
      row.minimum = Number(data.minimum) || row.minimum || 0;
      row.updatedAt = new Date().toISOString();
    } else {
      row = { id: createId('inv'), productId: product.id, name: data.name.trim(), category: data.category || '', quantity: Number(data.quantity) || 0, unit: data.unit || 'unidad', minimum: Number(data.minimum) || 0, location: data.location || '', expiryDate: data.expiryDate || '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      workspace.inventory.unshift(row);
    }
    if (Number(data.quantity) > 0) workspace.movements.unshift({ id: createId('mov'), inventoryId: row.id, productName: row.name, type: 'entrada', quantity: Number(data.quantity), reason: 'Existencia inicial', createdAt: new Date().toISOString() });
    logActivity('Inventario', 'Producto registrado', row.name + ' · ' + row.quantity + ' ' + row.unit);
    closeModal(); persist('Producto añadido al inventario.');
  } else if (action === 'inventory-adjust') {
    const row = workspace.inventory.find(item => item.id === data.id);
    const quantity = Number(data.quantity);
    if (!row || !Number.isFinite(quantity) || quantity <= 0) { showToast('Revisa la cantidad indicada.', 'info'); return; }
    const direction = data.direction;
    let next = direction === 'in' ? Number(row.quantity) + quantity : direction === 'out' ? Number(row.quantity) - quantity : quantity;
    if (next < 0) { showToast('El movimiento supera las existencias disponibles.', 'info'); return; }
    const delta = next - Number(row.quantity);
    row.quantity = Math.round(next * 100) / 100; row.updatedAt = new Date().toISOString();
    workspace.movements.unshift({ id: createId('mov'), inventoryId: row.id, productName: row.name, type: delta >= 0 ? 'entrada' : 'salida', quantity: Math.abs(delta), reason: data.reason || 'Ajuste manual', createdAt: new Date().toISOString() });
    logActivity('Inventario', 'Existencias ajustadas', row.name + ' · ' + row.quantity + ' ' + row.unit);
    closeModal(); persist('Movimiento de inventario aplicado.');
  } else if (action === 'update-budget') {
    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount < 0) { showToast('Indica un presupuesto válido.', 'info'); return; }
    const month = monthKey();
    const existing = workspace.budgets.find(row => row.month === month);
    if (existing) { existing.amount = amount; existing.updatedAt = new Date().toISOString(); }
    else workspace.budgets.unshift({ id: month, month, amount, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    logActivity('Finanzas', 'Presupuesto actualizado', money(amount) + ' · ' + monthLabel(month));
    closeModal(); persist('Presupuesto mensual guardado.');
  } else if (action === 'create-expense') {
    if (!Number.isFinite(Number(data.amount)) || Number(data.amount) <= 0) { showToast('El importe debe ser mayor que cero.', 'info'); return; }
    saveExpense({ ...data, paid: form.querySelector('[name="paid"]').checked });
    closeModal(); persist('Gasto guardado.');
  } else if (action === 'purchase-line') {
    const quantity = Number(data.quantity), unitPrice = Number(data.unitPrice), discount = Number(data.discount) || 0;
    if (!data.name.trim() || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0 || discount < 0 || discount > quantity * unitPrice) {
      showToast('Revisa el producto, cantidad, precio y descuento.', 'info'); return;
    }
    purchaseDraft.push({ name: data.name.trim(), quantity, unit: data.unit || 'unidad', unitPrice, discount });
    render();
    showToast('Producto añadido a la compra.');
  } else if (action === 'currency') {
    workspace.profile.currency = data.currency;
    logActivity('Configuración', 'Moneda actualizada', 'Moneda: ' + data.currency);
    persist('Preferencia de moneda guardada.');
  }
}
const store = createWorkspaceStore({
  onChange: next => { workspace = normalizeWorkspace(next); render(); },
  onStatus: () => render()
});

root.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  if (target.dataset.action === 'close-modal' && target.classList.contains('modal-backdrop') && event.target.closest('[data-modal-card]')) return;
  handleAction(target.dataset.action, target);
});
root.addEventListener('submit', handleSubmit);
root.addEventListener('input', event => {
  if (event.target.matches('[data-draft-price], [data-draft-qty]')) {
    const isPrice = event.target.matches('[data-draft-price]');
    const index = Number(isPrice ? event.target.dataset.draftPrice : event.target.dataset.draftQty);
    const item = purchaseDraft[index];
    if (item) {
      if (isPrice) item.unitPrice = Math.max(0, Number(event.target.value) || 0);
      else item.quantity = Math.max(0.01, Number(event.target.value) || 0.01);
      const lineTotal = document.querySelector('[data-line-total="' + index + '"]');
      if (lineTotal) lineTotal.textContent = money(Math.max(0, item.quantity * item.unitPrice - (Number(item.discount) || 0)));
      const total = document.getElementById('purchase-draft-total');
      if (total) total.textContent = money(computePurchaseTotal(purchaseDraft));
    }
    return;
  }
  const id = event.target.id;
  if (['inventory-search', 'catalog-search', 'activity-search'].includes(id)) {
    const position = event.target.selectionStart;
    searchValue = event.target.value;
    const active = id;
    const page = currentView;
    render();
    const replacement = document.getElementById(active);
    if (replacement) { replacement.focus(); replacement.setSelectionRange(position, position); }
  }
});
root.addEventListener('change', event => {
  if (event.target.id === 'restore-file' && event.target.files?.[0]) {
    const file = event.target.files[0];
    file.text().then(text => {
      const parsed = JSON.parse(text);
      if (!parsed || parsed.app !== 'Mi Compra 2.0' || !parsed.workspace || typeof parsed.workspace !== 'object') {
        throw new Error('El archivo no corresponde a una copia válida de Mi Compra 2.0.');
      }
      if (!store.isWorkspaceOwner()) throw new Error('Solo la cuenta propietaria puede restaurar copias de seguridad.');
      if (!window.confirm('¿Restaurar esta copia? Los datos actuales se combinarán con la copia y no se eliminarán registros coincidentes más recientes.')) return;
      store.restoreBackup(parsed);
      showToast('Copia restaurada y combinada con los datos actuales.');
    }).catch(error => showToast('No se pudo leer el respaldo: ' + error.message, 'info'))
      .finally(() => { event.target.value = ''; });
  }
});
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && modalName) closeModal();
});
window.addEventListener('beforeunload', () => store.dispose());

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(error => console.warn('PWA service worker:', error)));
render();
store.initialize().then(result => {
  workspace = normalizeWorkspace(result.workspace);
  authReady = true;
  render();
}).catch(error => {
  console.error(error);
  authReady = true;
  render();
  showToast('No se pudo comprobar la sesión. Intenta iniciar sesión de nuevo.', 'info');
});
