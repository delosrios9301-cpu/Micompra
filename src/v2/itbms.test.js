import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { computePurchaseTotal, createEmptyWorkspace, monthSpending, applySharedDraftOperation } from './model.js';
import { applySavedPurchaseChange } from './purchase-corrections.js';
import { suggestPanamaItbms, taxRateForNewItem, purchaseLineBreakdown, computePurchaseBreakdown, validTaxRate } from './itbms.js';

const item = (name, quantity, unitPrice, taxRate, extra = {}) =>
  ({ name, quantity, unitPrice, taxRate, discount: 0, ...extra });

test('Panamá: alimentos exentos y artículos de limpieza al 7%', () => {
  const items = [item('Arroz', 1, 20, 0), item('Detergente', 1, 10, 7)];
  assert.deepEqual(computePurchaseBreakdown(items), { subtotal:30, itbms:0.7, total:30.7 });
  assert.equal(computePurchaseTotal(items),30.7);
  assert.equal(purchaseLineBreakdown(items[0]).tax,0);
  assert.equal(purchaseLineBreakdown(items[1]).tax,0.7);
});

test('clasificación automática conservadora y editable desde el catálogo', () => {
  for (const name of ['Arroz blanco', 'Lechuga fresca', 'Pollo entero', 'Leche evaporada', 'Huevos', 'Ibuprofeno']) {
    assert.equal(suggestPanamaItbms(name),0,name);
  }
  for (const name of ['Detergente líquido', 'Papel higiénico', 'Jabón de lavar']) {
    assert.equal(suggestPanamaItbms(name),7,name);
  }
  assert.equal(suggestPanamaItbms('Producto desconocido'),null);
  assert.equal(taxRateForNewItem({name:'Arroz blanco'}),0);
  assert.equal(taxRateForNewItem({name:'Detergente'}),7);
  assert.equal(taxRateForNewItem({name:'Artículo por revisar'}),7);
  assert.equal(taxRateForNewItem({name:'Producto X'},[{name:'Producto X',category:'Alimentos'}]),0);
  assert.equal(taxRateForNewItem({name:'Arroz'},[{name:'Arroz',taxRate:7,category:'Alimentos'}]),7,'la configuración del usuario prevalece');
  assert.equal(taxRateForNewItem({name:'Vaso',taxRate:0}),0);
  assert.equal(taxRateForNewItem({name:'Vaso',taxRate:10}),10);
  assert.equal(taxRateForNewItem({name:'Vaso',taxRate:15}),15);
});

test('no aplica impuesto dos veces cuando precio ya lo incluye', () => {
  const {subtotal,itbms,total} = computePurchaseBreakdown([item('Jabón',1,10.7,7,{taxIncluded:true})]);
  assert.equal(subtotal,10);
  assert.equal(itbms,0.7);
  assert.equal(total,10.7);
  const discount = purchaseLineBreakdown(item('Jabón',2,5,7,{discount:2}));
  assert.equal(discount.base,8);
  assert.equal(discount.tax,0.56);
  assert.equal(discount.total,8.56);
});

test('admite 0%, 7% y tasas especiales 10% y 15% sin asumirlas automáticamente', () => {
  assert.equal(validTaxRate(0),true);
  assert.equal(validTaxRate(7),true);
  assert.equal(validTaxRate('10'),true);
  assert.equal(validTaxRate('15'),true);
  assert.equal(validTaxRate(5),false);
  assert.equal(validTaxRate(null),false);
  assert.equal(purchaseLineBreakdown(item('Categoría especial',1,10,10)).tax,1);
  assert.equal(purchaseLineBreakdown(item('Categoría especial',1,10,15)).tax,1.5);
});

test('compras históricas no generan ITBMS ni cambian total por actualización', () => {
  const old = [{name:'Producto antiguo',quantity:2,unitPrice:1.337,discount:0.05}];
  assert.equal(computePurchaseTotal(old),2.62);
  assert.deepEqual(computePurchaseBreakdown(old),{subtotal:2.62,itbms:0,total:2.62});
  const space={...createEmptyWorkspace(), purchases:[{date:'2026-11-13',total:2.62,items:old}]};
  assert.equal(monthSpending(space,'2026-11').purchases,2.62);
});

test('los cambios de ITBMS se comparten en el borrador sin borrar otros datos',()=>{
  const initial={id:'draft-1',updatedAt:'T1',items:[{id:'one',name:'Detergente',quantity:1,unitPrice:10,discount:0,taxRate:7,taxIncluded:false}]};
  const after=applySharedDraftOperation(initial,{type:'patch',draftId:'draft-1',itemId:'one',changes:{taxRate:0,taxIncluded:true},at:'T2'},true);
  assert.equal(after.items[0].taxRate,0);
  assert.equal(after.items[0].taxIncluded,true);
  assert.equal(after.items[0].unitPrice,10);
  assert.equal(computePurchaseTotal(after.items),10);
});

test('editar una compra permite corregir el ITBMS con auditoría y total financiero correcto',()=>{
  const now='2026-11-15T10:00:00Z';
  const space={...createEmptyWorkspace(),purchases:[{
    id:'buy-1',storeId:'',storeName:'Supermercado',date:'2026-11-14',paid:true,
    items:[{id:'line-food',name:'Arroz',quantity:1,unit:'kg',unitPrice:20,discount:0},
      {id:'line-soap',name:'Detergente',quantity:1,unit:'unidad',unitPrice:10,discount:0}],
    total:30,inventoryLinked:false,createdAt:now,updatedAt:now
  }]};
  const result=applySavedPurchaseChange(space,{
    kind:'edit',id:'buy-1',expectedUpdatedAt:now,changes:{
      date:'2026-11-14',storeId:'',paid:true,items:[
        {id:'line-food',name:'Arroz',quantity:1,unit:'kg',unitPrice:20,discount:0,taxRate:0,taxIncluded:false},
        {id:'line-soap',name:'Detergente',quantity:1,unit:'unidad',unitPrice:10,discount:0,taxRate:7,taxIncluded:false}
      ]
    }
  },{uid:'owner',email:'owner@example.com',isOwner:true},'2026-11-15T10:01:00Z');
  assert.equal(result.purchase.total,30.7);
  assert.equal(result.purchase.itbms,0.7);
  assert.equal(result.purchase.subtotal,30);
  assert.equal(result.workspace.activity[0].before.total,30);
  assert.equal(result.workspace.activity[0].after.total,30.7);
  assert.equal(monthSpending(result.workspace,'2026-11').purchases,30.7);
  assert.equal(result.workspace.purchases.length,1);
});

test('la interfaz ofrece tasas por producto y los cálculos de impuestos son coherentes',async()=>{
  const app=await readFile(new URL('./app.js',import.meta.url),'utf8');
  const store=await readFile(new URL('./store.js',import.meta.url),'utf8');
  assert.match(app,/ITBMS/);
  assert.match(app,/itbmsOptions/);
  assert.match(app,/purchaseTaxSummary/);
  assert.match(app,/data-draft-tax/);
  assert.match(app,/savedItemTax/);
  assert.match(app,/edit-product-tax/);
  assert.match(app,/taxIncluded/);
  assert.match(app,/computePurchaseBreakdown\(items\)/);
  assert.match(store,/Number\(item\.taxRate \|\| 0\)/);
});
