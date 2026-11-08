import test from 'node:test';
import assert from 'node:assert/strict';
import { matchStoreProduct, parsePriceCsv } from '../src/price-import.js';
import { isTrustedStoreSourceUrl, validateStoreProductMappingDraft } from '../src/store-mapping.js';

test('lee encabezados y filas CSV con BOM y CRLF', () => {
  const rows = parsePriceCsv('\uFEFFsupermercado,producto,precio\r\nSuper 99,Arroz,2.50\r\n');
  assert.deepEqual(rows, [{ supermercado: 'Super 99', producto: 'Arroz', precio: '2.50' }]);
});

test('respeta comas y comillas escapadas dentro de campos', () => {
  const rows = parsePriceCsv('producto,detalle\n"Arroz, premium","Bolsa ""familiar"""');
  assert.equal(rows[0].producto, 'Arroz, premium');
  assert.equal(rows[0].detalle, 'Bolsa "familiar"');
});

test('omite líneas vacías y conserva campos vacíos', () => {
  const rows = parsePriceCsv('a,b\nuno,\n\ndos,tres\n');
  assert.deepEqual(rows, [{ a: 'uno', b: '' }, { a: 'dos', b: 'tres' }]);
});

test('rechaza archivos con comillas sin cerrar', () => {
  assert.throws(() => parsePriceCsv('producto,precio\n"Arroz,2.50'), /Comillas sin cerrar/);
});

test('rechaza un archivo vacío', () => {
  assert.throws(() => parsePriceCsv('\uFEFF  \r\n'), /vacío/);
});

test('rechaza encabezados vacíos o duplicados', () => {
  assert.throws(() => parsePriceCsv('a,,b\n1,2,3'), /encabezado vacío/);
  assert.throws(() => parsePriceCsv('a,a\n1,2'), /duplicados/);
});

const mappings = [
  { id:'rice-1', source_product_name:'Arroz Like Especial', source_sku:'5641086', package_description:'1.81 KG', supermarkets:{name:'Xtra'}, supermarket_branches:{name:'Tienda en línea'} },
  { id:'rice-2', source_product_name:'Arroz Like Especial', source_sku:'5641087', package_description:'900 G', supermarkets:{name:'Xtra'}, supermarket_branches:{name:'Tienda en línea'} }
];

test('sin SKU exige coincidencia exacta de nombre y presentación', () => {
  assert.equal(matchStoreProduct({supermercado:'Xtra',sucursal:'Tienda en línea',producto:'Arroz Like Especial',presentacion:'1.81 KG'},mappings)?.id,'rice-1');
  assert.equal(matchStoreProduct({supermercado:'Xtra',sucursal:'Tienda en línea',producto:'Arroz Like Especial',presentacion:'1 KG'},mappings),null);
});

test('con SKU exige que tienda, sucursal, nombre y presentación no contradigan el mapeo', () => {
  assert.equal(matchStoreProduct({supermercado:'Xtra',sucursal:'Tienda en línea',producto:'Arroz Like Especial',presentacion:'900 G',sku:'5641087'},mappings)?.id,'rice-2');
  assert.equal(matchStoreProduct({supermercado:'Xtra',sucursal:'Tienda en línea',producto:'Arroz Like Especial',presentacion:'1.81 KG',sku:'5641087'},mappings),null);
  assert.equal(matchStoreProduct({supermercado:'Xtra',sucursal:'otra sucursal',producto:'Arroz Like Especial',presentacion:'1.81 KG',sku:'5641086'},mappings),null);
});

test('normaliza mayúsculas y espacios sin relajar la presentación', () => {
  assert.equal(matchStoreProduct({supermercado:' XTRA ',sucursal:'TIENDA EN LÍNEA',producto:' arroz like especial ',presentacion:'1.81   kg'},mappings)?.id,'rice-1');
});

test('no permite emparejar por nombre si falta la presentación', () => {
  assert.equal(matchStoreProduct({supermercado:'Xtra',sucursal:'Tienda en línea',producto:'Arroz Like Especial'},mappings),null);
});

test('permite asociar una tienda sin sucursal confirmada solo cuando el CSV deja sucursal vacía', () => {
  const mapping = { id:'xtra-null', source_product_name:'Arroz Like Especial', source_sku:'5641086', package_description:'1.81 KG', supermarkets:{name:'Xtra'}, supermarket_branches:null };
  assert.equal(matchStoreProduct({supermercado:'Xtra',sucursal:'',producto:'Arroz Like Especial',presentacion:'1.81 KG',sku:'5641086'},[mapping])?.id,'xtra-null');
  assert.equal(matchStoreProduct({supermercado:'Xtra',sucursal:'Tienda en línea',producto:'Arroz Like Especial',presentacion:'1.81 KG',sku:'5641086'},[mapping]),null);
});

test('rechaza asociaciones ambiguas aunque coincidan nombre y presentación', () => {
  const duplicate = {...mappings[0], id:'rice-duplicate', source_sku:'5641999'};
  assert.equal(matchStoreProduct({supermercado:'Xtra',sucursal:'Tienda en línea',producto:'Arroz Like Especial',presentacion:'1.81 KG'},[mappings[0],duplicate]),null);
});

test('acepta solo URLs HTTPS de dominios oficiales autorizados por tienda', () => {
  assert.equal(isTrustedStoreSourceUrl('Xtra','https://nuevatienda.superxtra.com/producto/arroz'),true);
  assert.equal(isTrustedStoreSourceUrl('Super 99','http://www.super99.com/producto'),false);
  assert.equal(isTrustedStoreSourceUrl('Super 99','https://superxtra.com/producto'),false);
  assert.equal(isTrustedStoreSourceUrl('El Rey','https://example.com/producto'),false);
});

test('exige SKU, presentación exacta y dominio oficial al crear una asociación', () => {
  const draft = {product_id:'p1',supermarket_id:'s1',supermarket_name:'Xtra',source_product_name:'Arroz',package_description:'1 KG',source_sku:'123',source_product_url:'https://nuevatienda.superxtra.com/arroz'};
  assert.equal(validateStoreProductMappingDraft(draft).valid,true);
  assert.match(validateStoreProductMappingDraft({...draft,source_sku:''}).message,/SKU/);
  assert.match(validateStoreProductMappingDraft({...draft,source_product_url:'https://otro.com/arroz'}).message,/dominio oficial/);
});
