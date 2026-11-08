import { createClient } from '@supabase/supabase-js';
import './style.css';
import { importPriceCsv } from './price-import.js';
import { renderStoreProductMappingManager } from './store-mapping.js';
import { renderPurchases, normalizeProductBarcode, isValidBarcodeChecksum } from './purchases.js';
import { getProductRegistrationCheck, validateProductRegistrationDraft } from './catalog-admin.js';
import { parseCatalogCsv, analyzeCatalogImportRows } from './catalog-import.js';
import { findCatalogNameMatches, findDuplicateListItem } from './catalog-duplicates.js';
import { renderSpendingDashboard } from './spending.js';
import { renderPersonalPantry } from './pantry.js';
import { renderWeeklyPlan, sortShoppingItemsByPriority } from './weekly-plan.js';

const env = import.meta.env;
const configured = Boolean(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY);
const supabase = configured ? createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY) : null;
const stores = [
  { name: 'Super 99', url: 'https://www.super99.com/nuestra-tienda-en-linea', sourceLabel: 'Catálogo en línea · precios sujetos a sucursal' },
  { name: 'El Rey', sourceLabel: 'Sin catálogo público de precios verificado' },
  { name: 'Xtra', url: 'https://nuevatienda.superxtra.com/supermercado', sourceLabel: 'Catálogo en línea · ubicación por confirmar' },
  { name: 'Riba Smith', url: 'https://www.ribasmith.com/', sourceLabel: 'Catálogo en línea · precio por verificar al consultar' },
  { name: 'Machetazo', url: 'https://www.elmachetazo.com/supermercado', sourceLabel: 'Catálogo público · precios aún no validados' },
  { name: 'Jumbo', url: 'https://jumbo.com.pa/497-alimentos-frescos-y-congelados', sourceLabel: 'Catálogo web · fecha y sucursal por validar' }
];
// Acceso temporal de consulta mientras se termina de configurar el correo de autenticación.
// Mantiene RLS intacto: no abre datos personales ni crea usuarios anónimos.
const TEMPORARY_GUEST_MODE = true;
let user = null;
let passwordRecovery = false;
let activeList = null;
let searchTimer;
let selectedBranchId = '';
let lastComparedProductId = null;
let productCatalogCache = [];

const app = document.querySelector('#app');
const money = value => new Intl.NumberFormat('es-PA', { style: 'currency', currency: 'USD' }).format(value);
const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function shell() {
  app.innerHTML = `
    <header><a class="brand" href="#">Mi<span>Compra</span></a><span class="country">Panamá</span></header>
    <div id="auth" class="auth auth-entry"></div>
    <main>
      <section class="hero"><p class="eyebrow">COMPRA CON INFORMACIÓN</p><h1>Tu compra, más inteligente.</h1><p>Organiza tu lista y compara precios publicados por supermercados.</p></section>
      <section id="connection" class="status"><i></i><div><strong>${configured ? 'Conectando con Mi Compra' : 'Configuración pendiente'}</strong><small>${configured ? 'Consultando catálogo y precios disponibles.' : 'Faltan las variables de conexión de Supabase.'}</small></div></section>
      <section class="section-head"><div><p class="eyebrow">COMPARADOR</p><h2>Busca un producto</h2></div></section>
      <input id="search" class="search" type="search" placeholder="Ej. arroz, lechuga, leche, pollo..." autocomplete="off" /><div class="store-filter"><label for="store-filter">Buscar en supermercado</label><select id="store-filter">${stores.map(s => `<option value="${safe(s.name)}">${safe(s.name)}</option>`).join("")}</select></div><small class="catalog-source-note">Catálogo ampliado con productos de referencia de la canasta básica de ACODECO. La referencia sirve para identificar productos y presentaciones; no representa precios actuales.</small>
      <div class="branch-filter"><label for="branch-filter">Sucursal para Super 99</label><select id="branch-filter"><option value="">Todas las sucursales</option></select><small>La sucursal filtra las publicaciones de Super 99. Para otras tiendas, este filtro no aplica.</small></div>
      <div id="results" class="results"><p class="empty">Escribe el nombre de un producto para ver las presentaciones disponibles.</p></div>
      <section class="section-head list-heading"><div><p class="eyebrow">TU CARRITO</p><h2>Lista para comprar</h2></div><span id="list-label" class="muted">Inicia sesión para guardar</span></section>
      <div id="cart" class="cart"><p class="empty">Tu lista aparecerá aquí.</p></div><section id="list-comparison" class="list-comparison"><p class="empty">El comparador aparecerá cuando agregues productos.</p></section><div id="weekly-plan-module"></div>
      <section class="section-head stores-heading"><div><p class="eyebrow">RED DE TIENDAS</p><h2>Supermercados</h2></div><span class="muted">6 tiendas</span></section>
      <section class="grid">${stores.map(s => `<article class="store"><b class="icon">${safe(s.name[0])}</b><div><strong>${safe(s.name)}</strong><small>${safe(s.sourceLabel)}</small></div>${s.url ? `<a href="${s.url}" target="_blank" rel="noreferrer">Consultar ↗</a>` : '<em>En preparación</em>'}</article>`).join('')}</section>
      <aside><strong>Precios transparentes</strong><p>Solo compararemos productos equivalentes con precio, presentación, fuente y fecha de consulta. Si no hay precio verificado, lo indicaremos.</p><a class="template-link" href="/plantilla-precios.csv" download>Descargar plantilla para registrar precios ↗</a><small class="template-note">La plantilla es para captura y revisión manual; no publica precios automáticamente.</small></aside>
      <footer>Mi Compra · Panamá</footer>
    </main>`;
  document.querySelector('#branch-filter').addEventListener('change', e => { selectedBranchId = e.target.value; const term=document.querySelector('#search')?.value.trim(); if(term) searchProducts(term); if (user) loadList(); });
  document.querySelector('#store-filter').addEventListener('change', () => { const term=document.querySelector('#search')?.value.trim(); if(term) searchProducts(term); document.querySelector('#branch-filter').closest('.branch-filter').hidden=document.querySelector('#store-filter').value!=='Super 99'; });
  document.querySelector('#search').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => searchProducts(e.target.value.trim()), 300);
  });
}

function message(text) {
  const el = document.querySelector('#connection');
  if (el) el.querySelector('small').textContent = text;
}

async function loadBranches() {
  const select = document.querySelector('#branch-filter');
  if (!select || !supabase) return;
  const { data, error } = await supabase.from('supermarket_branches').select('id,name').eq('active', true).eq('online_catalog_available', true).order('name');
  if (error || !data) return;
  select.innerHTML = '<option value="">Todas las sucursales</option>' + data.map(b => `<option value="${b.id}">${safe(b.name)}</option>`).join('');
}

