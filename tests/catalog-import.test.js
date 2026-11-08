
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCatalogCsv, analyzeCatalogImportRows } from '../src/catalog-import.js';

const catalog=[{id:'1',canonical_name:'Café molido',brand:'Marca A',normalized_quantity:'250',normalized_unit_name:'g',barcode:'0012345678905'}];
test('parses comma CSV, quoted commas and accented Spanish names',()=>{
 const result=parseCatalogCsv('canonical_name,brand,category,normalized_quantity,normalized_unit_name,barcode\n"Arroz, premium",Marca,Granos,1,kg,');
 assert.equal(result.ok,true);assert.equal(result.rows[0].canonical_name,'Arroz, premium');
});
test('parses semicolon CSV and decimal comma',()=>{
 const result=parseCatalogCsv('nombre;categoria;cantidad;unidad\nLeche;Lácteos;1,5;L');
 assert.equal(result.ok,true);assert.equal(result.rows[0].normalized_quantity,1.5);
});
test('rejects missing columns, malformed quotes and over 500 rows',()=>{
 assert.equal(parseCatalogCsv('nombre,categoria\nArroz,Granos').ok,false);
 assert.equal(parseCatalogCsv('canonical_name,category,normalized_quantity,normalized_unit_name\n"Arroz,Granos,1,kg').ok,false);
 const rows=Array.from({length:501},(_,i)=>'Producto '+i+',Granos,1,kg').join('\n');
 assert.equal(parseCatalogCsv('canonical_name,category,normalized_quantity,normalized_unit_name\n'+rows).ok,false);
});
test('flags exact catalog duplicates and repeated entries within the file',()=>{
 const rows=[
 {line:2,canonical_name:'Cafe molido',brand:'Marca A',category:'Café',normalized_quantity:250,normalized_unit_name:'g',barcode:null},
 {line:3,canonical_name:'Arroz',brand:null,category:'Granos',normalized_quantity:1,normalized_unit_name:'kg',barcode:null},
 {line:4,canonical_name:'Arroz',brand:null,category:'Granos',normalized_quantity:1,normalized_unit_name:'kg',barcode:null}
 ];
 const result=analyzeCatalogImportRows(rows,catalog,[]);
 assert.equal(result.readyRows.length,1);assert.equal(result.issues.length,2);
});
test('flags duplicate barcodes and warns on a different package variant',()=>{
 const rows=[
 {line:2,canonical_name:'Café molido',brand:'Marca A',category:'Café',normalized_quantity:500,normalized_unit_name:'g',barcode:null},
 {line:3,canonical_name:'Producto nuevo',brand:null,category:'Otros',normalized_quantity:1,normalized_unit_name:'unidad',barcode:'0012345678905'},
 {line:4,canonical_name:'Otro',brand:null,category:'Otros',normalized_quantity:1,normalized_unit_name:'unidad',barcode:'12345670'},
 {line:5,canonical_name:'Otro 2',brand:null,category:'Otros',normalized_quantity:1,normalized_unit_name:'unidad',barcode:'12345670'}
 ];
 const result=analyzeCatalogImportRows(rows,catalog,[],()=>true);
 assert.equal(result.readyRows.length,1);assert.equal(result.variantCount,1);assert.equal(result.issues.length,3);
});
