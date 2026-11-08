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
  return rows.map(values=>Object.fromEntries(headers.map((h,i)=>[h,values[i]??''])));
}

export async function importPriceCsv({file,supabase,user,output}) {
  if(!user||!supabase) throw new Error('Debes iniciar sesión.');
  if(!file||!file.name.toLowerCase().endsWith('.csv')) throw new Error('Selecciona un archivo CSV.');
  const rows=parsePriceCsv(await file.text());
  const required=['supermercado','sucursal','producto','precio','moneda','url_fuente','fecha_hora_panama'];
  const missing=required.filter(k=>!Object.keys(rows[0]||{}).includes(k));
  if(missing.length) throw new Error('Faltan columnas: '+missing.join(', '));
  const {data:mappings,error}=await supabase.from('store_products').select('id,source_product_name,source_sku,supermarkets(name),supermarket_branches(name)');
  if(error) throw new Error('No se pudo consultar el catálogo.');
  let saved=0,skipped=0;const issues=[];
  for(let i=0;i<rows.length;i++){
    const r=rows[i],line=i+2,price=Number(String(r.precio).replace(',','.'));
    const regular=r.precio_regular?Number(String(r.precio_regular).replace(',','.')):null;
    const hasTimezone=/(Z|[+-]\d{2}:\d{2})$/i.test(r.fecha_hora_panama);
    const date=new Date(r.fecha_hora_panama);
    if(!r.supermercado||!r.sucursal||!r.producto||!Number.isFinite(price)||price<=0||!/^https:\/\//i.test(r.url_fuente)||r.moneda.toUpperCase()!=='USD'||!hasTimezone||Number.isNaN(date.getTime())||date>new Date()||date<new Date(Date.now()-86400000)){issues.push('Fila '+line+': datos inválidos o fecha fuera de 24 horas.');skipped++;continue;}
    if(regular!==null&&(!Number.isFinite(regular)||regular<price)){issues.push('Fila '+line+': precio regular inválido.');skipped++;continue;}
    const match=mappings.find(m=>m.supermarkets?.name?.toLowerCase()===r.supermercado.toLowerCase()&&m.supermarket_branches?.name?.toLowerCase()===r.sucursal.toLowerCase()&&((r.sku&&m.source_sku===r.sku)||(m.source_product_name||'').toLowerCase()===r.producto.toLowerCase()));
    if(!match){issues.push('Fila '+line+': producto/sucursal no registrados o no coinciden.');skipped++;continue;}
    const {data:dupe,error:de}=await supabase.from('price_observations').select('id').eq('store_product_id',match.id).eq('observed_at',date.toISOString()).eq('price',price).limit(1);
    if(de){issues.push('Fila '+line+': no se pudo revisar duplicados.');skipped++;continue;}
    if(dupe?.length){skipped++;continue;}
    const {error:ie}=await supabase.from('price_observations').insert({store_product_id:match.id,price,currency:'USD',regular_price:regular,promotion_label:r.promocion||null,availability:r.disponibilidad||null,source_url:r.url_fuente,observed_at:date.toISOString()});
    if(ie){issues.push('Fila '+line+': error de permisos o datos.');skipped++;}else saved++;
  }
  output.textContent='Guardados para revisión: '+saved+'. Omitidos: '+skipped+'. Los importados permanecen ocultos hasta verificarse.'+(issues.length?'\n'+issues.slice(0,8).join('\n'):'');
}
