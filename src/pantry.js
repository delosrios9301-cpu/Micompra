const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const units = ['unidad','unidades','kg','g','lb','oz','L','ml','paquete','paquetes','botella','botellas','lata','latas','bolsa','bolsas','rollo','rollos'];

export function normalizePantryName(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
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

export async function renderPersonalPantry({ container, supabase, user }) {
  if (!container || !supabase || !user) return;
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
    <section class="pantry-list-section"><div class="pantry-list-heading"><h4>Mi inventario del hogar</h4><select id="pantry-filter" aria-label="Filtrar despensa"><option value="all">Todos los artículos</option><option value="low">Por reponer</option><option value="empty">Agotados</option></select></div><div id="pantry-list" class="pantry-list"><p class="pantry-empty">Cargando tu despensa…</p></div></section>
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
  $('#pantry-filter').addEventListener('change', renderList);
  $('.pantry-refresh').addEventListener('click', refresh);
  await refresh();
}
