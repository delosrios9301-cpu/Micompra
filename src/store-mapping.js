const SOURCE_HOSTS = {
  'Super 99': ['super99.com'],
  Xtra: ['superxtra.com'],
  'Riba Smith': ['ribasmith.com'],
  'El Machetazo': ['elmachetazo.com'],
  Jumbo: ['jumbo.com.pa']
};

const normalize = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function isTrustedStoreSourceUrl(storeName, sourceUrl) {
  const hosts = SOURCE_HOSTS[String(storeName ?? '').trim()];
  if (!hosts) return false;
  try {
    const url = new URL(String(sourceUrl ?? '').trim());
    return url.protocol === 'https:' && hosts.some(host => url.hostname === host || url.hostname.endsWith('.' + host));
  } catch {
    return false;
  }
}

export function validateStoreProductMappingDraft(draft) {
  if (!draft?.product_id || !draft?.supermarket_id) return { valid: false, message: 'Selecciona el producto y el supermercado.' };
  if (!String(draft.source_product_name ?? '').trim()) return { valid: false, message: 'Escribe el nombre exacto que aparece en la tienda.' };
  if (!String(draft.package_description ?? '').trim()) return { valid: false, message: 'Indica la presentación exacta del empaque.' };
  if (!String(draft.source_sku ?? '').trim()) return { valid: false, message: 'El código/SKU de la tienda es obligatorio para evitar asociaciones duplicadas.' };
  if (!isTrustedStoreSourceUrl(draft.supermarket_name, draft.source_product_url)) return { valid: false, message: 'La URL debe ser HTTPS y pertenecer al dominio oficial validado de ese supermercado.' };
  return { valid: true, message: '' };
}

