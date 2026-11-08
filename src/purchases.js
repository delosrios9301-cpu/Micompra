export function buildPurchasesCsv(purchases = []) {
  const headers = ['Fecha','Supermercado','Sucursal','Referencia factura','Producto','Presentación','Cantidad','Unidad','Precio unitario USD','Total USD','Notas'];
  const cell = value => {
    let v = String(value ?? '');
    if (/^[\s\u0000-\u001f]*[=+\-@]/.test(v)) v = "'" + v;
    return '"' + v.replace(/"/g, '""') + '"';
  };
  const rows = [headers.map(cell), ...purchases.flatMap(p => {
    const items = p.purchase_items || [];
    const base = [p.purchase_date,p.supermarkets?.name,p.supermarket_branches?.name,p.receipt_reference];
    if (!items.length) return [[...base,'','','','','','',p.notes].map(cell)];
    return items.map(i => [...base,i.item_name,i.package_description,i.quantity,i.unit,i.unit_price,i.line_total,p.notes].map(cell));
  })];
  return '\uFEFF' + rows.map(row => row.join(',')).join('\r\n');
}


export function normalizeProductBarcode(value) {
  return String(value ?? '').trim().replace(/\s+/g, '').replace(/-/g, '').toUpperCase();
}

export function isValidBarcodeChecksum(value, format = '') {
  const code = normalizeProductBarcode(value);
  const kind = String(format || '').toLowerCase();
  if (!/^\\d+$/.test(code)) return true;
  const checkDigitValid = digits => {
    const data = digits.slice(0, -1).split('').map(Number);
    const check = Number(digits.at(-1));
    const sum = data.reduce((total, digit, index) => {
      const weight = (data.length - 1 - index) % 2 === 0 ? 3 : 1;
      return total + digit * weight;
    }, 0);
    return (10 - (sum % 10)) % 10 === check;
  };
  if (kind === 'upc_e') {
    if (code.length !== 8 || !/^[01]/.test(code)) return false;
    const ns = code[0], a = code[1], b = code[2], c = code[3], d = code[4], e = code[5], f = code[6], check = code[7];
    let expanded;
    if (f <= '2') expanded = ns + a + b + f + '0000' + c + d + e + check;
    else if (f === '3') expanded = ns + a + b + c + '00000' + d + e + check;
    else if (f === '4') expanded = ns + a + b + c + d + '00000' + e + check;
    else expanded = ns + a + b + c + d + e + '0000' + f + check;
    return checkDigitValid(expanded);
  }
  if (kind === 'ean_13' || (!kind && code.length === 13)) return code.length === 13 && checkDigitValid(code);
  if (kind === 'ean_8' || (!kind && code.length === 8)) return code.length === 8 && checkDigitValid(code);
  if (kind === 'upc_a' || (!kind && code.length === 12)) return code.length === 12 && checkDigitValid(code);
  return true;
}

export function findProductByBarcode(products = [], barcode, mappings = []) {
  const code = normalizeProductBarcode(barcode);
  if (!code) return null;
  const primary = products.find(product => normalizeProductBarcode(product.barcode) === code);
  if (primary) return primary;
  const mapping = mappings.find(item => normalizeProductBarcode(item.barcode) === code);
  return mapping ? products.find(product => product.id === mapping.product_id) || null : null;
}

export function parseInvoiceMetadata(text, stores = [], branches = []) {
  const source = String(text || '');
  const normalized = source.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const compact = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const aliases = [
    { match: /\bsuper\s*99\b|\bsupermercados?\s*99\b/, names: ['super 99'] },
    { match: /\bxtra\b|\bsuper\s*xtra\b|\bsupermercados?\s*xtra\b/, names: ['xtra','super xtra'] },
    { match: /\b(?:supermercados?\s+)?el\s+rey\b|\bsm rey\b/, names: ['el rey','rey'] },
    { match: /\briba\s*smith\b/, names: ['riba smith'] },
    { match: /\bel\s*machetazo\b/, names: ['el machetazo','machetazo'] },
    { match: /\bjumbo\b/, names: ['jumbo'] }
  ];
  let store = null;
  for (const alias of aliases) {
    if (!alias.match.test(normalized)) continue;
    store = stores.find(s => alias.names.some(n => compact(s.name).includes(n) || n.includes(compact(s.name))));
    if (store) break;
  }
  let date = '';
  const datePatterns = [
    /\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/,
    /\b(0?[1-9]|[12]\d|3[01])[-/](0?[1-9]|1[0-2])[-/](20\d{2})\b/
  ];
  for (let i=0;i<datePatterns.length && !date;i++) {
    const m = source.match(datePatterns[i]);
    if (!m) continue;
    const parts = i===0 ? [Number(m[1]),Number(m[2]),Number(m[3])] : [Number(m[3]),Number(m[2]),Number(m[1])];
    const d = new Date(Date.UTC(parts[0],parts[1]-1,parts[2]));
    if (d.getUTCFullYear()===parts[0] && d.getUTCMonth()===parts[1]-1 && d.getUTCDate()===parts[2]) date = parts[0]+'-'+String(parts[1]).padStart(2,'0')+'-'+String(parts[2]).padStart(2,'0');
  }
  let reference = '';
  const refMatch = source.match(/(?:factura(?:\s+fiscal)?|comprobante|recibo|ticket)\s*(?:n(?:o\.?|[uú]m(?:ero)?|[º°.]?)|#|:|-)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{3,})/i);
  if (refMatch) reference = refMatch[1].slice(0,120);
  let branch = null;
  if (store) {
    const candidates = branches.filter(b => b.supermarket_id === store.id);
    const byName = candidates.find(b => compact(normalized).includes(compact(b.name)));
    if (byName) branch = byName;
  }
  return { supermarketId: store?.id || '', branchId: branch?.id || '', purchaseDate: date, receiptReference: reference };
}

const money = value => new Intl.NumberFormat('es-PA', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const localDate = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };
const parseInvoiceDraft = (text, products) => {
  const lines = String(text || '').split(/\r?\n/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const moneyPattern = /(?:B\/|USD|\$)?\s*(\d{1,4}(?:[.,]\d{3})*[.,]\d{2})\s*$/i;
  const drafts = [];
  const parseAmount = raw => {
    if (raw.includes('.') && raw.includes(',')) return Number(raw.lastIndexOf('.') > raw.lastIndexOf(',') ? raw.replace(/,/g, '') : raw.replace(/\./g, '').replace(',', '.'));
    return Number(raw.replace(',', '.'));
  };
  const ignoredLine = name => /^(?:total|subtotal|itbms|i\.t\.b\.m\.s|impuesto|tax|descuento|descto|desc\.?|ahorro|promocion|promoción|promo|cupon|cup[oó]n|bonificacion|bonificación|cambio|efectivo|visa|mastercard|debito|débito|credito|crédito|vuelto)\b/i.test(name)
    || /\b(?:total general|total a pagar|subtotal|itbms|impuesto|descuento|descto|ahorro|cup[oó]n|bonificacion|bonificación)\b/i.test(name)
    || /(?:^|\s)(?:promo(?:cion)?|oferta|2\s*[x×]\s*1|3\s*[x×]\s*2)(?:\s|$)/i.test(name);
  const weightedPattern = /(?:^|\s)(\d+(?:[.,]\d+)?)\s*(kg|kilo(?:s)?|g|gr|gramos?|lb|lbs|libras?|oz|onzas?)\s*$/i;
  for (const line of lines) {
    const match = line.match(moneyPattern);
    if (!match) continue;
    const amount = parseAmount(match[1]);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000) continue;
    let name = line.slice(0, match.index).replace(/[|*•]+/g, ' ').trim();
    if (ignoredLine(name) || name.length < 3 || !/[a-záéíóúñ]/i.test(name)) continue;
    let quantity = 1;
    let unit = 'unidad';
    let quantityMatch = name.match(weightedPattern);
    if (quantityMatch) {
      quantity = parseAmount(quantityMatch[1]);
      const rawUnit = quantityMatch[2].toLowerCase();
      unit = /^(?:kg|kilo)/.test(rawUnit) ? 'kg' : /^(?:g|gr|gram)/.test(rawUnit) ? 'kg' : /^(?:oz|onza)/.test(rawUnit) ? 'oz' : 'lb';
      if (/^(?:g|gr|gram)/.test(rawUnit)) quantity = quantity / 1000;
      name = name.slice(0, quantityMatch.index).trim();
    } else {
      quantityMatch = name.match(/^\s*(\d+(?:[.,]\d+)?)\s*(kg|kilo(?:s)?|g|gr|gramos?|lb|lbs|libras?|oz|onzas?)\s+(.+)$/i);
      if (quantityMatch) {
        quantity = parseAmount(quantityMatch[1]);
        const rawUnit = quantityMatch[2].toLowerCase();
        unit = /^(?:kg|kilo|g|gr|gram)/.test(rawUnit) ? 'kg' : /^(?:oz|onza)/.test(rawUnit) ? 'oz' : 'lb';
        if (/^(?:g|gr|gram)/.test(rawUnit)) quantity = quantity / 1000;
        name = quantityMatch[3].trim();
      }
    }
    if (!quantityMatch) {
      quantityMatch = name.match(/^\s*(\d+(?:[.,]\d+)?)\s*(?:x|unid(?:ad(?:es)?)?|uds?|und|pzas?)\s+/i);
      if (quantityMatch) {
        quantity = parseAmount(quantityMatch[1]);
        name = name.slice(quantityMatch[0].length).trim();
      } else {
        quantityMatch = name.match(/^\s*(\d+(?:[.,]\d+)?)\s*[x×]\s*/i);
        if (quantityMatch) {
          quantity = parseAmount(quantityMatch[1]);
          name = name.slice(quantityMatch[0].length).trim();
        } else {
          quantityMatch = name.match(/\s+[x×]\s*(\d+(?:[.,]\d+)?)\s*$/i);
          if (quantityMatch) {
            quantity = parseAmount(quantityMatch[1]);
            name = name.slice(0, quantityMatch.index).trim();
          } else {
            quantityMatch = name.match(/\s+(\d+(?:[.,]\d+)?)\s*(?:unid(?:ad(?:es)?)?|uds?|und|pzas?)\s*$/i);
            if (quantityMatch) {
              quantity = parseAmount(quantityMatch[1]);
              name = name.slice(0, quantityMatch.index).trim();
            }
          }
        }
      }
    }
    name = name.replace(/\s+(?:\d+(?:[.,]\d+)?\s*)?(?:lbs?|kg|gr?|oz|ml|lt?)\b.*$/i, '').trim();
    if (name.length < 3 || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1000) continue;
    const product = products.find(p => norm(name).includes(norm(p.canonical_name)) || norm(p.canonical_name).includes(norm(name)));
    drafts.push({
      productId: product?.id || '', name,
      package: product?.normalized_quantity && product?.normalized_unit_name ? product.normalized_quantity + ' ' + product.normalized_unit_name : '',
      quantity, unit, price: amount.toFixed(2), priceMode: 'line', selected: true
    });
  }
  return drafts.slice(0, 100);
};

const getInvoiceDuplicateGroups = items => {
  const groups = new Map();
  items.forEach((item, index) => {
    const identity = item.productId ? 'product:' + item.productId : 'name:' + norm(item.name || '');
    if (!identity || identity === 'name:') return;
    const key = [identity, norm(item.package || ''), norm(item.unit || 'unidad')].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(index);
  });
  return [...groups.values()].filter(group => group.length > 1);
};

const parseInvoiceTotals = text => {
  const lines = String(text || '').split(/\r?\n/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const parseAmount = raw => {
    if (raw.includes('.') && raw.includes(',')) return Number(raw.lastIndexOf('.') > raw.lastIndexOf(',') ? raw.replace(/,/g, '') : raw.replace(/\./g, '').replace(',', '.'));
    return Number(raw.replace(',', '.'));
  };
  const result = { total: null, subtotal: null, tax: 0, discount: 0 };
  for (const line of lines) {
    const match = line.match(/(?:B\/|USD|\$)?\s*(\d{1,4}(?:[.,]\d{3})*[.,]\d{2})\s*$/i);
    if (!match) continue;
    const amount = parseAmount(match[1]);
    if (!Number.isFinite(amount) || amount < 0 || amount > 100000) continue;
    const label = line.slice(0, match.index).trim();
    if (/^(?:total\s*(?:a\s*pagar|general|factura)?|importe\s*total|monto\s*total)\b/i.test(label)) result.total = amount;
    else if (/^subtotal\b/i.test(label)) result.subtotal = amount;
    else if (/^(?:itbms|impuesto|tax)\b/i.test(label)) result.tax += amount;
    else if (/^(?:descuento|descto|ahorro|promo(?:cion)?|cup[oó]n)\b/i.test(label)) result.discount += amount;
  }
  return result;
};

const dateLabel = value => value ? new Date(value + (String(value).length === 10 ? 'T12:00:00' : '')).toLocaleDateString('es-PA') : '—';
const norm = value => String(value ?? '').trim().toLocaleLowerCase('es').replace(/\s+/g, ' ');

export async function renderPurchases({ container, supabase, user }) {
  if (!container || !supabase || !user) return;
  let activePurchaseId = null;
  let stores = [], branches = [], products = [], purchases = [], adjustments = [];
  let barcodeMappings = [], canManageBarcodes = false;
  let rangeDays = '30';
  let invoiceDraft = [];
  let barcodeStream = null;
  let barcodeFrame = 0;
  let barcodeDetecting = false;\n  let barcodeAdminFormat = '';
  container.innerHTML = '<section class="purchase-module"><p class="empty">Cargando compras e inventario…</p></section>';

  const [storeResult, branchResult, productResult, barcodeAccess] = await Promise.all([
    supabase.from('supermarkets').select('id,name').eq('active', true).order('name'),
    supabase.from('supermarket_branches').select('id,name,supermarket_id').eq('active', true).order('name'),
    supabase.from('products').select('id,canonical_name,barcode,normalized_quantity,normalized_unit_name').eq('active', true).order('canonical_name'),
    supabase.rpc('is_price_reviewer')
  ]);
  if (storeResult.error || branchResult.error || productResult.error) {
    container.innerHTML = '<section class="purchase-module"><p class="empty">No se pudo cargar el catálogo de compras. Inténtalo de nuevo más tarde.</p></section>';
    return;
  }
  stores = storeResult.data || [];
  branches = branchResult.data || [];
  products = productResult.data || [];
  canManageBarcodes = !barcodeAccess.error && barcodeAccess.data === true;

  const reloadBarcodeMappings = async () => {
    const { data, error } = await supabase.from('product_barcodes')
      .select('id,product_id,barcode,created_at')
      .order('created_at', { ascending: false });
    if (!error) barcodeMappings = data || [];
  };
  await reloadBarcodeMappings();

  const loadData = async () => {
    const [purchaseResult, adjustmentResult] = await Promise.all([
      supabase.from('purchase_records')
        .select('id,user_id,supermarket_id,branch_id,purchase_date,receipt_reference,receipt_path,notes,supermarkets(name),supermarket_branches(name),purchase_items(id,product_id,item_name,package_description,quantity,unit,unit_price,line_total)')
        .eq('user_id', user.id).order('purchase_date', { ascending: false }).limit(300),
      supabase.from('inventory_adjustments')
        .select('id,product_id,item_name,package_description,unit,quantity_delta,reason,notes,occurred_at')
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
      const key = (item.product_id || 'name:' + norm(item.item_name)) + '|' + norm(item.package_description) + '|' + norm(item.unit);
      if (!productGroups.has(key)) productGroups.set(key, { name: item.item_name, package: item.package_description || '', unit: item.unit || 'unidad', productId: item.product_id, stores: new Map() });
      const group = productGroups.get(key);
      const current = group.stores.get(item.store);
      const entry = { date: item.date, price: Number(item.unit_price), quantity: Number(item.quantity), unit: item.unit || 'unidad' };
      if (!current || item.date > current.date) group.stores.set(item.store, entry);
    }

    const stockMap = new Map();
    for (const item of allItems) {
      const key = (item.product_id || 'name:' + norm(item.item_name)) + '|' + norm(item.package_description) + '|' + norm(item.unit);
      const previous = stockMap.get(key) || { name: item.item_name, package: item.package_description || '', unit: item.unit || 'unidad', quantity: 0 };
      previous.quantity += Number(item.quantity);
      stockMap.set(key, previous);
    }
    for (const move of adjustments) {
      const key = (move.product_id || 'name:' + norm(move.item_name)) + '|' + norm(move.package_description) + '|' + norm(move.unit);
      const previous = stockMap.get(key) || { name: move.item_name, package: move.package_description || '', unit: move.unit || 'unidad', quantity: 0 };
      previous.quantity += Number(move.quantity_delta);
      stockMap.set(key, previous);
    }
    const stockRows = [...stockMap.values()].sort((a,b) => a.name.localeCompare(b.name, 'es'));
    const barcodeAdminMarkup = canManageBarcodes ? `
      <section class="purchase-card barcode-admin-panel">
        <div class="purchase-card-head"><div><strong>Administrador de códigos de barras</strong><small>Asocia códigos reales a productos del catálogo. Puedes registrar varios empaques por producto; cada código sólo puede pertenecer a un producto.</small></div></div>
        <form id="barcode-admin-form" class="purchase-form barcode-admin-form">
          <label>Producto del catálogo<select id="barcode-admin-product" required><option value="">Selecciona un producto</option>${productOptions}</select></label>
          <label>Código de barras<input id="barcode-admin-value" type="text" maxlength="64" autocomplete="off" placeholder="Escanea con la cámara, lector o escribe el código" required></label>
          <button type="submit">Asociar código</button>
        </form>
        <div class="barcode-admin-camera-actions">
          <button type="button" class="secondary" id="scan-admin-barcode">Escanear con cámara</button>
          <button type="button" class="secondary" id="stop-admin-barcode" hidden>Detener cámara</button>
        </div>
        <div id="barcode-admin-camera-panel" class="barcode-camera-panel" hidden>
          <video id="barcode-admin-camera-video" playsinline muted></video>
          <small>Centra el código de barras dentro del encuadre. El código leído se copiará al campo; debes pulsar «Asociar código» para guardarlo.</small>
        </div>
        <small id="barcode-admin-status" class="purchase-message" aria-live="polite"></small>
        <div class="barcode-admin-list">${barcodeMappings.length ? barcodeMappings.map(mapping => {
          const product = products.find(item => item.id === mapping.product_id);
          return '<article class="barcode-admin-row"><div><strong>' + safe(product?.canonical_name || 'Producto no disponible') + '</strong><small>' + safe(mapping.barcode) + ' · Asociado ' + new Date(mapping.created_at).toLocaleString('es-PA') + '</small></div><button type="button" class="secondary" data-remove-barcode="' + mapping.id + '">Quitar</button></article>';
        }).join('') : '<small>Aún no hay códigos adicionales asociados.</small>'}</div>
      </section>` : '';

    container.innerHTML = `
      <section class="purchase-module">
        <div class="purchase-title"><div><p class="eyebrow">CONTROL PERSONAL</p><h3>Compras e inventario</h3><small>Registra lo que realmente compraste. Los precios del comparador no se convierten automáticamente en compras. El historial y el CSV incluyen hasta las 300 compras más recientes.</small></div><button type="button" class="secondary" id="export-purchases">Exportar gastos CSV</button></div>
        ${barcodeAdminMarkup}
        <div class="purchase-kpis">
          <article><small>Gastado este mes</small><b>${money(totalMonth)}</b></article>
          <article><small>Gasto acumulado</small><b>${money(totalAll)}</b></article>
          <article><small>Compras registradas</small><b>${purchases.length}</b></article>
        </div>
        <section class="purchase-card">
          <strong>Registrar una compra</strong>
          <form id="purchase-create" class="purchase-form">
            <label>Supermercado<select id="purchase-store" required><option value="">Selecciona</option>${storeOptions}</select></label>
            <label>Sucursal (opcional)<select id="purchase-branch"><option value="">No especificada / tienda en línea</option>${branchOptions}</select></label>
            <label>Fecha de compra<input id="purchase-date" type="date" value="${localDate()}" required></label>
            <label>Factura o referencia (opcional)<input id="purchase-reference" maxlength="120" placeholder="N.º de factura"></label>
            <label class="wide">Notas (opcional)<input id="purchase-notes" maxlength="1000" placeholder="Observaciones de la compra"></label>
            <button type="submit">Crear compra</button>
          </form>
          <small id="purchase-message" class="purchase-message" aria-live="polite"></small>
        </section>
        ${activePurchaseId ? (() => {
          const p = purchases.find(x => x.id === activePurchaseId);
          return p ? `<section class="purchase-card active-purchase"><div class="purchase-card-head"><div><strong>Compra en curso · ${safe(p.supermarkets?.name || 'Supermercado')}</strong><small>${dateLabel(p.purchase_date)} · ${safe(p.supermarket_branches?.name || 'Sucursal no indicada')}</small></div><button type="button" class="secondary" id="close-active-purchase">Cerrar</button></div>
          <div class="receipt-upload">
            <label>Comprobante de compra (foto o PDF, máximo 8 MB)<input id="purchase-receipt-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"></label>
            <button type="button" class="secondary" id="upload-purchase-receipt">Guardar comprobante</button>
            <small id="receipt-message" class="purchase-message" aria-live="polite"></small>
            ${p.receipt_path ? '<button type="button" class="secondary" data-receipt-path="' + safe(p.receipt_path) + '">Ver comprobante guardado</button>' : ''}
          </div>
          <section class="invoice-ocr">
            <strong>Lectura preliminar de factura</strong>
            <small>Procesamiento local de imágenes en este navegador. La foto no se envía a un servicio de OCR. Revisa y corrige el texto detectado; todavía no se registran artículos automáticamente.</small>
            <button type="button" class="secondary" id="read-purchase-invoice">Leer factura desde foto</button>
            <small id="invoice-ocr-status" class="purchase-message" aria-live="polite"></small>
            <label for="invoice-ocr-text">Texto reconocido (editable)</label>
            <textarea id="invoice-ocr-text" rows="7" maxlength="12000" placeholder="El texto reconocido aparecerá aquí para que puedas revisarlo."></textarea>
            <div class="invoice-metadata">
              <strong>Datos detectados de la factura</strong>
              <small>Son sugerencias. Comprueba cada dato y aplícalos sólo si coinciden con tu comprobante.</small>
              <label>Supermercado<select id="invoice-meta-store"><option value="">No detectado</option>${storeOptions}</select></label>
              <label>Sucursal<select id="invoice-meta-branch"><option value="">No especificada</option>${branchOptions}</select></label>
              <label>Fecha de compra<input id="invoice-meta-date" type="date"></label>
              <label>Número o referencia<input id="invoice-meta-reference" maxlength="120" placeholder="No detectado"></label>
              <button type="button" class="secondary" id="apply-invoice-metadata">Aplicar datos a esta compra</button>
              <small id="invoice-meta-status" class="purchase-message" aria-live="polite"></small>
            </div>
            <button type="button" class="secondary" id="prepare-invoice-draft">Preparar artículos desde el texto</button>
            <small class="invoice-ocr-note">Se omiten líneas de impuestos, totales, descuentos y promociones para evitar registrarlas como productos. Los artículos por peso se convierten a lb, kg u oz; revisa siempre cantidad e importe antes de confirmar.</small>
            <div id="invoice-draft-list"></div>
            <div id="invoice-reconciliation" class="invoice-ocr-note" aria-live="polite"></div>
            <button type="button" id="confirm-invoice-draft" disabled>Agregar artículos revisados a esta compra</button>
          </section>
          <form id="purchase-add-item" class="purchase-form item-form">
            <label>Producto del catálogo<select id="purchase-product"><option value="">Artículo libre</option>${productOptions}</select></label>
            <label class="wide">Código de barras<input id="purchase-barcode" type="text" inputmode="numeric" autocomplete="off" placeholder="Escanea o escribe el código"></label>
            <div class="barcode-actions wide"><button type="button" class="secondary" id="lookup-purchase-barcode">Buscar código</button><button type="button" class="secondary" id="scan-purchase-barcode">Abrir cámara para escanear</button></div>
            <div id="barcode-camera-panel" class="barcode-camera-panel wide" hidden><video id="barcode-camera-video" autoplay playsinline muted></video><button type="button" class="secondary" id="stop-purchase-barcode">Detener cámara</button></div>
            <small id="barcode-scan-status" class="purchase-message wide" aria-live="polite">Puedes usar la cámara o un lector USB/Bluetooth. El código se consulta contra el catálogo.</small>
            <label>Nombre del artículo<input id="purchase-item-name" maxlength="180" placeholder="Ej. arroz blanco"></label>
            <label>Presentación<input id="purchase-package" maxlength="180" placeholder="Ej. bolsa de 5 lb"></label>
            <label>Cantidad<input id="purchase-quantity" type="number" min="0.001" step="0.001" value="1" required></label>
            <label>Unidad<input id="purchase-unit" maxlength="40" value="unidad" required></label>
            <label>Precio por unidad (USD)<input id="purchase-unit-price" type="number" min="0" step="0.01" required placeholder="0.00"></label>
            <button type="submit">Agregar artículo</button>
          </form>
          <div id="active-purchase-items">${(p.purchase_items || []).map(i => '<div class="purchase-line"><span>' + safe(i.item_name) + ' · ' + safe(i.quantity) + ' ' + safe(i.unit) + '</span><b>' + money(i.line_total) + '</b></div>').join('') || '<small>Aún no has agregado artículos.</small>'}</div>
          <div class="purchase-grand-total"><span>Total registrado</span><b>${money((p.purchase_items || []).reduce((sum,i)=>sum+Number(i.line_total || 0),0))}</b></div>
          </section>` : '' })() : ''}
        <section class="purchase-card">
          <div class="purchase-card-head"><div><strong>Gastos por supermercado</strong><small>Totales de compras registradas durante el mes actual.</small></div></div>
          ${monthByStore.size ? [...monthByStore].sort((a,b)=>b[1]-a[1]).map(([name,total])=>'<div class="store-spend"><span>'+safe(name)+'</span><b>'+money(total)+'</b></div>').join('') : '<small>Aún no hay compras registradas este mes.</small>'}
        </section>
        <section class="purchase-card">
          <div class="purchase-card-head"><div><strong>Comparativa de compras entre supermercados</strong><small>Indica dónde sí registraste cada producto y dónde no aparece comprado en el periodo.</small></div><select id="purchase-range" aria-label="Periodo de comparación"><option value="30" ${rangeDays==='30'?'selected':''}>Últimos 30 días</option><option value="90" ${rangeDays==='90'?'selected':''}>Últimos 90 días</option><option value="all" ${rangeDays==='all'?'selected':''}>Todo el historial</option></select></div>
          <div class="purchase-compare-wrap">${productGroups.size ? '<table class="purchase-compare"><thead><tr><th>Producto</th>'+stores.map(s=>'<th>'+safe(s.name)+'</th>').join('')+'</tr></thead><tbody>'+[...productGroups.values()].sort((a,b)=>a.name.localeCompare(b.name,'es')).map(g=>'<tr><td><strong>'+safe(g.name)+'</strong><small>'+safe(g.package)+'</small></td>'+stores.map(s=>{const bought=g.stores.get(s.name);return '<td class="'+(bought?'bought':'not-bought')+'">'+(bought?'<b>Comprado</b><small>'+dateLabel(bought.date)+'</small><small>'+money(bought.price)+' / '+safe(bought.unit)+'</small>':'<span>No registrado</span>')+'</td>';}).join('')+'</tr>').join('')+'</tbody></table>' : '<small>Registra compras para comparar qué productos adquiriste en cada supermercado.</small>'}</div>
          <small class="purchase-footnote">“No registrado” significa que no hay una compra guardada de ese producto en ese supermercado durante el periodo elegido; no significa que el supermercado no lo venda.</small>
        </section>
        <section class="purchase-card">
          <strong>Inventario estimado de lo comprado</strong>
          <small>Se suman las cantidades compradas y se restan consumos, mermas o correcciones que registres.</small>
          ${stockRows.length ? stockRows.map(s=>'<div class="store-spend"><span>'+safe(s.name)+' <small>'+safe(s.package)+' · '+safe(s.unit)+'</small></span><b class="'+(s.quantity<0?'negative-stock':'')+'">'+s.quantity.toLocaleString('es-PA',{maximumFractionDigits:3})+'</b></div>').join('') : '<small>El inventario aparecerá cuando registres compras.</small>'}
          <form id="inventory-adjust" class="purchase-form inventory-form">
            <label>Producto<select id="adjust-product"><option value="">Artículo libre</option>${productOptions}</select></label>
            <label>Nombre<input id="adjust-name" maxlength="180" placeholder="Producto"></label>
            <label>Presentación<input id="adjust-package" maxlength="180" placeholder="Ej. bolsa de 5 lb"></label>
            <label>Unidad<input id="adjust-unit" maxlength="40" value="unidad"></label>
            <label>Tipo<select id="adjust-reason"><option value="consumption">Consumo</option><option value="spoilage">Merma / vencido</option><option value="correction">Corrección de inventario</option></select></label>
            <label>Cantidad<input id="adjust-quantity" type="number" step="0.001" min="0.001" required placeholder="Cantidad"></label>
            <button type="submit">Registrar movimiento</button>
          </form>
          <small id="adjust-message" class="purchase-message" aria-live="polite"></small>
        </section>
        <section class="purchase-card">
          <strong>Historial de compras</strong>
          ${purchases.length ? purchases.map(p=>{const items=p.purchase_items||[],total=items.reduce((sum,i)=>sum+Number(i.line_total||0),0);return '<details class="purchase-history"><summary><span><b>'+safe(p.supermarkets?.name||'Supermercado')+'</b><small>'+dateLabel(p.purchase_date)+' · '+items.length+' artículo(s)'+(p.supermarket_branches?.name?' · '+safe(p.supermarket_branches.name):'')+'</small></span><strong>'+money(total)+'</strong></summary><div class="history-items">'+items.map(i=>'<div><span>'+safe(i.item_name)+' · '+safe(i.quantity)+' '+safe(i.unit)+'</span><b>'+money(i.line_total)+'</b></div>').join('')+(p.receipt_reference?'<small>Factura: '+safe(p.receipt_reference)+'</small>':'')+(p.receipt_path?'<button type="button" class="secondary" data-receipt-path="'+safe(p.receipt_path)+'">Ver comprobante</button>':'')+(p.notes?'<small>'+safe(p.notes)+'</small>':'')+'</div></details>';}).join('') : '<small>Aún no hay compras guardadas.</small>'}
        </section>
      </section>`;

    container.querySelector('#export-purchases')?.addEventListener('click', () => {
      const blob = new Blob([buildPurchasesCsv(purchases)], {type:'text/csv;charset=utf-8'});
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'mi-compra-gastos-' + localDate() + '.csv';
      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    });

    container.querySelector('#read-purchase-invoice')?.addEventListener('click', async () => {
      const file = container.querySelector('#purchase-receipt-file')?.files?.[0];
      const status = container.querySelector('#invoice-ocr-status');
      const output = container.querySelector('#invoice-ocr-text');
      if (!file || !['image/jpeg','image/png','image/webp'].includes(file.type)) {
        status.textContent = 'Selecciona una foto JPG, PNG o WebP. Los PDF se pueden guardar, pero esta lectura preliminar acepta imágenes.';
        return;
      }
      if (file.size > 8 * 1024 * 1024) { status.textContent = 'La imagen supera el límite de 8 MB.'; return; }
      status.textContent = 'Preparando el motor de lectura en este dispositivo…';
      try {
        if (!window.Tesseract) {
          await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
            script.async = true;
            script.onload = resolve;
            script.onerror = () => reject(new Error('No se pudo cargar el motor OCR. Comprueba tu conexión e inténtalo de nuevo.'));
            document.head.appendChild(script);
          });
        }
        status.textContent = 'Leyendo la factura. En teléfonos puede tardar un poco…';
        const result = await window.Tesseract.recognize(file, 'spa+eng', {
          logger: progress => {
            if (progress.status === 'recognizing text' && Number.isFinite(progress.progress)) status.textContent = 'Reconociendo texto: ' + Math.round(progress.progress * 100) + '%';
          }
        });
        const recognized = String(result?.data?.text || '').trim();
        if (!recognized) { status.textContent = 'No se detectó texto legible. Prueba con una foto más nítida, bien iluminada y tomada de frente.'; return; }
        
        output.value = recognized.slice(0, 12000);
        const suggestions = parseInvoiceMetadata(recognized, stores, branches);
        const metaStore = container.querySelector('#invoice-meta-store');
        const metaBranch = container.querySelector('#invoice-meta-branch');
        const metaDate = container.querySelector('#invoice-meta-date');
        const metaRef = container.querySelector('#invoice-meta-reference');
        if (metaStore) metaStore.value = suggestions.supermarketId;
        if (metaBranch) metaBranch.value = suggestions.branchId;
        if (metaDate) metaDate.value = suggestions.purchaseDate;
        if (metaRef) metaRef.value = suggestions.receiptReference;
        if (metaBranch) [...metaBranch.options].forEach(o => { if (o.value) o.hidden = !!metaStore?.value && o.dataset.store !== metaStore.value; });

        status.textContent = 'Lectura terminada. Revisa el texto y corrige errores antes de usarlo. No se ha guardado ningún artículo automáticamente.';
      } catch (error) {
        status.textContent = error?.message || 'No se pudo leer la factura. Puedes guardar el comprobante y registrar la compra manualmente.';
      }
    });

    const drawInvoiceDraft = () => {
      const host = container.querySelector('#invoice-draft-list');
      const confirm = container.querySelector('#confirm-invoice-draft');
      if (!host) return;
      const duplicateGroups = getInvoiceDuplicateGroups(invoiceDraft);
      const duplicateIndexes = new Set(duplicateGroups.flat());
      host.innerHTML = invoiceDraft.length ? invoiceDraft.map((item,index) => '<div class="invoice-draft-row" data-invoice-row="'+index+'"><label><input type="checkbox" data-field="selected" '+(item.selected?'checked':'')+'> Incluir</label><label>Artículo<input data-field="name" maxlength="180" value="'+safe(item.name)+'"></label><label>Producto de catálogo<select data-field="productId"><option value="">Artículo libre</option>'+products.map(p=>'<option value="'+p.id+'" '+(item.productId===p.id?'selected':'')+'>'+safe(p.canonical_name)+'</option>').join('')+'</select></label><div class="invoice-draft-grid"><label>Presentación<input data-field="package" maxlength="180" value="'+safe(item.package)+'"></label><label>Cantidad<input data-field="quantity" type="number" min="0.001" step="0.001" value="'+safe(item.quantity)+'"></label><label>Unidad<input data-field="unit" maxlength="40" value="'+safe(item.unit)+'"></label><label>El importe leído es<select data-field="priceMode"><option value="line" '+(item.priceMode==='line'?'selected':'')+'>Total de la línea</option><option value="unit" '+(item.priceMode==='unit'?'selected':'')+'>Precio unitario</option></select></label><label>Importe leído USD<input data-field="price" type="number" min="0" step="0.01" value="'+safe(item.price)+'"></label><small class="invoice-line-calculation">Precio unitario calculado: <b>'+money(item.priceMode==='line' ? Number(item.price)/Math.max(Number(item.quantity),0.001) : Number(item.price))+'</b> · Total línea: <b>'+money(item.priceMode==='line' ? Number(item.price) : Number(item.price)*Number(item.quantity))+'</b></small></div>'+(duplicateIndexes.has(index)?'<small class="invoice-duplicate-warning">Posible artículo repetido. Compara cantidad e importe con la otra línea; no se combinará automáticamente.</small>':'')+'</div>').join('') : '<small>No se detectaron líneas con precio claro. Puedes corregir el texto o agregar artículos manualmente.</small>';
      if (confirm) confirm.disabled = !invoiceDraft.some(x => x.selected && x.name.trim() && Number(x.quantity)>0 && Number(x.price)>=0);
      const reconciliation = container.querySelector('#invoice-reconciliation');
      if (reconciliation) {
        const duplicateNote = duplicateGroups.length ? ' · ' + duplicateGroups.length + ' grupo(s) de posibles repetidos: revisa las líneas marcadas antes de confirmar.' : ' · No se detectaron posibles artículos repetidos.';
        const lineSum = invoiceDraft.filter(x => x.selected).reduce((sum,x) => sum + (x.priceMode === 'line' ? Number(x.price) || 0 : (Number(x.price) || 0) * (Number(x.quantity) || 0)), 0);
        const totals = parseInvoiceTotals(container.querySelector('#invoice-ocr-text')?.value || '');
        if (totals.total == null) reconciliation.textContent = 'Verificación de factura: no se detectó un total final legible. La suma preliminar de artículos seleccionados es ' + money(lineSum) + duplicateNote;
        else {
          const difference = totals.total - lineSum;
          const matches = Math.abs(difference) <= 0.02;
          reconciliation.textContent = (matches ? 'La suma de los artículos coincide con el total detectado. ' : 'Hay una diferencia entre los artículos y el total de la factura. ') +
            'Artículos: ' + money(lineSum) + ' · Total factura: ' + money(totals.total) + ' · Diferencia: ' + money(difference) +
            (totals.tax || totals.discount ? ' · ITBMS/descuentos detectados: ' + money(totals.tax - totals.discount) : '') +
            ' No se modificó ningún importe; revisa líneas omitidas, impuestos, descuentos o errores del OCR.' + duplicateNote;
        }
      }
    };

    const metaStore = container.querySelector('#invoice-meta-store');
    const metaBranch = container.querySelector('#invoice-meta-branch');
    const filterMetaBranches = () => {
      const selected = metaStore?.value || '';
      [...(metaBranch?.options || [])].forEach(option => {
        if (!option.value) return;
        option.hidden = !!selected && option.dataset.store !== selected;
        if (option.hidden && option.selected) metaBranch.value = '';
      });
    };
    metaStore?.addEventListener('change', filterMetaBranches);
    filterMetaBranches();
    container.querySelector('#apply-invoice-metadata')?.addEventListener('click', async () => {
      const status = container.querySelector('#invoice-meta-status');
      const supermarketId = metaStore?.value || '';
      const branchId = metaBranch?.value || '';
      const selectedBranch = branches.find(b => b.id === branchId);
      if (!activePurchaseId) return;
      if (selectedBranch && selectedBranch.supermarket_id !== supermarketId) {
        status.textContent = 'La sucursal seleccionada no corresponde al supermercado. Corrige la selección.';
        return;
      }
      const existingPurchase = purchases.find(p => p.id === activePurchaseId);
      const effectiveStoreId = supermarketId || existingPurchase?.supermarket_id || '';
      const payload = {
        supermarket_id: effectiveStoreId,
        branch_id: branchId || (effectiveStoreId === existingPurchase?.supermarket_id ? existingPurchase?.branch_id || null : null)
      };
      const dateValue = container.querySelector('#invoice-meta-date')?.value || '';
      const referenceValue = container.querySelector('#invoice-meta-reference')?.value.trim() || '';
      if (dateValue) payload.purchase_date = dateValue;
      payload.receipt_reference = referenceValue || null;
      if (!payload.supermarket_id) { status.textContent = 'Selecciona un supermercado antes de aplicar los datos.'; return; }
      status.textContent = 'Aplicando datos confirmados…';
      const { error } = await supabase.from('purchase_records').update(payload).eq('id', activePurchaseId).eq('user_id', user.id);
      if (error) { status.textContent = 'No se pudieron aplicar los datos. Revisa los permisos e inténtalo de nuevo.'; return; }
      status.textContent = 'Datos de factura aplicados a esta compra.';
      await refresh();
    });

    container.querySelector('#prepare-invoice-draft')?.addEventListener('click', () => {
      invoiceDraft = parseInvoiceDraft(container.querySelector('#invoice-ocr-text')?.value || '', products);
      drawInvoiceDraft();
      const status = container.querySelector('#invoice-ocr-status');
      status.textContent = invoiceDraft.length ? 'Se prepararon '+invoiceDraft.length+' línea(s) preliminares. Revisa nombres, cantidades y precios; el OCR puede equivocarse.' : 'No se encontraron líneas con un precio reconocible. Puedes ingresar los artículos manualmente.';
    });
    container.querySelector('#invoice-draft-list')?.addEventListener('change', event => {
      const row = event.target.closest('[data-invoice-row]');
      if (!row) return;
      const item = invoiceDraft[Number(row.dataset.invoiceRow)];
      const field = event.target.dataset.field;
      if (!item || !field) return;
      item[field] = field === 'selected' ? event.target.checked : event.target.value;
      drawInvoiceDraft();
    });
    container.querySelector('#invoice-draft-list')?.addEventListener('input', event => {
      const row = event.target.closest('[data-invoice-row]');
      if (!row) return;
      const item = invoiceDraft[Number(row.dataset.invoiceRow)];
      const field = event.target.dataset.field;
      if (!item || !field) return;
      item[field] = field === 'selected' ? event.target.checked : event.target.value;
      if (field === 'quantity' || field === 'price') {
        const quantity = Math.max(Number(item.quantity) || 0, 0.001);
        const amount = Math.max(Number(item.price) || 0, 0);
        const unitPrice = item.priceMode === 'line' ? amount / quantity : amount;
        const lineTotal = item.priceMode === 'line' ? amount : amount * quantity;
        const preview = row.querySelector('.invoice-line-calculation');
        if (preview) preview.innerHTML = 'Precio unitario calculado: <b>' + money(unitPrice) + '</b> · Total línea: <b>' + money(lineTotal) + '</b>';
      }
      const confirm = container.querySelector('#confirm-invoice-draft');
      if (confirm) confirm.disabled = !invoiceDraft.some(x => x.selected && x.name.trim() && Number(x.quantity)>0 && Number(x.price)>=0);
    });
    container.querySelector('#confirm-invoice-draft')?.addEventListener('click', async () => {
      const button = container.querySelector('#confirm-invoice-draft');
      const status = container.querySelector('#invoice-ocr-status');
      const selected = invoiceDraft.filter(x => x.selected);
      if (!activePurchaseId || !selected.length) return;
      if (selected.some(x => !x.name.trim() || !Number.isFinite(Number(x.quantity)) || Number(x.quantity)<=0 || !Number.isFinite(Number(x.price)) || Number(x.price)<0)) {
        status.textContent = 'Corrige los nombres, cantidades y precios antes de agregar los artículos.'; return;
      }
      button.disabled = true;
      status.textContent = 'Agregando artículos revisados…';
      for (const item of selected) {
        const { error } = await supabase.from('purchase_items').insert({
          purchase_id: activePurchaseId, user_id: user.id, product_id: item.productId || null,
          item_name: item.name.trim(), package_description: item.package.trim() || null,
          quantity: Number(item.quantity), unit: item.unit.trim() || 'unidad', unit_price: Number(item.priceMode === 'line' ? Number(item.price) / Number(item.quantity) : item.price)
        });
        if (error) {
          status.textContent = 'Se detuvo el registro por un error. Los artículos anteriores podrían haberse guardado; revisa la compra antes de volver a intentarlo.';
          button.disabled = false;
          await refresh();
          return;
        }
      }
      invoiceDraft = [];
      status.textContent = 'Artículos revisados agregados a la compra.';
      await refresh();
    });

    container.querySelector('#upload-purchase-receipt')?.addEventListener('click', async () => {
      const input = container.querySelector('#purchase-receipt-file');
      const message = container.querySelector('#receipt-message');
      const file = input?.files?.[0];
      if (!file || !activePurchaseId) { message.textContent = 'Selecciona primero una foto o PDF.'; return; }
      const allowed = ['image/jpeg','image/png','image/webp','application/pdf'];
      if (!allowed.includes(file.type) || file.size > 8 * 1024 * 1024) { message.textContent = 'Formato no permitido o archivo mayor de 8 MB.'; return; }
      message.textContent = 'Guardando comprobante…';
      const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'comprobante';
      const path = user.id + '/' + activePurchaseId + '/' + crypto.randomUUID() + '-' + cleanName;
      const { error: uploadError } = await supabase.storage.from('purchase-receipts').upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) { message.textContent = 'No se pudo guardar el archivo. Comprueba tu conexión e inténtalo de nuevo.'; return; }
      const { error: updateError } = await supabase.from('purchase_records').update({ receipt_path: path }).eq('id', activePurchaseId).eq('user_id', user.id);
      if (updateError) {
        await supabase.storage.from('purchase-receipts').remove([path]);
        message.textContent = 'El archivo se subió, pero no se pudo vincular a la compra.';
        return;
      }
      message.textContent = 'Comprobante guardado de forma privada.';
      await refresh();
    });

    container.querySelectorAll('[data-receipt-path]').forEach(button => button.addEventListener('click', async () => {
      const tab = window.open('about:blank', '_blank');
      const { data, error } = await supabase.storage.from('purchase-receipts').createSignedUrl(button.dataset.receiptPath, 3600);
      if (error || !data?.signedUrl) { if (tab) tab.close(); alert('No se pudo abrir el comprobante.'); return; }
      if (tab) tab.location.href = data.signedUrl;
      else window.location.href = data.signedUrl;
    }));

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

    const stopBarcodeCamera = () => {
      barcodeDetecting = false;
      if (barcodeFrame) cancelAnimationFrame(barcodeFrame);
      barcodeFrame = 0;
      if (barcodeStream) barcodeStream.getTracks().forEach(track => track.stop());
      barcodeStream = null;
      ['#barcode-camera-panel', '#barcode-admin-camera-panel'].forEach(selector => {
        const panel = container.querySelector(selector);
        if (panel) panel.hidden = true;
      });
      ['#barcode-camera-video', '#barcode-admin-camera-video'].forEach(selector => {
        const video = container.querySelector(selector);
        if (video) video.srcObject = null;
      });
      ['#stop-admin-barcode', '#stop-purchase-barcode'].forEach(selector => {
        const button = container.querySelector(selector);
        if (button) button.hidden = true;
      });
    };
    const startBarcodeCamera = async ({ videoId, panelId, statusId, stopButtonId, onDetected }) => {
      const status = container.querySelector(statusId);
      if (!('BarcodeDetector' in globalThis)) {
        if (status) status.textContent = 'Este navegador no permite leer códigos con la cámara. Puedes usar un lector USB/Bluetooth o escribir el código.';
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        if (status) status.textContent = 'La cámara requiere HTTPS y permiso del navegador. Puedes escribir el código manualmente.';
        return;
      }
      stopBarcodeCamera();
      try {
        const supported = await globalThis.BarcodeDetector.getSupportedFormats();
        const formats = ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','itf','qr_code'].filter(format => supported.includes(format));
        if (!formats.length) throw new Error('Este navegador no admite formatos de productos compatibles.');
        const detector = new globalThis.BarcodeDetector({ formats });
        barcodeStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        const video = container.querySelector(videoId);
        const panel = container.querySelector(panelId);
        if (!video || !panel) { stopBarcodeCamera(); return; }
        video.srcObject = barcodeStream;
        panel.hidden = false;
        const stopButton = container.querySelector(stopButtonId);
        if (stopButton) stopButton.hidden = false;
        await video.play();
        barcodeDetecting = true;
        if (status) status.textContent = 'Cámara activa. Coloca el código dentro del encuadre.';
        let lastScan = 0;
        const scanFrame = async () => {
          if (!barcodeDetecting || !video || video.readyState < 2) {
            if (barcodeDetecting) barcodeFrame = requestAnimationFrame(scanFrame);
            return;
          }
          const now = Date.now();
          if (now - lastScan >= 220) {
            lastScan = now;
            try {
              const results = await detector.detect(video);
              if (results.length && barcodeDetecting) {
                barcodeDetecting = false;
                onDetected(results[0].rawValue, results[0].format);
                stopBarcodeCamera();
                return;
              }
            } catch (_) {}
          }
          if (barcodeDetecting) barcodeFrame = requestAnimationFrame(scanFrame);
        };
        barcodeFrame = requestAnimationFrame(scanFrame);
      } catch (error) {
        stopBarcodeCamera();
        if (status) status.textContent = error.name === 'NotAllowedError'
          ? 'No se concedió permiso para usar la cámara. Habilítalo en el navegador o escribe el código manualmente.'
          : 'No se pudo iniciar el escáner: ' + (error.message || 'revisa la cámara y los permisos') + '.';
      }
    };
    const applyScannedBarcode = async (rawValue, format = '') => {
      const code = normalizeProductBarcode(rawValue);
      const field = container.querySelector('#purchase-barcode');
      const status = container.querySelector('#barcode-scan-status');
      if (!code) return;
      if (!isValidBarcodeChecksum(code, format)) {
        if (status) status.textContent = 'El dígito de control del código ' + code + ' no es válido. Limpia el código y vuelve a escanearlo.';
        stopBarcodeCamera();
        return;
      }
      if (field) field.value = code;
      const product = findProductByBarcode(products, code, barcodeMappings);
      if (product) {
        const selector = container.querySelector('#purchase-product');
        if (selector) {
          selector.value = product.id;
          selector.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (status) status.textContent = 'Producto identificado: ' + product.canonical_name + '. Revisa cantidad y precio antes de agregarlo.';
        stopBarcodeCamera();
        container.querySelector('#purchase-quantity')?.focus();
        return;
      }
      if (status) status.textContent = 'Código ' + code + ' leído, pero todavía no está asociado a un producto del catálogo. Selecciona el artículo manualmente; no se creó ni modificó ningún producto.';
      stopBarcodeCamera();
    };
    const lookupBarcode = async () => {
      const code = normalizeProductBarcode(container.querySelector('#purchase-barcode')?.value);
      if (!code) return;
      const status = container.querySelector('#barcode-scan-status');
      if (!isValidBarcodeChecksum(code)) { if (status) status.textContent = 'El dígito de control del código numérico no es válido. Corrígelo o vuelve a escanearlo.'; return; }
      const product = findProductByBarcode(products, code, barcodeMappings);
      if (product) { await applyScannedBarcode(code); return; }
      if (status) status.textContent = 'Código leído, pero no encontrado en los códigos registrados del catálogo. Selecciona el producto manualmente.';
    };
    container.querySelector('#barcode-admin-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      const productId = container.querySelector('#barcode-admin-product')?.value;
      const code = normalizeProductBarcode(container.querySelector('#barcode-admin-value')?.value);
      const status = container.querySelector('#barcode-admin-status');
      if (!productId || !code) { if (status) status.textContent = 'Selecciona un producto e introduce un código válido.'; return; }
      if (!/^[A-Z0-9]{4,64}$/.test(code)) { if (status) status.textContent = 'El código debe tener entre 4 y 64 caracteres alfanuméricos.'; return; }\n      if (!isValidBarcodeChecksum(code, barcodeAdminFormat)) { if (status) status.textContent = 'El dígito de control no coincide. Revisa el código antes de asociarlo.'; return; }
      if (findProductByBarcode(products, code, barcodeMappings)) {
        if (status) status.textContent = 'Este código ya está asociado a un producto del catálogo. No se creó un duplicado.';
        return;
      }
      const { error } = await supabase.from('product_barcodes').insert({ product_id: productId, barcode: code, created_by: user.id });
      if (error) {
        if (status) status.textContent = error.code === '23505' ? 'Ese código ya está registrado. Cada código sólo puede pertenecer a un producto.' : 'No se pudo asociar el código. Verifica los datos y tus permisos.';
        return;
      }
      if (status) status.textContent = 'Código asociado correctamente.';
      await refresh();
    });
    container.querySelectorAll('[data-remove-barcode]').forEach(button => button.addEventListener('click', async () => {
      if (!canManageBarcodes || !confirm('¿Quitar este código del catálogo?')) return;
      button.disabled = true;
      const { error } = await supabase.from('product_barcodes').delete().eq('id', button.dataset.removeBarcode);
      if (error) { button.disabled = false; alert('No se pudo quitar el código.'); return; }
      await refresh();
    }));
    container.querySelector('#lookup-purchase-barcode')?.addEventListener('click', lookupBarcode);
    container.querySelector('#purchase-barcode')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); lookupBarcode(); }
    });
    container.querySelector('#scan-purchase-barcode')?.addEventListener('click', () => {
      startBarcodeCamera({
        videoId: '#barcode-camera-video',
        panelId: '#barcode-camera-panel',
        statusId: '#barcode-scan-status',
        stopButtonId: '#stop-purchase-barcode',
        onDetected: applyScannedBarcode
      });
    });
    container.querySelector('#barcode-admin-value')?.addEventListener('input', () => { barcodeAdminFormat = ''; });\n    container.querySelector('#scan-admin-barcode')?.addEventListener('click', () => {
      startBarcodeCamera({
        videoId: '#barcode-admin-camera-video',
        panelId: '#barcode-admin-camera-panel',
        statusId: '#barcode-admin-status',
        stopButtonId: '#stop-admin-barcode',
        onDetected: rawValue => {
          const code = normalizeProductBarcode(rawValue);
          const field = container.querySelector('#barcode-admin-value');
          const status = container.querySelector('#barcode-admin-status');
          if (field) field.value = code;
          if (!/^[A-Z0-9]{4,64}$/.test(code)) {
            if (status) status.textContent = 'Código leído, pero su formato no es válido. Puedes corregirlo manualmente.';
          } else if (findProductByBarcode(products, code, barcodeMappings)) {
            if (status) status.textContent = 'Código leído: ' + code + '. Ya está asociado a un producto; no se guardará un duplicado.';
          } else if (status) {
            status.textContent = 'Código leído: ' + code + '. Selecciona el producto y pulsa «Asociar código» para guardarlo.';
          }
        }
      });
    });
    container.querySelector('#stop-purchase-barcode')?.addEventListener('click', () => {
      stopBarcodeCamera();
      const status = container.querySelector('#barcode-scan-status');
      if (status) status.textContent = 'Escáner detenido.';
    });
    container.querySelector('#stop-admin-barcode')?.addEventListener('click', () => {
      stopBarcodeCamera();
      const status = container.querySelector('#barcode-admin-status');
      if (status) status.textContent = 'Escáner detenido. El código leído, si lo había, permanece en el campo.';
    });
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
      if (p) { container.querySelector('#adjust-name').value = p.canonical_name; container.querySelector('#adjust-package').value = p.normalized_quantity && p.normalized_unit_name ? p.normalized_quantity + ' ' + p.normalized_unit_name : ''; }
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
      const { error } = await supabase.from('inventory_adjustments').insert({ user_id: user.id, product_id: productId, item_name: itemName, package_description: container.querySelector('#adjust-package').value.trim() || null, unit: container.querySelector('#adjust-unit').value.trim() || 'unidad', quantity_delta: delta, reason });
      const message = container.querySelector('#adjust-message');
      if (error) { message.textContent = 'No se pudo guardar el movimiento de inventario.'; return; }
      message.textContent = 'Movimiento registrado.';
      await refresh();
    });
  };

  const refresh = async () => {
    stopBarcodeCamera();
    try { await Promise.all([loadData(), reloadBarcodeMappings()]); await render(); }
    catch (error) { container.innerHTML = '<section class="purchase-module"><p class="empty">' + safe(error.message) + '</p></section>'; }
  };
  await refresh();
}
