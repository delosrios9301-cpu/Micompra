const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const unit = value => {
  const raw=String(value??'').trim().toLowerCase();
  if(['gr','gramo','gramos'].includes(raw))return 'g';
  if(['kilo','kilos','kilogramo','kilogramos'].includes(raw))return 'kg';
  if(['l','lt','litro','litros'].includes(raw))return 'L';
  if(['libra','libras','lbs'].includes(raw))return 'lb';
  return raw;
};
const quantity = value => {
  if(value===null||value===undefined||value==='')return null;
  const n=Number(value);return Number.isFinite(n)?String(n):String(value).trim().toLowerCase();
};
export function getProductRegistrationCheck(products=[],draft={},mappings=[]) {
  const name=normalize(draft.canonical_name),brand=normalize(draft.brand),qty=quantity(draft.normalized_quantity),u=unit(draft.normalized_unit_name);
  const nameMatches=name?products.filter(p=>normalize(p.canonical_name)===name):[];
  const exactDuplicate=nameMatches.find(p=>normalize(p.brand)===brand&&quantity(p.normalized_quantity)===qty&&unit(p.normalized_unit_name)===u)||null;
  const code=String(draft.barcode||'').replace(/[\s-]+/g,'').toUpperCase();
  let barcodeOwner=null;
  if(code){
    barcodeOwner=products.find(p=>String(p.barcode||'').replace(/[\s-]+/g,'').toUpperCase()===code)||null;
    if(!barcodeOwner){const mapping=mappings.find(m=>String(m.barcode||'').replace(/[\s-]+/g,'').toUpperCase()===code);if(mapping)barcodeOwner=products.find(p=>p.id===mapping.product_id)||{canonical_name:'otro producto'};}
  }
  return {nameMatches,exactDuplicate,barcodeOwner};
}
export function validateProductRegistrationDraft(draft={}) {
  if(!String(draft.canonical_name||'').trim())return {valid:false,message:'Escribe el nombre del producto.'};
  if(String(draft.canonical_name).trim().length>120)return {valid:false,message:'El nombre no puede superar 120 caracteres.'};
  if(!String(draft.category||'').trim())return {valid:false,message:'Indica la categoría del producto.'};
  if(!Number.isFinite(Number(draft.normalized_quantity))||Number(draft.normalized_quantity)<=0)return {valid:false,message:'La cantidad del empaque debe ser mayor que cero.'};
  if(!String(draft.normalized_unit_name||'').trim())return {valid:false,message:'Selecciona la unidad del empaque.'};
  if(draft.barcode&&String(draft.barcode).length>64)return {valid:false,message:'El código de barras no puede superar 64 caracteres.'};
  return {valid:true,message:''};
}