async function searchProducts(term) {
  const box = document.querySelector('#results');
  if (!term) { box.innerHTML = '<p class="empty">Escribe el nombre de un producto para ver las presentaciones disponibles.</p>'; return; }
  if (!supabase) { box.innerHTML = '<p class="empty">La conexión de datos aún no está configurada.</p>'; return; }
  const clean = term.replace(/[%_]/g, '').trim();
  const storeName = document.querySelector('#store-filter')?.value || 'Super 99';
  box.innerHTML = '<p class="empty">Buscando presentaciones en ' + safe(storeName) + '...</p>';
  let query = supabase.from('store_products')
    .select('id,product_id,source_product_name,source_product_url,source_sku,package_description,branch_id,products!inner(canonical_name,brand,normalized_quantity,normalized_unit_name),supermarkets!inner(name),supermarket_branches(name),price_observations(price,currency,observed_at,is_verified,review_status,availability)')
    .eq('supermarkets.name', storeName).ilike('source_product_name', '%' + clean + '%')
    .order('source_product_name').limit(50);
  if (storeName === 'Super 99' && selectedBranchId) query = query.or('branch_id.is.null,branch_id.eq.' + selectedBranchId);
  const { data: listings, error } = await query;
  if (error) { box.innerHTML = '<p class="empty">No se pudieron consultar las publicaciones de ' + safe(storeName) + '. Inténtalo nuevamente.</p>'; return; }
  if (listings?.length) {
    box.innerHTML = listings.map(item => {
      const price = (item.price_observations || []).filter(p => p.is_verified && p.review_status === 'approved' && p.currency === 'USD' && Number(p.price) > 0 && Date.now() - new Date(p.observed_at).getTime() <= 7 * 86400000).sort((a,b) => new Date(b.observed_at).getTime() - new Date(a.observed_at).getTime())[0];
      const priceAge = price ? Date.now() - new Date(price.observed_at).getTime() : Infinity;
      const priceContext = price?.availability === 'online_unit_price_per_kg' ? ' · precio publicado por kilogramo' : ' · precio publicado en línea';
      const priceLabel = !price ? 'Precio pendiente de verificación' : priceAge <= 86400000 ? 'precio en línea actualizado recientemente' + priceContext : 'último precio observado el ' + new Date(price.observed_at).toLocaleDateString('es-PA') + priceContext + ' · confirmar vigencia';
      return '<article class="product store-product-result"><div><strong>' + safe(item.source_product_name) + '</strong><small>' + safe(item.package_description || 'Presentación por confirmar') + (item.source_sku ? ' · SKU ' + safe(item.source_sku) : '') + '</small><small>' + safe(item.products?.canonical_name || '') + (item.supermarket_branches?.name ? ' · Sucursal: ' + safe(item.supermarket_branches.name) : ' · Sucursal por confirmar') + '</small><small class="' + (price ? (priceAge <= 86400000 ? 'price-current' : 'price-pending') : 'price-pending') + '">' + (price ? money(price.price) + ' · ' + priceLabel : priceLabel) + '</small>' + (item.source_product_url ? '<a href="' + safe(item.source_product_url) + '" target="_blank" rel="noreferrer">Ver publicación oficial ↗</a>' : '') + '</div><button type="button" data-add-listing="' + safe(item.id) + '">Agregar a mi compra</button></article>';
    }).join('');
    box.onclick = async event => {
      const button = event.target.closest('button[data-add-listing]');
      if (!button || !box.contains(button)) return;
      const item = listings.find(row => row.id === button.dataset.addListing);
      if (!item || button.disabled) return;
      await addSearchItemFromButton(button, {name:item.source_product_name,store:storeName,productId:item.product_id,price:null});
    };
    return;
  }
  const { data: products, error: productError } = await supabase.from('products').select('id,canonical_name,brand,normalized_quantity,normalized_unit_name').eq('active', true).ilike('canonical_name', '%' + clean + '%').order('canonical_name').limit(20);
  if (productError) { box.innerHTML = '<p class="empty">No se pudo consultar el catálogo. Inténtalo más tarde.</p>'; return; }
  if (!products?.length) { box.innerHTML = '<p class="empty">No encontramos "' + safe(term) + '" en el catálogo de ' + safe(storeName) + '.</p>'; return; }
  box.innerHTML = '<p class="catalog-empty-store">No hay publicaciones específicas registradas para ' + safe(storeName) + '. Puedes agregar el artículo como pendiente de confirmar, sin inventar precio ni disponibilidad.</p>' + products.map(p => '<article class="product store-product-result"><div><strong>' + safe(p.canonical_name) + '</strong><small>' + safe([p.brand,p.normalized_quantity && p.normalized_unit_name ? p.normalized_quantity + ' ' + p.normalized_unit_name : ''].filter(Boolean).join(' · ') || 'Presentación por confirmar') + '</small><small class="price-pending">Sin publicación ni precio confirmado en ' + safe(storeName) + '</small></div><button type="button" data-add-catalog="' + safe(p.id) + '">Agregar pendiente</button></article>').join('');
  box.onclick = async event => {
    const button = event.target.closest('button[data-add-catalog]');
    if (!button || !box.contains(button)) return;
    const p = products.find(row => row.id === button.dataset.addCatalog);
    if (!p || button.disabled) return;
    await addSearchItemFromButton(button, {name:p.canonical_name,store:storeName,productId:p.id,price:null});
  };
}
async function addSearchItemFromButton(button, item) {
  const card = button.closest('.store-product-result');
  let feedback = card?.querySelector('.add-feedback');
  if (!feedback && card) {
    feedback = document.createElement('small');
    feedback.className = 'add-feedback';
    feedback.setAttribute('role','status');
    feedback.setAttribute('aria-live','polite');
    card.appendChild(feedback);
  }
  button.disabled = true;
  button.textContent = 'Agregando...';
  if (feedback) feedback.textContent = '';
  const result = await addSearchItem(item);
  button.disabled = false;
  button.textContent = result.ok ? 'Agregado ✓' : 'Reintentar';
  if (feedback) feedback.textContent = result.message;
}
async function addSearchItem({name,store,productId=null,price=null}) {
  if (!name) return {ok:false,message:'No se identificó el producto.'};
  try {
    if (user) {
      if (!activeList) await loadList();
      if (!activeList) return {ok:false,message:'No se pudo abrir tu lista. Inténtalo nuevamente.'};
      const {error} = await supabase.from('shopping_list_items').insert({list_id:activeList.id,product_id:productId,item_name:name,quantity:1,unit:'unidades'});
      if (error) return {ok:false,message:'No se guardó en tu cuenta: '+(error.message || 'error de permisos')};
      await loadList();
      return {ok:true,message:'Producto guardado en tu lista.'};
    }
    addGuestCartItem({name,store,qty:1,price});
    const saved = readGuestCart().some(row => row.name === name && row.store === store);
    return saved ? {ok:true,message:'Producto agregado a tu lista de este dispositivo.'} : {ok:false,message:'No se pudo guardar en este dispositivo.'};
  } catch (error) {
    return {ok:false,message:'No se pudo agregar: '+(error?.message || 'error inesperado')};
  }
}
function addGuestCartItem({name,store,qty=1,price=null}) {
  const current = readGuestCart();
  const duplicate = current.find(item => item.name.toLowerCase() === name.toLowerCase() && item.store === store);
  if (duplicate) { duplicate.qty += qty; if (price !== null && Number.isFinite(Number(price))) duplicate.price = Number(price); }
  else current.push({id:Date.now().toString(36)+Math.random().toString(36).slice(2,7),name,store,qty,price:price === null ? null : Number(price)});
  saveGuestCart(current);
  renderGuestList();
}
async function compareProduct(id) {
  lastComparedProductId = id;
  const box = document.querySelector('#results');
  box.innerHTML = '<p class="empty">Consultando precios observados...</p>';
  const freshnessCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from('store_products')
    .select('id,branch_id,source_product_name,package_description,source_product_url,supermarkets(name),supermarket_branches(name),price_observations(price,currency,regular_price,promotion_label,source_url,observed_at,is_verified,review_status,availability)')
    .eq('product_id', id)
    .gte('price_observations.observed_at', freshnessCutoff)
    .limit(40);
  if (error) { box.innerHTML = '<p class="empty">No fue posible consultar los precios.</p>'; return; }
  const rows = (data || []).flatMap(item => (item.price_observations || []).map(price => ({...price, store:item.supermarkets?.name, branch:item.supermarket_branches?.name, branchId:item.branch_id, product:item.source_product_name, pack:item.package_description, productUrl:item.source_product_url})))
    .filter(p => p.is_verified && p.review_status === 'approved' && p.currency === 'USD' && Number(p.price) > 0 && new Date(p.observed_at).getTime() >= Date.now() - 86400000 && (p.store !== 'Super 99' || !selectedBranchId || p.branchId === selectedBranchId)).sort((a,b) => Number(a.price)-Number(b.price));
  if (!rows.length) { box.innerHTML = '<p class="empty">Este producto no tiene precios verificados de las últimas 24 horas. No mostraremos precios antiguos como si fueran actuales.</p>'; return; }
  box.innerHTML = rows.map((p,i) => `<article class="price-row"><div><strong>${safe(p.store || 'Tienda')}</strong><small>${safe(p.product)} · ${safe(p.pack || 'Presentación no especificada')}</small>${p.branch ? `<small>Sucursal: ${safe(p.branch)}</small>` : '<small>Sucursal no especificada</small>'}<small>Consultado: ${new Date(p.observed_at).toLocaleString('es-PA')}</small>${p.store === 'Super 99' ? (p.availability === 'online_unit_price_per_kg' ? '<small>Precio publicado por kilogramo para compras en línea; el importe final depende del peso.</small>' : '<small>Precio publicado exclusivamente para compras en línea; puede diferir del precio en sucursal.</small>') : ''}</div><div class="price-value"><b>${money(p.price)}</b>${p.regular_price && Number(p.regular_price)>Number(p.price) ? `<del>${money(p.regular_price)}</del><em>${safe(p.promotion_label || "En oferta")}</em>` : ""}${i===0?'<em>Menor precio verificado</em>':''}<a href="${safe(p.source_url || p.productUrl || '#')}" target="_blank" rel="noreferrer">Ver fuente ↗</a></div></article>`).join('');
}

