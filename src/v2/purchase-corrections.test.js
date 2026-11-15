import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createEmptyWorkspace, monthSpending, mergeWorkspaces } from './model.js';
import { applySavedPurchaseChange } from './purchase-corrections.js';

const oldDate = '2026-11-10T12:00:00.000Z';
const atEdit = '2026-11-14T15:10:00.000Z';
const atDelete = '2026-11-14T15:20:00.000Z';
const actor = {uid:'uid-member',email:'member@example.com',isOwner:false};
const owner = {uid:'uid-owner',email:'owner@example.com',isOwner:true};
const makeSpace = ({linked = true, stock = 5} = {}) => ({
  ...createEmptyWorkspace(),
  stores: [{id:'store-1',name:'Supermercado',createdAt:oldDate}],
  products: [{id:'product-1',name:'Arroz',unit:'unidad',active:true,createdAt:oldDate}],
  purchases: [{
    id:'purchase-1',date:'2026-11-10',storeId:'store-1',storeName:'Supermercado',paid:true,
    items:[{id:'line-1',name:'Arroz',quantity:2,unit:'unidad',unitPrice:3,discount:0}],
    total:6,inventoryLinked:linked,createdAt:oldDate,updatedAt:oldDate
  }],
  inventory: [{id:'stock-1',name:'Arroz',quantity:stock,unit:'unidad',createdAt:oldDate}],
  movements: linked ? [{id:'mov-original',inventoryId:'stock-1',productName:'Arroz',type:'entrada',quantity:2,reason:'Compra purchase-1',createdAt:oldDate}] : []
});
const editRequest = (changes = {}) => ({
  id:'purchase-1',expectedUpdatedAt:oldDate,kind:'edit',
  changes: {
    date:'2026-11-12',storeId:'store-1',paid:false,
    items:[{id:'line-1',name:'Arroz',quantity:3,unit:'unidad',unitPrice:4,discount:1}],
    ...changes
  }
});

test('una compra confirmada se puede reabrir y corregir sin duplicar finanzas ni registros', () => {
  const before = makeSpace();
  const {workspace:after,purchase} = applySavedPurchaseChange(before,editRequest(),actor,atEdit);
  assert.equal(before.purchases[0].total,6,'la entrada original no se debe mutar');
  assert.equal(after.purchases.length,1);
  assert.equal(purchase.id,'purchase-1');
  assert.equal(purchase.date,'2026-11-12');
  assert.equal(purchase.paid,false);
  assert.equal(purchase.total,11);
  assert.equal(monthSpending(after,'2026-11').purchases,11);
  assert.equal(after.inventory[0].quantity,6);
  assert.equal(after.movements.length,2);
  assert.equal(after.movements.find(m => m.id==='mov-original').quantity,2);
  assert.equal(after.movements[0].quantity,1);
  assert.equal(after.movements[0].purchaseAdjustment,true);
  assert.equal(after.movements[0].performedByEmail,'member@example.com');
  assert.equal(after.activity[0].performedByUid,actor.uid);
  assert.equal(after.activity[0].before.total,6);
  assert.equal(after.activity[0].after.total,11);
  assert.equal(after.deletedRecords['purchases:purchase-1'],undefined);
});

test('un segundo ajuste usa los movimientos compensatorios para no descontar dos veces', () => {
  const first = applySavedPurchaseChange(makeSpace(),editRequest(),actor,atEdit).workspace;
  const secondRequest = editRequest({items:[{id:'line-1',name:'Arroz',quantity:4,unit:'unidad',unitPrice:5,discount:0}]});
  secondRequest.expectedUpdatedAt = atEdit;
  const second = applySavedPurchaseChange(first,secondRequest,actor,atDelete).workspace;
  assert.equal(second.inventory.find(i => i.id==='stock-1').quantity,7);
  assert.equal(second.movements.filter(m => m.purchaseAdjustment).length,2);
  assert.equal(second.purchases[0].total,20);
});

test('el propietario puede eliminar, revierta existencias y conserva auditoría sin resucitar registros', () => {
  const first = applySavedPurchaseChange(makeSpace(),editRequest(),actor,atEdit).workspace;
  const result = applySavedPurchaseChange(first,{kind:'delete',id:'purchase-1',expectedUpdatedAt:atEdit},owner,atDelete);
  const after = result.workspace;
  assert.equal(result.deleted,true);
  assert.equal(after.purchases.length,0);
  assert.equal(after.inventory[0].quantity,3);
  assert.equal(after.movements.length,3);
  assert.equal(after.movements[0].type,'salida');
  assert.equal(after.movements[0].quantity,3);
  assert.equal(after.activity[0].action,'Compra eliminada');
  assert.equal(after.activity[0].performedByEmail,'owner@example.com');
  assert.equal(after.activity[0].before.total,11);
  assert.equal(after.activity[0].after,null);
  assert.equal(after.deletedRecords['purchases:purchase-1'].deletedAt,atDelete);
  const merged = mergeWorkspaces(after,makeSpace());
  assert.equal(merged.purchases.length,0,'un dispositivo antiguo no debe resucitar la compra');
  assert.equal(monthSpending(after,'2026-11').purchaseCount,0);
});

test('los miembros pueden corregir pero no eliminar compras confirmadas', () => {
  assert.throws(() => applySavedPurchaseChange(makeSpace(),{kind:'delete',id:'purchase-1',expectedUpdatedAt:oldDate},actor,atDelete),/Solo el propietario/);
  assert.equal(applySavedPurchaseChange(makeSpace(),editRequest(),actor,atEdit).purchase.total,11);
});

