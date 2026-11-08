const money = value => new Intl.NumberFormat('es-PA', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const localDate = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };
const dateLabel = value => value ? new Date(value + (String(value).length === 10 ? 'T12:00:00' : '')).toLocaleDateString('es-PA') : '—';
const norm = value => String(value ?? '').trim().toLocaleLowerCase('es').replace(/\s+/g, ' ');

export async function renderPurchases({ container, supabase, user }) {
  if (!container || !supabase || !user) return;
  let activePurchaseId = null;
  let stores = [], branches = [], products = [], purchases = [], adjustments = [];
  let rangeDays = '30';
  container.innerHTML = '<section class="purchase-module"><p class="empty">Cargando compras e inventario…</p></section>';

  const [storeResult, branchResult, productResult] = await Promise.all([
    supabase.from('supermarkets').select('id,name').eq('active', true).order('name'),
    supabase.from('supermarket_branches').select('id,name,supermarket_id').eq('active', true).order('name'),
    supabase.from('products').select('id,canonical_name,normalized_quantity,normalized_unit_name').eq('active', true).order('canonical_name')
  ]);
  if (storeResult.error || branchResult.error || productResult.error) {
    container.innerHTML = '<section class="purchase-module"><p class="empty">No se pudo cargar el catálogo de compras. Inténtalo de nuevo más tarde.</p></section>';
    return;
  }
  stores = storeResult.data || [];
  branches = branchResult.data || [];
  products = productResult.data || [];

  const loadData = async () => {
    const [purchaseResult, adjustmentResult] = await Promise.all([
      supabase.from('purchase_records')
        .select('id,user_id,supermarket_id,branch_id,purchase_date,receipt_reference,notes,supermarkets(name),supermarket_branches(name),purchase_items(id,product_id,item_name,package_description,quantity,unit,unit_price,line_total)')
        .eq('user_id', user.id).order('purchase_date', { ascending: false }).limit(300),
      supabase.from('inventory_adjustments')
        .select('id,product_id,item_name,quantity_delta,reason,notes,occurred_at')
        .eq('user_id', user.id).order('occurred_at', { ascending: false }).limit(500)
    ]);
    if (purchaseResult.error || adjustmentResult.error) throw new Error('No se pudo consultar el historial de compras o inventario.');
    purchases = purchaseResult.data || [];
    adjustments = adjustmentResult.data || [];
  };

  const productOptions = products.map(p => '<option value="' + p.id + '">' + safe(p.canonical_name) + '</option>').join('');
  const storeOptions = stores.map(s => '<option value="' + s.id + '">' + safe(s.name) + '</option>').join('');
  const branchOptions = branches.map(b => '<option value="' + b.id + '" data-store="' + b.supermarket_id + '">' + safe(b.name) + '</option>').join('');

  const render = async () => {
    const currentMonth = localDate().slice(0, 7);
    const allItems = purchases.flatMap(p => (p.purchase_items || []).map(i => ({ ...i, purchaseId: p.id, date: p.purchase_date, storeId: p.supermarket_id, store: p.supermarkets?.name || 'Supermercado', branch: p.supermarket_branches?.name || '', receipt: p.receipt_reference })));
    const totalMonth = allItems.filter(i => String(i.date).startsWith(currentMonth)).reduce((sum, i) => sum + Number(i.line_total ?? Number(i.quantity) * Number(i.unit_price)), 0);
    const totalAll = allItems.reduce((sum, i) => sum + Number(i.line_total ?? Number(i.quantity) * Number(i.unit_price)), 0);
    const monthByStore = new Map();
    for (const item of allItems.filter(i => String(i.date).startsWith(currentMonth))) monthByStore.set(item.store, (monthByStore.get(item.store) || 0) + Number(item.line_total ?? Number(item.quantity) * Number(item.unit_price)));

    const cutoff = rangeDays === 'all' ? null : new Date(Date.now() - Number(rangeDays) * 86400000).toISOString().slice(0, 10);
    const comparedItems = allItems.filter(i => !cutoff || i.date >= cutoff);
    const productGroups = new Map();
    for (const item of comparedItems) {
      const key = item.product_id || 'name:' + norm(item.item_name) + '|' + norm(item.package_description);
      if (!productGroups.has(key)) productGroups.set(key, { name: item.item_name, package: item.package_description || '', productId: item.product_id, stores: new Map() });
      const group = productGroups.get(key);
      const current = group.stores.get(item.store);
      const entry = { date: item.date, price: Number(item.unit_price), quantity: Number(item.quantity), unit: item.unit || 'unidad' };
      if (!current || item.date > current.date) group.stores.set(item.store, entry);
    }

    const stockMap = new Map();
    for (const item of allItems) {
      const key = item.product_id || 'name:' + norm(item.item_name);
      const previous = stockMap.get(key) || { name: item.item_name, unit: item.unit || 'unidad', quantity: 0 };
      previous.quantity += Number(item.quantity);
      stockMap.set(key, previous);
    }
    for (const move of adjustments) {
      const key = move.product_id || 'name:' + norm(move.item_name);
      const previous = stockMap.get(key) || { name: move.item_name, unit: 'unidad', quantity: 0 };
      previous.quantity += Number(move.quantity_delta);
      stockMap.set(key, previous);
    }
    const stockRows = [...stockMap.values()].sort((a,b) => a.name.localeCompare(b.name, 'es'));

    container.innerHTML = \`
      <section class="purchase-module">
        <div class="purchase-title"><div><p class="eyebrow">CONTROL PERSONAL</p><h3>Compras e inventario</h3><small>Registra lo que realmente compraste. Los precios del comparador no se convierten automáticamente en compras.</small></div></div>
        <div class="purchase-kpis">
          <article><small>Gastado este mes</small><b>\${money(totalMonth)}</b></article>
          <article><small>Gasto acumulado</small><b>\${money(totalAll)}</b></article>
          <article><small>Compras registradas</small><b>\${purchases.length}</b></article>
        </div>
        <section class="purchase-card">
          <strong>Registrar una compra</strong>
          <form id="purchase-create" class="purchase-form">
            <label>Supermercado<select id="purchase-store" required><option value="">Selecciona</option>\${storeOptions}</select></label>
            <label>Sucursal (opcional)<select id="purchase-branch"><option value="">No especificada / tienda en línea</option>\${branchOptions}</select></label>
            <label>Fecha de compra<input id="purchase-date" type="date" value="\${new Date().toISOString().slice(0,10)}" required></label>
            <label>Factura o referencia (opcional)<input id="purchase-reference" maxlength="120" placeholder="N.º de factura"></label>
            <label class="wide">Notas (opcional)<input id="purchase-notes" maxlength="1000" placeholder="Observaciones de la compra"></label>
            <button type="submit">Crear compra</button>
          </form>
          <small id="purchase-message" class="purchase-message" aria-live="polite"></small>
        </section>
        \${activePurchaseId ? (() => {
          const p = purchases.find(x => x.id === activePurchaseId);
          return p ? \`<section class="purchase-card active-purchase"><div class="purchase-card-head"><div><strong>Compra en curso · \${safe(p.supermarkets?.name || 'Supermercado')}</strong><small>\${dateLabel(p.purchase_date)} · \${safe(p.supermarket_branches?.name || 'Sucursal no indicada')}</small></div><button type="button" class="secondary" id="close-active-purchase">Cerrar</button></div>
          <form id="purchase-add-item" class="purchase-form item-form">
            <label>Producto del catálogo<select id="purchase-product"><option value="">Artículo libre</option>\${productOptions}</select></label>
            <label>Nombre del artículo<input id="purchase-item-name" maxlength="180" placeholder="Ej. arroz blanco"></label>
            <label>Presentación<input id="purchase-package" maxlength="180" placeholder="Ej. bolsa de 5 lb"></label>
            <label>Cantidad<input id="purchase-quantity" type="number" min="0.001" step="0.001" value="1" required></label>
            <label>Unidad<input id="purchase-unit" maxlength="40" value="unidad" required></label>
            <label>Precio por unidad (USD)<input id="purchase-unit-price" type="number" min="0" step="0.01" required placeholder="0.00"></label>
            <button type="submit">Agregar artículo</button>
          </form>
          <div id="active-purchase-items">\${(p.purchase_items || []).map(i => '<div class="purchase-line"><span>' + safe(i.item_name) + ' · ' + safe(i.quantity) + ' ' + safe(i.unit) + '</span><b>' + money(i.line_total) + '</b></div>').join('') || '<small>Aún no has agregado artículos.</small>'}</div>
          <div class="purchase-grand-total"><span>Total registrado</span><b>\${money((p.purchase_items || []).reduce((sum,i)=>sum+Number(i.line_total || 0),0))}</b></div>
          </section>\` : '' })() : ''}
        <section class="purchase-card">
          <div class="purchase-card-head"><div><strong>Gastos por supermercado</strong><small>Totales de compras registradas durante el mes actual.</small></div></div>
          \${monthByStore.size ? [...monthByStore].sort((a,b)=>b[1]-a[1]).map(([name,total])=>'<div class="store-spend"><span>'+safe(name)+'</span><b>'+money(total)+'</b></div>').join('') : '<small>Aún no hay compras registradas este mes.</small>'}
        </section>
        <section class="purchase-card">
          <div class="purchase-card-head"><div><strong>Comparativa de compras entre supermercados</strong><small>Indica dónde sí registraste cada producto y dónde no aparece comprado en el periodo.</small></div><select id="purchase-range" aria-label="Periodo de comparación"><option value="30" \${rangeDays==='30'?'selected':''}>Últimos 30 días</option><option value="90" \${rangeDays==='90'?'selected':''}>Últimos 90 días</option><option value="all" \${rangeDays==='all'?'selected':''}>Todo el historial</option></select></div>
          <div class="purchase-compare-wrap">\${productGroups.size ? '<table class="purchase-compare"><thead><tr><th>Producto</th>'+stores.map(s=>'<th>'+safe(s.name)+'</th>').join('')+'</tr></thead><tbody>'+[...productGroups.values()].sort((a,b)=>a.name.localeCompare(b.name,'es')).map(g=>'<tr><td><strong>'+safe(g.name)+'</strong><small>'+safe(g.package)+'</small></td>'+stores.map(s=>{const bought=g.stores.get(s.name);return '<td class="'+(bought?'bought':'not-bought')+'">'+(bought?'<b>Comprado</b><small>'+dateLabel(bought.date)+'</small><small>'+money(bought.price)+' / '+safe(bought.unit)+'</small>':'<span>No registrado</span>')+'</td>';}).join('')+'</tr>').join('')+'</tbody></table>' : '<small>Registra compras para comparar qué productos adquiriste en cada supermercado.</small>'}</div>
          <small class="purchase-footnote">“No registrado” significa que no hay una compra guardada de ese producto en ese supermercado durante el periodo elegido; no significa que el supermercado no lo venda.</small>
        </section>
        <section class="purchase-card">
          <strong>Inventario estimado de lo comprado</strong>
          <small>Se suman las cantidades compradas y se restan consumos, mermas o correcciones que registres.</small>
          \${stockRows.length ? stockRows.map(s=>'<div class="store-spend"><span>'+safe(s.name)+' <small>'+safe(s.unit)+'</small></span><b class="'+(s.quantity<0?'negative-stock':'')+'">'+s.quantity.toLocaleString('es-PA',{maximumFractionDigits:3})+'</b></div>').join('') : '<small>El inventario aparecerá cuando registres compras.</small>'}
          <form id="inventory-adjust" class="purchase-form inventory-form">
            <label>Producto<select id="adjust-product"><option value="">Artículo libre</option>\${productOptions}</select></label>
            <label>Nombre<input id="adjust-name" maxlength="180" placeholder="Producto"></label>
            <label>Tipo<select id="adjust-reason"><option value="consumption">Consumo</option><option value="spoilage">Merma / vencido</option><option value="correction">Corrección de inventario</option></select></label>
            <label>Cantidad<input id="adjust-quantity" type="number" step="0.001" min="0.001" required placeholder="Cantidad"></label>
            <button type="submit">Registrar movimiento</button>
          </form>
          <small id="adjust-message" class="purchase-message" aria-live="polite"></small>
        </section>
        <section class="purchase-card">
          <strong>Historial de compras</strong>
          \${purchases.length ? purchases.map(p=>{const items=p.purchase_items||[],total=items.reduce((sum,i)=>sum+Number(i.line_total||0),0);return '<details class="purchase-history"><summary><span><b>'+safe(p.supermarkets?.name||'Supermercado')+'</b><small>'+dateLabel(p.purchase_date)+' · '+items.length+' artículo(s)'+(p.supermarket_branches?.name?' · '+safe(p.supermarket_branches.name):'')+'</small></span><strong>'+money(total)+'</strong></summary><div class="history-items">'+items.map(i=>'<div><span>'+safe(i.item_name)+' · '+safe(i.quantity)+' '+safe(i.unit)+'</span><b>'+money(i.line_total)+'</b></div>').join('')+(p.receipt_reference?'<small>Factura: '+safe(p.receipt_reference)+'</small>':'')+(p.notes?'<small>'+safe(p.notes)+'</small>':'')+'</div></details>';}).join('') : '<small>Aún no hay compras guardadas.</small>'}
        </section>
      </section>\`;

    const storeSelect = container.querySelector('#purchase-store');
    const branchSelect = container.querySelector('#purchase-branch');
    const filterBranches = () => {
      const selected = storeSelect?.value || '';
      [...(branchSelect?.options || [])].forEach(option => {
        if (!option.value) return;
        option.hidden = option.dataset.store !== selected;
        if (option.hidden && option.selected) branchSelect.value = '';
      });
    };
    storeSelect?.addEventListener('change', filterBranches);
    filterBranches();

    container.querySelector('#purchase-create')?.addEventListener('submit', async event => {
      event.preventDefault();
      const message = container.querySelector('#purchase-message');
      message.textContent = 'Guardando compra…';
      const payload = {
        user_id: user.id,
        supermarket_id: storeSelect.value,
        branch_id: branchSelect.value || null,
        purchase_date: container.querySelector('#purchase-date').value,
        receipt_reference: container.querySelector('#purchase-reference').value.trim() || null,
        notes: container.querySelector('#purchase-notes').value.trim() || null
      };
      const { data, error } = await supabase.from('purchase_records').insert(payload).select('id').single();
      if (error) { message.textContent = 'No se pudo guardar la compra. Verifica los datos e inténtalo de nuevo.'; return; }
      activePurchaseId = data.id;
      await refresh();
    });

    container.querySelector('#close-active-purchase')?.addEventListener('click', () => { activePurchaseId = null; render(); });
    container.querySelector('#purchase-product')?.addEventListener('change', event => {
      const p = products.find(x => x.id === event.target.value);
      if (!p) return;
      container.querySelector('#purchase-item-name').value = p.canonical_name;
      container.querySelector('#purchase-package').value = p.normalized_quantity && p.normalized_unit_name ? p.normalized_quantity + ' ' + p.normalized_unit_name : '';
      container.querySelector('#purchase-unit').value = 'unidad';
    });
    container.querySelector('#purchase-add-item')?.addEventListener('submit', async event => {
      event.preventDefault();
      const productId = container.querySelector('#purchase-product').value || null;
      const product = products.find(p => p.id === productId);
      const itemName = container.querySelector('#purchase-item-name').value.trim() || product?.canonical_name || '';
      const quantity = Number(container.querySelector('#purchase-quantity').value);
      const unitPrice = Number(container.querySelector('#purchase-unit-price').value);
      if (!itemName || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) return;
      const { error } = await supabase.from('purchase_items').insert({
        purchase_id: activePurchaseId, user_id: user.id, product_id: productId,
        item_name: itemName, package_description: container.querySelector('#purchase-package').value.trim() || null,
        quantity, unit: container.querySelector('#purchase-unit').value.trim() || 'unidad', unit_price: unitPrice
      });
      if (error) { alert('No se pudo agregar el artículo a la compra.'); return; }
      await refresh();
    });
    container.querySelector('#purchase-range')?.addEventListener('change', event => { rangeDays = event.target.value; render(); });
    container.querySelector('#adjust-product')?.addEventListener('change', event => {
      const p = products.find(x => x.id === event.target.value);
      if (p) container.querySelector('#adjust-name').value = p.canonical_name;
    });
    container.querySelector('#inventory-adjust')?.addEventListener('submit', async event => {
      event.preventDefault();
      const productId = container.querySelector('#adjust-product').value || null;
      const product = products.find(p => p.id === productId);
      const itemName = container.querySelector('#adjust-name').value.trim() || product?.canonical_name || '';
      const amount = Number(container.querySelector('#adjust-quantity').value);
      const reason = container.querySelector('#adjust-reason').value;
      if (!itemName || !Number.isFinite(amount) || amount <= 0) return;
      const delta = reason === 'correction' ? amount : -amount;
      const { error } = await supabase.from('inventory_adjustments').insert({ user_id: user.id, product_id: productId, item_name: itemName, quantity_delta: delta, reason });
      const message = container.querySelector('#adjust-message');
      if (error) { message.textContent = 'No se pudo guardar el movimiento de inventario.'; return; }
      message.textContent = 'Movimiento registrado.';
      await refresh();
    });
  };

  const refresh = async () => {
    try { await loadData(); await render(); }
    catch (error) { container.innerHTML = '<section class="purchase-module"><p class="empty">' + safe(error.message) + '</p></section>'; }
  };
  await refresh();
}
