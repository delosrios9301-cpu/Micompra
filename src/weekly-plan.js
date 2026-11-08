const money = value => new Intl.NumberFormat('es-PA', { style: 'currency', currency: 'USD' }).format(Number(value) || 0);
const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();


function localDateKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function getShoppingReminders(items = [], today = new Date(), daysAhead = 7) {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const todayKey = localDateKey(start);
  const end = new Date(start);
  end.setDate(end.getDate() + Math.max(0, Math.min(31, Number(daysAhead) || 0)));
  const endKey = localDateKey(end);
  const pending = sortShoppingItemsByPriority((items || []).filter(item => !item.checked && item.planned_for));
  const overdue = pending.filter(item => item.planned_for < todayKey);
  const dates = [...new Set(pending.filter(item => item.planned_for >= todayKey && item.planned_for <= endKey).map(item => item.planned_for))].sort();
  const upcoming = dates.map(date => {
    const [year, month, day] = date.split('-').map(Number);
    const parsed = new Date(year, month - 1, day);
    const offset = Math.round((parsed - start) / 86400000);
    const label = offset === 0 ? 'Hoy' : offset === 1 ? 'Mañana' : new Intl.DateTimeFormat('es-PA', { weekday: 'long' }).format(parsed);
    return { date, label, dateLabel: new Intl.DateTimeFormat('es-PA', { day: 'numeric', month: 'short' }).format(parsed), items: sortShoppingItemsByPriority(pending.filter(item => item.planned_for === date)) };
  });
  return { overdue, upcoming, total: overdue.length + upcoming.reduce((sum, group) => sum + group.items.length, 0) };
}

export function getWeeklyRange(today = new Date()) {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const key = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { start: key(start), end: key(end) };
}

export function getCalendarWeek(today = new Date(), offset = 0) {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + (Number(offset) || 0) * 7);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    return { date: key, day: new Intl.DateTimeFormat('es-PA', { weekday: 'short' }).format(date), label: new Intl.DateTimeFormat('es-PA', { day: 'numeric', month: 'short' }).format(date) };
  });
}

export function sortShoppingItemsByPriority(items = []) {
  const rank = { urgent: 0, normal: 1, low: 2 };
  return [...(items || [])].sort((a, b) => {
    if (Boolean(a.checked) !== Boolean(b.checked)) return Number(Boolean(a.checked)) - Number(Boolean(b.checked));
    return (rank[a.priority] ?? rank.normal) - (rank[b.priority] ?? rank.normal);
  });
}

export function groupShoppingItemsByDate(items = [], days = []) {
  return days.map(day => ({ ...day, items: sortShoppingItemsByPriority((items || []).filter(item => item.planned_for === day.date)) }));
}

export function summarizeWeeklyPlan(items = [], pantryItems = [], today = new Date()) {
  const pending = (items || []).filter(item => !item.checked);
  const completed = (items || []).filter(item => item.checked);
  const lowStock = (pantryItems || []).filter(item => {
    const quantity = Number(item.quantity) || 0;
    const minimum = Number(item.minimum_quantity) || 0;
    return quantity <= minimum && (minimum > 0 || quantity === 0);
  });
  const linked = pending.filter(item => item.product_id);
  const unlinked = pending.length - linked.length;
  return { ...getWeeklyRange(today), pending, completed, linked, unlinked, lowStock };
}

export function compareWeeklyPlanPrices(items = [], listings = [], selectedBranchId = '') {
  const linked = (items || []).filter(item => !item.checked && item.product_id);
  if (!linked.length) return { total: null, store: null, complete: false, covered: 0, count: 0 };
  const stores = new Map();
  for (const listing of listings || []) {
    const storeName = listing.supermarkets?.name;
    const branchName = listing.supermarket_branches?.name;
    if (!storeName || (storeName === 'Super 99' && selectedBranchId && listing.branch_id !== selectedBranchId)) continue;
    const valid = (listing.price_observations || []).filter(price =>
      price.is_verified && price.review_status === 'approved' && price.currency === 'USD' &&
      Number(price.price) > 0 && Date.now() - new Date(price.observed_at).getTime() <= 86400000 &&
      Date.now() >= new Date(price.observed_at).getTime()
    );
    if (!valid.length) continue;
    const price = Math.min(...valid.map(row => Number(row.price)));
    const key = branchName ? storeName + ' · ' + branchName : storeName;
    if (!stores.has(key)) stores.set(key, new Map());
    const prices = stores.get(key);
    if (!prices.has(listing.product_id) || price < prices.get(listing.product_id)) prices.set(listing.product_id, price);
  }
  const totals = [...stores.entries()].map(([store, prices]) => {
    let total = 0, covered = 0;
    for (const item of linked) {
      const price = prices.get(item.product_id);
      if (price !== undefined) { total += Number(item.quantity) * price; covered += 1; }
    }
    return { store, total, covered, complete: covered === linked.length };
  }).filter(row => row.complete).sort((a, b) => a.total - b.total);
  const best = totals[0] || null;
  return { total: best?.total ?? null, store: best?.store ?? null, complete: Boolean(best), covered: best?.covered ?? 0, count: linked.length };
}

