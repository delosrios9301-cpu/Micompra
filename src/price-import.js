export function parsePriceCsv(text) {
  const rows=[]; let row=[], field='', quoted=false;
  const input=text.replace(/^\uFEFF/,'');
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

export function matchStoreProduct(row, mappings) {
  const store=normalize(row.supermercado), branch=normalize(row.sucursal);
  const name=normalize(row.producto), pack=normalize(row.presentacion);
  if(!store||!branch||!name) return null;
  return mappings.find(item => {
    if(normalize(item.supermarkets?.name)!==store || normalize(item.supermarket_branches?.name)!==branch) return false;
    const sku=String(row.sku ?? '').trim();
    if(sku) {
      if(String(item.source_sku ?? '').trim()!==sku) return false;
      if(name && normalize(item.source_product_name)!==name) return false;
      return !pack || normalize(item.package_description)===pack;
    }
    return Boolean(pack) && normalize(item.source_product_name)===name && normalize(item.package_description)===pack;
  }) || null;
}

export async function importPriceCsv({file,supabase,user,output}) {
  if(!user||!supabase) throw new Error('Debes iniciar sesión.');
  if(!file||!file.name.toLowerCase().endsWith('.csv')) throw new Error('Selecciona un archivo CSV.');
  const rows=parsePriceCsv(await file.text());
  const required=['supermercado','sucursal','producto','presentacion','precio','moneda','url_fuente','fecha_hora_panama'];
  const missing=required.filter(k=>!Object.keys(rows[0]||{}).includes(k));
  if(missing.length) throw new Error('Faltan columnas: '+missing.join(', '));
  const {data:mappings,error}=await supabase.from('store_products').select('id,source_product_name,source_sku,package_description,supermarkets(name),supermarket_branches(name)');
  if(error) throw new Error('No se pudo consultar el catálogo.');
  let saved=0,skipped=0;const issues=[];
  for(let i=0;i<rows.length;i++){
    const r=rows[i],line=i+2,price=Number(String(r.precio).replace(',','.'));
    const regular=r.precio_regular?Number(String(r.precio_regular).replace(',','.')):null;
    const hasTimezone=/(Z|[+-]\d{2}:\d{2})$/i.test(r.fecha_hora_panama);
    const date=new Date(r.fecha_hora_panama);
    if(!r.supermercado||!r.sucursal||!r.producto||!r.presentacion||!Number.isFinite(price)||price<=0||!/^https:\/\//i.test(r.url_fuente)||r.moneda.toUpperCase()!=='USD'||!hasTimezone||Number.isNaN(date.getTime())||date>new Date()||date<new Date(Date.now()-86400000)){
      issues.push('Fila '+line+': datos inválidos, presentación faltante o fecha fuera de 24 horas.');skipped++;continue;
    }
    if(regular!==null&&(!Number.isFinite(regular)||regular<price)){issues.push('Fila '+line+': precio regular inválido.');skipped++;continue;}
    const match=matchStoreProduct(r,mappings||[]);
    if(!match){issues.push('Fila '+line+': producto, presentación o sucursal no coinciden exactamente.');skipped++;continue;}
    const {data:dupe,error:de}=await supabase.from('price_observations').select('id').eq('store_product_id',match.id).eq('observed_at',date.toISOString()).eq('price',price).limit(1);
    if(de){issues.push('Fila '+line+': no se pudo revisar duplicados.');skipped++;continue;}
    if(dupe?.length){skipped++;continue;}
    const {error:ie}=await supabase.from('price_observations').insert({store_product_id:match.id,price,currency:'USD',regular_price:regular,promotion_label:r.promocion||null,availability:r.disponibilidad||null,source_url:r.url_fuente,observed_at:date.toISOString()});
    if(ie){issues.push('Fila '+line+': error de permisos o datos.');skipped++;}else saved++;
  }
  output.textContent='Guardados para revisión: '+saved+'. Omitidos: '+skipped+'. Los importados permanecen pendientes y ocultos hasta aprobación.'+(issues.length?'\n'+issues.slice(0,8).join('\n'):'');
}
