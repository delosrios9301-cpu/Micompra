import { createClient } from '@supabase/supabase-js';
import './style.css';
import { importPriceCsv } from './price-import.js';
import { renderStoreProductMappingManager } from './store-mapping.js';
import { renderPurchases, normalizeProductBarcode, isValidBarcodeChecksum } from './purchases.js';
import { getProductRegistrationCheck, validateProductRegistrationDraft } from './catalog-admin.js';
import { parseCatalogCsv, analyzeCatalogImportRows } from './catalog-import.js';
import { findCatalogNameMatches, findDuplicateListItem } from './catalog-duplicates.js';
import { renderSpendingDashboard } from './spending.js';
import { renderPersonalPantry, GUEST_PANTRY_KEY, readGuestPantry, addPurchasedItemsToGuestPantry } from './pantry.js';
import { renderWeeklyPlan, sortShoppingItemsByPriority } from './weekly-plan.js';
import { startPersonalWorkspaceSync } from './personal-sync.js';
import { readStoredArraySafely, readStoredObjectSafely, collectLocalRecoveryCopies, restoreLocalRecoveryCopies } from './storage-recovery.js';

const env = import.meta.env;
const configured = Boolean(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY);
const supabase = configured ? createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY) : null;
const stores = ['Super 99','El Rey','Xtra','Riba Smith','Machetazo','Jumbo'].map(name=>({name,sourceLabel:'Precios y productos registrados manualmente por ti'}));
// Acceso temporal de consulta mientras se termina de configurar el correo de autenticación.
// Mantiene RLS intacto: no abre datos personales ni crea usuarios anónimos.
const TEMPORARY_GUEST_MODE = false;
let user = null;
let passwordRecovery = false;
let activeList = null;
let searchTimer;
let selectedBranchId = '';
let lastComparedProductId = null;
let productCatalogCache = [];
let stopPersonalWorkspaceSync = null;

