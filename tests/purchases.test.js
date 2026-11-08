import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPurchasesCsv } from '../src/purchases.js';

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
