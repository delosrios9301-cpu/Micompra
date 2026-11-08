
import { getProductRegistrationCheck, validateProductRegistrationDraft } from './catalog-admin.js';

const normalizeHeader = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
const headerAliases = {
  canonical_name:['canonical_name','nombre','producto','nombre_producto','product_name'],
  brand:['brand','marca'],
  category:['category','categoria'],
  normalized_quantity:['normalized_quantity','cantidad','cantidad_empaque','contenido','peso','volumen'],
  normalized_unit_name:['normalized_unit_name','unidad','unidad_medida','presentacion_unidad'],
  barcode:['barcode','codigo_barras','codigo_de_barras','ean','upc']
};
const normalizeName = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const normalizeUnit = value => {
  const v=String(value??'').trim().toLowerCase();
  if(['gr','gramo','gramos'].includes(v))return 'g';
  if(['kilo','kilos','kilogramo','kilogramos'].includes(v))return 'kg';
  if(['l','lt','litro','litros'].includes(v))return 'L';
  if(['libra','libras','lbs'].includes(v))return 'lb';
  return v;
};
const parseQuantity = (value,delimiter) => {
  const raw=String(value??'').trim().replace(/\s/g,'');
  if(!raw)return NaN;
  const normalized=delimiter===';'?raw.replace(',','.'):raw;
  return Number(normalized);
};
function detectDelimiter(line) {
  let commas=0,semicolons=0,quoted=false;
  for(let i=0;i<line.length;i++){
    if(line[i]==='"'){if(quoted&&line[i+1]==='"'){i++;continue;}quoted=!quoted;continue;}
    if(!quoted){if(line[i]===',')commas++;if(line[i]===';')semicolons++;}
  }
  return semicolons>commas?';':',';
}
function parseRecords(text,delimiter) {
  const records=[];let row=[],field='',quoted=false,line=1,rowLine=1;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"'&&text[i+1]==='"'){field+='"';i++;}
      else if(ch==='"')quoted=false;
      else {field+=ch;if(ch==='\n')line++;}
      continue;
    }
    if(ch==='"'&&field===''){quoted=true;continue;}
    if(ch===delimiter){row.push(field);field='';continue;}
    if(ch==='\r'||ch==='\n'){
      if(ch==='\r'&&text[i+1]==='\n')i++;
      row.push(field);field='';
      if(row.some(v=>String(v).trim()!==''))records.push({line:rowLine,values:row});
      row=[];line++;rowLine=line;continue;
    }
    field+=ch;
  }
  if(quoted)return {error:'Hay una comilla sin cerrar en el archivo CSV.'};
  row.push(field);
  if(row.some(v=>String(v).trim()!==''))records.push({line:rowLine,values:row});
  return {records};
}
export function parseCatalogCsv(text) {
  const source=String(text??'').replace(/^\uFEFF/,'');
  if(!source.trim())return {ok:false,error:'El archivo está vacío.'};
  const firstLine=source.split(/\r?\n/).find(line=>line.trim())||'';
  const delimiter=detectDelimiter(firstLine);
  const parsed=parseRecords(source,delimiter);
  if(parsed.error)return {ok:false,error:parsed.error};
  const [headerRecord,...dataRecords]=parsed.records;
  if(!headerRecord)return {ok:false,error:'No se encontró la fila de encabezados.'};
  const headers=headerRecord.values.map(normalizeHeader);
  const columns={};
  for(const [key,aliases] of Object.entries(headerAliases)){
    const index=headers.findIndex(h=>aliases.includes(h));
    if(index>=0)columns[key]=index;
  }
  const missing=['canonical_name','category','normalized_quantity','normalized_unit_name'].filter(k=>columns[k]===undefined);
  if(missing.length)return {ok:false,error:'Faltan columnas obligatorias: '+missing.join(', ')+'. Descarga la plantilla para ver los encabezados correctos.'};
  if(dataRecords.length>500)return {ok:false,error:'El archivo supera el máximo de 500 productos por importación.'};
  const rows=dataRecords.map(record=>{
    const get=key=>columns[key]===undefined?'':String(record.values[columns[key]]??'').trim();
    return {
      line:record.line,
      canonical_name:get('canonical_name'),
      brand:get('brand')||null,
      category:get('category'),
      normalized_quantity:parseQuantity(get('normalized_quantity'),delimiter),
      normalized_unit_name:normalizeUnit(get('normalized_unit_name')),
      barcode:get('barcode').replace(/[\s-]+/g,'').toUpperCase()||null
    };
  });
  return {ok:true,delimiter,rows};
}
export function analyzeCatalogImportRows(rows=[],products=[],mappings=[],checksumValidator=()=>true) {
  const readyRows=[],issues=[],seenIdentities=new Set(),seenBarcodes=new Set();
  const allowedUnits=new Set(['kg','g','lb','oz','L','ml','unidad','unidades','rollos']);
  for(const row of rows){
    const draft={...row};
    const validation=validateProductRegistrationDraft(draft);
    let reason=!validation.valid?validation.message:'';
    if(!reason&&!allowedUnits.has(draft.normalized_unit_name))reason='La unidad no está permitida.';
    if(!reason&&draft.barcode&&/^\d+$/.test(draft.barcode)&&[8,12,13].includes(draft.barcode.length)&&!checksumValidator(draft.barcode))reason='El dígito de control del código de barras no es válido.';
    const identity=[normalizeName(draft.canonical_name),normalizeName(draft.brand),String(Number(draft.normalized_quantity)),normalizeUnit(draft.normalized_unit_name)].join('|');
    const code=draft.barcode||'';
    const existing=getProductRegistrationCheck(products,draft,mappings);
    if(!reason&&existing.exactDuplicate)reason='Ya existe el mismo producto, marca y presentación en el catálogo.';
    if(!reason&&existing.barcodeOwner)reason='El código de barras ya está asociado a otro registro.';
    if(!reason&&seenIdentities.has(identity))reason='Este producto y presentación están repetidos dentro del propio archivo.';
    if(!reason&&code&&seenBarcodes.has(code))reason='Este código de barras está repetido dentro del propio archivo.';
    if(reason){issues.push({line:row.line,canonical_name:row.canonical_name,reason});continue;}
    seenIdentities.add(identity);
    if(code)seenBarcodes.add(code);
    readyRows.push({...draft,variantWarning:existing.nameMatches.length>0});
  }
  return {readyRows,issues,variantCount:readyRows.filter(r=>r.variantWarning).length};
}
