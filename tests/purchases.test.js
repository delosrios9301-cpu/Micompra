import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPurchasesCsv, normalizeProductBarcode, findProductByBarcode, isValidBarcodeChecksum, getBarcodePackageVariants, getBarcodeAssociationStatus, getCatalogDuplicateGroups } from '../src/purchases.js';

test('CSV includes UTF-8 BOM and Spanish headers', () => {
  const csv = buildPurchasesCsv([]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /"Fecha","Supermercado","Sucursal"/);
});

test('CSV exports every purchased item and calculated total', () => {
  const csv = buildPurchasesCsv([{
    purchase_date: '2026-11-07',
    supermarkets: { name: 'Super 99' },
    supermarket_branches: { name: 'San Francisco' },
    receipt_reference: 'F-123',
    notes: 'Compra semanal',
    purchase_items: [
      { item_name: 'Arroz', package_description: '5 lb', quantity: 2, unit: 'bolsa', unit_price: 3.5, line_total: 7 },
      { item_name: 'Leche', package_description: '1 L', quantity: 1, unit: 'unidad', unit_price: 1.75, line_total: 1.75 }
    ]
  }]);
  assert.match(csv, /"Arroz","5 lb","2","bolsa","3.5","7"/);
  assert.match(csv, /"Leche","1 L","1","unidad","1.75","1.75"/);
  assert.match(csv, /"F-123"/);
});

test('CSV neutralizes spreadsheet formulas in user text', () => {
  const csv = buildPurchasesCsv([{
    purchase_date: '2026-11-07',
    supermarkets: { name: 'Xtra' },
    purchase_items: [{ item_name: '=HYPERLINK("https://example.com")', quantity: 1, unit: 'unidad', unit_price: 1, line_total: 1 }]
  }]);
  assert.ok(csv.includes("\"'=HYPERLINK(\"\"https://example.com\"\")\""));
});

test('CSV retains a purchase with no item rows', () => {
  const csv = buildPurchasesCsv([{
    purchase_date: '2026-11-07',
    supermarkets: { name: 'El Rey' },
    notes: 'Factura pendiente',
    purchase_items: []
  }]);
  assert.match(csv, /"El Rey"/);
  assert.match(csv, /"Factura pendiente"/);
});

test('CSV neutralizes formulas preceded by whitespace', () => {
  const csv = buildPurchasesCsv([{
    purchase_date: '2026-11-07',
    supermarkets: { name: 'Xtra' },
    purchase_items: [{ item_name: '  =1+1', quantity: 1, unit: 'unidad', unit_price: 1, line_total: 1 }]
  }]);
  assert.match(csv, /"'  =1\+1"/);
});

test('Empty purchase rows have the same number of columns as the header', () => {
  const csv = buildPurchasesCsv([{ purchase_date: '2026-11-07', supermarkets: { name: 'El Rey' }, notes: 'Sin detalle', purchase_items: [] }]);
  const lines = csv.replace(/^\uFEFF/, '').split('\r\n');
  assert.equal(lines[0].split(',').length, lines[1].split(',').length);
});

test('barcode normalization preserves leading zeros and removes spaces or hyphens', () => {
  assert.equal(normalizeProductBarcode(' 0 123-456 789 '), '0123456789');
  assert.equal(normalizeProductBarcode(' ab-cd 123 '), 'ABCD123');
});

test('barcode lookup requires an exact normalized match', () => {
  const products = [
    { id: 'rice', canonical_name: 'Arroz', barcode: '0012345678905' },
    { id: 'milk', canonical_name: 'Leche', barcode: '7501234567890' }
  ];
  assert.equal(findProductByBarcode(products, '0012345678905')?.id, 'rice');
  assert.equal(findProductByBarcode(products, ' 001234 5678905 ')?.id, 'rice');
  assert.equal(findProductByBarcode(products, '001234567890') , null);
  assert.equal(findProductByBarcode(products, '') , null);
});

test('barcode lookup resolves alternate codes to the linked catalog product', () => {
  const products = [
    { id: 'rice', canonical_name: 'Arroz', barcode: null },
    { id: 'milk', canonical_name: 'Leche', barcode: '7501234567890' }
  ];
  const mappings = [
    { product_id: 'rice', barcode: ' 0-987-654-321 ' }
  ];
  assert.equal(findProductByBarcode(products, '0987654321', mappings)?.id, 'rice');
  assert.equal(findProductByBarcode(products, '7501234567890', mappings)?.id, 'milk');
  assert.equal(findProductByBarcode(products, '098765432', mappings), null);
});

