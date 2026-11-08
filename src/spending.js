const money = value => new Intl.NumberFormat('es-PA', { style: 'currency', currency: 'USD' }).format(Number(value) || 0);
const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getMondayDateKey(date = new Date()) {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return localDateKey(day);
}

export function summarizeSpending(purchases, today = new Date()) {
  const todayKey = localDateKey(today);
  const monthKey = todayKey.slice(0, 7);
  const weekStart = getMondayDateKey(today);
  const items = (purchases || []).flatMap(purchase => (purchase.purchase_items || []).map(item => {
    const amount = Number(item.line_total ?? (Number(item.quantity) * Number(item.unit_price)));
    return {
      name: item.item_name || 'Producto sin nombre',
      category: item.products?.category || 'Sin categoría',
      date: purchase.purchase_date,
      amount: Number.isFinite(amount) && amount > 0 ? amount : 0
    };
  }));
  const week = items.filter(item => item.date >= weekStart && item.date <= todayKey).reduce((sum, item) => sum + item.amount, 0);
  const monthItems = items.filter(item => String(item.date || '').startsWith(monthKey));
  const month = monthItems.reduce((sum, item) => sum + item.amount, 0);
  const products = new Map();
  const categories = new Map();
  for (const item of monthItems) {
    products.set(item.name, (products.get(item.name) || 0) + item.amount);
    categories.set(item.category, (categories.get(item.category) || 0) + item.amount);
  }
  const rank = map => [...map.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
  return { week, month, monthItems: monthItems.length, totalItems: items.length, topProducts: rank(products).slice(0, 6), categories: rank(categories).slice(0, 6) };
}

export function getBudgetThresholdsReached(monthSpend, monthlyBudget) {
  const spend = Number(monthSpend) || 0;
  const budget = Number(monthlyBudget) || 0;
  if (budget <= 0) return [];
  return [75, 90, 100].filter(threshold => spend >= budget * threshold / 100);
}

export function summarizeMonthlySpending(purchases, today = new Date(), monthCount = 6) {
  const count = Math.max(1, Math.min(24, Math.floor(Number(monthCount) || 6)));
  const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const months = Array.from({ length: count }, (_, index) => {
    const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - (count - index - 1), 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    return { key, label: new Intl.DateTimeFormat('es-PA', { month: 'short', year: '2-digit' }).format(date).replace('.', ''), amount: 0, purchases: 0 };
  });
  const byMonth = new Map(months.map(month => [month.key, month]));
  for (const purchase of purchases || []) {
    const month = byMonth.get(String(purchase.purchase_date || '').slice(0, 7));
    if (!month) continue;
    const items = purchase.purchase_items || [];
    month.amount += items.reduce((sum, item) => {
      const line = Number(item.line_total ?? (Number(item.quantity) * Number(item.unit_price)));
      return sum + (Number.isFinite(line) && line > 0 ? line : 0);
    }, 0);
    if (items.length) month.purchases += 1;
  }
  return months;
}

function bars(rows) {
  if (!rows.length) return '<p class="spending-empty">Todavía no hay compras registradas para este mes.</p>';
  const max = Math.max(...rows.map(row => row.amount), 0.01);
  return rows.map(row => `<div class="spending-bar-row"><div><span>${safe(row.name)}</span><b>${money(row.amount)}</b></div><i><span style="width:${Math.max(2, row.amount / max * 100)}%"></span></i></div>`).join('');
}

export async function renderSpendingDashboard({ container, supabase, user }) {
  if (!container || !supabase || !user) return;
  container.querySelector('.personal-spending')?.remove();
  const section = document.createElement('section');
  section.className = 'personal-spending';
  section.innerHTML = '<div class="spending-heading"><div><p class="eyebrow">CONTROL DEL HOGAR</p><h3>Mis gastos</h3><small>Resumen de tus compras registradas en Mi Compra.</small></div><button type="button" class="spending-refresh">Actualizar</button></div><div class="spending-kpis"><article><small>Esta semana</small><strong id="spending-week">—</strong></article><article><small>Este mes</small><strong id="spending-month">—</strong></article><article><small>Presupuesto restante</small><strong id="spending-remaining">—</strong></article></div><section class="spending-budget"><form id="spending-budget-form"><label for="spending-budget-input">Mi presupuesto mensual (USD)</label><div><input id="spending-budget-input" type="number" min="0" max="10000000" step="0.01" placeholder="Ej. 350"><button type="submit">Guardar presupuesto</button></div><small id="spending-budget-status" aria-live="polite">Opcional. Puedes dejarlo en 0 si todavía no deseas definir un presupuesto.</small></form><div class="spending-progress"><div><span>Uso del presupuesto</span><b id="spending-progress-label">Sin presupuesto definido</b></div><i><span id="spending-progress-fill"></span></i></div></section><div class="spending-analysis"><section><h4>Productos con mayor gasto</h4><div id="spending-products"></div></section><section><h4>Gasto por categoría</h4><div id="spending-categories"></div></section></div><section class="spending-alerts" aria-live="polite"><h4>Avisos de presupuesto</h4><div id="spending-alert-list"><p class="spending-empty">Todavía no hay avisos este mes.</p></div></section><section class="spending-monthly"><div><h4>Historial de gastos</h4><small>Comparación de los últimos 6 meses</small></div><div id="spending-month-history" class="spending-month-history" role="img" aria-label="Gastos mensuales de los últimos seis meses"></div></section><p class="spending-footnote" id="spending-footnote">Los importes se calculan a partir de las compras guardadas. Registra tus compras para que el resumen refleje tus gastos.</p>';
  container.appendChild(section);
  const $ = selector => section.querySelector(selector);
  const refresh = async () => {
    $('.spending-refresh').disabled = true;
    $('.spending-footnote').textContent = 'Consultando tus compras…';
    const [purchaseResult, budgetResult] = await Promise.all([
      supabase.from('purchase_records')
        .select('id,purchase_date,purchase_items(item_name,quantity,unit_price,line_total,products(category))')
        .eq('user_id', user.id).order('purchase_date', { ascending: false }).limit(1000),
      supabase.from('personal_budget_settings').select('monthly_budget').eq('user_id', user.id).maybeSingle()
    ]);
    $('.spending-refresh').disabled = false;
    if (purchaseResult.error || budgetResult.error) {
      $('.spending-footnote').textContent = 'No se pudo cargar el resumen. Verifica tu conexión e inténtalo de nuevo.';
      return;
    }
    const summary = summarizeSpending(purchaseResult.data || []);
    const monthlyHistory = summarizeMonthlySpending(purchaseResult.data || []);
    const budget = Number(budgetResult.data?.monthly_budget || 0);
    const remaining = budget > 0 ? budget - summary.month : null;
    const periodStart = `${localDateKey().slice(0, 7)}-01`;
    const reached = getBudgetThresholdsReached(summary.month, budget);
    if (reached.length) {
      const alertRows = reached.map(threshold => ({
        user_id: user.id, period_start: periodStart, threshold
      }));
      const { error: alertWriteError } = await supabase.from('personal_budget_alerts')
        .upsert(alertRows, { onConflict: 'user_id,period_start,threshold', ignoreDuplicates: true });
      if (alertWriteError) {
        $('#spending-alert-list').innerHTML = '<p class="spending-empty">No se pudieron guardar los avisos. Actualiza para volver a intentarlo.</p>';
      }
    }
    const { data: alertRows, error: alertReadError } = await supabase.from('personal_budget_alerts')
      .select('threshold,triggered_at').eq('user_id', user.id).eq('period_start', periodStart)
      .order('threshold', { ascending: true });
    if (alertReadError) {
      $('#spending-alert-list').innerHTML = '<p class="spending-empty">No se pudieron consultar los avisos de este mes.</p>';
    } else if (!budget) {
      $('#spending-alert-list').innerHTML = '<p class="spending-empty">Define tu presupuesto mensual para activar los avisos del 75 %, 90 % y 100 %.</p>';
    } else if (!alertRows?.length) {
      $('#spending-alert-list').innerHTML = '<p class="spending-empty">Aún no has alcanzado el 75 % de tu presupuesto este mes.</p>';
    } else {
      $('#spending-alert-list').innerHTML = alertRows.map(alert => {
        const messages = {
          75: 'Has utilizado el 75 % de tu presupuesto mensual. Conviene revisar lo que queda por comprar.',
          90: 'Has utilizado el 90 % de tu presupuesto mensual. Modera los gastos restantes.',
          100: 'Has alcanzado o superado el 100 % de tu presupuesto mensual.'
        };
        return `<article class="spending-alert spending-alert-${alert.threshold}"><b>${alert.threshold}% del presupuesto</b><span>${messages[alert.threshold]}</span><small>${new Date(alert.triggered_at).toLocaleString('es-PA')}</small></article>`;
      }).join('');
    }
    $('#spending-week').textContent = money(summary.week);
    $('#spending-month').textContent = money(summary.month);
    $('#spending-remaining').textContent = remaining === null ? '—' : money(remaining);
    $('#spending-remaining').classList.toggle('is-over-budget', remaining !== null && remaining < 0);
    $('#spending-budget-input').value = budget ? budget.toFixed(2) : '';
    $('#spending-products').innerHTML = bars(summary.topProducts);
    $('#spending-categories').innerHTML = bars(summary.categories);
    const historyMax = Math.max(...monthlyHistory.map(month => month.amount), 0.01);
    $('#spending-month-history').innerHTML = monthlyHistory.map(month => `<div class="spending-month-row"><div><span>${safe(month.label)}</span><b>${money(month.amount)}</b></div><i><span style="width:${Math.max(0, month.amount / historyMax * 100)}%"></span></i><small>${month.purchases} ${month.purchases === 1 ? 'compra' : 'compras'}</small></div>`).join('');
    const percent = budget > 0 ? Math.min(100, summary.month / budget * 100) : 0;
    $('#spending-progress-fill').style.width = `${percent}%`;
    $('#spending-progress-label').textContent = budget > 0 ? `${percent.toFixed(0)}% · ${money(summary.month)} de ${money(budget)}` : 'Sin presupuesto definido';
    $('.spending-footnote').textContent = summary.totalItems
      ? `Basado en ${summary.totalItems} artículos de hasta 1,000 compras registradas. ${summary.monthItems} artículos corresponden al mes actual.`
      : 'Aún no hay compras registradas. Cuando guardes tus primeras compras, aquí aparecerán los gastos reales; no se muestran cifras estimadas.';
  };
  $('#spending-budget-form').addEventListener('submit', async event => {
    event.preventDefault();
    const status = $('#spending-budget-status');
    const value = Number($('#spending-budget-input').value || 0);
    if (!Number.isFinite(value) || value < 0 || value > 10000000) {
      status.textContent = 'Escribe un presupuesto válido entre 0 y 10,000,000.';
      return;
    }
    status.textContent = 'Guardando…';
    const { error } = await supabase.from('personal_budget_settings').upsert(
      { user_id: user.id, monthly_budget: value, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
    status.textContent = error ? 'No se pudo guardar el presupuesto. Inténtalo de nuevo.' : 'Presupuesto guardado en tu cuenta.';
    if (!error) await refresh();
  });
  $('.spending-refresh').addEventListener('click', refresh);
  await refresh();
}
