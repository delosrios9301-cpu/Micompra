import { createClient } from '@supabase/supabase-js';
import './style.css';
const env = import.meta.env;
const configured = Boolean(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY);
const supabase = configured ? createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY) : null;
const stores = [
 {name:'Super 99',url:'https://www.super99.com/nuestra-tienda-en-linea'},
 {name:'El Rey'}, {name:'Xtra'}, {name:'Riba Smith'}, {name:'Machetazo'}, {name:'Jumbo'}
];
document.querySelector('#app').innerHTML = [
 '<header><a class="brand" href="#">Mi<span>Compra</span></a><span class="country">Panamá</span></header>',
 '<main><section class="hero"><p class="eyebrow">COMPRA CON INFORMACIÓN</p><h1>Tu compra, más inteligente.</h1><p>Organiza tu lista y compara precios con fuentes verificables.</p></section>',
 `<section class="status"><i></i><div><strong>${configured?'Conexión configurada':'Configuración pendiente'}</strong><small>${configured?'Cliente Supabase inicializado; precios aún no sincronizados.':'Agrega las variables de Supabase para conectar tus datos.'}</small></div></section>`,
 '<div class="section-head"><div><p class="eyebrow">RED DE TIENDAS</p><h2>Supermercados</h2></div><small>6 tiendas</small></div>',
 `<section class="grid">${stores.map(s=>`<article class="store"><b class="icon">${s.name[0]}</b><div><strong>${s.name}</strong><small>Pendiente de conexión</small></div>${s.url?`<a href="${s.url}" target="_blank" rel="noreferrer">Visitar ↗</a>`:'<em>En preparación</em>'}</article>`).join('')}</section>`,
 '<aside><strong>Precios transparentes</strong><p>Solo mostraremos precios con fuente identificable, fecha de consulta y presentación comparable. Todavía no hay precios importados.</p></aside>',
 '<footer>Mi Compra · Panamá · Versión inicial</footer></main>'
].join('');
void supabase;