async function renderAuth() {
  const box = document.querySelector('#auth');
  if (TEMPORARY_GUEST_MODE && !user) {
    box.classList.remove('auth-gate');
    box.innerHTML = '<section class="guest-access"><strong>Acceso temporal de consulta</strong><p>El comparador y el catálogo están disponibles sin iniciar sesión mientras terminamos la configuración.</p><small>Por seguridad, las listas personales, compras, gastos y despensa permanecerán protegidos y no estarán disponibles en este modo. Tus datos existentes no se eliminan.</small></section>';
    return;
  }
  if (!supabase) {
    box.classList.add('auth-gate');
    box.innerHTML = '<section class="login-card"><div class="login-mark">Mi<span>Compra</span></div><p class="eyebrow">ACCESO SEGURO</p><h1>Bienvenido</h1><p class="login-intro">Inicia sesión para entrar a tus listas, compras y despensa.</p><p class="login-message">La conexión segura todavía no está configurada. Inténtalo más tarde.</p></section>';
    return;
  }
  if (!user) {
    box.classList.add('auth-gate');
    box.innerHTML = `<section class="login-card">
      <div class="login-mark">Mi<span>Compra</span></div><p class="eyebrow">ACCESO SEGURO</p>
      <h1 id="auth-title">Iniciar sesión</h1><p class="login-intro">Accede a tus listas y datos personales de forma segura.</p>
      <form id="password-login" class="password-form">
        <label for="auth-email">Correo electrónico</label><input id="auth-email" type="email" autocomplete="username" required placeholder="tu@correo.com">
        <label for="auth-password">Contraseña</label><input id="auth-password" type="password" autocomplete="current-password" required minlength="8" placeholder="Tu contraseña">
        <button type="submit" id="auth-submit">Entrar</button>
      </form>
      <div class="login-links"><button type="button" data-auth-mode="reset">Olvidé mi contraseña</button><button type="button" data-auth-mode="signup">Crear cuenta</button></div>
      <p id="auth-feedback" class="login-feedback" role="status" aria-live="polite"></p>
      <small class="login-footnote">Tu información personal solo se muestra después de autenticarte.</small>
    </section>`;
    const form=box.querySelector('#password-login');
    const feedback=box.querySelector('#auth-feedback');
    const emailInput=box.querySelector('#auth-email');
    const passwordInput=box.querySelector('#auth-password');
    let mode='login';
    const setMode=next=>{
      mode=next;
      const reset=mode==='reset', signup=mode==='signup';
      box.querySelector('#auth-title').textContent=reset?'Recuperar contraseña':signup?'Crear cuenta':'Iniciar sesión';
      passwordInput.hidden=reset;
      passwordInput.required=!reset;
      passwordInput.autocomplete=signup?'new-password':'current-password';
      box.querySelector('#auth-submit').textContent=reset?'Enviar instrucciones':signup?'Crear cuenta':'Entrar';
      box.querySelector('[data-auth-mode="reset"]').hidden=reset;
      box.querySelector('[data-auth-mode="signup"]').hidden=signup;
      feedback.textContent='';
    };
    box.querySelectorAll('[data-auth-mode]').forEach(button=>button.addEventListener('click',()=>setMode(button.dataset.authMode)));
    form.addEventListener('submit',async e=>{
      e.preventDefault();
      const email=emailInput.value.trim();
      const password=passwordInput.value;
      const submit=box.querySelector('#auth-submit');
      submit.disabled=true; feedback.textContent='Procesando solicitud...';
      try {
        let result;
        const redirectTo=location.origin+location.pathname;
        if(mode==='reset') {
          result=await supabase.auth.resetPasswordForEmail(email,{redirectTo});
          feedback.textContent=result.error?'No se pudo enviar la recuperación. Verifica el correo.':'Si el correo está registrado, recibirás instrucciones para restablecer la contraseña.';
        } else if(mode==='signup') {
          result=await supabase.auth.signUp({email,password,options:{emailRedirectTo:redirectTo}});
          feedback.textContent=result.error?'No se pudo crear la cuenta: '+result.error.message:result.data.session?'Cuenta creada. Acceso iniciado.':'Cuenta creada. Revisa tu correo para confirmar la dirección antes de iniciar sesión.';
        } else {
          result=await supabase.auth.signInWithPassword({email,password});
          if(result.error) feedback.textContent='No se pudo iniciar sesión. Verifica el correo y la contraseña; si tu cuenta se creó con enlace, usa «Olvidé mi contraseña» para establecer una contraseña.';
        }
      } catch(error) { feedback.textContent='No fue posible completar la solicitud. Inténtalo nuevamente.'; }
      finally { submit.disabled=false; }
    });
    return;
  }
  if (passwordRecovery) {
    box.classList.add('auth-gate');
    box.innerHTML = `<section class="login-card"><div class="login-mark">Mi<span>Compra</span></div><p class="eyebrow">RECUPERACIÓN SEGURA</p><h1>Crear nueva contraseña</h1><p class="login-intro">Elige una contraseña nueva para proteger tu cuenta.</p><form id="new-password-form" class="password-form"><label for="new-password">Nueva contraseña</label><input id="new-password" type="password" minlength="8" autocomplete="new-password" required placeholder="Mínimo 8 caracteres"><label for="confirm-password">Confirmar contraseña</label><input id="confirm-password" type="password" minlength="8" autocomplete="new-password" required placeholder="Repite la contraseña"><button type="submit">Guardar contraseña</button></form><p id="password-feedback" class="login-feedback" role="status" aria-live="polite"></p></section>`;
    box.querySelector('#new-password-form').addEventListener('submit',async e=>{
      e.preventDefault();
      const password=box.querySelector('#new-password').value;
      const confirmation=box.querySelector('#confirm-password').value;
      const feedback=box.querySelector('#password-feedback');
      if(password!==confirmation){feedback.textContent='Las contraseñas no coinciden.';return;}
      const button=e.currentTarget.querySelector('button');button.disabled=true;feedback.textContent='Guardando...';
      const {error}=await supabase.auth.updateUser({password});
      button.disabled=false;
      if(error){feedback.textContent='No se pudo actualizar la contraseña. Solicita un nuevo enlace e inténtalo otra vez.';return;}
      passwordRecovery=false;
      await renderAuth();
      feedback.textContent='Contraseña actualizada.';
    });
    return;
  }
  box.classList.remove('auth-gate');
  box.innerHTML = `<div class="signed"><span>Sesión: ${safe(user.email)}</span><button id="logout" class="secondary">Cerrar sesión</button></div><section class="import-panel"><strong>Importar precios desde CSV</strong><p>Usa fecha ISO 8601 de Panamá (-05:00), SKU y presentación exacta. Marca verificado=SI solo después de revisar el producto y su precio. Solo acepta enlaces HTTPS de dominios oficiales autorizados y precios de las últimas 24 horas. Los precios importados quedan pendientes de revisión.</p><div class="import-row"><input id="price-csv" type="file" accept=".csv,text/csv"><button id="import-csv" class="secondary">Validar e importar</button></div><small id="import-result" aria-live="polite"></small></section><div id="purchases-module"></div><div id="spending-module"></div><div id="pantry-module"></div>`;
  box.querySelector('#logout').addEventListener('click', () => supabase.auth.signOut());
  box.querySelector('#import-csv').addEventListener('click', async () => { const output=box.querySelector('#import-result'); output.textContent='Procesando...'; try { await importPriceCsv({file:box.querySelector('#price-csv').files[0],supabase,user,output}); await renderPriceReview(); } catch(error) { output.textContent=error.message || 'No se pudo importar el archivo.'; } });
  const purchasesContainer=box.querySelector('#purchases-module');
  await renderPurchases({container:purchasesContainer,supabase,user});
  await renderSpendingDashboard({container:box.querySelector('#spending-module'),supabase,user});
  await renderPersonalPantry({container:box.querySelector('#pantry-module'),supabase,user});
}



