import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPurchasesCsv, normalizeProductBarcode, findProductByBarcode } from '../src/purchases.js';

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
