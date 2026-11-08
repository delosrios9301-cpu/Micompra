import { isTrustedStoreSourceUrl } from './store-mapping.js';

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