test('las versiones antiguas de otros dispositivos no sobreescriben correcciones', () => {
  assert.throws(()=>applySavedPurchaseChange(makeSpace(),{...editRequest(),expectedUpdatedAt:'2026-11-09T00:00:00Z'},actor,atEdit),/otro dispositivo/);
  assert.throws(()=>applySavedPurchaseChange(makeSpace(),{...editRequest(),id:'no-existe'},actor,atEdit),/no existe/);
});

test('se bloquean cantidades inválidas, descuentos excesivos y fechas imposibles', () => {
  assert.throws(()=>applySavedPurchaseChange(makeSpace(),editRequest({items:[]}),actor,atEdit),/entre 1 y 250/);
  assert.throws(()=>applySavedPurchaseChange(makeSpace(),editRequest({date:'mañana'}),actor,atEdit),/fecha válida/);
  assert.throws(()=>applySavedPurchaseChange(makeSpace(),editRequest({items:[{id:'line-1',name:'Arroz',quantity:2,unit:'unidad',unitPrice:3,discount:200}]}),actor,atEdit),/Revisa nombre/);
  assert.throws(()=>applySavedPurchaseChange(makeSpace(),editRequest({items:[{id:'same',name:'Arroz',quantity:1,unit:'unidad',unitPrice:3},{id:'same',name:'Aceite',quantity:1,unit:'unidad',unitPrice:2}]}),actor,atEdit),/duplicados/);
});

test('no genera stock negativo cuando parte de la compra ya se consumió', () => {
  const original = makeSpace({stock:1});
  assert.throws(()=>applySavedPurchaseChange(original,{kind:'delete',id:'purchase-1',expectedUpdatedAt:oldDate},owner,atDelete),/no hay existencias suficientes/);
  assert.equal(original.inventory[0].quantity,1);
  assert.equal(original.purchases.length,1);
});

test('compras sin inventario solo modifican su registro financiero', () => {
  const original = makeSpace({linked:false});
  const result = applySavedPurchaseChange(original,editRequest(),actor,atEdit);
  assert.equal(result.workspace.inventory[0].quantity,5);
  assert.equal(result.workspace.movements.length,0);
  assert.equal(result.purchase.inventoryLinked,false);
});

test('agregar y eliminar productos actualiza inventario con historial y sin duplicados', () => {
  const extraItem={id:'line-2',name:'Aceite',quantity:2,unit:'botella',unitPrice:5,discount:0};
  const first=applySavedPurchaseChange(makeSpace(),editRequest({items:[
    {id:'line-1',name:'Arroz',quantity:2,unit:'unidad',unitPrice:3,discount:0},extraItem
  ]}),owner,atEdit).workspace;
  assert.equal(first.purchases.length,1);
  assert.equal(first.purchases[0].total,16);
  assert.equal(first.inventory.length,2);
  assert.equal(first.inventory.find(row=>row.name==='Aceite').quantity,2);
  assert.equal(first.products.filter(row=>row.name==='Aceite').length,1);
  const second=applySavedPurchaseChange(first,{...editRequest({items:[
    {id:'line-1',name:'Arroz',quantity:2,unit:'unidad',unitPrice:3,discount:0}
  ]}),expectedUpdatedAt:atEdit},owner,atDelete).workspace;
  assert.equal(second.inventory.find(row=>row.name==='Aceite').quantity,0);
  assert.equal(second.products.filter(row=>row.name==='Aceite').length,1);
  assert.equal(second.movements.filter(row=>row.purchaseAdjustment && row.productName==='Aceite').length,2);
});

test('compatibilidad con compras antiguas sin updatedAt y con movimientos que no guardaron unidad exacta', () => {
  const legacy=makeSpace();
  delete legacy.purchases[0].updatedAt;
  legacy.purchases[0].items[0].unit='kg';
  const result=applySavedPurchaseChange(legacy,{
    ...editRequest({items:[{id:'line-1',name:'Arroz',quantity:2,unit:'kg',unitPrice:2,discount:0}]}),
    expectedUpdatedAt:oldDate
  },actor,atEdit).workspace;
  assert.equal(result.inventory.length,1);
  assert.equal(result.products.length,1);
});

test('la interfaz expone detalles, edición, corrección de líneas y borrado solo al propietario',async()=>{
  const app=await readFile(new URL('./app.js',import.meta.url),'utf8');
  const store=await readFile(new URL('./store.js',import.meta.url),'utf8');
  assert.match(app,/data-action="open-saved-purchase"/);
  assert.match(app,/data-action="edit-saved-purchase"/);
  assert.match(app,/data-action="delete-saved-purchase"/);
  assert.match(app,/data-form="edit-saved-purchase"/);
  assert.match(app,/data-action="remove-saved-purchase-item"/);
  assert.match(app,/data-action="add-saved-purchase-item"/);
  assert.match(app,/store\.isWorkspaceOwner\(\) \? '<button class="btn btn-danger"/);
  assert.match(app,/store\.changeSavedPurchase/);
  assert.match(store,/runTransaction\(db, async transaction =>/);
  assert.match(store,/applySavedPurchaseChange\(snapshot\.data\(\)\.workspace, request, actingUser\)/);
});
