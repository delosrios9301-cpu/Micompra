import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePriceCsv } from '../src/price-import.js';

test('lee encabezados y filas CSV con BOM y CRLF', () => {
  const rows = parsePriceCsv('\uFEFFsupermercado,producto,precio\\r\\nSuper 99,Arroz,2.50\\r\\n');
  assert.deepEqual(rows, [{ supermercado: 'Super 99', producto: 'Arroz', precio: '2.50' }]);
});

test('respeta comas y comillas escapadas dentro de campos', () => {
  const rows = parsePriceCsv('producto,detalle\\n"Arroz, premium","Bolsa ""familiar"""');
  assert.equal(rows[0].producto, 'Arroz, premium');
  assert.equal(rows[0].detalle, 'Bolsa "familiar"');
});

test('omite líneas vacías y conserva campos vacíos', () => {
  const rows = parsePriceCsv('a,b\\nuno,\\n\\ndos,tres\\n');
  assert.deepEqual(rows, [{ a: 'uno', b: '' }, { a: 'dos', b: 'tres' }]);
});

test('rechaza archivos con comillas sin cerrar', () => {
  assert.throws(() => parsePriceCsv('producto,precio\\n"Arroz,2.50'), /Comillas sin cerrar/);
});

test('rechaza un archivo vacío', () => {
  assert.throws(() => parsePriceCsv('\\uFEFF  \\r\\n'), /vacío/);
});
