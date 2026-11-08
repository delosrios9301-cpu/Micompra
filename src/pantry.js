const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const units = ['unidad','unidades','kg','g','lb','oz','L','ml','paquete','paquetes','botella','botellas','lata','latas','bolsa','bolsas','rollo','rollos'];

export function normalizePantryName(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const normalizeUnit = value => {
  const unit = String(value || 'unidades').trim().toLowerCase();
  return ({ unidad: 'unidades', unidades: 'unidades', l: 'litro', litros: 'litro', ml: 'ml', kilogramo: 'kg', kilogramos: 'kg', gramos: 'g', libra: 'lb', libras: 'lb', onza: 'oz', onzas: 'oz' })[unit] || unit;
};

export function findPantryListDuplicate(listItems = [], pantryItem) {
  const name = normalizePantryName(pantryItem?.item_name);
  const unit = normalizeUnit(pantryItem?.unit);
  if (!name) return null;
  return (listItems || []).find(row =>
    normalizePantryName(row.item_name) === name &&
    normalizeUnit(row.unit) === unit
  ) || null;
}

// Solo vincula cuando nombre, unidad y tamaño de presentación coinciden sin ambigüedad.
export function findPantryCatalogMatch(pantryItem, products = []) {
  const name = normalizePantryName(pantryItem?.item_name);
  const unit = normalizeUnit(pantryItem?.unit);
  if (!name) return { product: null, reason: 'no_match' };
  const matches = (products || []).filter(product => {
    if (product.active === false || normalizePantryName(product.canonical_name) !== name) return false;
    if (normalizeUnit(product.normalized_unit_name) !== unit) return false;
    const packageQuantity = product.normalized_quantity == null ? null : Number(product.normalized_quantity);
    return packageQuantity == null || packageQuantity === 1;
  });
  return matches.length === 1
    ? { product: matches[0], reason: 'matched' }
    : { product: null, reason: matches.length ? 'ambiguous' : 'no_match' };
}

export function buildPantryRestockPlan(pantryItems = [], listItems = [], products = []) {
  const plannedList = (listItems || []).map(item => ({ ...item }));
  const updates = [];
  const inserts = [];
  const lowItems = (pantryItems || []).filter(isPantryLowStock);
  let linked = 0, unlinked = 0;
  for (const pantryItem of lowItems) {
    const match = findPantryCatalogMatch(pantryItem, products);
    const productId = match.product?.id || null;
    if (productId) linked++; else unlinked++;
    const duplicate = findPantryListDuplicate(plannedList, pantryItem);
    if (duplicate) {
      const nextQuantity = (Number(duplicate.quantity) || 0) + 1;
      duplicate.quantity = nextQuantity;
      duplicate.checked = false;
      if (!duplicate.product_id && productId) duplicate.product_id = productId;
      updates.push({ id: duplicate.id, quantity: nextQuantity, checked: false, ...(duplicate.product_id ? { product_id: duplicate.product_id } : {}) });
    } else {
      const newItem = {
        id: null, product_id: productId,
        item_name: match.product?.canonical_name || pantryItem.item_name,
        quantity: 1, unit: pantryItem.unit || 'unidades', checked: false
      };
      inserts.push({
        list_id: null, product_id: productId,
        item_name: newItem.item_name, quantity: newItem.quantity, unit: newItem.unit
      });
      plannedList.push(newItem);
    }
  }
  return { updates, inserts, total: lowItems.length, linked, unlinked };
}

export function isPantryLowStock(item) {
  const quantity = Number(item?.quantity) || 0;
  const minimum = Number(item?.minimum_quantity) || 0;
  return quantity <= minimum && (minimum > 0 || quantity === 0);
}

export function summarizePantry(items = []) {
  const rows = items || [];
  const low = rows.filter(isPantryLowStock);
  return { total: rows.length, low: low.length, empty: low.filter(item => Number(item.quantity) <= 0).length, lowItems: low };
}

export const GUEST_PANTRY_KEY = 'micompra_guest_pantry_v1';

export function readGuestPantry() {
  try {
    const value = JSON.parse(localStorage.getItem(GUEST_PANTRY_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

export function addPurchasedItemsToGuestPantry(purchasedItems = []) {
  const items = readGuestPantry();
  let added = 0, updated = 0, skipped = 0;
  for (const purchased of purchasedItems || []) {
    const name = String(purchased?.name || purchased?.item_name || '').trim();
    const quantity = Number(purchased?.qty ?? purchased?.quantity);
    const unit = String(purchased?.priceUnit || purchased?.unit || 'unidad').trim();
    if (!name || !Number.isFinite(quantity) || quantity <= 0 || !unit) { skipped++; continue; }
    const existing = items.find(row =>
      normalizePantryName(row.item_name) === normalizePantryName(name) &&
      normalizeUnit(row.unit) === normalizeUnit(unit)
    );
    if (existing) {
      existing.quantity = Number(existing.quantity || 0) + quantity;
      existing.updated_at = new Date().toISOString();
      updated++;
    } else {
      items.push({
        id: globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2),
        item_name: name, quantity, unit, minimum_quantity: 1, location: '',
        created_at: new Date().toISOString()
      });
      added++;
    }
  }
  saveGuestPantry(items);
  return { added, updated, skipped };
}

function saveGuestPantry(items) {
  localStorage.setItem(GUEST_PANTRY_KEY, JSON.stringify(items));
}

function renderGuestPantry(container) {
  container.querySelector('.personal-pantry')?.remove();
  const section = document.createElement('section');
  section.className = 'personal-pantry';
  section.innerHTML = `
    <div class="pantry-heading"><div><p class="eyebrow">CONTROL DEL HOGAR</p><h3>Mi inventario</h3><small>Registra lo que tienes en casa y recibe avisos cuando debas reponerlo.</small></div></div>
    <div class="pantry-summary"><article><small>Artículos registrados</small><b data-pantry-total>0</b></article><article><small>Por reponer</small><b data-pantry-low>0</b></article><article><small>Agotados</small><b data-pantry-empty>0</b></article></div>
    <form class="pantry-form" data-pantry-add>
      <strong>Agregar artículo</strong>
      <label>Nombre del producto<input name="item_name" maxlength="120" required placeholder="Ej. arroz, leche, papel higiénico"></label>
      <div class="pantry-form-grid">
        <label>Cantidad disponible<input name="quantity" type="number" min="0" max="100000000" step="0.001" value="1" required></label>
        <label>Unidad<select name="unit">${units.map(unit => `<option value="${unit}" ${unit === 'unidad' ? 'selected' : ''}>${unit}</option>`).join('')}</select></label>
        <label>Aviso cuando queden<input name="minimum_quantity" type="number" min="0" max="100000000" step="0.001" value="1" required></label>
        <label>Ubicación<input name="location" maxlength="80" placeholder="Ej. cocina, nevera"></label>
      </div>
      <button type="submit">Guardar en inventario</button><small class="pantry-status" aria-live="polite"></small>
    </form>
    <div class="pantry-list-heading"><h4>Existencias en casa</h4><select data-pantry-filter aria-label="Filtrar inventario"><option value="all">Todos</option><option value="low">Por reponer</option><option value="empty">Agotados</option></select></div>
    <div class="pantry-list" data-pantry-list></div>
    <p class="pantry-footnote">El inventario se guarda en este dispositivo y se incluye en las copias de seguridad. Registrar una compra no modifica tus existencias automáticamente.</p>`;
  container.appendChild(section);
  const $ = selector => section.querySelector(selector);
  let items = readGuestPantry();
  const status = (message, error = false) => { $('.pantry-status').textContent = message; $('.pantry-status').classList.toggle('is-error', error); };
  const persist = () => saveGuestPantry(items);
  const render = () => {
    const summary = summarizePantry(items);
    $('[data-pantry-total]').textContent = summary.total;
    $('[data-pantry-low]').textContent = summary.low;
    $('[data-pantry-empty]').textContent = summary.empty;
    const filter = $('[data-pantry-filter]').value;
    const visible = items.filter(item => filter === 'all' || (filter === 'low' && isPantryLowStock(item)) || (filter === 'empty' && Number(item.quantity) <= 0));
    $('[data-pantry-list]').innerHTML = visible.length ? visible.map(item => {
      const low = isPantryLowStock(item), empty = Number(item.quantity) <= 0;
      return `<article class="pantry-item ${low ? 'is-low' : ''} ${empty ? 'is-empty' : ''}" data-pantry-id="${safe(item.id)}">
        <div class="pantry-item-title"><div><strong>${safe(item.item_name)}</strong><small>${safe(item.location || 'Ubicación no indicada')}</small></div><span class="pantry-state ${empty ? 'state-empty' : low ? 'state-low' : 'state-ok'}">${empty ? 'Agotado' : low ? 'Por reponer' : 'Disponible'}</span></div>
        <form class="pantry-item-form" data-pantry-update>
          <label>Cantidad actual<input name="quantity" type="number" min="0" step="0.001" value="${safe(item.quantity)}" required></label>
          <label>Unidad<input name="unit" maxlength="40" value="${safe(item.unit)}" required></label>
          <label>Mínimo<input name="minimum_quantity" type="number" min="0" step="0.001" value="${safe(item.minimum_quantity)}" required></label>
          <div class="pantry-item-actions"><button type="submit">Actualizar</button><button type="button" class="pantry-delete">Eliminar</button></div>
        </form>
        <form class="pantry-consume-form" data-pantry-consume><label>Registrar consumo<input name="amount" type="number" min="0.001" step="0.001" max="${Math.max(0,Number(item.quantity)||0)}" placeholder="Cantidad" required></label><button type="submit" ${Number(item.quantity)<=0?'disabled':''}>Descontar</button></form>
      </article>`;
    }).join('') : '<p class="pantry-empty">No hay artículos en esta vista.</p>';
    $('[data-pantry-list]').querySelectorAll('[data-pantry-id]').forEach(card => {
      const id = card.dataset.pantryId;
      card.querySelector('[data-pantry-update]').addEventListener('submit', event => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const quantity = Number(data.get('quantity')), minimum = Number(data.get('minimum_quantity')), unit = String(data.get('unit')||'').trim();
        if (!Number.isFinite(quantity)||quantity<0||!Number.isFinite(minimum)||minimum<0||!unit) return;
        items = items.map(row => row.id===id ? {...row,quantity,minimum_quantity:minimum,unit,updated_at:new Date().toISOString()} : row);
        persist(); render(); status('Existencias actualizadas.');
      });
      card.querySelector('.pantry-delete').addEventListener('click', () => {
        if (!confirm('¿Eliminar este artículo del inventario?')) return;
        items = items.filter(row => row.id!==id); persist(); render(); status('Artículo eliminado.');
      });
      card.querySelector('[data-pantry-consume]').addEventListener('submit', event => {
        event.preventDefault();
        const amount = Number(new FormData(event.currentTarget).get('amount'));
        const item = items.find(row => row.id===id);
        if (!item || !Number.isFinite(amount) || amount<=0 || amount>Number(item.quantity)) { status('La cantidad de consumo no puede superar las existencias.',true); return; }
        items = items.map(row => row.id===id ? {...row,quantity:Math.max(0,Number(row.quantity)-amount),updated_at:new Date().toISOString()} : row);
        persist(); render(); status('Consumo registrado y existencias descontadas.');
      });
    });
  };
  $('[data-pantry-add]').addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get('item_name')||'').trim(), unit = String(data.get('unit')||'unidad');
    const quantity = Number(data.get('quantity')), minimum = Number(data.get('minimum_quantity'));
    if (!name || !Number.isFinite(quantity)||quantity<0||!Number.isFinite(minimum)||minimum<0) { status('Revisa el nombre y las cantidades.',true); return; }
    const duplicate = items.find(row => normalizePantryName(row.item_name)===normalizePantryName(name) && normalizeUnit(row.unit)===normalizeUnit(unit));
    if (duplicate) { status('Ese artículo ya existe. Actualiza su cantidad en la lista.',true); return; }
    items.push({id:globalThis.crypto?.randomUUID?.() || Date.now().toString(36)+Math.random().toString(36).slice(2),item_name:name,quantity,unit,minimum_quantity:minimum,location:String(data.get('location')||'').trim(),created_at:new Date().toISOString()});
    try { persist(); } catch { items.pop(); status('No hay espacio suficiente para guardar este artículo.',true); return; }
    event.currentTarget.reset(); event.currentTarget.elements.quantity.value='1'; event.currentTarget.elements.minimum_quantity.value='1';
    render(); status('Artículo guardado en tu inventario.');
  });
  $('[data-pantry-filter]').addEventListener('change', render);
  render();
}