export async function renderStoreProductMappingManager({ container, supabase }) {
  const panel = document.createElement('section');
  panel.className = 'store-mapping-manager';
  panel.innerHTML = '<div><strong>Asociar productos con supermercados</strong><p>Vincula manualmente el producto exacto de Mi Compra con su publicación en la tienda. Esto no carga ni aprueba precios. Solo se aceptan URLs oficiales HTTPS y códigos SKU únicos.</p></div><small class="store-mapping-status">Cargando catálogos...</small>';
  container.appendChild(panel);
  const status = panel.querySelector('.store-mapping-status');
  const [productsResult, storesResult, branchesResult, mappingsResult] = await Promise.all([
    supabase.from('products').select('id,canonical_name,brand,normalized_quantity,normalized_unit_name').eq('active', true).order('canonical_name').limit(1500),
    supabase.from('supermarkets').select('id,name').eq('active', true).order('name'),
    supabase.from('supermarket_branches').select('id,supermarket_id,name').eq('active', true).order('name'),
    supabase.from('store_products').select('id,source_product_name,source_sku,package_description,source_product_url,products(canonical_name),supermarkets(name),supermarket_branches(name)').limit(500)
  ]);
  if (productsResult.error || storesResult.error || branchesResult.error || mappingsResult.error) {
    status.textContent = 'No se pudieron cargar los catálogos. No se permite crear asociaciones sin validar los datos.';
    return;
  }
  const products = productsResult.data || [];
  const stores = (storesResult.data || []).filter(store => SOURCE_HOSTS[store.name]);
  const branches = branchesResult.data || [];
  const mappings = mappingsResult.data || [];
  panel.innerHTML = '<div><strong>Asociar productos con supermercados</strong><p>Vincula manualmente el producto exacto de Mi Compra con su publicación en la tienda. Esto no carga ni aprueba precios. Solo se aceptan URLs oficiales HTTPS y códigos SKU únicos.</p></div><small class="store-mapping-count"></small><form class="store-mapping-form"><label>Producto de Mi Compra<select name="product" required><option value="">Selecciona el producto</option>' + products.map(p => '<option value="' + safe(p.id) + '">' + safe(p.canonical_name) + (p.brand ? ' · ' + safe(p.brand) : '') + (p.normalized_quantity && p.normalized_unit_name ? ' · ' + safe(p.normalized_quantity) + ' ' + safe(p.normalized_unit_name) : '') + '</option>').join('') + '</select></label><div class="store-mapping-grid"><label>Supermercado<select name="store" required><option value="">Selecciona</option>' + stores.map(s => '<option value="' + safe(s.id) + '">' + safe(s.name) + '</option>').join('') + '</select></label><label>Sucursal<select name="branch"><option value="">Sin sucursal confirmada</option></select></label></div><label>Nombre exacto en la tienda<input name="source_name" maxlength="180" required placeholder="Nombre publicado por el supermercado"></label><label>Presentación exacta<input name="package" maxlength="100" required placeholder="Ej. 1.81 KG, 900 G, 16 rollos"></label><label>Código/SKU publicado<input name="sku" maxlength="100" required placeholder="Código del producto en la tienda"></label><label>Enlace directo al producto<input name="url" type="url" maxlength="1000" required placeholder="https://..."></label><label class="store-mapping-confirm"><input name="confirm" type="checkbox" required> Confirmo que revisé el producto, marca y presentación física/publicada y que corresponden al artículo seleccionado.</label><button type="submit">Guardar asociación</button><small class="store-mapping-result" aria-live="polite"></small></form><p class="store-mapping-footnote">Las asociaciones sin sucursal se mostrarán como “Sucursal no especificada”. Selecciona una sucursal solo cuando la publicación confirme dónde aplica; de lo contrario, deja “Sin sucursal confirmada”. El Rey queda fuera hasta disponer de un dominio oficial de catálogo validado.</p>';
  const form = panel.querySelector('form');
  const storeSelect = form.elements.store;
  const branchSelect = form.elements.branch;
  const result = panel.querySelector('.store-mapping-result');
  const count = panel.querySelector('.store-mapping-count');
  const refreshCount = () => { count.textContent = mappings.length + ' asociaciones existentes · ' + products.length + ' productos activos disponibles'; };
  const refreshBranches = () => {
    const selected = storeSelect.value;
    const storeBranches = branches.filter(branch => branch.supermarket_id === selected);
    branchSelect.innerHTML = '<option value="">Sin sucursal confirmada</option>' + storeBranches.map(branch => '<option value="' + safe(branch.id) + '">' + safe(branch.name) + '</option>').join('');
    branchSelect.required = false;
    branchSelect.value = '';
  };
  storeSelect.addEventListener('change', refreshBranches);
  refreshBranches();
  refreshCount();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const store = stores.find(item => item.id === storeSelect.value);
    const draft = {
      product_id: form.elements.product.value,
      supermarket_id: store?.id,
      supermarket_name: store?.name,
      branch_id: branchSelect.value || null,
      source_product_name: form.elements.source_name.value.trim(),
      package_description: form.elements.package.value.trim(),
      source_sku: form.elements.sku.value.trim(),
      source_product_url: form.elements.url.value.trim()
    };
    const validation = validateStoreProductMappingDraft(draft);
    if (!validation.valid) { result.textContent = validation.message; return; }
    if (branchSelect.required && !draft.branch_id) { result.textContent = 'Selecciona la sucursal para este supermercado.'; return; }
    const product = products.find(item => item.id === draft.product_id);
    const sameProduct = mappings.find(item =>
      item.supermarkets?.name === store.name &&
      (item.supermarket_branches?.name || '') === (branches.find(b => b.id === draft.branch_id)?.name || '') &&
      normalize(item.source_sku) === normalize(draft.source_sku)
    );
    if (sameProduct) { result.textContent = 'Ese SKU ya está asociado en esta tienda y sucursal.'; return; }
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    result.textContent = 'Guardando asociación...';
    const { data, error } = await supabase.from('store_products').insert({
      product_id: draft.product_id,
      supermarket_id: draft.supermarket_id,
      branch_id: draft.branch_id,
      source_product_name: draft.source_product_name,
      package_description: draft.package_description,
      source_sku: draft.source_sku,
      source_product_url: draft.source_product_url,
      match_confidence: 1
    }).select('id').single();
    submit.disabled = false;
    if (error || !data) {
      result.textContent = error?.code === '23505' ? 'El SKU ya existe para esa tienda y sucursal.' : 'No se pudo guardar. Verifica permisos y que la asociación no exista.';
      return;
    }
    mappings.push({
      id: data.id,
      source_product_name: draft.source_product_name,
      source_sku: draft.source_sku,
      package_description: draft.package_description,
      source_product_url: draft.source_product_url,
      products: { canonical_name: product?.canonical_name },
      supermarkets: { name: store.name },
      supermarket_branches: branches.find(b => b.id === draft.branch_id) ? { name: branches.find(b => b.id === draft.branch_id).name } : null
    });
    refreshCount();
    form.elements.source_name.value = '';
    form.elements.package.value = '';
    form.elements.sku.value = '';
    form.elements.url.value = '';
    form.elements.confirm.checked = false;
    result.textContent = 'Asociación guardada. Ahora podrás importar una observación reciente para revisión; todavía no hay precio aprobado.';
  });
}