const app = document.querySelector('#app');
const money = value => { let currency='USD'; try { const prefs=JSON.parse(localStorage.getItem('micompra_settings_v1')||'{}'); if(['USD','PAB'].includes(prefs.currency))currency=prefs.currency; } catch {} return new Intl.NumberFormat('es-PA',{style:'currency',currency}).format(Number(value)||0); };
const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function renderHomeDashboard(){
 const host=document.querySelector('#home-dashboard');if(!host)return;
 const catalog=readPersonalCatalog(),purchases=readGuestPurchases(),cart=readGuestCart(),pantry=readGuestPantry();
 const now=new Date(),monthStart=new Date(now.getFullYear(),now.getMonth(),1);
 const validPurchases=purchases.filter(p=>Number.isFinite(Number(p.total))&&Number(p.total)>=0);
 const spentAll=validPurchases.reduce((sum,p)=>sum+Number(p.total),0);
 const monthPurchases=validPurchases.filter(p=>{const d=new Date(p.createdAt);return Number.isFinite(d.getTime())&&d>=monthStart&&d<=now;});
 const spentMonth=monthPurchases.reduce((sum,p)=>sum+Number(p.total),0);
 const low=pantry.filter(p=>Number(p.quantity||0)>0&&Number(p.quantity||0)<=Number(p.minimum_quantity??1));
 const empty=pantry.filter(p=>Number(p.quantity||0)<=0);
 const restock=[...empty,...low],pending=cart.filter(p=>p.price===null||p.price===undefined||!Number.isFinite(Number(p.price))).length;
 const cartTotal=cart.filter(p=>p.price!==null&&p.price!==undefined&&Number.isFinite(Number(p.price))).reduce((sum,p)=>sum+Number(p.qty||0)*Number(p.price),0);
 const latest=validPurchases.slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0];
 const monthlySpend=Array.from({length:6},(_,index)=>{const d=new Date(now.getFullYear(),now.getMonth()-(5-index),1);const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');return {key,label:d.toLocaleDateString('es-PA',{month:'short'}).replace('.',''),amount:0};});
 const monthLookup=new Map(monthlySpend.map(row=>[row.key,row]));
 validPurchases.forEach(p=>{const d=new Date(p.createdAt);if(!Number.isFinite(d.getTime()))return;const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');const row=monthLookup.get(key);if(row)row.amount+=Number(p.total);});
 const maxMonthlySpend=Math.max(...monthlySpend.map(row=>row.amount),0.01);
 const spendingChartHtml='<section class="dashboard-panel dashboard-spending-chart"><div class="dashboard-panel-heading"><div><p class="eyebrow">TENDENCIA DE GASTOS</p><h3>Últimos seis meses</h3></div><span class="dashboard-chart-caption">Compras guardadas</span></div>'+(validPurchases.length?'<div class="dashboard-month-bars">'+monthlySpend.map(row=>'<div class="dashboard-month-bar"><div><span>'+safe(row.label)+'</span><b>'+money(row.amount)+'</b></div><i><span style="width:'+Math.max(0,row.amount/maxMonthlySpend*100)+'%"></span></i></div>').join('')+'</div>':'<p class="dashboard-empty">La gráfica aparecerá cuando guardes tu primera compra.</p>')+'<small class="dashboard-chart-note">Importes reales de tus comprobantes personales guardados '+(user?'en tu cuenta sincronizada.':'en este dispositivo.')+'</small></section>';
 const fmtDate=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleDateString('es-PA',{day:'numeric',month:'short',year:'numeric'}):'Fecha no disponible';};
 const restockHtml=restock.length?restock.slice(0,4).map(item=>'<li class="'+(Number(item.quantity||0)<=0?'is-empty':'is-low')+'"><span><strong>'+safe(item.item_name||'Artículo')+'</strong><small>'+(Number(item.quantity||0)<=0?'Agotado':'Quedan '+safe(item.quantity)+' '+safe(item.unit||'unidad(es)'))+'</small></span><b>'+(Number(item.quantity||0)<=0?'Reponer':'Mín. '+safe(item.minimum_quantity??1))+'</b></li>').join(''):'<li class="dashboard-no-alerts"><span><strong>Todo en orden</strong><small>No hay artículos por debajo del mínimo.</small></span><b>✓</b></li>';
 const lastHtml=latest?'<div class="dashboard-last-purchase"><span class="dashboard-last-icon">✓</span><div><strong>'+safe(latest.number||'Compra guardada')+'</strong><small>'+fmtDate(latest.createdAt)+' · '+safe((latest.items||[]).length)+' producto(s)</small></div><b>'+money(Number(latest.total))+'</b></div>':'<p class="dashboard-empty">Todavía no has guardado compras. Cuando finalices una compra, aparecerá aquí.</p>';
 host.innerHTML='<div class="dashboard-heading"><div><p class="eyebrow">TU RESUMEN PERSONAL</p><h2>Hola, bienvenido a Mi Compra</h2><p>Un vistazo rápido a tus compras, productos y despensa.</p></div><span class="dashboard-date">'+now.toLocaleDateString('es-PA',{weekday:'long',day:'numeric',month:'long'})+'</span></div><div class="dashboard-metrics"><article class="dashboard-metric metric-spent"><span class="dashboard-metric-icon">$</span><div><small>Gasto acumulado</small><strong>'+money(spentAll)+'</strong><em>'+validPurchases.length+' compra(s) guardada(s)</em></div></article><article class="dashboard-metric"><span class="dashboard-metric-icon">↗</span><div><small>Gasto este mes</small><strong>'+money(spentMonth)+'</strong><em>'+monthPurchases.length+' compra(s) este mes</em></div></article><article class="dashboard-metric"><span class="dashboard-metric-icon">▦</span><div><small>Mi catálogo</small><strong>'+catalog.length+'</strong><em>Producto(s) registrados</em></div></article><article class="dashboard-metric '+(restock.length?'metric-alert':'')+'"><span class="dashboard-metric-icon">⌂</span><div><small>Por reponer</small><strong>'+restock.length+'</strong><em>'+empty.length+' agotado(s) · '+low.length+' bajo mínimo</em></div></article></div>'+spendingChartHtml+'<div class="dashboard-detail-grid"><section class="dashboard-panel"><div class="dashboard-panel-heading"><div><p class="eyebrow">DESPENSA</p><h3>Necesitan atención</h3></div><button type="button" data-dashboard-view="cuenta">Ver inventario →</button></div><ul class="dashboard-restock-list">'+restockHtml+'</ul></section><section class="dashboard-panel"><div class="dashboard-panel-heading"><div><p class="eyebrow">ACTIVIDAD RECIENTE</p><h3>Última compra</h3></div><button type="button" data-dashboard-view="comparar">Ver resumen →</button></div>'+lastHtml+'<div class="dashboard-cart-status"><span>Lista actual</span><strong>'+cart.length+' artículo(s) · '+money(cartTotal)+'</strong><small>'+(pending?pending+' producto(s) sin precio':'Precios completos o lista vacía')+'</small></div></section></div><p class="dashboard-data-note">Resumen calculado con la información guardada '+(user?'en tu cuenta y sincronizada entre dispositivos.':'en este dispositivo.')+' No se consultan páginas de supermercados.</p>';
 host.querySelectorAll('[data-dashboard-view]').forEach(button=>button.addEventListener('click',()=>{const target=button.dataset.dashboardView;if(target==='cuenta'){document.querySelector('[data-more-view="cuenta"]')?.click();return;}document.querySelector('[data-open-view="'+target+'"]')?.click();}));
}
function shell() {
  app.innerHTML = `
    <header><a class="brand" href="#">Mi<span>Compra</span></a><span class="country">Panamá</span></header>
    <div id="auth" class="auth auth-entry"></div>
    <main>
      <section class="hero"><p class="eyebrow">COMPRA CON INFORMACIÓN</p><h1>Tu compra, más inteligente.</h1><p>Registra tus productos, organiza tus compras y compara los precios que tú mismo anotas.</p></section>
      <section id="connection" class="status"><i></i><div><strong>${configured ? 'Conectando con Mi Compra' : 'Configuración pendiente'}</strong><small>${configured ? 'Consultando catálogo y precios disponibles.' : 'Faltan las variables de conexión de Supabase.'}</small></div></section>
      <section class="section-head"><div><p class="eyebrow">COMPARADOR</p><h2>Busca un producto</h2></div></section>
      <input id="search" class="search" type="search" placeholder="Ej. arroz, lechuga, leche, pollo..." autocomplete="off" /><div class="store-filter"><label for="store-filter">Buscar en supermercado</label><select id="store-filter"><option value="">Selecciona un supermercado</option>${guestStores.map(name => `<option value="${safe(name)}">${safe(name)}</option>`).join("")}</select></div><small class="catalog-source-note">Solo se muestran productos que tú hayas registrado manualmente para el supermercado seleccionado.</small>
      <div class="branch-filter" hidden></div>
      <div id="results" class="results"><p class="empty">Escribe el nombre de un producto para ver las presentaciones disponibles.</p></div>
      <section class="section-head list-heading"><div><p class="eyebrow">TU CARRITO</p><h2>Lista para comprar</h2></div><span id="list-label" class="muted">Inicia sesión para guardar</span></section>
      <div id="cart" class="cart"><p class="empty">Tu lista aparecerá aquí.</p></div><section id="list-comparison" class="list-comparison"><p class="empty">El comparador aparecerá cuando agregues productos.</p></section><div id="weekly-plan-module"></div>
      <section class="section-head stores-heading"><div><p class="eyebrow">RED DE TIENDAS</p><h2>Supermercados</h2></div><span class="muted">6 tiendas</span></section>
      <section class="grid">${stores.map(s => `<article class="store"><b class="icon">${safe(s.name[0])}</b><div><strong>${safe(s.name)}</strong><small>${safe(s.sourceLabel)}</small></div><em>Catálogo personal</em></article>`).join('')}</section>
      <aside><strong>Comparaciones basadas en tus datos</strong><p>Mi Compra no consulta páginas de supermercados. Tú registras cada producto, fotografía, presentación y precio; el sistema compara esos datos y señala cuándo faltan registros.</p></aside>
      <footer>Mi Compra · Panamá</footer>
    </main>`;
  const main=document.querySelector('main');
  const authPanel=document.querySelector('#auth');
  const views=[
    {id:'inicio',label:'Inicio',icon:'⌂',nodes:['.hero','#connection']},
    {id:'comprar',label:'Comprar',icon:'＋',nodes:['.section-head:not(.list-heading):not(.stores-heading)','#search','.store-filter','.catalog-source-note','.branch-filter','#results','.list-heading','#cart']},
    {id:'comparar',label:'Comparar',icon:'⇄',nodes:['#list-comparison','#weekly-plan-module']},
    {id:'tiendas',label:'Tiendas',icon:'▦',nodes:['.stores-heading','.grid','aside']},
    {id:'cuenta',label:'Mi espacio',icon:'◉',nodes:[]},{id:'catalogo',label:'Mi catálogo',icon:'▣',nodes:[]},{id:'configuracion',label:'Ajustes',icon:'⚙',nodes:[]},{id:'mas',label:'Más',icon:'⋯',nodes:[]}
  ];
  const nav=document.createElement('nav');nav.className='app-navigation';nav.setAttribute('aria-label','Navegación principal');
  const viewHost=document.createElement('div');viewHost.className='app-views';
  const panels={};
  views.forEach(view=>{
    const panel=document.createElement('section');panel.className='app-view';panel.dataset.view=view.id;panel.hidden=view.id!=='inicio';panels[view.id]=panel;viewHost.appendChild(panel);
    view.nodes.forEach(selector=>{const node=main.querySelector(selector);if(node)panel.appendChild(node);});
    if(['inicio','comprar','comparar','catalogo','mas'].includes(view.id)){const button=document.createElement('button');button.type='button';button.className='app-nav-item'+(view.id==='inicio'?' active':'');button.dataset.openView=view.id;button.innerHTML='<span aria-hidden="true">'+view.icon+'</span><small>'+view.label+'</small>';nav.appendChild(button);}
  });
  const searchCard=document.createElement('section');searchCard.className='page-card shopping-search-card';
  ['.section-head:not(.list-heading):not(.stores-heading)','#search','.store-filter','.catalog-source-note','.branch-filter','#results'].forEach(selector=>{const node=panels.comprar.querySelector(selector);if(node)searchCard.appendChild(node);});
  panels.comprar.prepend(searchCard);
  const cartCard=document.createElement('section');cartCard.className='page-card shopping-cart-card';
  ['.list-heading','#cart'].forEach(selector=>{const node=panels.comprar.querySelector(selector);if(node)cartCard.appendChild(node);});
  panels.comprar.appendChild(cartCard);
  const compareIntro=document.createElement('div');compareIntro.className='module-intro';compareIntro.innerHTML='<p class="eyebrow">ANÁLISIS DE PRECIOS</p><h2>Comparar precios</h2><p>Compara los registros que has guardado para el mismo producto y presentación.</p>';
  panels.comparar.prepend(compareIntro);
  const storesCard=document.createElement('section');storesCard.className='page-card stores-page-card';
  ['.stores-heading','.grid','aside'].forEach(selector=>{const node=panels.tiendas.querySelector(selector);if(node)storesCard.appendChild(node);});
  panels.tiendas.appendChild(storesCard);
  panels.cuenta.appendChild(authPanel);
  panels.mas.innerHTML='<section class="more-page"><div class="settings-heading"><p class="eyebrow">CENTRO DE HERRAMIENTAS</p><h2>Más opciones</h2><p>Las herramientas están agrupadas por función para que encuentres cada módulo sin mezclar tareas.</p></div><section class="more-group"><h3>Gestión personal</h3><div class="more-links"><button type="button" data-more-view="tiendas"><span>▦</span><span><strong>Supermercados</strong><small>Tiendas disponibles y datos de referencia</small></span><b>›</b></button><button type="button" data-more-view="cuenta"><span>◉</span><span><strong>Mi espacio</strong><small>Cuenta, compras guardadas, gastos y despensa</small></span><b>›</b></button></div></section><section class="more-group"><h3>Aplicación</h3><div class="more-links"><button type="button" data-more-view="configuracion"><span>⚙</span><span><strong>Configuración</strong><small>Preferencias, apariencia y copias de seguridad</small></span><b>›</b></button></div></section></section>';
  panels.configuracion.innerHTML='<section class="settings-page"><div class="settings-heading"><p class="eyebrow">PERSONALIZA TU EXPERIENCIA</p><h2>Configuración</h2><p>Controla cómo funciona Mi Compra. Tus supermercados y precios se registran manualmente.</p></div><article class="settings-card"><div class="settings-card-title"><span>🏬</span><div><strong>Supermercados</strong><small>Selecciona los establecimientos que utilizas.</small></div></div><div class="settings-store-list">'+guestStores.map(name=>'<label><input type="checkbox" name="enabled-store" value="'+name+'" checked><span>'+name+'</span></label>').join('')+'</div><form id="settings-add-store" class="settings-add-store"><label>Agregar supermercado<input name="storeName" maxlength="50" required placeholder="Ej. Supermercado local"></label><button type="submit">Agregar supermercado</button><small id="settings-store-feedback" role="status"></small></form></article><article class="settings-card"><div class="settings-card-title"><span>🛒</span><div><strong>Preferencias de compra</strong><small>Define los valores iniciales de tus listas.</small></div></div><label class="settings-field">Supermercado predeterminado<select id="settings-default-store">'+guestStores.map(name=>'<option>'+name+'</option>').join('')+'</select></label><label class="settings-field">Moneda de referencia<select id="settings-currency"><option value="USD">Dólar estadounidense (USD)</option><option value="PAB">Balboa panameño (PAB)</option></select></label></article><article class="settings-card"><div class="settings-card-title"><span>🎨</span><div><strong>Apariencia</strong><small>Interfaz clara y adaptable a tu dispositivo.</small></div></div><label class="settings-field">Tema<select id="settings-theme"><option value="light">Claro</option><option value="system">Según dispositivo</option></select></label></article><article class="settings-card"><div class="settings-card-title"><span>🛡️</span><div><strong>Respaldo de datos</strong><small>Guarda una copia de tus productos, fotografías, lista, inventario e historial de compras de este dispositivo.</small></div></div><button type="button" id="settings-export">Descargar copia de seguridad</button><label class="settings-restore-control">Restaurar una copia guardada<input type="file" id="settings-import" accept="application/json,.json"></label><small id="settings-feedback" role="status"></small></article><article class="settings-card"><div class="settings-card-title"><span>📊</span><div><strong>Estado de tus datos</strong><small>Resumen de la información guardada en este dispositivo.</small></div></div><div class="settings-data-summary"><div><b id="settings-count-products">0</b><small>Productos</small></div><div><b id="settings-count-cart">0</b><small>En la lista</small></div><div><b id="settings-count-purchases">0</b><small>Compras</small></div><div><b id="settings-count-pantry">0</b><small>En despensa</small></div></div><p class="settings-storage-note">Tus datos se guardan en este dispositivo. Para utilizarlos en otro equipo, restaura una copia de seguridad. La sincronización entre dispositivos requiere una cuenta autenticada.</p><button type="button" id="settings-reset-preferences" class="settings-secondary-button">Restablecer solo preferencias</button><small id="settings-reset-feedback" role="status"></small></article><article class="settings-card"><div class="settings-card-title"><span>ℹ️</span><div><strong>Acerca de Mi Compra</strong><small>Comparador manual de precios · Panamá.</small></div></div><p class="settings-storage-note">Los precios se registran manualmente. Mi Compra no consulta páginas de supermercados. Las comparaciones se calculan a partir de los productos y precios que tú ingresas.</p></article><p class="settings-version">Mi Compra · Panamá · Comparaciones basadas en precios ingresados manualmente.</p></section>';
  panels.catalogo.innerHTML='<section class="personal-catalog"><div class="catalog-page-heading"><p class="eyebrow">TUS PRODUCTOS FAVORITOS</p><h2>Mi catálogo</h2><p>Guarda cada producto con su fotografía y agrégalo a tu compra con un solo toque.</p></div><form id="personal-product-form" class="personal-product-form"><h3>Agregar un producto</h3><label class="catalog-photo-picker"><input id="personal-product-photo" type="file" accept="image/*" capture="environment"><span class="catalog-photo-preview" id="catalog-photo-preview">＋</span><span><strong>Añadir fotografía</strong><small>Toma una foto o elige una de tu galería</small></span></label><label>Nombre del producto<input name="name" maxlength="100" required placeholder="Ej. Leche entera"></label><label>Marca y presentación<input name="presentation" maxlength="100" required placeholder="Ej. 1 litro · marca opcional"></label><div class="catalog-form-grid"><label>Categoría<select name="category"><option>Abarrotes</option><option>Frutas</option><option>Vegetales</option><option>Carnes y pollo</option><option>Lácteos</option><option>Bebidas</option><option>Limpieza</option><option>Higiene personal</option><option>Otros</option></select></label><label>Supermercado<select name="store">'+guestStores.map(s=>'<option>'+s+'</option>').join('')+'</select></label><label>Precio habitual<input name="price" type="number" min="0" step="0.01" placeholder="Opcional"></label><label>Unidad<select name="unit"><option value="unidad">Unidad</option><option value="kg">Kilogramo</option><option value="paquete">Paquete</option><option value="litro">Litro</option><option value="lb">Libra</option></select></label></div><button type="submit">Guardar en mi catálogo</button><small class="catalog-form-feedback" id="catalog-form-feedback" role="status"></small></form><div class="personal-catalog-list-heading"><div><h3>Mis productos</h3><small id="personal-catalog-count">0 productos guardados</small></div><input id="personal-catalog-filter" type="search" placeholder="Buscar en mi catálogo"></div><div id="personal-catalog-grid" class="personal-catalog-grid"></div><small class="catalog-storage-note">Los cambios se sincronizan con tu cuenta cuando has iniciado sesión; sin sesión, permanecen en este dispositivo.</small></section>';
  const shortcuts=document.createElement('section');
  shortcuts.className='home-shortcuts';
  shortcuts.innerHTML=`
    <div class="home-welcome"><div><p class="eyebrow">TU COMPRA, MÁS FÁCIL</p><h2>Todo lo que necesitas, en un solo lugar.</h2><p>Organiza tu lista, revisa precios y controla lo que tienes en casa.</p><button type="button" data-home-view="comprar">Empezar mi compra <span>→</span></button></div><img src="https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=900&q=85" alt="Frutas y verduras frescas" loading="lazy"></div>
    <div class="home-search-shortcut"><span aria-hidden="true">⌕</span><button type="button" data-home-view="comprar">¿Qué estás buscando hoy?</button><b>☷</b></div>
    <section class="home-category-section"><div class="home-section-title"><div><p class="eyebrow">DESCUBRE</p><h3>Compra por categoría</h3></div><button type="button" data-home-view="comprar">Ver todo</button></div><div class="home-category-grid">
      <button type="button" data-home-category="frutas"><img src="https://images.unsplash.com/photo-1610832958506-aa56368176cf?auto=format&fit=crop&w=420&q=80" alt="" loading="lazy"><strong>Frutas</strong></button>
      <button type="button" data-home-category="verduras"><img src="https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=420&q=80" alt="" loading="lazy"><strong>Vegetales</strong></button>
      <button type="button" data-home-category="pollo"><img src="https://images.unsplash.com/photo-1604503468506-a8da13d82791?auto=format&fit=crop&w=420&q=80" alt="" loading="lazy"><strong>Carnes y pollo</strong></button>
      <button type="button" data-home-category="arroz"><img src="https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=420&q=80" alt="" loading="lazy"><strong>Abarrotes</strong></button>
    </div></section>
    <section class="home-feature-banner"><div><p class="eyebrow">PLANIFICA MEJOR</p><h3>Tu lista siempre a la mano</h3><p>Agrega cantidades y precios para ver cómo cambia el total de tu compra.</p><button type="button" data-home-view="comprar">Crear mi lista <span>→</span></button></div><div class="home-feature-art" aria-hidden="true">🛒</div></section>
    <div class="home-shortcuts-heading"><p class="eyebrow">TUS HERRAMIENTAS</p><h2>Accesos rápidos</h2></div><div class="home-shortcuts-grid"><button type="button" data-home-view="comprar"><span class="home-shortcut-icon">＋</span><span><strong>Mi compra</strong><small>Agrega productos y consulta tu total</small></span><b>›</b></button><button type="button" data-home-view="comparar"><span class="home-shortcut-icon">⇄</span><span><strong>Comparar precios</strong><small>Revisa precios disponibles por tienda</small></span><b>›</b></button><button type="button" data-home-view="tiendas"><span class="home-shortcut-icon">▦</span><span><strong>Supermercados</strong><small>Consulta las tiendas disponibles</small></span><b>›</b></button><button type="button" data-home-view="cuenta"><span class="home-shortcut-icon">◉</span><span><strong>Mi espacio</strong><small>Accede a tus compras y despensa</small></span><b>›</b></button><button type="button" data-home-view="configuracion"><span class="home-shortcut-icon">⚙</span><span><strong>Configuración</strong><small>Personaliza tu aplicación</small></span><b>›</b></button></div>`;

  const dashboard=document.createElement('section');dashboard.id='home-dashboard';dashboard.className='home-dashboard';panels.inicio.appendChild(dashboard);
  panels.inicio.appendChild(shortcuts);
  main.prepend(nav);main.appendChild(viewHost);renderHomeDashboard();
  const openView=id=>{
    if(id==='inicio')renderHomeDashboard();
    Object.entries(panels).forEach(([key,panel])=>{panel.hidden=key!==id;});
    nav.querySelectorAll('button').forEach(button=>{const active=button.dataset.openView===id||(button.dataset.openView==='mas'&&['tiendas','cuenta','configuracion'].includes(id));button.classList.toggle('active',active);button.setAttribute('aria-current',active?'page':'false');});
    window.scrollTo({top:0,behavior:'smooth'});
  };
  nav.addEventListener('click',event=>{const button=event.target.closest('[data-open-view]');if(button){openView(button.dataset.openView);if(button.dataset.openView==='comparar')renderManualComparisonDashboard();if(button.dataset.openView==='comprar'){searchProducts(document.querySelector('#search')?.value||'');renderGuestList();}}});
  shortcuts.addEventListener('click',event=>{const button=event.target.closest('[data-home-view]');if(button)openView(button.dataset.homeView);});
  shortcuts.addEventListener('click',event=>{const button=event.target.closest('[data-home-category]');if(!button)return;const term=button.dataset.homeCategory;openView('comprar');const search=document.querySelector('#search');if(search){search.value=term;searchProducts(term);}});
  viewHost.addEventListener('click',event=>{const account=event.target.closest('[data-account-view]');const more=event.target.closest('[data-more-view]');const target=more?.dataset.moreView||account?.dataset.accountView;if(!target)return;openView(target);if(target==='comparar')renderManualComparisonDashboard();if(target==='comprar'){searchProducts(document.querySelector('#search')?.value||'');renderGuestList();}});
  window.addEventListener('hashchange',()=>{});
  document.querySelector('#branch-filter').addEventListener('change', e => { selectedBranchId = e.target.value; const term=document.querySelector('#search')?.value.trim(); if(term) searchProducts(term); if (user) loadList(); });
  document.querySelector('#store-filter').addEventListener('change', () => { const term=document.querySelector('#search')?.value.trim(); searchProducts(term||''); const manualStore=document.querySelector('#guest-store');if(manualStore)manualStore.value=document.querySelector('#store-filter').value||guestStores[0];renderGuestList(); });
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

async function searchProductsLegacy(term) {
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
      const currentPrice = (item.price_observations || [])
        .filter(p => p.is_verified && p.review_status === 'approved' && p.currency === 'USD' && Number(p.price) > 0 && Date.now() - new Date(p.observed_at).getTime() <= 7 * 86400000)
        .sort((a,b) => new Date(b.observed_at).getTime() - new Date(a.observed_at).getTime())[0] || null;
      await addSearchItemFromButton(button, {
        name:item.source_product_name,
        store:storeName,
        productId:item.product_id,
        price:currentPrice ? Number(currentPrice.price) : null,
        priceUnit:currentPrice?.availability === 'online_unit_price_per_kg' ? 'kg' : 'unidad',
        priceSource:currentPrice?.source_url || item.source_product_url || null,
        priceObservedAt:currentPrice?.observed_at || null
      });
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
async function addSearchItem({name,store,productId=null,price=null,priceUnit='unidad',priceSource=null,priceObservedAt=null}) {
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
    addGuestCartItem({name,store,qty:1,price,priceUnit,priceSource,priceObservedAt});
    const saved = readGuestCart().some(row => row.name === name && row.store === store);
    return saved ? {ok:true,message:'Producto agregado a tu lista de este dispositivo.'} : {ok:false,message:'No se pudo guardar en este dispositivo.'};
  } catch (error) {
    return {ok:false,message:'No se pudo agregar: '+(error?.message || 'error inesperado')};
  }
  renderHomeDashboard();
}
function addGuestCartItem({name,store,qty=1,price=null,priceUnit='unidad',priceSource=null,priceObservedAt=null,imageData=null}) {
  const current = readGuestCart();
  const duplicate = current.find(item => item.name.toLowerCase() === name.toLowerCase() && item.store === store);
  if (duplicate) { duplicate.qty += qty; if (price !== null && Number.isFinite(Number(price))) { duplicate.price = Number(price); duplicate.priceUnit=priceUnit; duplicate.priceSource=priceSource; duplicate.priceObservedAt=priceObservedAt; } if(imageData)duplicate.imageData=imageData; }
  else current.push({id:Date.now().toString(36)+Math.random().toString(36).slice(2,7),name,store,qty,price:price === null ? null : Number(price),priceUnit,priceSource,priceObservedAt,imageData});
  saveGuestCart(current);
  renderGuestList();
}
async function compareProductLegacy(id) {
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
    const catalogCount=readPersonalCatalog().length,purchaseCount=readGuestPurchases().length;
    box.innerHTML='<section class="account-overview"><div class="account-avatar">MC</div><p class="eyebrow">TU ESPACIO PERSONAL</p><h2>Mi cuenta</h2><p>Tu centro personal para administrar productos, compras y preferencias de Mi Compra.</p><div class="account-stats"><article><b>'+catalogCount+'</b><small>Productos guardados</small></article><article><b>'+purchaseCount+'</b><small>Compras registradas</small></article></div><div class="account-actions"><button type="button" data-account-view="catalogo">Mi catálogo</button><button type="button" data-account-view="configuracion">Configuración</button><button type="button" data-account-view="comprar">Mi compra</button></div><small class="account-local-note">Actualmente, la información personal se guarda en este dispositivo. Puedes crear una copia de seguridad desde Configuración.</small></section><div id="pantry-module"></div>';
    await renderPersonalPantry({container:box.querySelector('#pantry-module'),supabase:null,user:null});
    /* Los accesos de Mi espacio se resuelven desde la navegación principal. */
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
      <small class="login-footnote">Inicia sesión o crea una cuenta para sincronizar tus datos entre dispositivos. Sin iniciar sesión, puedes seguir usando la información local.</small>
    </section><div id="pantry-module"></div>`;
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
    await renderPersonalPantry({container:box.querySelector('#pantry-module'),supabase:null,user:null});
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
  box.innerHTML = `<section class="account-overview account-session-card"><div class="signed"><span>Sesión: ${safe(user.email)}</span><button id="logout" class="secondary">Cerrar sesión</button></div><small id="workspace-sync-status" class="workspace-sync-status" role="status" aria-live="polite">Preparando sincronización segura…</small></section><section class="account-module-block"><div class="account-module-heading"><p class="eyebrow">HISTORIAL</p><h3>Compras guardadas</h3><p>Consulta tus comprobantes personales y sus detalles.</p></div><div id="purchases-module"></div></section><section class="account-module-block"><div class="account-module-heading"><p class="eyebrow">CONTROL PERSONAL</p><h3>Gastos</h3><p>Revisa tus importes y evolución de compras.</p></div><div id="spending-module"></div></section><section class="account-module-block"><div class="account-module-heading"><p class="eyebrow">EN CASA</p><h3>Mi despensa</h3><p>Actualiza existencias, mínimos y productos por reponer.</p></div><div id="pantry-module"></div></section><details class="account-tools"><summary>Herramientas de datos</summary><section class="import-panel"><strong>Importar archivo CSV de precios</strong><p>Esta herramienta es opcional. Los registros importados quedan pendientes de revisión; no consulta páginas de supermercados.</p><div class="import-row"><input id="price-csv" type="file" accept=".csv,text/csv"><button id="import-csv" class="secondary">Validar e importar</button></div><small id="import-result" aria-live="polite"></small></section></details>`;
  box.querySelector('#logout').addEventListener('click', () => supabase.auth.signOut());
  box.querySelector('#import-csv').addEventListener('click', async () => { const output=box.querySelector('#import-result'); output.textContent='Procesando...'; try { await importPriceCsv({file:box.querySelector('#price-csv').files[0],supabase,user,output}); await renderPriceReview(); } catch(error) { output.textContent=error.message || 'No se pudo importar el archivo.'; } });
  const purchasesContainer=box.querySelector('#purchases-module');
  await renderPurchases({container:purchasesContainer,supabase,user});
  await renderSpendingDashboard({container:box.querySelector('#spending-module'),supabase,user});
  await renderPersonalPantry({container:box.querySelector('#pantry-module'),supabase:null,user});
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
  renderAppSettings();

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
const PERSONAL_CATALOG_KEY='micompra_personal_catalog_v1';
function readPersonalCatalog(){return readStoredArraySafely(PERSONAL_CATALOG_KEY)}
function savePersonalCatalog(items){localStorage.setItem(PERSONAL_CATALOG_KEY,JSON.stringify(items));window.dispatchEvent(new CustomEvent('micompra:local-data-changed',{detail:{collection:'catalog'}}));}
const GUEST_CART_KEY='micompra_guest_cart_v1';
const guestStores=['Super 99','El Rey','Xtra','Riba Smith','Machetazo','Jumbo'];
try{const custom=JSON.parse(localStorage.getItem('micompra_custom_stores_v1')||'[]');if(Array.isArray(custom))custom.forEach(name=>{if(typeof name==='string'&&name.trim()&&!guestStores.some(x=>x.toLowerCase()===name.trim().toLowerCase()))guestStores.push(name.trim());});}catch{}
function readGuestCart(){return readStoredArraySafely(GUEST_CART_KEY)}
function saveGuestCart(items){localStorage.setItem(GUEST_CART_KEY,JSON.stringify(items));window.dispatchEvent(new CustomEvent('micompra:local-data-changed',{detail:{collection:'cart'}}));}
const GUEST_PURCHASES_KEY='micompra_saved_purchases_v1';
function readGuestPurchases(){return readStoredArraySafely(GUEST_PURCHASES_KEY)}
function saveGuestPurchases(items){localStorage.setItem(GUEST_PURCHASES_KEY,JSON.stringify(items));window.dispatchEvent(new CustomEvent('micompra:local-data-changed',{detail:{collection:'purchases'}}));}
async function compressProductPhoto(file){
 if(!file||!file.type.startsWith('image/'))throw new Error('Selecciona una imagen válida.');
 if(file.size>12*1024*1024)throw new Error('La imagen debe pesar menos de 12 MB.');
 const url=URL.createObjectURL(file);
 try{const img=await new Promise((resolve,reject)=>{const el=new Image();el.onload=()=>resolve(el);el.onerror=reject;el.src=url;});const scale=Math.min(1,520/Math.max(img.width,img.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',0.72);}finally{URL.revokeObjectURL(url);}
}
function renderAppSettings(){
 const key='micompra_settings_v1';const defaults={defaultStore:'Super 99',currency:'USD',theme:'light',enabledStores:guestStores.slice()};
 let settings={...defaults,...readStoredObjectSafely(key,{})};
 if(!Array.isArray(settings.enabledStores))settings.enabledStores=defaults.enabledStores.slice();
 settings.enabledStores=settings.enabledStores.filter(name=>guestStores.includes(name));
 if(!settings.enabledStores.length)settings.enabledStores=defaults.enabledStores.slice();
 if(!guestStores.includes(settings.defaultStore))settings.defaultStore=defaults.defaultStore;
 if(typeof settings.currency!=='string')settings.currency=defaults.currency;
 if(typeof settings.theme!=='string')settings.theme=defaults.theme;
 const store=document.querySelector('#settings-default-store'),currency=document.querySelector('#settings-currency'),theme=document.querySelector('#settings-theme');
 if(!store)return;store.value=settings.defaultStore;currency.value=settings.currency;theme.value=settings.theme;
 document.querySelectorAll('[name="enabled-store"]').forEach(input=>input.checked=settings.enabledStores.includes(input.value));
 const save=()=>{settings={...settings,defaultStore:store.value,currency:currency.value,theme:theme.value,enabledStores:[...document.querySelectorAll('[name="enabled-store"]:checked')].map(x=>x.value)};if(!settings.enabledStores.length){document.querySelector('[name="enabled-store"]').checked=true;settings.enabledStores=[document.querySelector('[name="enabled-store"]').value];}localStorage.setItem(key,JSON.stringify(settings));window.dispatchEvent(new CustomEvent('micompra:local-data-changed',{detail:{collection:'settings'}}));const active=settings.enabledStores.length?settings.enabledStores:[guestStores[0]];document.querySelectorAll('#store-filter,#guest-store,#personal-product-form select[name="store"]').forEach(select=>{const current=select.value;select.innerHTML=(select.id==='store-filter'?'<option value="">Selecciona un supermercado</option>':'')+active.map(name=>'<option value="'+safe(name)+'">'+safe(name)+'</option>').join('');select.value=active.includes(current)?current:(select.id==='store-filter'?'':settings.defaultStore);});document.querySelector('#settings-feedback').textContent='Preferencias guardadas.';renderGuestList();renderHomeDashboard();};
 [store,currency,theme,...document.querySelectorAll('[name="enabled-store"]')].forEach(el=>{el.onchange=save;});
  const counts={products:readPersonalCatalog().length,cart:readGuestCart().length,purchases:readGuestPurchases().length,pantry:readGuestPantry().length};Object.entries(counts).forEach(([name,count])=>{const node=document.querySelector('#settings-count-'+name);if(node)node.textContent=count;});
  const addStoreForm=document.querySelector('#settings-add-store');
 addStoreForm.onsubmit=e=>{e.preventDefault();const field=addStoreForm.elements.storeName,name=field.value.trim();const feedback=document.querySelector('#settings-store-feedback');if(!name){feedback.textContent='Escribe el nombre del supermercado.';return;}if(guestStores.some(x=>x.toLowerCase()===name.toLowerCase())){feedback.textContent='Ese supermercado ya está registrado.';return;}guestStores.push(name);localStorage.setItem('micompra_custom_stores_v1',JSON.stringify(guestStores.filter(x=>!['Super 99','El Rey','Xtra','Riba Smith','Machetazo','Jumbo'].includes(x))));const checkbox=document.createElement('label');checkbox.innerHTML='<input type="checkbox" name="enabled-store" value="'+safe(name)+'" checked><span>'+safe(name)+'</span>';document.querySelector('.settings-store-list').appendChild(checkbox);checkbox.querySelector('input').onchange=save;[store,document.querySelector('#guest-store'),document.querySelector('#store-filter'),document.querySelector('#personal-product-form select[name="store"]')].forEach(select=>{if(!select)return;const option=document.createElement('option');option.value=name;option.textContent=name;select.appendChild(option);});const defaultOption=document.createElement('option');defaultOption.value=name;defaultOption.textContent=name;store.appendChild(defaultOption);document.querySelectorAll('#guest-store,#personal-product-form select[name="store"]').forEach(select=>{if(select)select.value=name;});settings.enabledStores=[...new Set([...settings.enabledStores,name])];settings.defaultStore=name;store.value=name;save();field.value='';feedback.textContent='Supermercado agregado y habilitado.';};
 document.querySelector('#settings-reset-preferences').onclick=()=>{if(!confirm('Se restablecerán únicamente las preferencias de esta aplicación. Tus productos, fotografías, listas, compras e inventario no se eliminarán. ¿Continuar?'))return;localStorage.setItem(key,JSON.stringify(defaults));document.querySelector('#settings-reset-feedback').textContent='Preferencias restablecidas. Tus datos personales siguen intactos.';renderAppSettings();renderGuestList();renderHomeDashboard();};
 document.querySelector('#settings-export').onclick=()=>{const backup={format:'micompra-backup-v1',createdAt:new Date().toISOString(),catalog:readPersonalCatalog(),cart:readGuestCart(),purchases:readGuestPurchases(),pantry:readGuestPantry(),settings,recoveryCopies:collectLocalRecoveryCopies()};const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='mi-compra-respaldo-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);document.querySelector('#settings-feedback').textContent='Copia de seguridad preparada.';};
 const importInput=document.querySelector('#settings-import'),feedback=document.querySelector('#settings-feedback');
 importInput.onchange=async()=>{const file=importInput.files?.[0];if(!file)return;try{if(file.size>15*1024*1024)throw new Error('El archivo supera el límite de 15 MB.');const backup=JSON.parse(await file.text());if(backup.format!=='micompra-backup-v1'||!Array.isArray(backup.catalog)||!Array.isArray(backup.cart)||!Array.isArray(backup.purchases)||(backup.pantry!==undefined&&!Array.isArray(backup.pantry))||!backup.settings||typeof backup.settings!=='object')throw new Error('El archivo no tiene el formato de copia de Mi Compra.');if(!confirm('Restaurar esta copia reemplazará el catálogo, la lista, las compras, el inventario y las preferencias actuales de este dispositivo. ¿Deseas continuar?')){importInput.value='';return;}const keys=[PERSONAL_CATALOG_KEY,GUEST_CART_KEY,GUEST_PURCHASES_KEY,GUEST_PANTRY_KEY,key],previous=keys.map(k=>localStorage.getItem(k));try{localStorage.setItem(PERSONAL_CATALOG_KEY,JSON.stringify(backup.catalog));localStorage.setItem(GUEST_CART_KEY,JSON.stringify(backup.cart));localStorage.setItem(GUEST_PURCHASES_KEY,JSON.stringify(backup.purchases));if(Array.isArray(backup.pantry))localStorage.setItem(GUEST_PANTRY_KEY,JSON.stringify(backup.pantry));localStorage.setItem(key,JSON.stringify(backup.settings));restoreLocalRecoveryCopies(backup.recoveryCopies);}catch(error){keys.forEach((k,i)=>{if(previous[i]===null)localStorage.removeItem(k);else localStorage.setItem(k,previous[i]);});throw new Error('No hubo espacio suficiente. Los datos anteriores se conservaron.');}feedback.textContent='Copia restaurada. Actualizando la vista…';window.dispatchEvent(new CustomEvent('micompra:local-data-changed',{detail:{collection:'all'}}));renderPersonalCatalog();renderGuestList();renderAuth();renderAppSettings();renderManualComparisonDashboard();}catch(error){feedback.textContent=error.message||'No se pudo restaurar la copia.';}finally{importInput.value='';}};
}
function renderPersonalCatalog(){
 const form=document.querySelector('#personal-product-form'),grid=document.querySelector('#personal-catalog-grid');if(!form||!grid)return;let photoData=null;
 const input=form.querySelector('#personal-product-photo'),preview=form.querySelector('#catalog-photo-preview'),feedback=form.querySelector('#catalog-form-feedback');
 input.onchange=async()=>{const file=input.files&&input.files[0];if(!file)return;try{photoData=await compressProductPhoto(file);preview.innerHTML='<img src="'+photoData+'" alt="Vista previa">';feedback.textContent='Fotografía lista.';}catch(e){feedback.textContent=e.message;}};
 const render=()=>{const items=readPersonalCatalog(),term=(document.querySelector('#personal-catalog-filter').value||'').toLowerCase();document.querySelector('#personal-catalog-count').textContent=items.length+' producto(s) guardado(s)';const visible=items.filter(p=>(p.name+' '+(p.presentation||'')+' '+p.category).toLowerCase().includes(term));
 grid.innerHTML=visible.length?visible.map(p=>'<article class="personal-product-card">'+(p.imageData?'<img class="personal-product-photo" src="'+p.imageData+'" alt="'+safe(p.name)+'">':'<div class="personal-product-photo product-photo-placeholder">🛒</div>')+'<div class="personal-product-info"><small>'+safe(p.category)+'</small><strong>'+safe(p.name)+'</strong><span>'+safe(p.presentation||'Presentación no especificada')+'</span><span>'+safe(p.store)+(p.price>0?' · '+money(p.price):' · Precio pendiente')+'</span><small>'+((p.priceHistory||[]).length?'Último cambio: '+safe(new Date(p.priceHistory[p.priceHistory.length-1].date).toLocaleDateString('es-PA')):'Sin historial de cambios')+'</small></div><div class="personal-product-actions"><button type="button" data-quick-add="'+p.id+'">＋ Agregar</button><button type="button" data-edit-price="'+p.id+'">Editar precio</button><button type="button" class="catalog-delete" data-catalog-delete="'+p.id+'">×</button></div></article>').join(''):'<p class="empty">No hay productos guardados todavía.</p>';
 grid.querySelectorAll('[data-quick-add]').forEach(b=>b.onclick=()=>{const p=items.find(x=>x.id===b.dataset.quickAdd);if(!p)return;addGuestCartItem({name:p.name,store:p.store,qty:1,price:p.price>0?p.price:null,priceUnit:p.unit,imageData:p.imageData});b.textContent='Agregado ✓';renderGuestList();});
 grid.querySelectorAll('[data-edit-price]').forEach(b=>b.onclick=()=>{const current=readPersonalCatalog(),p=current.find(x=>x.id===b.dataset.editPrice);if(!p)return;const raw=prompt('Nuevo precio para '+p.name+' · '+p.store+' (moneda configurada):',p.price??'');if(raw===null)return;const next=Number(String(raw).replace(',','.'));if(!Number.isFinite(next)||next<=0){alert('Escribe un precio mayor que cero.');return;}const previous=Number(p.price);if(previous>0&&previous!==next){p.priceHistory=Array.isArray(p.priceHistory)?p.priceHistory:[];p.priceHistory.push({price:previous,date:new Date().toISOString(),kind:'anterior'});p.priceHistory.push({price:next,date:new Date().toISOString(),kind:'actual'});}else if(!(p.priceHistory||[]).length){p.priceHistory=[{price:next,date:new Date().toISOString(),kind:'registro'}];}p.price=next;savePersonalCatalog(current);render();renderManualComparisonDashboard();});
 grid.querySelectorAll('[data-catalog-delete]').forEach(b=>b.onclick=()=>{if(confirm('¿Eliminar este producto de tu catálogo?')){savePersonalCatalog(readPersonalCatalog().filter(p=>p.id!==b.dataset.catalogDelete));render();}});};
 renderHomeDashboard();
 document.querySelector('#personal-catalog-filter').oninput=render;
 form.onsubmit=e=>{e.preventDefault();const d=new FormData(form),name=String(d.get('name')||'').trim(),raw=String(d.get('price')||'').trim(),price=raw===''?null:Number(raw);if(!name||(price!==null&&(!Number.isFinite(price)||price<0))){feedback.textContent='Revisa el nombre y el precio.';return;}const items=readPersonalCatalog(),presentation=String(d.get('presentation')||'').trim();const existing=items.find(p=>p.name.toLowerCase()===name.toLowerCase()&&(p.presentation||'').toLowerCase()===presentation.toLowerCase()&&p.store===d.get('store'));if(!existing&&!photoData){feedback.textContent='Agrega una fotografía para registrar un producto nuevo.';return;}if(existing){if(price!==null&&Number(existing.price)!==price){const previous=Number(existing.price);existing.priceHistory=Array.isArray(existing.priceHistory)?existing.priceHistory:[];if(previous>0)existing.priceHistory.push({price:previous,date:new Date().toISOString(),kind:'anterior'});existing.priceHistory.push({price,date:new Date().toISOString(),kind:'actual'});existing.price=price;}existing.imageData=photoData||existing.imageData;existing.category=d.get('category');existing.unit=d.get('unit');}else{items.unshift({id:Date.now().toString(36),name,presentation,category:d.get('category'),store:d.get('store'),price,unit:d.get('unit'),imageData:photoData,priceHistory:price!==null?[{price,date:new Date().toISOString(),kind:'registro'}]:[]});}try{savePersonalCatalog(items);}catch{feedback.textContent='No hay espacio para guardar esa foto. Usa una imagen más pequeña.';return;}form.reset();photoData=null;preview.textContent='＋';feedback.textContent=existing?'Producto actualizado. El precio anterior quedó registrado para las métricas.':'Producto guardado. Ya puedes agregarlo con un toque.';render();renderManualComparisonDashboard();};render();
}
function renderGuestList(){
  const label=document.querySelector('#list-label'),cart=document.querySelector('#cart'),panel=document.querySelector('#list-comparison');
  const items=readGuestCart(),purchases=readGuestPurchases();label.textContent=user?'Lista sincronizada con tu cuenta':'Lista temporal · guardada en este dispositivo';
  cart.innerHTML='<p class="guest-cart-note">Agrega productos manualmente o desde el catálogo. Coloca el precio y la cantidad para calcular cada subtotal automáticamente. '+(user?'Esta lista se sincroniza con tu cuenta.':'Esta lista se guarda en este dispositivo.')+'</p><form id="guest-add-item" class="guest-add-form"><label>Supermercado<select id="guest-store">'+guestStores.map(s=>'<option>'+s+'</option>').join('')+'</select></label><label>Producto<input id="guest-name" required maxlength="100" placeholder="Ej. Pollo"></label><div class="guest-fields"><label>Cantidad<input id="guest-qty" type="number" min="0.01" step="0.01" value="1" required></label><label>Precio por unidad<input id="guest-price" type="number" min="0.01" step="0.01" placeholder="Ej. 3.50" required></label></div><button type="submit">Agregar a mi compra</button><small id="guest-feedback" role="status"></small></form>';
  const preferredStore=(()=>{try{const pref=JSON.parse(localStorage.getItem('micompra_settings_v1')||'{}');return guestStores.includes(pref.defaultStore)?pref.defaultStore:guestStores[0];}catch{return guestStores[0];}})();
  const storeSelect=cart.querySelector('#guest-store');if(storeSelect)storeSelect.value=preferredStore;
  (items.length?items.map(i=>'<article class="guest-cart-item">'+(i.imageData?'<img class="guest-cart-thumb" src="'+i.imageData+'" alt="" loading="lazy">':'')+'<div><strong>'+safe(i.name)+'</strong><small>'+safe(i.store)+' · '+safe(i.qty)+' '+(i.priceUnit==='kg'?'kg':'unidad(es)')+' × '+(i.price===null||i.price===undefined?'Precio pendiente':money(i.price)+(i.priceUnit==='kg'?' / kg':''))+'</small>'+(i.priceObservedAt?'<small>Precio observado: '+safe(new Date(i.priceObservedAt).toLocaleDateString('es-PA'))+'</small>':'')+'</div><b>'+(i.price===null||i.price===undefined?'Pendiente':money(i.qty*i.price)+(i.priceUnit==='kg'?' estimado':''))+'</b><button type="button" data-guest-remove="'+i.id+'" aria-label="Eliminar '+safe(i.name)+'">×</button></article>').join(''):'<p class="empty">Todavía no has agregado productos.</p>');
  const totals=guestStores.map(store=>({store,total:items.filter(i=>i.store===store&&i.price!==null&&i.price!==undefined).reduce((sum,i)=>sum+i.qty*i.price,0),count:items.filter(i=>i.store===store).length,priced:items.filter(i=>i.store===store&&i.price!==null&&i.price!==undefined).length})).filter(x=>x.count);
  const pricedItems=items.filter(i=>i.price!==null&&i.price!==undefined&&Number.isFinite(Number(i.price))),grand=pricedItems.reduce((sum,i)=>sum+i.qty*i.price,0),pending=items.length-pricedItems.length;
  cart.insertAdjacentHTML('beforeend','<section class="guest-cart-live-total" aria-live="polite"><div><small>TOTAL ACTUAL DE TU COMPRA</small><strong>'+money(grand)+'</strong></div><span>'+items.length+' artículo(s) · '+pending+' sin precio</span><small>El total se actualiza al agregar o quitar productos.</small></section>');
  const history=purchases.slice(0,10).map(p=>'<details class="saved-purchase"><summary><strong>'+safe(p.number)+'</strong> · '+safe(new Date(p.createdAt).toLocaleString('es-PA'))+' · <b>'+money(p.total)+'</b></summary><div class="receipt-lines">'+p.items.map(i=>'<div><span>'+safe(i.name)+' ('+safe(i.qty)+' × '+money(i.price)+')</span><b>'+money(i.qty*i.price)+'</b></div>').join('')+'<hr><div><strong>Total</strong><strong>'+money(p.total)+'</strong></div><small>Supermercado(s): '+safe([...new Set(p.items.map(i=>i.store))].join(', '))+'</small><small>Comprobante personal, no fiscal.</small><button type="button" class="secondary" data-print-purchase="'+p.id+'">Imprimir comprobante</button><button type="button" class="secondary" data-add-purchase-inventory="'+p.id+'" '+(p.inventoryAddedAt?'disabled':'')+'>'+(p.inventoryAddedAt?'Productos en inventario':'Añadir productos al inventario')+'</button></div></details>').join('');
  panel.innerHTML='<div class="comparison-heading"><p class="eyebrow">CONTROL DE TU DINERO</p><h3>Resumen de compra</h3><small>Los artículos sin precio no se suman al total. Completa todos los precios para cerrar la compra.</small></div><article class="guest-grand-total"><small>Total de artículos con precio</small><b>'+money(grand)+'</b><span>'+items.length+' producto(s) · '+pending+' pendiente(s) de precio</span></article>'+(totals.length?totals.map(t=>'<article class="store-total"><div><strong>'+safe(t.store)+'</strong><small>'+t.count+' producto(s) · '+t.priced+' con precio</small></div><b>'+money(t.total)+'</b></article>').join(''):'<p class="empty">Los totales por supermercado aparecerán aquí.</p>')+'<button type="button" id="save-guest-purchase" '+(!items.length||pending?'disabled':'')+'>Finalizar y guardar compra</button><button type="button" class="secondary" id="guest-clear-cart" '+(items.length?'':'disabled')+'>Vaciar lista actual</button><div class="purchase-history"><h3>Historial de compras</h3>'+(history||'<p class="empty">Todavía no hay compras guardadas.</p>')+'</div><small class="comparison-footnote">'+(user?'Los comprobantes se sincronizan con tu cuenta.':'Los comprobantes se guardan en este dispositivo.')+' Son comprobantes personales, no facturas fiscales.</small>';
  cart.querySelector('#guest-add-item').addEventListener('submit',e=>{e.preventDefault();const name=cart.querySelector('#guest-name').value.trim(),store=cart.querySelector('#guest-store').value,qty=Number(cart.querySelector('#guest-qty').value),rawPrice=cart.querySelector('#guest-price').value.trim(),price=rawPrice===''?null:Number(rawPrice);if(!name||!Number.isFinite(qty)||qty<=0||price===null||!Number.isFinite(price)||price<=0){cart.querySelector('#guest-feedback').textContent='Indica producto, cantidad y un precio mayor que cero.';return;}addGuestCartItem({name,store,qty,price});});
  cart.querySelectorAll('[data-guest-remove]').forEach(b=>b.addEventListener('click',()=>{saveGuestCart(readGuestCart().filter(i=>i.id!==b.dataset.guestRemove));renderGuestList();}));
  panel.querySelector('#save-guest-purchase')?.addEventListener('click',()=>{const current=readGuestCart();if(!current.length||current.some(i=>i.price===null||!Number.isFinite(Number(i.price))||Number(i.price)<=0)){alert('Completa el precio de todos los productos antes de guardar la compra.');return;}const total=current.reduce((sum,i)=>sum+Number(i.qty)*Number(i.price),0),createdAt=new Date().toISOString(),purchasesBefore=readGuestPurchases(),purchasesNow=purchasesBefore.slice(),number='MC-'+new Date().toISOString().replace(/[-:T.Z]/g,'').slice(0,14)+'-'+String(purchasesBefore.length+1).padStart(3,'0');purchasesNow.unshift({id:Date.now().toString(36),number,createdAt,total,items:current.map(i=>({name:i.name,store:i.store,qty:Number(i.qty),price:Number(i.price),priceUnit:i.priceUnit||'unidad'}))});try{saveGuestPurchases(purchasesNow);try{saveGuestCart([]);}catch(error){saveGuestPurchases(purchasesBefore);throw error;}}catch(error){alert('No se pudo cerrar la compra por falta de espacio o permisos de almacenamiento. Tu lista se conserva; libera espacio o descarga una copia de seguridad e inténtalo nuevamente.');return;}renderGuestList();});
  panel.querySelector('#guest-clear-cart')?.addEventListener('click',()=>{if(confirm('¿Vaciar la lista actual? Las compras guardadas no se eliminarán.')){saveGuestCart([]);renderGuestList();}});
  panel.querySelectorAll('[data-print-purchase]').forEach(button=>button.addEventListener('click',()=>{const purchase=readGuestPurchases().find(p=>p.id===button.dataset.printPurchase);if(!purchase)return;const rows=purchase.items.map(i=>'<tr><td>'+safe(i.name)+'</td><td>'+safe(i.qty)+'</td><td>'+money(i.price)+'</td><td>'+money(i.qty*i.price)+'</td></tr>').join('');const w=window.open('','_blank');if(!w){alert('Permite las ventanas emergentes para imprimir el comprobante.');return;}w.document.write('<!doctype html><html lang="es"><meta charset="utf-8"><title>'+safe(purchase.number)+'</title><style>body{font:14px Arial;max-width:700px;margin:30px auto;padding:20px}h1,p{text-align:center}table{width:100%;border-collapse:collapse;margin-top:24px}td,th{padding:10px;border-bottom:1px solid #ddd;text-align:left}.total{text-align:right;font-size:22px;font-weight:bold;margin-top:24px}</style><h1>MI COMPRA</h1><p>COMPROBANTE PERSONAL · NO FISCAL</p><p>'+safe(purchase.number)+'<br>'+safe(new Date(purchase.createdAt).toLocaleString('es-PA'))+'</p><table><thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead><tbody>'+rows+'</tbody></table><p class="total">TOTAL: '+money(purchase.total)+'</p></html>');w.document.close();w.print();}));
  panel.querySelectorAll('[data-add-purchase-inventory]').forEach(button=>button.addEventListener('click',()=>{
    const purchase=readGuestPurchases().find(p=>p.id===button.dataset.addPurchaseInventory);
    if(!purchase||purchase.inventoryAddedAt)return;
    try {
      const result=addPurchasedItemsToGuestPantry(purchase.items||[]);
      const updated=readGuestPurchases().map(p=>p.id===purchase.id?{...p,inventoryAddedAt:new Date().toISOString()}:p);
      saveGuestPurchases(updated);
      renderGuestList();
      alert('Inventario actualizado: '+result.added+' artículo(s) nuevo(s), '+result.updated+' existencia(s) acumulada(s).'+(result.skipped?' '+result.skipped+' línea(s) omitida(s).':''));
    } catch(error) {
      alert('No se pudo actualizar el inventario. Tus compras guardadas se conservaron.');
    }
  }));
  renderHomeDashboard();
}
async function loadList() {
  // La lista de compra personal usa el mismo almacenamiento sincronizado para sesiones y dispositivos.
  renderGuestList();
  document.querySelector('#weekly-plan-module').innerHTML = '';
}

async function connectPersonalWorkspaceSync() {
  if (stopPersonalWorkspaceSync) { stopPersonalWorkspaceSync(); stopPersonalWorkspaceSync = null; }
  if (!supabase || !user) return;
  stopPersonalWorkspaceSync = await startPersonalWorkspaceSync({
    supabase, user,
    onStatus: message => {
      const status = document.querySelector('#workspace-sync-status');
      if (status) status.textContent = message;
    }
  });
}

function refreshWorkspaceViews() {
  renderPersonalCatalog();
  renderGuestList();
  renderHomeDashboard();
  const pantry = document.querySelector('#pantry-module');
  if (pantry) renderPersonalPantry({ container: pantry, supabase: null, user });
  renderAppSettings();
}

async function start() {
  shell();
  collectLocalRecoveryCopies();
  renderPersonalCatalog();
  window.addEventListener('micompra:workspace-synced', refreshWorkspaceViews);
  if (!supabase) { await renderAuth(); await loadList(); message('Modo local disponible. Configura el acceso para sincronizar entre dispositivos.'); return; }
  passwordRecovery = new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery';
  const { data } = await supabase.auth.getUser();
  user = data.user;
  message('Modo de compra manual: los productos y precios los registras tú.');
  supabase.auth.onAuthStateChange((event, session) => {
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
      await connectPersonalWorkspaceSync();
      await loadList();
    });
  });
  await renderAuth();
  await connectPersonalWorkspaceSync();
  const callbackParams = new URLSearchParams(location.hash.startsWith('#') ? location.hash.slice(1) : location.hash);
  const callbackError = callbackParams.get('error_description') || callbackParams.get('error');
  if (callbackError) {
    const feedback = document.querySelector('#auth-feedback');
    if (feedback) feedback.textContent = 'El enlace de acceso no pudo validarse: ' + callbackError.replace(/\+/g, ' ');
  }
  await loadList();
}

/* Modo de operación manual: sin búsquedas ni extracción desde sitios de supermercados. */
function searchProducts(term){
 const box=document.querySelector('#results');if(!box)return;
 const storeName=document.querySelector('#store-filter')?.value||'';
 if(!storeName){box.innerHTML='<p class="empty">Primero selecciona el supermercado donde estás comprando. Después aparecerán únicamente tus productos registrados para esa tienda.</p>';return;}
 const clean=String(term||'').trim().toLocaleLowerCase('es');
 const products=readPersonalCatalog().filter(p=>p.store===storeName&&(!clean||(p.name+' '+p.category).toLocaleLowerCase('es').includes(clean)));
 if(!products.length){
  box.innerHTML='<section class="manual-empty-state"><div class="manual-empty-icon">＋</div><h3>Este producto aún no está en tu catálogo</h3><p>Regístralo con su foto y precio del supermercado seleccionado. Después quedará disponible para tus próximas compras y comparaciones.</p><button type="button" id="manual-create-product">Agregar producto a '+safe(storeName)+'</button></section>';
  box.querySelector('#manual-create-product')?.addEventListener('click',()=>{
   document.querySelector('[data-open-view="catalogo"]')?.click();
   const form=document.querySelector('#personal-product-form');if(!form)return;
   form.querySelector('[name="name"]').value=String(term||'').trim();
   form.querySelector('[name="store"]').value=storeName;
   form.querySelector('[name="name"]').focus();
  });
  return;
 }
 box.innerHTML='<div class="manual-results-heading"><strong>'+products.length+' producto(s)</strong><small>Catálogo personal · '+safe(storeName)+'</small></div>'+products.map(p=>'<article class="manual-product-result">'+(p.imageData?'<img src="'+p.imageData+'" alt="'+safe(p.name)+'">':'<div class="manual-result-placeholder">🛒</div>')+'<div class="manual-result-info"><strong>'+safe(p.name)+'</strong><small>'+safe(p.category)+' · '+safe(p.unit||'unidad')+'</small><b>'+(p.price!==null&&p.price!==undefined?money(p.price):'Precio pendiente')+'</b></div><button type="button" data-manual-add="'+safe(p.id)+'">＋ Agregar</button></article>').join('')+'<button type="button" class="manual-add-another" id="manual-create-product">＋ Registrar otro producto para '+safe(storeName)+'</button>';
 box.querySelectorAll('[data-manual-add]').forEach(button=>button.addEventListener('click',()=>{
  const p=products.find(item=>item.id===button.dataset.manualAdd);if(!p)return;
  addGuestCartItem({name:p.name,store:p.store,qty:1,price:p.price===null?null:Number(p.price),priceUnit:p.unit||'unidad',imageData:p.imageData||null});
  button.textContent='Agregado ✓';button.disabled=true;
 }));
 box.querySelector('#manual-create-product')?.addEventListener('click',()=>{
  document.querySelector('[data-open-view="catalogo"]')?.click();
  const form=document.querySelector('#personal-product-form');if(form)form.querySelector('[name="store"]').value=storeName;
 });
}

function renderManualComparisonDashboard(periodDays=0){
 const panel=document.querySelector('#list-comparison');if(!panel)return;
 const products=readPersonalCatalog(),groups=new Map();
 products.forEach(p=>{const k=((p.name||'').trim()+'|'+(p.presentation||'').trim()).toLocaleLowerCase('es');if(!groups.has(k))groups.set(k,[]);groups.get(k).push(p);});
 const priced=products.filter(p=>p.price!==null&&p.price!==undefined&&Number(p.price)>0);
 const comparable=[...groups.values()].filter(g=>g.filter(p=>p.price!==null&&p.price!==undefined&&Number(p.price)>0).length>1);
 const cheapest=comparable.reduce((sum,g)=>sum+Math.min(...g.filter(p=>Number(p.price)>0).map(p=>Number(p.price))),0);
 const storeTotals=guestStores.map(store=>({store,items:products.filter(p=>p.store===store),total:products.filter(p=>p.store===store&&p.price!==null&&Number(p.price)>0).reduce((n,p)=>n+Number(p.price),0)})).filter(x=>x.items.length);
 const trends=priced.map(p=>{const cutoff=periodDays>0?Date.now()-periodDays*86400000:0;const history=(Array.isArray(p.priceHistory)?p.priceHistory:[]).filter(x=>Number(x.price)>0&&Number.isFinite(Number(x.price))&&new Date(x.date).getTime()>=cutoff).slice().sort((a,b)=>new Date(a.date)-new Date(b.date));if(!history.length)return null;const first=Number(history[0].price),last=Number(p.price),delta=last-first,pct=first>0?(delta/first)*100:0;return {p,history,first,last,delta,pct};}).filter(Boolean);
 const up=trends.filter(x=>x.delta>0.00001).length,down=trends.filter(x=>x.delta< -0.00001).length,stable=trends.length-up-down;
 const fmtDate=value=>new Date(value).toLocaleDateString('es-PA',{day:'2-digit',month:'short'});
 const storeTrendCards=guestStores.map(store=>{const byDay=new Map();trends.filter(t=>t.p.store===store).forEach(t=>t.history.forEach(h=>{const day=new Date(h.date).toISOString().slice(0,10);if(!byDay.has(day))byDay.set(day,[]);byDay.get(day).push(Number(h.price));}));const series=[...byDay.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([day,values])=>({day,avg:values.reduce((a,b)=>a+b,0)/values.length}));if(!series.length)return '';const values=series.map(x=>x.avg),min=Math.min(...values),max=Math.max(...values),range=max-min||1,points=values.map((v,i)=>(values.length<2?50:8+i*(84/(values.length-1)))+','+(40-((v-min)/range)*32)).join(' '),first=values[0],last=values[values.length-1],pct=first>0?((last-first)/first)*100:0,cls=pct>0.00001?'price-up':pct< -0.00001?'price-down':'price-stable';return '<article class="smart-trend-card"><div class="smart-trend-top"><div><strong>'+safe(store)+'</strong><small>Promedio de precios registrados · '+series.length+' fecha(s)</small></div><b class="'+cls+'">'+(pct>0?'Subió ':pct<0?'Bajó ':'Sin cambio ')+Math.abs(pct).toFixed(1)+'%</b></div><div class="smart-trend-values"><span>Promedio inicial <b>'+money(first)+'</b></span><span>Promedio reciente <b>'+money(last)+'</b></span></div><svg class="smart-sparkline" viewBox="0 0 100 44" role="img" aria-label="Tendencia promedio en '+safe(store)+'"><polyline points="'+points+'" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg><small class="smart-trend-foot">'+fmtDate(series[0].day)+' al '+fmtDate(series[series.length-1].day)+'</small></article>';}).join('');
 const trendCards=trends.slice().sort((a,b)=>Math.abs(b.pct)-Math.abs(a.pct)).map(t=>{const values=t.history.map(x=>Number(x.price));if(values[values.length-1]!==t.last)values.push(t.last);const min=Math.min(...values),max=Math.max(...values),range=max-min||1;const points=values.map((v,i)=>(values.length<2?50:8+i*(84/(values.length-1)))+','+(40-((v-min)/range)*32)).join(' ');const cls=t.delta>0.00001?'price-up':t.delta< -0.00001?'price-down':'price-stable';const label=t.delta>0.00001?'Subió':t.delta< -0.00001?'Bajó':'Sin cambio';const cx=values.length<2?50:92,cy=40-((values[values.length-1]-min)/range)*32;return '<article class="smart-trend-card"><div class="smart-trend-top"><div><strong>'+safe(t.p.name)+'</strong><small>'+safe(t.p.presentation||'Presentación no especificada')+' · '+safe(t.p.store)+'</small></div><b class="'+cls+'">'+label+' '+Math.abs(t.pct).toFixed(1)+'%</b></div><div class="smart-trend-values"><span>Antes <b>'+money(t.first)+'</b></span><span>Ahora <b>'+money(t.last)+'</b></span><span class="'+cls+'">'+(t.delta>0?'+':t.delta<0?'−':'')+money(Math.abs(t.delta))+'</span></div><svg class="smart-sparkline" viewBox="0 0 100 44" role="img" aria-label="Evolución del precio de '+safe(t.p.name)+'"><polyline points="'+points+'" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="'+cx+'" cy="'+cy+'" r="3" fill="currentColor"/></svg><small class="smart-trend-foot">'+t.history.length+' registro(s) · '+fmtDate(t.history[0].date)+' al '+fmtDate(t.history[t.history.length-1].date)+'</small></article>';}).join('');
 panel.innerHTML='<section class="smart-dashboard"><div class="smart-dashboard-heading"><p class="eyebrow">ANÁLISIS DE TUS PRECIOS</p><h2>Dashboard inteligente</h2><p>Compara precios y sigue sus cambios usando exclusivamente los registros manuales de tu catálogo.</p></div><div class="smart-kpis"><article><small>Productos registrados</small><b>'+products.length+'</b></article><article><small>Productos comparables</small><b>'+comparable.length+'</b></article><article><small>Menor costo de referencia*</small><b>'+money(cheapest)+'</b></article></div><div class="smart-trend-summary"><article><small>Precios que subieron</small><b class="price-up">'+up+'</b></article><article><small>Precios que bajaron</small><b class="price-down">'+down+'</b></article><article><small>Sin variación</small><b>'+stable+'</b></article></div><h3>Resumen por supermercado</h3>'+(storeTotals.length?storeTotals.map(s=>'<article class="smart-store-row"><div><strong>'+safe(s.store)+'</strong><small>'+s.items.length+' producto(s) · '+s.items.filter(p=>p.price!==null&&Number(p.price)>0).length+' con precio</small></div><b>'+money(s.total)+'</b></article>').join(''):'<p class="empty">Agrega productos a tu catálogo para crear el dashboard.</p>')+'<h3>Comparación entre supermercados</h3>'+(comparable.length?comparable.map(g=>{const sorted=g.filter(p=>p.price!==null&&Number(p.price)>0).sort((a,b)=>Number(a.price)-Number(b.price));const spread=Number(sorted[sorted.length-1].price)-Number(sorted[0].price);return '<article class="smart-compare-card"><strong>'+safe(g[0].name)+' · '+safe(g[0].presentation||'Presentación no especificada')+'</strong>'+sorted.map((p,i)=>'<div><span>'+safe(p.store)+(i===0?' · menor precio':'')+'</span><b>'+money(p.price)+'</b></div>').join('')+'<small>Diferencia entre mayor y menor precio: '+money(spread)+'</small></article>';}).join(''):'<p class="empty">Registra el mismo producto y presentación en al menos dos supermercados para compararlos.</p>')+'<h3>Evolución de precios por producto</h3><label class="smart-period-filter">Período de análisis <select id="smart-period-select"><option value="0"'+(periodDays===0?' selected':'')+'>Todo el historial</option><option value="30"'+(periodDays===30?' selected':'')+'>Últimos 30 días</option><option value="90"'+(periodDays===90?' selected':'')+'>Últimos 90 días</option><option value="365"'+(periodDays===365?' selected':'')+'>Último año</option></select></label>'+(trendCards||'<p class="empty">Al actualizar el precio, aquí verás cuánto subió o bajó en dólares y porcentaje, junto con su gráfica.</p>')+'<small class="smart-dashboard-note">* La referencia suma el menor precio de cada producto comparable; no representa una compra real ni incluye cantidades. Las comparaciones requieren la misma presentación.</small><button type="button" id="smart-dashboard-catalog">Administrar productos y precios</button></section>';
 panel.querySelector('#smart-period-select')?.addEventListener('change',e=>renderManualComparisonDashboard(Number(e.target.value)));
 panel.querySelector('#smart-dashboard-catalog')?.addEventListener('click',()=>document.querySelector('[data-open-view="catalogo"]')?.click());
 const storeTitle=document.createElement('h3');storeTitle.textContent='Tendencia por supermercado';panel.querySelector('.smart-dashboard')?.insertBefore(storeTitle,panel.querySelector('#smart-dashboard-catalog'));const storeWrap=document.createElement('div');storeWrap.className='smart-store-trends';storeWrap.innerHTML=storeTrendCards||'<p class="empty">Todavía no hay historial suficiente para calcular tendencias por supermercado.</p>';panel.querySelector('.smart-dashboard')?.insertBefore(storeWrap,panel.querySelector('#smart-dashboard-catalog'));
}
function compareProduct(){
 const box=document.querySelector('#results');if(!box)return;
 const all=readPersonalCatalog();
 const groups=new Map();
 all.forEach(p=>{const key=((p.name||'').trim()+'|'+(p.presentation||'').trim()).toLocaleLowerCase('es');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);});
 const rows=[...groups.values()].filter(group=>group.length>1&&group.every(p=>p.price!==null&&p.price!==undefined&&Number(p.price)>0)).map(group=>({name:group[0].name,rows:group.slice().sort((a,b)=>Number(a.price)-Number(b.price))}));
 box.innerHTML=rows.length?'<h3>Comparación de tus precios registrados</h3>'+rows.map(group=>'<section class="manual-compare-card"><strong>'+safe(group.name)+'</strong>'+group.rows.map((p,i)=>'<div><span>'+safe(p.store)+(i===0?' · menor precio':'')+'</span><b>'+money(p.price)+'</b></div>').join('')+'</section>').join(''):'<section class="manual-empty-state"><h3>Aún faltan datos para comparar</h3><p>Registra el mismo producto en dos o más supermercados y coloca sus precios. El comparador identificará automáticamente la opción más económica.</p><button type="button" id="go-catalog-comparison">Ir a Mi catálogo</button></section>';
 box.querySelector('#go-catalog-comparison')?.addEventListener('click',()=>document.querySelector('[data-open-view="catalogo"]')?.click());
}

start();