export async function renderWeeklyPlan({ container, supabase, user, items = [], selectedBranchId = '' }) {
  if (!container || !supabase || !user) return;
  container.querySelector('.weekly-plan')?.remove();
  const section = document.createElement('section');
  section.className = 'weekly-plan';
  section.innerHTML = '<div class="weekly-plan-heading"><div><p class="eyebrow">ORGANIZACIÓN DEL HOGAR</p><h3>Mi plan de compras semanal</h3><small>Plan orientativo de lunes a domingo, basado en tu lista y tu despensa.</small></div><button type="button" class="weekly-plan-refresh">Actualizar</button></div><div class="shopping-reminders" id="shopping-reminders" aria-live="polite"></div><div class="weekly-plan-range" id="weekly-plan-range">Calculando semana…</div><div class="shopping-calendar"><div class="shopping-calendar-heading"><div><h4>Calendario de compras</h4><small>Asigna una fecha a cada artículo desde tu lista.</small></div><div class="shopping-calendar-nav"><button type="button" class="calendar-prev" aria-label="Semana anterior">‹</button><button type="button" class="calendar-next" aria-label="Semana siguiente">›</button></div></div><div class="shopping-calendar-grid" id="shopping-calendar-grid"></div><p class="shopping-calendar-unassigned" id="shopping-calendar-unassigned"></p></div><div class="weekly-plan-kpis"><article><small>Por comprar</small><b id="weekly-plan-pending">—</b></article><article><small>Ya marcados</small><b id="weekly-plan-done">—</b></article><article><small>Por reponer en casa</small><b id="weekly-plan-low">—</b></article></div><div class="weekly-plan-cost" id="weekly-plan-cost"><small>Presupuesto de la lista pendiente</small><b>Calculando precios actuales…</b></div><div class="weekly-plan-budget" id="weekly-plan-budget">Consultando presupuesto mensual…</div><p class="weekly-plan-note">Este plan no crea compras ni descuenta existencias. Los precios son estimaciones basadas únicamente en observaciones aprobadas de las últimas 24 horas.</p>';
  container.appendChild(section);
  const $ = selector => section.querySelector(selector);
  let weekOffset = 0;
  const renderReminders = () => {
    const reminders = getShoppingReminders(items, new Date(), 7);
    const overdue = reminders.overdue.length
      ? '<div class="shopping-reminder-overdue"><strong>Compras pendientes con fecha anterior</strong><ul>' + reminders.overdue.map(item => '<li>' + safe(item.item_name) + ' <small>· ' + safe(item.planned_for) + '</small></li>').join('') + '</ul></div>'
      : '';
    const upcoming = reminders.upcoming.length
      ? '<div class="shopping-reminder-groups">' + reminders.upcoming.map(group => '<article class="shopping-reminder-group"><div><strong>' + safe(group.label) + '</strong><small>' + safe(group.dateLabel) + '</small></div><ul>' + group.items.map(item => '<li>' + safe(item.item_name) + ' <small>× ' + safe(item.quantity) + ' ' + safe(item.unit || 'unidades') + '</small></li>').join('') + '</ul></article>').join('') + '</div>'
      : '';
    $('#shopping-reminders').innerHTML = '<div class="shopping-reminders-heading"><div><h4>Recordatorios de compras</h4><small>Artículos pendientes programados para hoy y los próximos 7 días.</small></div><span>' + reminders.total + '</span></div>' + (overdue || upcoming ? overdue + upcoming : '<p class="shopping-reminders-empty">No tienes compras pendientes programadas para los próximos 7 días.</p>');
  };
  renderReminders();
  const renderCalendar = () => {
    const days = getCalendarWeek(new Date(), weekOffset);
    const grouped = groupShoppingItemsByDate(items, days);
    $('#weekly-plan-range').textContent = `Semana del ${days[0].label} al ${days[6].label}`;
    $('#shopping-calendar-grid').innerHTML = grouped.map(day => `<article class="shopping-calendar-day"><div class="shopping-calendar-day-title"><strong>${safe(day.day)}</strong><small>${safe(day.label)}</small></div>${day.items.length ? '<ul>' + day.items.map(item => `<li class="${item.checked ? 'is-done' : ''}">${safe(item.item_name)} <small>× ${safe(item.quantity)} ${safe(item.unit || 'unidades')}</small></li>`).join('') + '</ul>' : '<p>Sin compras</p>'}</article>`).join('');
    const visibleDates = new Set(days.map(day => day.date));
    const unassigned = items.filter(item => !item.planned_for || !visibleDates.has(item.planned_for));
    $('#shopping-calendar-unassigned').textContent = unassigned.length ? `${unassigned.length} artículo(s) sin fecha asignada o programados fuera de esta semana. Usa el selector de fecha junto a cada producto en tu lista.` : 'Todos los artículos de la lista están programados para esta semana.';
  };
  $('.calendar-prev').addEventListener('click', () => { weekOffset -= 1; renderCalendar(); });
  $('.calendar-next').addEventListener('click', () => { weekOffset += 1; renderCalendar(); });
  renderCalendar();
  const refresh = async () => {
    $('.weekly-plan-refresh').disabled = true;
    const [pantryResult, priceResult, budgetResult, purchaseResult] = await Promise.all([
      supabase.from('personal_pantry_items').select('item_name,quantity,minimum_quantity,unit').eq('user_id', user.id).limit(1000),
      (() => {
        const ids = [...new Set(items.filter(item => !item.checked && item.product_id).map(item => item.product_id))];
        if (!ids.length) return Promise.resolve({ data: [], error: null });
        const cutoff = new Date(Date.now() - 86400000).toISOString();
        return supabase.from('store_products').select('product_id,branch_id,supermarkets(name),supermarket_branches(name),price_observations(price,currency,observed_at,is_verified,review_status)').in('product_id', ids).gte('price_observations.observed_at', cutoff).limit(300);
      })(),
      supabase.from('personal_budget_settings').select('monthly_budget').eq('user_id', user.id).maybeSingle(),
      supabase.from('purchase_records').select('purchase_date,purchase_items(line_total,quantity,unit_price)').eq('user_id', user.id).order('purchase_date', { ascending: false }).limit(1000)
    ]);
    const now = new Date();
    const summary = summarizeWeeklyPlan(items, pantryResult.error ? [] : pantryResult.data || [], now);
    renderCalendar();
    $('#weekly-plan-pending').textContent = summary.pending.length;
    $('#weekly-plan-done').textContent = summary.completed.length;
    $('#weekly-plan-low').textContent = summary.lowStock.length;
    if (pantryResult.error) $('#weekly-plan-low').textContent = '—';
    const comparison = compareWeeklyPlanPrices(summary.pending, priceResult.error ? [] : priceResult.data || [], selectedBranchId);
    $('#weekly-plan-cost').innerHTML = comparison.complete
      ? `<small>Menor total completo en una sola tienda</small><b>${money(comparison.total)}</b><span>${safe(comparison.store)} · ${comparison.covered} de ${comparison.count} productos vinculados</span>`
      : `<small>Presupuesto de la lista pendiente</small><b>No disponible todavía</b><span>${summary.linked.length ? 'Solo hay precios parciales o no hay precios aprobados y vigentes para todos los productos vinculados.' : 'Vincula los artículos de tu lista con el catálogo para calcular un total.'}</span>`;
    const budget = Number(budgetResult.data?.monthly_budget) || 0;
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const spent = (purchaseResult.data || []).filter(row => String(row.purchase_date || '').startsWith(monthKey)).reduce((sum, row) =>
      sum + (row.purchase_items || []).reduce((subtotal, item) => {
        const amount = Number(item.line_total ?? (Number(item.quantity) * Number(item.unit_price)));
        return subtotal + (Number.isFinite(amount) && amount > 0 ? amount : 0);
      }, 0), 0);
    if (budgetResult.error || purchaseResult.error) {
      $('#weekly-plan-budget').textContent = 'No se pudo consultar el margen del presupuesto mensual.';
    } else if (!budget) {
      $('#weekly-plan-budget').textContent = 'Aún no has definido un presupuesto mensual. Puedes configurarlo en “Mis gastos”.';
    } else {
      const remaining = budget - spent;
      $('#weekly-plan-budget').innerHTML = `Presupuesto mensual restante: <strong>${money(remaining)}</strong> <small>(${money(spent)} gastados de ${money(budget)} registrados este mes)</small>`;
    }
    $('.weekly-plan-refresh').disabled = false;
  };
  $('.weekly-plan-refresh').addEventListener('click', refresh);
  await refresh();
}