export async function renderPersonalPantry({ container, supabase, user }) {
  if (!container) return;
  if (!supabase || !user) { renderGuestPantry(container); return; }
  container.querySelector('.personal-pantry')?.remove();
  const section = document.createElement('section');
  section.className = 'personal-pantry';
  section.innerHTML = `
    <div class="pantry-heading"><div><p class="eyebrow">CONTROL DEL HOGAR</p><h3>Mi despensa</h3><small>Registra lo que tienes y controla lo que necesitas reponer.</small></div><button type="button" class="pantry-refresh">Actualizar</button></div>
    <div class="pantry-summary"><article><small>Artículos registrados</small><b id="pantry-total">—</b></article><article><small>Por reponer</small><b id="pantry-low">—</b></article><article><small>Agotados</small><b id="pantry-empty">—</b></article></div>
    <form class="pantry-form" id="pantry-add-form">
      <strong>Agregar a mi despensa</strong>
      <label>Artículo<input name="item_name" maxlength="120" required placeholder="Ej. arroz, leche, papel higiénico"></label>
      <div class="pantry-form-grid">
        <label>Cantidad disponible<input name="quantity" type="number" min="0" max="100000000" step="0.001" value="1" required></label>
        <label>Unidad<select name="unit">${units.map(unit => `<option value="${unit}" ${unit === 'unidad' ? 'selected' : ''}>${unit}</option>`).join('')}</select></label>
        <label>Aviso cuando queden<input name="minimum_quantity" type="number" min="0" max="100000000" step="0.001" value="1" required></label>
        <label>Ubicación (opcional)<input name="location" maxlength="80" placeholder="Ej. cocina, nevera"></label>
      </div>
      <label>Notas (opcional)<input name="notes" maxlength="500" placeholder="Marca, tamaño o detalles"></label>
      <button type="submit">Guardar artículo</button><small class="pantry-status" aria-live="polite"></small>
    </form>
    <section class="pantry-list-section"><div class="pantry-list-heading"><h4>Mi inventario del hogar</h4><button type="button" class="pantry-add-all-to-list" disabled>Añadir todos por reponer</button><select id="pantry-filter" aria-label="Filtrar despensa"><option value="all">Todos los artículos</option><option value="low">Por reponer</option><option value="empty">Agotados</option></select></div><div id="pantry-list" class="pantry-list"><p class="pantry-empty">Cargando tu despensa…</p></div></section>
    <p class="pantry-footnote">La cantidad se actualiza manualmente. Un artículo se marca “Por reponer” al llegar al mínimo que indiques; si llega a cero, aparece como “Agotado”.</p>`;
  container.appendChild(section);
  const $ = selector => section.querySelector(selector);
  let items = [];
  const status = (message, isError = false) => { $('.pantry-status').textContent = message; $('.pantry-status').classList.toggle('is-error', isError); };
  const renderList = () => {
    const filter = $('#pantry-filter').value;
    const summary = summarizePantry(items);
    $('#pantry-total').textContent = summary.total;
    $('#pantry-low').textContent = summary.low;
    $('#pantry-empty').textContent = summary.empty;
    $('.pantry-add-all-to-list').disabled = summary.low === 0;
    $('.pantry-add-all-to-list').textContent = summary.low ? `Añadir todos por reponer (${summary.low})` : 'No hay artículos por reponer';
    const visible = items.filter(item => filter === 'all' || (filter === 'low' && isPantryLowStock(item)) || (filter === 'empty' && Number(item.quantity) <= 0));
    $('#pantry-list').innerHTML = visible.length ? visible.map(item => {
      const low = isPantryLowStock(item), empty = Number(item.quantity) <= 0;
      return `<article class="pantry-item ${low ? 'is-low' : ''} ${empty ? 'is-empty' : ''}" data-id="${safe(item.id)}">
        <div class="pantry-item-title"><div><strong>${safe(item.item_name)}</strong><small>${safe(item.location || 'Ubicación no indicada')}${item.notes ? ' · ' + safe(item.notes) : ''}</small></div><span class="pantry-state ${empty ? 'state-empty' : low ? 'state-low' : 'state-ok'}">${empty ? 'Agotado' : low ? 'Por reponer' : 'Disponible'}</span></div>
        <form class="pantry-item-form">
          <label>Cantidad actual<input name="quantity" type="number" min="0" max="100000000" step="0.001" value="${safe(item.quantity)}" required></label>
          <label>Unidad<input name="unit" maxlength="40" value="${safe(item.unit)}" required></label>
          <label>Mínimo<input name="minimum_quantity" type="number" min="0" max="100000000" step="0.001" value="${safe(item.minimum_quantity)}" required></label>
          <div class="pantry-item-actions"><button type="submit">Actualizar</button><button type="button" class="pantry-delete">Eliminar</button></div>
          <button type="button" class="pantry-add-to-list" data-add-list="${safe(item.id)}">Añadir a mi lista de compras</button>
        </form>
      </article>`;
    }).join('') : '<p class="pantry-empty">' + (filter === 'all' ? 'Todavía no has agregado artículos a tu despensa.' : 'No hay artículos en esta categoría.') + '</p>';
    $('#pantry-list').querySelectorAll('.pantry-item').forEach(card => {
      const id = card.dataset.id;
      card.querySelector('form').addEventListener('submit', async event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const quantity = Number(form.get('quantity')), minimum = Number(form.get('minimum_quantity')), unit = String(form.get('unit') || '').trim();
        if (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(minimum) || minimum < 0 || !unit || unit.length > 40) return;
        const button = card.querySelector('button[type="submit"]'); button.disabled = true;
        const { data, error } = await supabase.from('personal_pantry_items').update({ quantity, minimum_quantity: minimum, unit, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id).select('*').single();
        button.disabled = false;
        if (error || !data) { status('No se pudo actualizar el artículo. Inténtalo de nuevo.', true); return; }
        items = items.map(row => row.id === id ? data : row); renderList(); status('Cantidad actualizada.');
      });
      card.querySelector('[data-add-list]').addEventListener('click', async () => {
        const button = card.querySelector('[data-add-list]');
        button.disabled = true;
        button.textContent = 'Añadiendo…';
        try {
          let { data: lists, error: listError } = await supabase.from('shopping_lists').select('id,name').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1);
          if (listError) throw listError;
          let activeList = lists?.[0];
          if (!activeList) {
            const created = await supabase.from('shopping_lists').insert({ user_id: user.id, name: 'Mi lista' }).select('id,name').single();
            if (created.error) throw created.error;
            activeList = created.data;
          }
          const { data: listItems, error: itemsError } = await supabase.from('shopping_list_items').select('id,item_name,quantity,unit,checked,product_id').eq('list_id', activeList.id);
          if (itemsError) throw itemsError;
          const pantryItem = items.find(x => x.id === id);
          if (!pantryItem) throw new Error('Artículo no encontrado');
          const { data: products, error: catalogError } = await supabase.from('products')
            .select('id,canonical_name,normalized_quantity,normalized_unit_name,active')
            .eq('active', true).limit(1000);
          if (catalogError) throw catalogError;
          const match = findPantryCatalogMatch(pantryItem, products || []);
          const duplicate = findPantryListDuplicate(listItems, pantryItem);
          if (duplicate) {
            const changes = { quantity: Number(duplicate.quantity) + 1, checked: false };
            if (!duplicate.product_id && match.product) changes.product_id = match.product.id;
            const { error } = await supabase.from('shopping_list_items').update(changes).eq('id', duplicate.id).eq('list_id', activeList.id);
            if (error) throw error;
          } else {
            const { error } = await supabase.from('shopping_list_items').insert({
              list_id: activeList.id, product_id: match.product?.id || null,
              item_name: match.product?.canonical_name || pantryItem.item_name,
              quantity: 1, unit: pantryItem.unit
            });
            if (error) throw error;
          }
          status('“' + pantryItem.item_name + '” se añadió a tu lista' + (duplicate ? ' y se aumentó su cantidad.' : '.') +
            (match.product ? ' Quedó vinculado al catálogo para comparar precios.' : ' Quedó como artículo libre; no se asignó un producto para evitar una presentación incorrecta.'));
          button.textContent = 'Añadido a la lista';
        } catch (error) {
          status('No se pudo añadir a la lista. Inténtalo de nuevo.', true);
          button.textContent = 'Añadir a mi lista de compras';
          button.disabled = false;
        }
      });
      card.querySelector('.pantry-delete').addEventListener('click', async () => {
        if (!window.confirm('¿Eliminar este artículo de tu despensa?')) return;
        const button = card.querySelector('.pantry-delete'); button.disabled = true;
        const { error } = await supabase.from('personal_pantry_items').delete().eq('id', id).eq('user_id', user.id);
        if (error) { button.disabled = false; status('No se pudo eliminar el artículo.', true); return; }
        items = items.filter(row => row.id !== id); renderList(); status('Artículo eliminado.');
      });
    });
  };
  const refresh = async () => {
    $('.pantry-refresh').disabled = true;
    $('#pantry-list').innerHTML = '<p class="pantry-empty">Actualizando…</p>';
    const { data, error } = await supabase.from('personal_pantry_items').select('id,item_name,quantity,unit,minimum_quantity,location,notes,updated_at').eq('user_id', user.id).order('item_name', { ascending: true }).limit(1000);
    $('.pantry-refresh').disabled = false;
    if (error) { $('#pantry-list').innerHTML = '<p class="pantry-empty">No se pudo cargar tu despensa. Comprueba la conexión.</p>'; return; }
    items = data || []; renderList();
  };
  $('#pantry-add-form').addEventListener('submit', async event => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const itemName = String(form.get('item_name') || '').trim(), unit = String(form.get('unit') || 'unidad').trim();
    const quantity = Number(form.get('quantity')), minimum = Number(form.get('minimum_quantity'));
    if (!itemName || !Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(minimum) || minimum < 0) { status('Revisa el nombre y las cantidades.', true); return; }
    const duplicate = items.find(item => normalizePantryName(item.item_name) === normalizePantryName(itemName) && String(item.unit).toLowerCase() === unit.toLowerCase());
    if (duplicate) { status('Ese artículo ya existe en tu despensa. Actualiza su cantidad en la lista.', true); return; }
    const button = $('#pantry-add-form button[type="submit"]'); button.disabled = true; status('Guardando…');
    const { data, error } = await supabase.from('personal_pantry_items').insert({
      user_id: user.id, item_name: itemName, quantity, unit, minimum_quantity: minimum,
      location: String(form.get('location') || '').trim() || null, notes: String(form.get('notes') || '').trim() || null
    }).select('*').single();
    button.disabled = false;
    if (error || !data) { status('No se pudo guardar el artículo. Comprueba los datos e inténtalo de nuevo.', true); return; }
    items = [...items, data].sort((a,b) => a.item_name.localeCompare(b.item_name, 'es'));
    formElement.reset(); formElement.elements.quantity.value = '1'; formElement.elements.minimum_quantity.value = '1';
    renderList(); status('Artículo guardado en tu despensa.');
  });
  $('.pantry-add-all-to-list').addEventListener('click', async () => {
    const lowItems = items.filter(isPantryLowStock);
    if (!lowItems.length) return;
    const button = $('.pantry-add-all-to-list');
    button.disabled = true;
    button.textContent = 'Añadiendo artículos…';
    let completed = 0;
    let failed = 0;
    try {
      let { data: lists, error: listError } = await supabase.from('shopping_lists').select('id,name').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1);
      if (listError) throw listError;
      let activeList = lists?.[0];
      if (!activeList) {
        const created = await supabase.from('shopping_lists').insert({ user_id: user.id, name: 'Mi lista' }).select('id,name').single();
        if (created.error) throw created.error;
        activeList = created.data;
      }
      const { data: listItems, error: itemsError } = await supabase.from('shopping_list_items').select('id,item_name,quantity,unit,checked').eq('list_id', activeList.id);
      if (itemsError) throw itemsError;
      const { data: products, error: catalogError } = await supabase.from('products')
        .select('id,canonical_name,normalized_quantity,normalized_unit_name,active')
        .eq('active', true).limit(1000);
      if (catalogError) throw catalogError;
      const plan = buildPantryRestockPlan(lowItems, listItems || [], products || []);
      for (const update of plan.updates) {
        const changes = { quantity: update.quantity, checked: false };
        if (update.product_id) changes.product_id = update.product_id;
        const { error } = await supabase.from('shopping_list_items').update(changes).eq('id', update.id).eq('list_id', activeList.id);
        if (error) failed++; else completed++;
      }
      if (plan.inserts.length) {
        const rows = plan.inserts.map(({ product_id, item_name, quantity, unit }) => ({
          list_id: activeList.id, product_id, item_name, quantity, unit
        }));
        const { error } = await supabase.from('shopping_list_items').insert(rows);
        if (error) failed += rows.length; else completed += rows.length;
      }
      status(failed
        ? `Se añadieron ${completed} artículos; ${failed} no se pudieron añadir. Puedes reintentar.`
        : `Se añadieron ${completed} artículos por reponer. Vinculados al catálogo: ${plan.linked}; pendientes de vincular: ${plan.unlinked}.`);
    } catch (error) {
      status('No se pudo completar la incorporación. Comprueba la conexión e inténtalo de nuevo.', true);
    }
    button.disabled = false;
    renderList();
  });
  $('#pantry-filter').addEventListener('change', renderList);
  $('.pantry-refresh').addEventListener('click', refresh);
  await refresh();
}
