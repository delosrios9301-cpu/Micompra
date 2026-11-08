import { createClient } from '@supabase/supabase-js';
import './style.css';
import { importPriceCsv } from './price-import.js';
import { renderPurchases } from './purchases.js';

const env = import.meta.env;
const configured = Boolean(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY);
const supabase = configured ? createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY) : null;
const stores = [
  { name: 'Super 99', url: 'https://www.super99.com/nuestra-tienda-en-linea' },
  { name: 'El Rey' }, { name: 'Xtra', url: 'https://www.superxtra.com/supermercado' }, { name: 'Riba Smith' }, { name: 'Machetazo' }, { name: 'Jumbo' }
];
let user = null;
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
    <main>
      <section class="hero"><p class="eyebrow">COMPRA CON INFORMACIÓN</p><h1>Tu compra, más inteligente.</h1><p>Organiza tu lista y compara precios publicados por supermercados.</p></section>
      <section id="connection" class="status"><i></i><div><strong>${configured ? 'Conectando con Mi Compra' : 'Configuración pendiente'}</strong><small>${configured ? 'Consultando catálogo y precios disponibles.' : 'Faltan las variables de conexión de Supabase.'}</small></div></section>
      <section class="section-head"><div><p class="eyebrow">COMPARADOR</p><h2>Busca un producto</h2></div></section>
      <input id="search" class="search" type="search" placeholder="Ej. arroz, leche, pollo..." autocomplete="off" /><small class="catalog-source-note">Catálogo ampliado con productos de referencia de la canasta básica de ACODECO. La referencia sirve para identificar productos y presentaciones; no representa precios actuales.</small>
      <div class="branch-filter"><label for="branch-filter">Sucursal para Super 99</label><select id="branch-filter"><option value="">Todas las sucursales</option></select><small>La sucursal elegida solo filtra los precios de Super 99; los demás supermercados siguen apareciendo.</small></div>
      <div id="results" class="results"><p class="empty">Escribe el nombre de un producto para consultar el catálogo.</p></div>
      <section class="section-head list-heading"><div><p class="eyebrow">TU CARRITO</p><h2>Lista de compras</h2></div><span id="list-label" class="muted">Inicia sesión para guardar</span></section>
      <div id="auth" class="auth"></div>
      <div id="cart" class="cart"><p class="empty">Tu lista aparecerá aquí.</p></div><section id="list-comparison" class="list-comparison"><p class="empty">El comparador aparecerá cuando agregues productos.</p></section>
      <section class="section-head stores-heading"><div><p class="eyebrow">RED DE TIENDAS</p><h2>Supermercados</h2></div><span class="muted">6 tiendas</span></section>
      <section class="grid">${stores.map(s => `<article class="store"><b class="icon">${safe(s.name[0])}</b><div><strong>${safe(s.name)}</strong><small>${s.url ? 'Tienda en línea disponible' : 'Integración pendiente'}</small></div>${s.url ? `<a href="${s.url}" target="_blank" rel="noreferrer">Visitar ↗</a>` : '<em>En preparación</em>'}</article>`).join('')}</section>
      <aside><strong>Precios transparentes</strong><p>Solo compararemos productos equivalentes con precio, presentación, fuente y fecha de consulta. Si no hay precio verificado, lo indicaremos.</p><a class="template-link" href="/plantilla-precios.csv" download>Descargar plantilla para registrar precios ↗</a><small class="template-note">La plantilla es para captura y revisión manual; no publica precios automáticamente.</small></aside>
      <footer>Mi Compra · Panamá</footer>
    </main>`;
  document.querySelector('#branch-filter').addEventListener('change', e => { selectedBranchId = e.target.value; if (lastComparedProductId) compareProduct(lastComparedProductId); });
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
  if (!term) { box.innerHTML = '<p class="empty">Escribe el nombre de un producto para consultar el catálogo.</p>'; return; }
  if (!supabase) { box.innerHTML = '<p class="empty">La conexión de datos aún no está configurada.</p>'; return; }
  box.innerHTML = '<p class="empty">Buscando en el catálogo...</p>';
  const { data, error } = await supabase.from('products')
    .select('id,canonical_name,brand,normalized_quantity,normalized_unit_name')
    .eq('active', true).ilike('canonical_name', `%${term.replace(/[%_]/g, '')}%`)
    .order('canonical_name').limit(20);
  if (error) { box.innerHTML = '<p class="empty">No se pudo consultar el catálogo. Inténtalo más tarde.</p>'; return; }
  if (!data?.length) { box.innerHTML = '<p class="empty">No hay coincidencias en el catálogo todavía. No mostraremos precios estimados.</p>'; return; }
  box.innerHTML = data.map(p => `<article class="product"><div><strong>${safe(p.canonical_name)}</strong><small>${safe([p.brand, p.normalized_quantity && p.normalized_unit_name ? p.normalized_quantity + ' ' + p.normalized_unit_name : ''].filter(Boolean).join(' · ') || 'Presentación por confirmar')}</small></div><button data-product="${p.id}">Comparar</button></article>`).join('');
  box.querySelectorAll('[data-product]').forEach(b => b.addEventListener('click', () => compareProduct(b.dataset.product)));
}

async function compareProduct(id) {
  lastComparedProductId = id;
  const box = document.querySelector('#results');
  box.innerHTML = '<p class="empty">Consultando precios observados...</p>';
  const freshnessCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from('store_products')
    .select('id,branch_id,source_product_name,package_description,source_product_url,supermarkets(name),supermarket_branches(name),price_observations(price,currency,regular_price,promotion_label,source_url,observed_at,is_verified,review_status)')
    .eq('product_id', id)
    .gte('price_observations.observed_at', freshnessCutoff)
    .limit(40);
  if (error) { box.innerHTML = '<p class="empty">No fue posible consultar los precios.</p>'; return; }
  const rows = (data || []).flatMap(item => (item.price_observations || []).map(price => ({...price, store:item.supermarkets?.name, branch:item.supermarket_branches?.name, branchId:item.branch_id, product:item.source_product_name, pack:item.package_description, productUrl:item.source_product_url})))
    .filter(p => p.is_verified && p.review_status === 'approved' && p.currency === 'USD' && Number(p.price) > 0 && new Date(p.observed_at).getTime() >= Date.now() - 86400000 && (p.store !== 'Super 99' || !selectedBranchId || p.branchId === selectedBranchId)).sort((a,b) => Number(a.price)-Number(b.price));
  if (!rows.length) { box.innerHTML = '<p class="empty">Este producto no tiene precios verificados de las últimas 24 horas. No mostraremos precios antiguos como si fueran actuales.</p>'; return; }
  box.innerHTML = rows.map((p,i) => `<article class="price-row"><div><strong>${safe(p.store || 'Tienda')}</strong><small>${safe(p.product)} · ${safe(p.pack || 'Presentación no especificada')}</small>${p.branch ? `<small>Sucursal: ${safe(p.branch)}</small>` : '<small>Sucursal no especificada</small>'}<small>Consultado: ${new Date(p.observed_at).toLocaleString('es-PA')}</small>${p.store === 'Super 99' ? '<small>Precio exclusivo de compra en línea; sin ITBMS. Los productos por kg pueden mostrar importes aproximados.</small>' : ''}</div><div class="price-value"><b>${money(p.price)}</b>${p.regular_price && Number(p.regular_price)>Number(p.price) ? `<del>${money(p.regular_price)}</del><em>${safe(p.promotion_label || "En oferta")}</em>` : ""}${i===0?'<em>Menor precio verificado</em>':''}<a href="${safe(p.source_url || p.productUrl || '#')}" target="_blank" rel="noreferrer">Ver fuente ↗</a></div></article>`).join('');
}

async function renderAuth() {
  const box = document.querySelector('#auth');
  if (!supabase) { box.innerHTML = ''; return; }
  if (!user) {
    box.innerHTML = '<form id="login-form"><label for="email">Correo electrónico para guardar tu lista</label><div class="login-row"><input id="email" type="email" required placeholder="tu@correo.com"><button>Enviar enlace</button></div><small>Te enviaremos un enlace seguro de acceso; no necesitas contraseña.</small></form>';
    box.querySelector('#login-form').addEventListener('submit', async e => {
      e.preventDefault();
      const email = box.querySelector('#email').value.trim();
      const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } });
      box.querySelector('small').textContent = error ? 'No se pudo enviar el enlace. Verifica el correo e inténtalo de nuevo.' : 'Enlace enviado. Revisa tu correo para iniciar sesión.';
    });
  } else {
    box.innerHTML = `<div class="signed"><span>Sesión: ${safe(user.email)}</span><button id="logout" class="secondary">Cerrar sesión</button></div><section class="import-panel"><strong>Importar precios desde CSV</strong><p>Usa fecha ISO 8601 con zona horaria, por ejemplo 2026-11-07T17:00:00-05:00. Solo acepta precios de las últimas 24 horas, fuentes HTTPS y coincidencias exactas con producto y sucursal. Los precios importados quedan pendientes de revisión.</p><div class="import-row"><input id="price-csv" type="file" accept=".csv,text/csv"><button id="import-csv" class="secondary">Validar e importar</button></div><small id="import-result" aria-live="polite"></small></section><div id="purchases-module"></div>`;
    box.querySelector('#logout').addEventListener('click', () => supabase.auth.signOut());
    box.querySelector('#import-csv').addEventListener('click', async () => { const output=box.querySelector('#import-result'); output.textContent='Procesando...'; try { await importPriceCsv({file:box.querySelector('#price-csv').files[0],supabase,user,output}); await renderPriceReview(); } catch(error) { output.textContent=error.message || 'No se pudo importar el archivo.'; } });
  }
  if(user) await renderPurchases({container:box.querySelector('#purchases-module'),supabase,user});
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
async function loadList() {
  const label=document.querySelector('#list-label'),cart=document.querySelector('#cart');
  if(!user){label.textContent='Inicia sesión para guardar';cart.innerHTML='<p class="empty">Inicia sesión para crear y sincronizar tu lista.</p>';document.querySelector('#list-comparison').innerHTML='<p class="empty">Inicia sesión para comparar tu lista.</p>';return;}
  let {data:lists,error}=await supabase.from('shopping_lists').select('id,name').eq('user_id',user.id).order('created_at',{ascending:false}).limit(1);
  if(error){cart.innerHTML='<p class="empty">No se pudo cargar tu lista.</p>';return;}
  if(!lists?.length){const created=await supabase.from('shopping_lists').insert({user_id:user.id,name:'Mi lista'}).select('id,name').single();if(created.error){cart.innerHTML='<p class="empty">No se pudo crear la lista.</p>';return;}activeList=created.data;}else activeList=lists[0];
  label.textContent=activeList.name;
  const [result,catalog]=await Promise.all([supabase.from('shopping_list_items').select('id,product_id,item_name,quantity,unit,checked').eq('list_id',activeList.id).order('created_at'),loadProductCatalog()]);
  const items=result.data||[];if(result.error){cart.innerHTML='<p class="empty">No se pudieron cargar los artículos.</p>';return;}
  const options=catalog.map(p=>'<option value="'+p.id+'">'+safe(p.canonical_name)+(p.normalized_quantity&&p.normalized_unit_name?' · '+safe(p.normalized_quantity)+' '+safe(p.normalized_unit_name):'')+'</option>').join('');
  cart.innerHTML='<form id="add-item" class="add-row"><select id="item-product" aria-label="Vincular producto del catálogo"><option value="">Artículo libre (sin vincular)</option>'+options+'</select><input id="item-name" type="text" placeholder="O escribe un artículo" aria-label="Artículo libre"><input id="item-qty" type="number" min="0.01" step="0.01" value="1" aria-label="Cantidad de unidades"><button '+(catalog.length?'':'disabled')+'>Agregar</button></form>'+(items.length?items.map(i=>'<div class="cart-item"><label><input type="checkbox" data-check="'+i.id+'" '+(i.checked?'checked':'')+'><span class="'+(i.checked?'done':'')+'">'+safe(i.item_name)+' <small>× '+safe(i.quantity)+' '+safe(i.unit||'unidades')+'</small><small class="'+(i.product_id?'linked-product':'unlinked-product')+'">'+(i.product_id?'Producto vinculado al catálogo':'Sin vincular · no se compara')+'</small></span></label><button class="remove" data-remove="'+i.id+'" aria-label="Eliminar '+safe(i.item_name)+'">×</button></div>').join(''):'<p class="empty">Tu lista está vacía. Agrega un producto del catálogo.</p>');
  cart.querySelector('#add-item').addEventListener('submit',async e=>{e.preventDefault();const id=cart.querySelector('#item-product').value,product=catalog.find(p=>p.id===id),customName=cart.querySelector('#item-name').value.trim(),quantity=Number(cart.querySelector('#item-qty').value);if((!product&&!customName)||!Number.isFinite(quantity)||quantity<=0)return;const unit=product?(product.normalized_quantity&&product.normalized_unit_name?product.normalized_quantity+' '+product.normalized_unit_name+' por unidad':'unidades'):'unidades';const {error}=await supabase.from('shopping_list_items').insert({list_id:activeList.id,product_id:product?.id||null,item_name:product?.canonical_name||customName,quantity,unit});if(!error)loadList();else alert('No se pudo agregar el artículo.');});
  cart.querySelectorAll('[data-check]').forEach(c=>c.addEventListener('change',async()=>{const {error}=await supabase.from('shopping_list_items').update({checked:c.checked}).eq('id',c.dataset.check);if(error)loadList();}));
  cart.querySelectorAll('[data-remove]').forEach(b=>b.addEventListener('click',async()=>{const {error}=await supabase.from('shopping_list_items').delete().eq('id',b.dataset.remove);if(!error)loadList();}));
  await renderListComparison(items);
}

async function start() {
  shell();
  if (!supabase) { await renderAuth(); return; }
  const { data } = await supabase.auth.getUser();
  user = data.user;
  message('Conexión con Supabase lista. Los precios se mostrarán únicamente si están verificados.');
  supabase.auth.onAuthStateChange((_event, session) => {
    user = session?.user || null;
    queueMicrotask(async () => {
      await renderAuth();
      await loadList();
      await renderPriceReview();
    });
  });
  await renderAuth();
  await renderPriceReview();
  await loadBranches();
  await loadList();
}
start();