test('barcode check digits validate EAN-13, EAN-8 and UPC-A', () => {
  assert.equal(isValidBarcodeChecksum('4006381333931', 'ean_13'), true);
  assert.equal(isValidBarcodeChecksum('4006381333932', 'ean_13'), false);
  assert.equal(isValidBarcodeChecksum('96385074', 'ean_8'), true);
  assert.equal(isValidBarcodeChecksum('96385075', 'ean_8'), false);
  assert.equal(isValidBarcodeChecksum('036000291452', 'upc_a'), true);
  assert.equal(isValidBarcodeChecksum('036000291453', 'upc_a'), false);
});

test('UPC-E check digit validates against its expanded UPC-A value', () => {
  assert.equal(isValidBarcodeChecksum('04252614', 'upc_e'), true);
  assert.equal(isValidBarcodeChecksum('04252615', 'upc_e'), false);
  assert.equal(isValidBarcodeChecksum('14252614', 'upc_e'), false);
});

test('non-numeric barcode formats are not forced through UPC/EAN checksum rules', () => {
  assert.equal(isValidBarcodeChecksum('ABC123XYZ', 'code_128'), true);
  assert.equal(isValidBarcodeChecksum('AB-CD 123', 'code_39'), true);
});

test('barcode associations detect duplicate codes across products and normalize formatting', () => {
  const products = [
    { id: 'rice-1', canonical_name: 'Arroz blanco', normalized_quantity: '1', normalized_unit_name: 'kg', barcode: null },
    { id: 'rice-5', canonical_name: 'Arroz blanco', normalized_quantity: '5', normalized_unit_name: 'kg', barcode: null }
  ];
  const mappings = [{ id: 1, product_id: 'rice-5', barcode: '012345678905' }];
  assert.equal(getBarcodeAssociationStatus(products, mappings, 'rice-1', '012-345 678905').status, 'assigned_to_other_product');
  assert.equal(getBarcodeAssociationStatus(products, mappings, 'rice-5', '012345678905').status, 'already_on_selected_product');
  assert.equal(getBarcodeAssociationStatus(products, mappings, 'rice-1', '098765432109').status, 'available');
});

test('barcode package variants identify same catalog product with different presentations', () => {
  const products = [
    { id: 'coffee-250', canonical_name: 'Café molido', normalized_quantity: '250', normalized_unit_name: 'g' },
    { id: 'coffee-500', canonical_name: 'Café molido', normalized_quantity: '500', normalized_unit_name: 'g' },
    { id: 'tea', canonical_name: 'Té negro', normalized_quantity: '36', normalized_unit_name: 'g' }
  ];
  assert.deepEqual(getBarcodePackageVariants(products, 'coffee-250').map(item => item.id), ['coffee-500']);
  assert.deepEqual(getBarcodePackageVariants(products, 'tea'), []);
});


test('catalog audit separates exact duplicates from valid package variants', () => {
  const products = [
    { id: 'rice-a', canonical_name: 'Arroz Blanco', normalized_quantity: 1, normalized_unit_name: 'kg' },
    { id: 'rice-b', canonical_name: 'arroz blanco', normalized_quantity: '1.0', normalized_unit_name: 'kg' },
    { id: 'coffee-250', canonical_name: 'Café molido', normalized_quantity: 250, normalized_unit_name: 'g' },
    { id: 'coffee-500', canonical_name: 'Cafe molido', normalized_quantity: 500, normalized_unit_name: 'gramos' },
    { id: 'tea', canonical_name: 'Té negro', normalized_quantity: 36, normalized_unit_name: 'g' }
  ];
  const result = getCatalogDuplicateGroups(products);
  assert.equal(result.exactDuplicates.length, 1);
  assert.deepEqual(result.exactDuplicates[0].products.map(item => item.id), ['rice-a', 'rice-b']);
  assert.equal(result.presentationVariants.length, 1);
  assert.deepEqual(result.presentationVariants[0].products.map(item => item.id), ['coffee-250', 'coffee-500']);
});
