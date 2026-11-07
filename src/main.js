import { createClient } from '@supabase/supabase-js';
import './style.css';

const env = import.meta.env;
const configured = Boolean(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY);
const supabase = configured ? createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY) : null;
const stores = [
  { name: 'Super 99', url: 'https://www.super99.com/nuestra-tienda-en-linea' },
  { name: 'El Rey' }, { name: 'Xtra' }, { name: 'Riba Smith' }, { name: 'Machetazo' }, { name: 'Jumbo' }
];
let user = null;
let activeList = null;
let searchTimer;
let selectedBranchId = '';
let lastComparedProductId = null;

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
      <input id="search" class="search" type="search" placeholder="Ej. arroz, leche, pollo..." autocomplete="off" />
      <div class="branch-filter"><label for="branch-filter">Sucursal para Super 99</label><select id="branch-filter"><option value="">Todas las sucursales</option></select><small>La sucursal elegida solo filtra los precios de Super 99; los demás supermercados siguen apareciendo.</small></div>
      <div id="results" class="results"><p class="empty">Escribe el nombre de un producto para consultar el catálogo.</p></div>
      <section class="section-head list-heading"><div><p class="eyebrow">TU CARRITO</p><h2>Lista de compras</h2></div><span id="list-label" class="muted">Inicia sesión para guardar</span></section>
      <div id="auth" class="auth"></div>
      <div id="cart" class="cart"><p class="empty">Tu lista aparecerá aquí.</p></div>
      <section class="section-head stores-heading"><div><p class="eyebrow">RED DE TIENDAS</p><h2>Supermercados</h2></div><span class="muted">6 tiendas</span></section>
      <section class="grid">${stores.map(s => `<article class="store"><b class="icon">${safe(s.name[0])}</b><div><strong>${safe(s.name)}</strong><small>${s.url ? 'Tienda en línea disponible' : 'Integración pendiente'}</small></div>${s.url ? `<a href="${s.url}" target="_blank" rel="noreferrer">Visitar ↗</a>` : '<em>En preparación</em>'}</article>`).join('')}</section>
      <aside><strong>Precios transparentes</strong><p>Solo compararemos productos equivalentes con precio, presentación, fuente y fecha de consulta. Si no hay precio verificado, lo indicaremos.</p></aside>
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
    .select('id,branch_id,source_product_name,package_description,source_product_url,supermarkets(name),supermarket_branches(name),price_observations(price,currency,regular_price,promotion_label,source_url,observed_at,is_verified)')
    .eq('product_id', id)
    .gte('price_observations.observed_at', freshnessCutoff)
    .limit(40);
  if (error) { box.innerHTML = '<p class="empty">No fue posible consultar los precios.</p>'; return; }
  const rows = (data || []).flatMap(item => (item.price_observations || []).map(price => ({...price, store:item.supermarkets?.name, branch:item.supermarket_branches?.name, branchId:item.branch_id, product:item.source_product_name, pack:item.package_description, productUrl:item.source_product_url})))
    .filter(p => p.is_verified && (p.store !== 'Super 99' || !selectedBranchId || p.branchId === selectedBranchId)).sort((a,b) => Number(a.price)-Number(b.price));
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
    box.innerHTML = `<div class="signed"><span>Sesión: ${safe(user.email)}</span><button id="logout" class="secondary">Cerrar sesión</button></div>`;
    box.querySelector('#logout').addEventListener('click', () => supabase.auth.signOut());
  }
}

async function loadList() {
  const label = document.querySelector('#list-label'), cart = document.querySelector('#cart');
  if (!user) { label.textContent = 'Inicia sesión para guardar'; cart.innerHTML = '<p class="empty">Inicia sesión para crear y sincronizar tu lista.</p>'; return; }
  let { data: lists, error } = await supabase.from('shopping_lists').select('id,name').order('created_at', {ascending:false}).limit(1);
  if (error) { cart.innerHTML = '<p class="empty">No se pudo cargar tu lista.</p>'; return; }
  if (!lists?.length) {
    const created = await supabase.from('shopping_lists').insert({user_id:user.id,name:'Mi lista'}).select('id,name').single();
    if (created.error) { cart.innerHTML = '<p class="empty">No se pudo crear la lista.</p>'; return; }
    activeList = created.data;
  } else activeList = lists[0];
  label.textContent = activeList.name;
  const { data: items, error: itemError } = await supabase.from('shopping_list_items').select('id,item_name,quantity,unit,checked').eq('list_id',activeList.id).order('created_at');
  if (itemError) { cart.innerHTML = '<p class="empty">No se pudieron cargar los artículos.</p>'; return; }
  const total = (items || []).length;
  cart.innerHTML = `<form id="add-item" class="add-row"><input id="item-name" required placeholder="Agregar artículo"><input id="item-qty" type="number" min="0.01" step="0.01" value="1" aria-label="Cantidad"><button>Agregar</button></form>${total ? items.map(i => `<div class="cart-item"><label><input type="checkbox" data-check="${i.id}" ${i.checked?'checked':''}><span class="${i.checked?'done':''}">${safe(i.item_name)} <small>× ${safe(i.quantity)} ${safe(i.unit || '')}</small></span></label><button class="remove" data-remove="${i.id}" aria-label="Eliminar ${safe(i.item_name)}">×</button></div>`).join('') : '<p class="empty">Tu lista está vacía. Agrega tu primer artículo.</p>'}`;
  cart.querySelector('#add-item').addEventListener('submit', async e => {
    e.preventDefault();
    const item_name = cart.querySelector('#item-name').value.trim();
    const quantity = Number(cart.querySelector('#item-qty').value);
    const { error } = await supabase.from('shopping_list_items').insert({list_id:activeList.id,item_name,quantity});
    if (!error) loadList(); else alert('No se pudo agregar el artículo.');
  });
  cart.querySelectorAll('[data-check]').forEach(c => c.addEventListener('change', async () => {
    const {error} = await supabase.from('shopping_list_items').update({checked:c.checked}).eq('id',c.dataset.check);
    if (error) loadList();
  }));
  cart.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', async () => {
    const {error} = await supabase.from('shopping_list_items').delete().eq('id',b.dataset.remove);
    if (!error) loadList();
  }));
}

async function start() {
  shell();
  if (!supabase) { await renderAuth(); return; }
  const { data } = await supabase.auth.getUser();
  user = data.user;
  message('Conexión con Supabase lista. Los precios se mostrarán únicamente si están verificados.');
  supabase.auth.onAuthStateChange((_event, session) => {
    user = session?.user || null;
    renderAuth();
    loadList();
  });
  await renderAuth();
  await loadBranches();
  await loadList();
}
start();
