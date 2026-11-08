import { isTrustedStoreSourceUrl } from './store-mapping.js';

export function parsePriceCsv(text) {
  const rows=[]; let row=[], field='', quoted=false;
  const input=String(text ?? '').replace(/^\uFEFF/,'');
  for(let i=0;i<input.length;i++){
    const ch=input[i], next=input[i+1];
    if(ch==='"' && quoted && next==='"'){field+='"';i++;}
    else if(ch==='"'){quoted=!quoted;}
    else if(ch===','&&!quoted){row.push(field.trim());field='';}
    else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&next==='\n')i++;row.push(field.trim());if(row.some(v=>v!==''))rows.push(row);row=[];field='';}
    else field+=ch;
  }
  row.push(field.trim());if(row.some(v=>v!==''))rows.push(row);
  if(quoted) throw new Error('Comillas sin cerrar en el CSV.');
  if(!rows.length) throw new Error('El archivo está vacío.');
  const headers=rows.shift().map(h=>h.toLowerCase());
  if(headers.some(h=>!h)) throw new Error('El CSV contiene un encabezado vacío.');
  if(new Set(headers).size!==headers.length) throw new Error('El CSV contiene encabezados duplicados.');
  return rows.map(values=>Object.fromEntries(headers.map((h,i)=>[h,values[i]??''])));
}

const normalize = value => String(value ?? '').trim().replace(/\s+/g,' ').toLocaleLowerCase('es');
const parseAmount = value => Number(String(value ?? '').trim().replace(/\s/g,'').replace(',','.'));

export function matchStoreProduct(row, mappings) {
  const store=normalize(row.supermercado), branch=normalize(row.sucursal);
  const name=normalize(row.producto), pack=normalize(row.presentacion);
  if(!store||!name||!pack) return null;
  const sku=String(row.sku ?? '').trim();
  const matches=(mappings||[]).filter(item => {
    if(normalize(item.supermarkets?.name)!==store) return false;
    const mappedBranch=normalize(item.supermarket_branches?.name);
    if(branch ? mappedBranch!==branch : Boolean(mappedBranch)) return false;
    if(normalize(item.source_product_name)!==name || normalize(item.package_description)!==pack) return false;
    return !sku || String(item.source_sku ?? '').trim()===sku;
  });
  return matches.length===1 ? matches[0] : null;
}

export async function importPriceCsv({file,supabase,user,output}) {
  if(!user||!supabase) throw new Error('Debes iniciar sesión.');
  if(!file||!file.name.toLowerCase().endsWith('.csv')) throw new Error('Selecciona un archivo CSV.');
  if(file.size>1024*1024) throw new Error('El archivo no puede superar 1 MB.');
  const rows=parsePriceCsv(await file.text());
  if(rows.length>500) throw new Error('El archivo no puede superar 500 filas.');
  const required=['supermercado','sucursal','producto','presentacion','precio','moneda','url_fuente','fecha_hora_panama','verificado'];
  const missing=required.filter(k=>!Object.keys(rows[0]||{}).includes(k));
  if(missing.length) throw new Error('Faltan columnas: '+missing.join(', '));
  const {data:mappings,error}=await supabase.from('store_products').select('id,source_product_name,source_sku,package_description,supermarkets(name),supermarket_branches(name)');
  if(error) throw new Error('No se pudo consultar el catálogo de asociaciones.');
  let saved=0,skipped=0;const issues=[];
  for(let i=0;i<rows.length;i++){
    const r=rows[i],line=i+2,price=parseAmount(r.precio);
    const regular=r.precio_regular?parseAmount(r.precio_regular):null;
    const dateText=String(r.fecha_hora_panama ?? '').trim();
    const hasPanamaTimezone=/-05:00$/i.test(dateText);
    const date=new Date(dateText);
    const verified=['si','sí','yes','true','1'].includes(normalize(r.verificado));
    if(!r.supermercado||!r.producto||!r.presentacion||!Number.isFinite(price)||price<=0||
      !isTrustedStoreSourceUrl(r.supermercado,r.url_fuente)||normalize(r.moneda)!=='usd'||
      !hasPanamaTimezone||!verified||Number.isNaN(date.getTime())||date>new Date()||
      date<new Date(Date.now()-86400000)){
      issues.push('Fila '+line+': datos inválidos, fuente no oficial, verificación faltante o fecha fuera de 24 horas.');skipped++;continue;
    }
    if(regular!==null&&(!Number.isFinite(regular)||regular<price)){issues.push('Fila '+line+': precio regular inválido.');skipped++;continue;}
    const match=matchStoreProduct(r,mappings||[]);
    if(!match){issues.push('Fila '+line+': producto, presentación, SKU o sucursal no coinciden exactamente o la asociación es ambigua.');skipped++;continue;}
    const {data:dupe,error:de}=await supabase.from('price_observations').select('id').eq('store_product_id',match.id).eq('observed_at',date.toISOString()).eq('price',price).limit(1);
    if(de){issues.push('Fila '+line+': no se pudo revisar duplicados.');skipped++;continue;}
    if(dupe?.length){skipped++;continue;}
    const {error:ie}=await supabase.from('price_observations').insert({
      store_product_id:match.id,price,currency:'USD',regular_price:regular,
      promotion_label:r.promocion||null,availability:r.disponibilidad||null,
      source_url:r.url_fuente,observed_at:date.toISOString()
    });
    if(ie){issues.push('Fila '+line+': error de permisos o datos.');skipped++;}else saved++;
  }
  output.textContent='Guardados para revisión: '+saved+'. Omitidos: '+skipped+'. Los importados permanecen pendientes y ocultos hasta aprobación.'+(issues.length?'\n'+issues.slice(0,8).join('\n'):'');
}