async function renderProductAdmin(panel) {
  const section=document.createElement('section');
  section.className='catalog-product-admin';
  section.innerHTML='<div class="catalog-admin-heading"><div><strong>Agregar producto al catálogo</strong><small>Solo el administrador principal puede crear productos. Los precios no se modifican aquí.</small></div></div><form id="catalog-product-form" class="catalog-product-form" novalidate><label>Nombre del producto<input id="new-product-name" maxlength="120" required placeholder="Ej. Arroz blanco"></label><div class="catalog-admin-grid"><label>Marca (opcional)<input id="new-product-brand" maxlength="80" placeholder="Ej. marca comercial"></label><label>Categoría<input id="new-product-category" maxlength="60" list="catalog-category-options" required placeholder="Ej. Granos y cereales"><datalist id="catalog-category-options"></datalist></label><label>Cantidad del empaque<input id="new-product-quantity" type="number" min="0.001" max="1000000" step="0.001" required placeholder="Ej. 1"></label><label>Unidad<select id="new-product-unit" required><option value="">Selecciona</option><option value="kg">kg</option><option value="g">g</option><option value="lb">lb</option><option value="oz">oz</option><option value="L">L</option><option value="ml">ml</option><option value="unidad">unidad</option><option value="unidades">unidades</option><option value="rollos">rollos</option></select></label></div><label>Código de barras (opcional)<input id="new-product-barcode" maxlength="64" inputmode="numeric" placeholder="Escanea o escribe el código"></label><div id="catalog-product-match" class="catalog-product-match" hidden aria-live="polite"></div><label id="catalog-variant-confirm-wrap" class="catalog-variant-confirm" hidden><input id="catalog-variant-confirm" type="checkbox"> Confirmo que es un producto o presentación diferente de los registros señalados</label><button id="catalog-product-save" type="submit">Guardar producto en el catálogo</button><small id="catalog-product-status" aria-live="polite"></small></form>';
  panel.appendChild(section);
  const form=section.querySelector('#catalog-product-form'),status=section.querySelector('#catalog-product-status'),matchBox=section.querySelector('#catalog-product-match'),confirmWrap=section.querySelector('#catalog-variant-confirm-wrap'),confirmBox=section.querySelector('#catalog-variant-confirm'),save=section.querySelector('#catalog-product-save');
  const fields={
    name:section.querySelector('#new-product-name'),brand:section.querySelector('#new-product-brand'),category:section.querySelector('#new-product-category'),
    quantity:section.querySelector('#new-product-quantity'),unit:section.querySelector('#new-product-unit'),barcode:section.querySelector('#new-product-barcode')
  };
  const {data:products,error:productsError}=await supabase.from('products').select('id,canonical_name,brand,category,normalized_quantity,normalized_unit_name,barcode,active').order('canonical_name').limit(1000);
  const {data:mappings,error:mappingsError}=await supabase.from('product_barcodes').select('product_id,barcode');
  if(productsError||mappingsError){status.textContent='No se pudo cargar la validación del catálogo. No se permite guardar sin esa comprobación.';save.disabled=true;return;}
  const categories=[...new Set((products||[]).map(p=>p.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
  section.querySelector('#catalog-category-options').innerHTML=categories.map(category=>'<option value="'+safe(category)+'"></option>').join('');
  let exactDuplicate=false,barcodeDuplicate=false,needsConfirmation=false;
  const draft=()=>({
    canonical_name:fields.name.value.trim(),brand:fields.brand.value.trim()||null,category:fields.category.value.trim(),
    normalized_quantity:fields.quantity.value===''?null:Number(fields.quantity.value),
    normalized_unit_name:fields.unit.value,
    barcode:normalizeProductBarcode(fields.barcode.value)||null
  });
  const updateValidation=()=>{
    const value=draft(),check=getProductRegistrationCheck(products||[],value,mappings||[]);
    exactDuplicate=Boolean(check.exactDuplicate);barcodeDuplicate=Boolean(check.barcodeOwner);
    needsConfirmation=check.nameMatches.length>0&&!exactDuplicate;
    matchBox.hidden=!check.nameMatches.length&&!check.barcodeOwner;
    matchBox.innerHTML=(check.exactDuplicate?'<strong>Este producto con la misma marca y presentación ya existe. No se puede duplicar.</strong>':'')+
      (check.nameMatches.length?'<div><strong>Coincidencias de nombre en el catálogo</strong>'+check.nameMatches.map(p=>'<small>'+safe(p.canonical_name)+' · '+safe(p.brand||'Sin marca')+' · '+safe([p.normalized_quantity,p.normalized_unit_name].filter(Boolean).join(' ')||'Presentación sin definir')+'</small>').join('')+'</div>':'')+
      (check.barcodeOwner?'<strong>El código de barras ya está asociado a '+safe(check.barcodeOwner.canonical_name||'otro producto')+'.</strong>':'');
    confirmWrap.hidden=!needsConfirmation;
    if(!needsConfirmation)confirmBox.checked=false;
    save.disabled=exactDuplicate||barcodeDuplicate;
    status.textContent='';
  };
  Object.values(fields).forEach(field=>field.addEventListener('input',updateValidation));
  Object.values(fields).forEach(field=>field.addEventListener('change',updateValidation));
  confirmBox.addEventListener('change',()=>{});
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const value=draft(),validation=validateProductRegistrationDraft(value);
    if(!validation.valid){status.textContent=validation.message;return;}
    if(value.barcode&&!isValidBarcodeChecksum(value.barcode)){status.textContent='El código EAN/UPC no supera la validación de su dígito de control.';return;}
    updateValidation();
    if(exactDuplicate||barcodeDuplicate){status.textContent='Corrige el duplicado señalado antes de guardar.';return;}
    if(needsConfirmation&&!confirmBox.checked){status.textContent='Confirma que la presentación o el producto es diferente.';return;}
    save.disabled=true;status.textContent='Guardando producto...';
    const normalizedUnit=['kg','g','lb','oz'].includes(value.normalized_unit_name)?'weight':['L','ml'].includes(value.normalized_unit_name)?'volume':'unit';
    const {data:created,error}=await supabase.from('products').insert({
      canonical_name:value.canonical_name,brand:value.brand,category:value.category,
      normalized_quantity:value.normalized_quantity,normalized_unit:normalizedUnit,
      normalized_unit_name:value.normalized_unit_name,barcode:value.barcode,active:true
    }).select('id,canonical_name,brand,category,normalized_quantity,normalized_unit_name,barcode').single();
    if(error){
      status.textContent=error.code==='23505'?'El producto o el código ya existe. Actualiza la lista y revisa las coincidencias.':'No se pudo guardar. Verifica los datos y tus permisos.';
      save.disabled=false;return;
    }
    productCatalogCache=[];
    status.textContent='Producto agregado correctamente al catálogo. Ya puede seleccionarse en las listas y comparaciones.';
    form.reset();matchBox.hidden=true;matchBox.innerHTML='';confirmWrap.hidden=true;confirmBox.checked=false;
    save.disabled=false;
    products.push(created);
  });

  const importSection=document.createElement('section');
  importSection.className='catalog-csv-import';
  importSection.innerHTML='<div class="catalog-admin-heading"><div><strong>Importar varios productos (CSV)</strong><small>Plantilla compatible con Excel y hojas de cálculo. Máximo 500 filas por archivo y 1 MB.</small></div></div><div class="catalog-csv-actions"><button type="button" id="catalog-csv-template" class="catalog-csv-secondary">Descargar plantilla CSV</button><label class="catalog-csv-file">Seleccionar archivo CSV<input id="catalog-csv-file" type="file" accept=".csv,text/csv"></label></div><small>Columnas obligatorias: canonical_name, category, normalized_quantity y normalized_unit_name. Marca y barcode son opcionales. Puedes usar encabezados en español.</small><div id="catalog-csv-summary" class="catalog-csv-summary" hidden aria-live="polite"></div><div id="catalog-csv-preview" class="catalog-csv-preview" hidden></div><label id="catalog-csv-variant-confirm-wrap" class="catalog-variant-confirm" hidden><input id="catalog-csv-variant-confirm" type="checkbox"> Confirmo que revisé las presentaciones similares y que son productos o tamaños distintos</label><button type="button" id="catalog-csv-import" hidden disabled>Importar productos válidos</button><small id="catalog-csv-status" aria-live="polite"></small>';
  section.appendChild(importSection);
  const csvFile=importSection.querySelector('#catalog-csv-file'),csvSummary=importSection.querySelector('#catalog-csv-summary'),csvPreview=importSection.querySelector('#catalog-csv-preview'),csvImport=importSection.querySelector('#catalog-csv-import'),csvStatus=importSection.querySelector('#catalog-csv-status'),csvVariantWrap=importSection.querySelector('#catalog-csv-variant-confirm-wrap'),csvVariantConfirm=importSection.querySelector('#catalog-csv-variant-confirm');
  let importAnalysis=null;
  importSection.querySelector('#catalog-csv-template').addEventListener('click',()=>{
    const template='\uFEFFcanonical_name,brand,category,normalized_quantity,normalized_unit_name,barcode\r\n';
    const blob=new Blob([template],{type:'text/csv;charset=utf-8;'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='plantilla_catalogo_mi_compra.csv';document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
  });
  const updateCsvImportButton=()=>{
    csvImport.disabled=!importAnalysis?.readyRows.length||(importAnalysis.variantCount>0&&!csvVariantConfirm.checked);
  };
  csvVariantConfirm.addEventListener('change',updateCsvImportButton);
  csvFile.addEventListener('change',async()=>{
    importAnalysis=null;csvImport.hidden=true;csvVariantWrap.hidden=true;csvSummary.hidden=true;csvPreview.hidden=true;csvStatus.textContent='';
    const file=csvFile.files?.[0];if(!file)return;
    if(file.size>1024*1024){csvStatus.textContent='El archivo supera 1 MB. Reduce su tamaño y vuelve a intentarlo.';csvFile.value='';return;}
    try{
      const parsed=parseCatalogCsv(await file.text());
      if(!parsed.ok){csvStatus.textContent=parsed.error;return;}
      if(!parsed.rows.length){csvStatus.textContent='El archivo no contiene productos para importar.';return;}
      importAnalysis=analyzeCatalogImportRows(parsed.rows,products||[],mappings||[],code=>isValidBarcodeChecksum(code,'ean_8')||isValidBarcodeChecksum(code,'upc_e')||isValidBarcodeChecksum(code,'upc_a')||isValidBarcodeChecksum(code,'ean_13'));
      const ready=importAnalysis.readyRows,issues=importAnalysis.issues;
      csvSummary.hidden=false;
      csvSummary.innerHTML='<strong>Resultado de la revisión</strong><div>'+ready.length+' productos listos para importar</div><div>'+issues.length+' filas omitidas por errores o duplicados</div><div>'+importAnalysis.variantCount+' posibles variantes de presentación requieren confirmación</div>';
      const previewRows=ready.slice(0,12).map(row=>'<tr><td>'+row.line+'</td><td>'+safe(row.canonical_name)+'</td><td>'+safe(row.brand||'—')+'</td><td>'+safe(row.normalized_quantity+' '+row.normalized_unit_name)+'</td><td>'+safe(row.category)+'</td></tr>');
      const issueRows=issues.slice(0,8).map(row=>'<tr><td>'+row.line+'</td><td>'+safe(row.canonical_name||'—')+'</td><td>'+safe(row.reason)+'</td></tr>');
      csvPreview.hidden=false;
      csvPreview.innerHTML=(previewRows.length?'<strong>Vista previa de productos válidos</strong><div class="catalog-csv-table-wrap"><table><thead><tr><th>Fila</th><th>Producto</th><th>Marca</th><th>Presentación</th><th>Categoría</th></tr></thead><tbody>'+previewRows.join('')+'</tbody></table></div>':'')+
        (issues.length?'<strong>Filas que no se importarán</strong><div class="catalog-csv-table-wrap"><table><thead><tr><th>Fila</th><th>Producto</th><th>Motivo</th></tr></thead><tbody>'+issueRows.join('')+'</tbody></table></div>':'')+
        (ready.length>12?'<small>Se muestran las primeras 12 filas válidas; se importarán todas las filas válidas.</small>':'')+
        (issues.length>8?'<small>Se muestran los primeros 8 errores; hay '+issues.length+' filas omitidas en total.</small>':'');
      csvVariantWrap.hidden=importAnalysis.variantCount===0;csvVariantConfirm.checked=false;
      csvImport.hidden=ready.length===0;csvImport.textContent='Importar '+ready.length+' productos válidos';updateCsvImportButton();
    }catch(error){csvStatus.textContent='No se pudo leer el archivo. Comprueba que sea un CSV válido.';}
  });
  csvImport.addEventListener('click',async()=>{
    if(!importAnalysis?.readyRows.length)return;
    if(importAnalysis.variantCount&&!csvVariantConfirm.checked){csvStatus.textContent='Confirma primero que revisaste las presentaciones similares.';return;}
    csvImport.disabled=true;csvStatus.textContent='Guardando productos en el catálogo...';
    const payload=importAnalysis.readyRows.map(row=>({
      canonical_name:row.canonical_name.trim(),brand:row.brand?.trim()||null,category:row.category.trim(),
      normalized_quantity:row.normalized_quantity,
      normalized_unit:['kg','g','lb','oz'].includes(row.normalized_unit_name)?'weight':['L','ml'].includes(row.normalized_unit_name)?'volume':'unit',
      normalized_unit_name:row.normalized_unit_name,barcode:row.barcode||null,active:true
    }));
    const {data:created,error}=await supabase.from('products').insert(payload).select('id,canonical_name,brand,category,normalized_quantity,normalized_unit_name,barcode');
    if(error){
      csvStatus.textContent=error.code==='23505'?'No se guardó la carga porque el catálogo detectó un duplicado. Revisa el archivo y vuelve a generar la vista previa.':'No se pudo guardar. Comprueba tu autorización de administrador y vuelve a intentarlo.';
      csvImport.disabled=false;return;
    }
    products.push(...(created||[]));productCatalogCache=[];
    csvStatus.textContent=(created?.length||0)+' productos agregados correctamente. Las filas omitidas no se modificaron.';
    csvImport.hidden=true;csvFile.value='';importAnalysis=null;csvVariantWrap.hidden=true;csvSummary.hidden=true;csvPreview.hidden=true;
  });


  const manager=document.createElement('section');
  manager.className='catalog-personal-manager';
  manager.innerHTML='<div class="catalog-admin-heading"><div><strong>Mi catálogo personal</strong><small>Corrige los datos o desactiva productos que ya no usas. No se eliminan registros ni historial de compras.</small></div></div><label class="catalog-manager-search">Buscar en mi catálogo<input id="catalog-manager-search" type="search" placeholder="Nombre, marca, categoría o código"></label><div id="catalog-manager-count" class="catalog-manager-count"></div><div id="catalog-manager-list" class="catalog-manager-list"></div><div id="catalog-manager-editor" class="catalog-manager-editor" hidden><strong id="catalog-manager-edit-title">Editar producto</strong><form id="catalog-manager-edit-form" class="catalog-product-form" novalidate><label>Nombre del producto<input id="edit-product-name" maxlength="120" required></label><div class="catalog-admin-grid"><label>Marca<input id="edit-product-brand" maxlength="80"></label><label>Categoría<input id="edit-product-category" maxlength="60" required></label><label>Cantidad del empaque<input id="edit-product-quantity" type="number" min="0.001" max="1000000" step="0.001" required></label><label>Unidad<select id="edit-product-unit" required><option value=\"kg\">kg</option><option value=\"g\">g</option><option value=\"lb\">lb</option><option value=\"oz\">oz</option><option value=\"L\">L</option><option value=\"ml\">ml</option><option value=\"unidad\">unidad</option><option value=\"unidades\">unidades</option><option value=\"rollos\">rollos</option></select></label></div><label>Código de barras<input id="edit-product-barcode" maxlength="64" inputmode="numeric"></label><div id="edit-product-match" class="catalog-product-match" hidden></div><label id="edit-variant-confirm-wrap" class="catalog-variant-confirm" hidden><input id="edit-variant-confirm" type="checkbox"> Confirmo que revisé las presentaciones similares y que son distintas</label><div class="catalog-manager-edit-actions"><button type="submit" id="catalog-manager-save">Guardar cambios</button><button type="button" id="catalog-manager-cancel" class="catalog-csv-secondary">Cancelar</button></div><small id="catalog-manager-edit-status" aria-live="polite"></small></form></div>';
  section.appendChild(manager);
  const managerSearch=manager.querySelector('#catalog-manager-search'),managerList=manager.querySelector('#catalog-manager-list'),managerCount=manager.querySelector('#catalog-manager-count'),editor=manager.querySelector('#catalog-manager-editor'),editForm=manager.querySelector('#catalog-manager-edit-form'),editStatus=manager.querySelector('#catalog-manager-edit-status'),editMatch=manager.querySelector('#edit-product-match'),editConfirmWrap=manager.querySelector('#edit-variant-confirm-wrap'),editConfirm=manager.querySelector('#edit-variant-confirm'),editSave=manager.querySelector('#catalog-manager-save');
  const editFields={name:manager.querySelector('#edit-product-name'),brand:manager.querySelector('#edit-product-brand'),category:manager.querySelector('#edit-product-category'),quantity:manager.querySelector('#edit-product-quantity'),unit:manager.querySelector('#edit-product-unit'),barcode:manager.querySelector('#edit-product-barcode')};
  let editingProduct=null;
  const renderPersonalCatalog=()=>{
    const term=managerSearch.value.trim().toLocaleLowerCase('es');
    const filtered=(products||[]).filter(p=>[p.canonical_name,p.brand,p.category,p.barcode,p.normalized_quantity,p.normalized_unit_name].join(' ').toLocaleLowerCase('es').includes(term));
    managerCount.textContent=filtered.length+' productos · '+filtered.filter(p=>p.active!==false).length+' activos · '+filtered.filter(p=>p.active===false).length+' desactivados';
    managerList.innerHTML=filtered.map(p=>'<article class="catalog-manager-item"><div class="catalog-manager-item-main"><strong>'+safe(p.canonical_name)+'</strong><small>'+safe(p.brand||'Sin marca')+' · '+safe(p.category||'Sin categoría')+' · '+safe([p.normalized_quantity,p.normalized_unit_name].filter(Boolean).join(' ')||'Sin presentación')+'</small><small>'+safe(p.barcode||'Sin código de barras')+'</small></div><span class="catalog-manager-state '+(p.active===false?'is-inactive':'is-active')+'">'+(p.active===false?'Desactivado':'Activo')+'</span><div class="catalog-manager-item-actions"><button type="button" data-edit-product="'+p.id+'">Editar</button><button type="button" data-toggle-product="'+p.id+'">'+(p.active===false?'Reactivar':'Desactivar')+'</button></div></article>').join('')||'<p class="catalog-manager-empty">No hay productos que coincidan con tu búsqueda.</p>';
  };
  managerSearch.addEventListener('input',renderPersonalCatalog);
  manager.querySelector('#catalog-manager-cancel').addEventListener('click',()=>{editor.hidden=true;editingProduct=null;editForm.reset();});
  managerList.addEventListener('click',async event=>{
    const editButton=event.target.closest('[data-edit-product]'),toggleButton=event.target.closest('[data-toggle-product]');
    if(editButton){
      editingProduct=products.find(p=>p.id===editButton.dataset.editProduct);if(!editingProduct)return;
      manager.querySelector('#catalog-manager-edit-title').textContent='Editar: '+editingProduct.canonical_name;
      editFields.name.value=editingProduct.canonical_name||'';editFields.brand.value=editingProduct.brand||'';editFields.category.value=editingProduct.category||'';
      editFields.quantity.value=editingProduct.normalized_quantity??'';editFields.unit.value=editingProduct.normalized_unit_name||'unidad';editFields.barcode.value=editingProduct.barcode||'';
      editMatch.hidden=true;editConfirmWrap.hidden=true;editConfirm.checked=false;editStatus.textContent='';editor.hidden=false;editor.scrollIntoView({behavior:'smooth',block:'nearest'});return;
    }
    if(toggleButton){
      const product=products.find(p=>p.id===toggleButton.dataset.toggleProduct);if(!product)return;
      const nextActive=product.active===false;
      if(!window.confirm((nextActive?'¿Reactivar':'¿Desactivar')+' "'+product.canonical_name+'"? '+(nextActive?'Volverá a aparecer en las búsquedas del catálogo.':'Se conservará su historial y dejará de aparecer en nuevas selecciones.')))return;
      toggleButton.disabled=true;
      const {data,error}=await supabase.from('products').update({active:nextActive}).eq('id',product.id).select('id,active').single();
      if(error||!data){toggleButton.disabled=false;managerCount.textContent='No se pudo actualizar el producto. Comprueba tus permisos e inténtalo otra vez.';return;}
      product.active=data.active;productCatalogCache=[];renderPersonalCatalog();managerCount.textContent='Producto '+(nextActive?'reactivado':'desactivado')+' correctamente. Su historial se conserva.';
    }
  });
  const updateEditValidation=()=>{
    if(!editingProduct)return;
    const value={canonical_name:editFields.name.value.trim(),brand:editFields.brand.value.trim()||null,category:editFields.category.value.trim(),normalized_quantity:editFields.quantity.value===''?null:Number(editFields.quantity.value),normalized_unit_name:editFields.unit.value,barcode:normalizeProductBarcode(editFields.barcode.value)||null};
    const otherProducts=products.filter(p=>p.id!==editingProduct.id),otherMappings=(mappings||[]).filter(p=>p.product_id!==editingProduct.id);
    const check=getProductRegistrationCheck(otherProducts,value,otherMappings);
    const exact=Boolean(check.exactDuplicate),codeDuplicate=Boolean(check.barcodeOwner),variant=check.nameMatches.length>0&&!exact;
    editMatch.hidden=!exact&&!codeDuplicate&&!variant;
    editMatch.innerHTML=(exact?'<strong>Ya existe otro producto con la misma marca y presentación.</strong>':'')+(variant?'<div><strong>Otras presentaciones del mismo producto</strong>'+check.nameMatches.map(p=>'<small>'+safe(p.canonical_name)+' · '+safe(p.brand||'Sin marca')+' · '+safe([p.normalized_quantity,p.normalized_unit_name].filter(Boolean).join(' '))+'</small>').join('')+'</div>':'')+(codeDuplicate?'<strong>El código ya pertenece a '+safe(check.barcodeOwner.canonical_name||'otro producto')+'.</strong>':'');
    editConfirmWrap.hidden=!variant;if(!variant)editConfirm.checked=false;
    editSave.disabled=exact||codeDuplicate;
    return {value,exact,codeDuplicate,variant};
  };
  Object.values(editFields).forEach(field=>{field.addEventListener('input',updateEditValidation);field.addEventListener('change',updateEditValidation);});
  editForm.addEventListener('submit',async event=>{
    event.preventDefault();if(!editingProduct)return;
    const result=updateEditValidation();if(!result)return;
    const {value,exact,codeDuplicate,variant}=result,validation=validateProductRegistrationDraft(value);
    if(!validation.valid){editStatus.textContent=validation.message;return;}
    if(value.barcode&&!isValidBarcodeChecksum(value.barcode)){editStatus.textContent='El código EAN/UPC no supera la validación de su dígito de control.';return;}
    if(exact||codeDuplicate){editStatus.textContent='Corrige el duplicado antes de guardar.';return;}
    if(variant&&!editConfirm.checked){editStatus.textContent='Confirma que revisaste las otras presentaciones.';return;}
    editSave.disabled=true;editStatus.textContent='Guardando cambios...';
    const normalizedUnit=['kg','g','lb','oz'].includes(value.normalized_unit_name)?'weight':['L','ml'].includes(value.normalized_unit_name)?'volume':'unit';
    const {data,error}=await supabase.from('products').update({canonical_name:value.canonical_name,brand:value.brand,category:value.category,normalized_quantity:value.normalized_quantity,normalized_unit:normalizedUnit,normalized_unit_name:value.normalized_unit_name,barcode:value.barcode}).eq('id',editingProduct.id).select('id,canonical_name,brand,category,normalized_quantity,normalized_unit_name,barcode,active').single();
    if(error||!data){editStatus.textContent=error?.code==='23505'?'El catálogo detectó un duplicado. Actualiza la lista y revisa los datos.':'No se pudieron guardar los cambios. Verifica tus permisos.';editSave.disabled=false;return;}
    const index=products.findIndex(p=>p.id===data.id);if(index>=0)products[index]=data;
    productCatalogCache=[];editingProduct=data;editStatus.textContent='Cambios guardados. Las compras y listas anteriores conservan sus registros.';manager.querySelector('#catalog-manager-edit-title').textContent='Editar: '+data.canonical_name;renderPersonalCatalog();editSave.disabled=false;
  });
  renderPersonalCatalog();

}

async function renderPriceReview() {
  const box=document.querySelector('#auth');
  if(!box||!user||!supabase) return;
  box.querySelector('.review-panel')?.remove();
  const {data:allowed,error:checkError}=await supabase.rpc('is_price_reviewer');
  if(checkError||!allowed) return;
  const panel=document.createElement('section');
  panel.className='review-panel';
  panel.innerHTML='<strong>Revisión de precios pendientes</strong><p>Solo se aprobarán precios con fuente HTTPS y observación dentro de las últimas 24 horas.</p><div class="review-items"><small>Cargando precios pendientes...</small></div>';
  box.appendChild(panel);
  await renderProductAdmin(panel);
  await renderStoreProductMappingManager({ container: panel, supabase });
  const list=panel.querySelector('.review-items');
  const {data,error}=await supabase.from('price_observations')
    .select('id,price,currency,regular_price,promotion_label,availability,source_url,observed_at,review_status,store_products(source_product_name,package_description,supermarkets(name),supermarket_branches(name))')
    .eq('review_status','pending').order('observed_at',{ascending:false}).limit(50);
  if(error){list.innerHTML='<small>No se pudo cargar la cola de revisión.</small>';return;}
  if(!data?.length){list.innerHTML='<small>No hay precios pendientes de revisión.</small>';return;}
  list.innerHTML=data.map(p=>{const sp=p.store_products||{};return '<article class="review-item"><div><strong>'+safe(sp.source_product_name||'Producto')+'</strong><small>'+safe(sp.supermarkets?.name||'Tienda')+' · '+safe(sp.supermarket_branches?.name||'Sucursal no indicada')+'</small><small>'+safe(sp.package_description||'Presentación no indicada')+' · '+money(p.price)+'</small><small>Observado: '+new Date(p.observed_at).toLocaleString('es-PA')+'</small><a href="'+safe(p.source_url)+'" target="_blank" rel="noreferrer">Abrir fuente ↗</a></div><div class="review-actions"><button data-review="approve" data-id="'+p.id+'">Aprobar</button><button class="secondary" data-review="reject" data-id="'+p.id+'">Rechazar</button></div></article>';}).join('');
  list.querySelectorAll('[data-review]').forEach(button=>button.addEventListener('click',async()=>{
    button.disabled=true;
    const approve=button.dataset.review==='approve';
    const {error:reviewError}=await supabase.rpc('review_price_observation',{p_observation_id:Number(button.dataset.id),p_approve:approve,p_note:null});
    if(reviewError){button.disabled=false;alert(reviewError.message||'No se pudo revisar el precio.');return;}
    await renderPriceReview();
    if(lastComparedProductId) compareProduct(lastComparedProductId);
  }));
}

async function loadProductCatalog() {
  if(productCatalogCache.length)return productCatalogCache;
  const {data,error}=await supabase.from('products').select('id,canonical_name,brand,normalized_quantity,normalized_unit_name').eq('active',true).order('canonical_name');
  if(error)throw error;productCatalogCache=data||[];return productCatalogCache;
}
async function renderListComparison(items) {
  const panel=document.querySelector('#list-comparison'),linked=(items||[]).filter(i=>i.product_id),unlinked=(items||[]).length-linked.length;
  if(!items?.length){panel.innerHTML='<p class="empty">Agrega productos para calcular el costo de tu lista.</p>';return;}
  if(!linked.length){panel.innerHTML='<p class="empty">Vincula artículos con el catálogo para comparar. Los artículos libres no entran en los totales.</p>';return;}
  panel.innerHTML='<div class="comparison-heading"><p class="eyebrow">COSTO DE TU LISTA</p><h3>Comparación por supermercado</h3><small>Solo precios aprobados y verificados de las últimas 24 horas; se comparan productos con la misma presentación.</small></div><p class="empty">Calculando...</p>';
  const ids=[...new Set(linked.map(i=>i.product_id))],cutoff=new Date(Date.now()-86400000).toISOString();
  const {data,error}=await supabase.from('store_products').select('product_id,branch_id,supermarkets(name),supermarket_branches(name),price_observations(price,currency,observed_at,is_verified,review_status)').in('product_id',ids).gte('price_observations.observed_at',cutoff).eq('price_observations.is_verified',true).eq('price_observations.review_status','approved').limit(300);
  if(error){panel.innerHTML='<p class="empty">No se pudo calcular la lista.</p>';return;}
  const stores=new Map();
  for(const listing of data||[]){
    const name=listing.supermarkets?.name,branchName=listing.supermarket_branches?.name,storeKey=branchName?name+' · '+branchName:name;if(!name||(name==='Super 99'&&selectedBranchId&&listing.branch_id!==selectedBranchId))continue;
    const valid=(listing.price_observations||[]).filter(p=>p.is_verified&&p.review_status==='approved'&&p.currency==='USD'&&Number(p.price)>0&&new Date(p.observed_at).getTime()>=Date.now()-86400000);
    if(!valid.length)continue;const price=valid.reduce((x,y)=>Number(x.price)<Number(y.price)?x:y);
    if(!stores.has(storeKey))stores.set(storeKey,new Map());const map=stores.get(storeKey),old=map.get(listing.product_id);
    if(!old||Number(price.price)<old.price)map.set(listing.product_id,{price:Number(price.price)});
  }
  const totals=[];for(const [name,prices] of stores){let total=0,covered=0;for(const item of linked){const p=prices.get(item.product_id);if(p){total+=Number(item.quantity)*p.price;covered++;}}totals.push({name,total,covered,complete:covered===linked.length});}
  totals.sort((x,y)=>Number(y.complete)-Number(x.complete)||x.total-y.total);
  const full=totals.filter(x=>x.complete),best=full[0]||null;
  const combo=linked.map(item=>{const opts=[];for(const [name,prices] of stores){const p=prices.get(item.product_id);if(p)opts.push({name,price:p.price});}opts.sort((x,y)=>x.price-y.price);return {item,choice:opts[0]||null};});
  const comboComplete=combo.every(x=>x.choice),comboTotal=combo.reduce((sum,x)=>sum+(x.choice?Number(x.item.quantity)*x.choice.price:0),0),comboStores=[...new Set(combo.filter(x=>x.choice).map(x=>x.choice.name))],savings=best&&comboComplete?Math.max(0,best.total-comboTotal):null;
  let html='<div class="comparison-heading"><p class="eyebrow">COSTO DE TU LISTA</p><h3>Comparación por supermercado</h3><small>USD · precios actuales, aprobados y verificados.</small></div>';
  if(unlinked)html+='<p class="comparison-note">'+unlinked+' artículo(s) sin vincular al catálogo quedan fuera del cálculo.</p>';
  html+=best?'<article class="best-total"><small>Menor total en una sola tienda</small><strong>'+safe(best.name)+'</strong><b>'+money(best.total)+'</b><span>Todos los '+linked.length+' productos tienen precio</span></article>':'<p class="comparison-note">Ningún supermercado tiene precio actual para todos los productos. No se presenta un total parcial como total de compra.</p>';
  html+='<div class="store-totals">'+(totals.length?totals.map(x=>'<article class="store-total"><div><strong>'+safe(x.name)+'</strong><small>'+x.covered+'/'+linked.length+' productos con precio</small></div><b>'+(x.complete?money(x.total):'Incompleto')+'</b></article>').join(''):'<p class="empty">No hay precios aprobados y actuales para estos productos.</p>')+'</div>';
  html+='<div class="combo-total"><strong>Combinación de menor precio</strong>'+(comboComplete?'<b>'+money(comboTotal)+'</b><small>Comprando en '+comboStores.length+' supermercado(s): '+safe(comboStores.join(', '))+'</small><small class="covered">'+(savings>0?'Ahorro potencial frente a la mejor tienda única: '+money(savings):'Sin ahorro adicional frente a la mejor tienda única.')+'</small>':'<small>Solo '+combo.filter(x=>x.choice).length+' de '+linked.length+' productos tienen precio actual; falta información para el total.</small>')+'<ul>'+combo.map(x=>'<li><span>'+safe(x.item.item_name)+' × '+safe(x.item.quantity)+'</span><span>'+(x.choice?safe(x.choice.name)+' · '+money(x.choice.price):'Sin precio verificado')+'</span></li>').join('')+'</ul></div><small class="comparison-footnote">Se multiplica el precio de la presentación catalogada por la cantidad indicada. No incluye entrega ni productos sin precio verificado.</small>';
  panel.innerHTML=html;
}
const GUEST_CART_KEY='micompra_guest_cart_v1';
const guestStores=['Super 99','El Rey','Xtra','Riba Smith','Machetazo','Jumbo'];
function readGuestCart(){try{const value=JSON.parse(localStorage.getItem(GUEST_CART_KEY)||'[]');return Array.isArray(value)?value:[];}catch{return [];}}
function saveGuestCart(items){localStorage.setItem(GUEST_CART_KEY,JSON.stringify(items));}
function renderGuestList(){
  const label=document.querySelector('#list-label'),cart=document.querySelector('#cart'),panel=document.querySelector('#list-comparison');
  const items=readGuestCart();label.textContent='Lista temporal · guardada en este dispositivo';
  cart.innerHTML='<p class="guest-cart-note">Puedes agregar productos desde los resultados aunque todavía no tengan precio verificado. El precio es opcional y podrás anotarlo cuando lo confirmes en la tienda. Esta lista temporal se guarda solo en este navegador/dispositivo.</p><form id="guest-add-item" class="guest-add-form"><label>Supermercado<select id="guest-store">'+guestStores.map(s=>'<option>'+s+'</option>').join('')+'</select></label><label>Producto<input id="guest-name" required maxlength="100" placeholder="Ej. Pollo"></label><div class="guest-fields"><label>Cantidad<input id="guest-qty" type="number" min="0.01" step="0.01" value="1" required></label><label>Precio por unidad ($)<input id="guest-price" type="number" min="0" step="0.01" placeholder="Opcional"></label></div><button type="submit">Agregar a mi compra</button><small id="guest-feedback" role="status"></small></form>'+ (items.length?items.map(i=>'<article class="guest-cart-item"><div><strong>'+safe(i.name)+'</strong><small>'+safe(i.store)+' · '+safe(i.qty)+' × '+(i.price===null||i.price===undefined?'Precio pendiente':money(i.price))+'</small></div><b>'+(i.price===null||i.price===undefined?'Pendiente':money(i.qty*i.price))+'</b><button type="button" data-guest-remove="'+i.id+'" aria-label="Eliminar '+safe(i.name)+'">×</button></article>').join(''):'<p class="empty">Todavía no has agregado productos.</p>');
  const totals=guestStores.map(store=>({store,total:items.filter(i=>i.store===store&&i.price!==null&&i.price!==undefined).reduce((sum,i)=>sum+i.qty*i.price,0),count:items.filter(i=>i.store===store).length,priced:items.filter(i=>i.store===store&&i.price!==null&&i.price!==undefined).length})).filter(x=>x.count);
  const grand=items.filter(i=>i.price!==null&&i.price!==undefined).reduce((sum,i)=>sum+i.qty*i.price,0);
  const pending=items.filter(i=>i.price===null||i.price===undefined).length;
  panel.innerHTML='<div class="comparison-heading"><p class="eyebrow">CONTROL DE TU DINERO</p><h3>Resumen de compra</h3><small>Los artículos sin precio se conservan en la lista, pero no se suman al total hasta que registres un importe.</small></div><article class="guest-grand-total"><small>Total de artículos con precio</small><b>'+money(grand)+'</b><span>'+items.length+' producto(s) · '+pending+' pendiente(s) de precio</span></article>'+(totals.length?totals.map(t=>'<article class="store-total"><div><strong>'+safe(t.store)+'</strong><small>'+t.count+' producto(s) · '+t.priced+' con precio</small></div><b>'+money(t.total)+'</b></article>').join(''):'<p class="empty">Los totales por supermercado aparecerán aquí.</p>')+'<button type="button" class="secondary" id="guest-clear-cart" '+(items.length?'':'disabled')+'>Vaciar lista temporal</button><small class="comparison-footnote">No se mezcla con precios oficiales ni con tus registros privados. Para conservarla en otro dispositivo, habrá que reactivar el acceso privado.</small>';
  cart.querySelector('#guest-add-item').addEventListener('submit',e=>{e.preventDefault();const name=cart.querySelector('#guest-name').value.trim(),store=cart.querySelector('#guest-store').value,qty=Number(cart.querySelector('#guest-qty').value),rawPrice=cart.querySelector('#guest-price').value.trim(),price=rawPrice===''?null:Number(rawPrice);if(!name||!Number.isFinite(qty)||qty<=0||(price!==null&&(!Number.isFinite(price)||price<0)))return;addGuestCartItem({name,store,qty,price});});
  cart.querySelectorAll('[data-guest-remove]').forEach(b=>b.addEventListener('click',()=>{saveGuestCart(readGuestCart().filter(i=>i.id!==b.dataset.guestRemove));renderGuestList();}));
  panel.querySelector('#guest-clear-cart')?.addEventListener('click',()=>{if(confirm('¿Vaciar la lista temporal de este dispositivo?')){saveGuestCart([]);renderGuestList();}});
}
async function loadList() {
  const label=document.querySelector('#list-label'),cart=document.querySelector('#cart');
  if(!user){renderGuestList();document.querySelector('#weekly-plan-module').innerHTML='';return;}
  let {data:lists,error}=await supabase.from('shopping_lists').select('id,name').eq('user_id',user.id).order('created_at',{ascending:false}).limit(1);
  if(error){cart.innerHTML='<p class="empty">No se pudo cargar tu lista.</p>';document.querySelector('#weekly-plan-module').innerHTML='';return;}
  if(!lists?.length){const created=await supabase.from('shopping_lists').insert({user_id:user.id,name:'Mi lista'}).select('id,name').single();if(created.error){cart.innerHTML='<p class="empty">No se pudo crear la lista.</p>';return;}activeList=created.data;}else activeList=lists[0];
  label.textContent=activeList.name;
  const [result,catalog]=await Promise.all([supabase.from('shopping_list_items').select('id,product_id,item_name,quantity,unit,checked,planned_for,priority').eq('list_id',activeList.id).order('created_at'),loadProductCatalog()]);
  const items=result.data||[];if(result.error){cart.innerHTML='<p class="empty">No se pudieron cargar los artículos.</p>';return;}
  const options=catalog.map(p=>'<option value="'+p.id+'">'+safe(p.canonical_name)+(p.normalized_quantity&&p.normalized_unit_name?' · '+safe(p.normalized_quantity)+' '+safe(p.normalized_unit_name):'')+'</option>').join('');
  cart.innerHTML='<form id="add-item" class="add-row"><select id="item-product" aria-label="Vincular producto del catálogo"><option value="">Artículo libre (sin vincular)</option>'+options+'</select><input id="item-name" type="text" placeholder="O escribe un artículo" aria-label="Artículo libre" autocomplete="off"><input id="item-qty" type="number" min="0.01" step="0.01" value="1" aria-label="Cantidad de unidades"><button id="add-list-item" '+(catalog.length?'':'disabled')+'>Agregar</button><div id="catalog-name-match" class="catalog-name-match" hidden aria-live="polite"></div></form>'+(items.length?sortShoppingItemsByPriority(items).map(i=>'<div class="cart-item priority-'+(i.priority||'normal')+'"><label><input type="checkbox" data-check="'+i.id+'" '+(i.checked?'checked':'')+'><span class="'+(i.checked?'done':'')+'">'+safe(i.item_name)+' <small>× '+safe(i.quantity)+' '+safe(i.unit||'unidades')+'</small><small class="'+(i.product_id?'linked-product':'unlinked-product')+'">'+(i.product_id?'Producto vinculado al catálogo':'Sin vincular · no se compara')+'</small></span></label><select class="cart-priority" data-priority="'+i.id+'" aria-label="Prioridad de '+safe(i.item_name)+'"><option value="urgent" '+((i.priority||'normal')==='urgent'?'selected':'')+'>Urgente</option><option value="normal" '+((i.priority||'normal')==='normal'?'selected':'')+'>Normal</option><option value="low" '+((i.priority||'normal')==='low'?'selected':'')+'>Baja</option></select><input class="cart-plan-date" type="date" data-plan-date="'+i.id+'" value="'+(i.planned_for||'')+'" aria-label="Programar '+safe(i.item_name)+'"><button class="remove" data-remove="'+i.id+'" aria-label="Eliminar '+safe(i.item_name)+'">×</button></div>').join(''):'<p class="empty">Tu lista está vacía. Agrega un producto del catálogo.</p>');
  const addForm=cart.querySelector('#add-item'),nameInput=cart.querySelector('#item-name'),productSelect=cart.querySelector('#item-product'),matchBox=cart.querySelector('#catalog-name-match'),addButton=cart.querySelector('#add-list-item');
  const updateCatalogSuggestions=()=>{
    const matches=productSelect.value?[]:findCatalogNameMatches(catalog,nameInput.value);
    const exact=matches.some(match=>match.isExactName);
    addButton.disabled=!catalog.length||exact;
    if(!matches.length){matchBox.hidden=true;matchBox.innerHTML='';return;}
    matchBox.hidden=false;
    matchBox.innerHTML='<strong>'+(exact?'Este producto ya existe en el catálogo. Selecciona la presentación correcta:':'¿Quizás buscabas uno de estos productos?')+'</strong>'+matches.map(p=>'<button type="button" class="catalog-match-option" data-catalog-match="'+safe(p.id)+'"><span>'+safe(p.canonical_name)+'</span><small>'+safe([p.brand,p.normalized_quantity&&p.normalized_unit_name?p.normalized_quantity+' '+p.normalized_unit_name:'Presentación por confirmar'].filter(Boolean).join(' · '))+'</small></button>').join('');
    matchBox.querySelectorAll('[data-catalog-match]').forEach(button=>button.addEventListener('click',()=>{
      productSelect.value=button.dataset.catalogMatch;
      nameInput.value='';
      matchBox.hidden=true;
      matchBox.innerHTML='';
      addButton.disabled=false;
    }));
  };
  nameInput.addEventListener('input',updateCatalogSuggestions);
  productSelect.addEventListener('change',updateCatalogSuggestions);
  addForm.addEventListener('submit',async e=>{
    e.preventDefault();
    const id=productSelect.value,product=catalog.find(p=>p.id===id),customName=nameInput.value.trim(),quantity=Number(cart.querySelector('#item-qty').value);
    if((!product&&!customName)||!Number.isFinite(quantity)||quantity<=0)return;
    if(!product&&findCatalogNameMatches(catalog,customName).some(match=>match.isExactName)){updateCatalogSuggestions();return;}
    const unit=product?(product.normalized_quantity&&product.normalized_unit_name?product.normalized_quantity+' '+product.normalized_unit_name+' por unidad':'unidades'):'unidades';
    const duplicate=findDuplicateListItem(items,product?.id||null,customName);
    if(duplicate){
      const {error}=await supabase.from('shopping_list_items').update({quantity:Number(duplicate.quantity)+quantity,checked:false}).eq('id',duplicate.id).eq('list_id',activeList.id);
      if(error)alert('No se pudo actualizar la cantidad del artículo.');else await loadList();
      return;
    }
    const {error}=await supabase.from('shopping_list_items').insert({list_id:activeList.id,product_id:product?.id||null,item_name:product?.canonical_name||customName,quantity,unit});
    if(!error)await loadList();else alert('No se pudo agregar el artículo.');
  });
  cart.querySelectorAll('[data-priority]').forEach(input=>input.addEventListener('change',async()=>{const {error}=await supabase.from('shopping_list_items').update({priority:input.value}).eq('id',input.dataset.priority).eq('list_id',activeList.id);if(error){alert('No se pudo guardar la prioridad.');}await loadList();}));
  cart.querySelectorAll('[data-plan-date]').forEach(input=>input.addEventListener('change',async()=>{const {error}=await supabase.from('shopping_list_items').update({planned_for:input.value||null}).eq('id',input.dataset.planDate).eq('list_id',activeList.id);if(error){alert('No se pudo guardar la fecha de compra.');}await loadList();}));
  cart.querySelectorAll('[data-check]').forEach(c=>c.addEventListener('change',async()=>{const {error}=await supabase.from('shopping_list_items').update({checked:c.checked}).eq('id',c.dataset.check);await loadList();if(error)alert('No se pudo actualizar el artículo.');}));
  cart.querySelectorAll('[data-remove]').forEach(b=>b.addEventListener('click',async()=>{const {error}=await supabase.from('shopping_list_items').delete().eq('id',b.dataset.remove);if(!error)loadList();}));
  await renderListComparison(items);
  await renderWeeklyPlan({ container: document.querySelector('#weekly-plan-module'), supabase, user, items, selectedBranchId });
}

async function start() {
  shell();
  if (!supabase) { await renderAuth(); await loadList(); message('Modo temporal disponible. La consulta del catálogo requiere conexión.'); return; }
  passwordRecovery = new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery';
  const { data } = await supabase.auth.getUser();
  user = data.user;
  message('Conexión con Supabase lista. Los precios se mostrarán únicamente si están verificados.');
  supabase.auth.onAuthStateChange((event, session) => {
    // INITIAL_SESSION ya queda cubierto por getUser() y el render inicial de start().
    // TOKEN_REFRESHED no debe reconstruir los módulos ni vaciar visualmente los datos.
    if (!['SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED', 'PASSWORD_RECOVERY'].includes(event)) return;
    if (event === 'PASSWORD_RECOVERY') passwordRecovery = true;
    const nextUser = session?.user || null;
    const previousUserId = user?.id || null;
    const nextUserId = nextUser?.id || null;
    if (event === 'SIGNED_IN' && previousUserId === nextUserId) return;
    if (event === 'SIGNED_OUT' && previousUserId === null) return;
    user = nextUser;
    queueMicrotask(async () => {
      await renderAuth();
      await loadList();
      await renderPriceReview();
    });
  });
  await renderAuth();
  const callbackParams = new URLSearchParams(location.hash.startsWith('#') ? location.hash.slice(1) : location.hash);
  const callbackError = callbackParams.get('error_description') || callbackParams.get('error');
  if (callbackError) {
    const feedback = document.querySelector('#auth-feedback');
    if (feedback) feedback.textContent = 'El enlace de acceso no pudo validarse: ' + callbackError.replace(/\+/g, ' ');
  }
  await renderPriceReview();
  await loadBranches();
  await loadList();
}
start();
