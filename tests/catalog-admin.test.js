import test from 'node:test';
import assert from 'node:assert/strict';
import { getProductRegistrationCheck, validateProductRegistrationDraft } from '../src/catalog-admin.js';

const catalog=[
 {id:'coffee-425',canonical_name:'Café molido tradicional',brand:null,normalized_quantity:'425',normalized_unit_name:'g',barcode:null},
 {id:'rice-1',canonical_name:'Arroz blanco',brand:'Marca A',normalized_quantity:'1',normalized_unit_name:'kg',barcode:'0012345678905'}
];

test('same name, brand and package is blocked as an exact duplicate',()=>{
 const result=getProductRegistrationCheck(catalog,{canonical_name:'Cafe molido tradicional',brand:'',normalized_quantity:425,normalized_unit_name:'gramos'});
 assert.equal(result.exactDuplicate.id,'coffee-425');
});

test('same product name with another package is treated as a variant',()=>{
 const result=getProductRegistrationCheck(catalog,{canonical_name:'Café molido tradicional',brand:'',normalized_quantity:500,normalized_unit_name:'g'});
 assert.equal(result.exactDuplicate,null);
 assert.equal(result.nameMatches.length,1);
});

test('brand is part of product identity',()=>{
 const result=getProductRegistrationCheck(catalog,{canonical_name:'Arroz blanco',brand:'Marca B',normalized_quantity:1,normalized_unit_name:'kg'});
 assert.equal(result.exactDuplicate,null);
 assert.equal(result.nameMatches.length,1);
});

test('primary and alternate barcodes are checked for duplicates',()=>{
 const primary=getProductRegistrationCheck(catalog,{canonical_name:'Producto nuevo',normalized_quantity:1,normalized_unit_name:'unidad',barcode:'00-12345678905'});
 assert.equal(primary.barcodeOwner.id,'rice-1');
 const alternate=getProductRegistrationCheck(catalog,{canonical_name:'Producto nuevo',normalized_quantity:1,normalized_unit_name:'unidad',barcode:'0987654321'},[{product_id:'coffee-425',barcode:'0987654321'}]);
 assert.equal(alternate.barcodeOwner.id,'coffee-425');
});

test('product registration requires name, category, positive quantity and unit',()=>{
 assert.equal(validateProductRegistrationDraft({canonical_name:'Arroz',category:'Granos',normalized_quantity:1,normalized_unit_name:'kg'}).valid,true);
 assert.equal(validateProductRegistrationDraft({canonical_name:'',category:'Granos',normalized_quantity:1,normalized_unit_name:'kg'}).valid,false);
 assert.equal(validateProductRegistrationDraft({canonical_name:'Arroz',category:'Granos',normalized_quantity:0,normalized_unit_name:'kg'}).valid,false);
 assert.equal(validateProductRegistrationDraft({canonical_name:'Arroz',category:'',normalized_quantity:1,normalized_unit_name:'kg'}).valid,false);
});
