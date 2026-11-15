import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  validateReceiptFile, encodeReceiptParts, decodeReceiptParts, receiptCategory,
  canAttachToPurchase, MAX_RECEIPT_BYTES, MAX_RECEIPTS_PER_PURCHASE,
  MAX_RECEIPT_PARTS
} from './receipts.js';

const pdfBytes = new TextEncoder().encode('%PDF-1.6\nDocumento de prueba seguro');
test('codifica y reconstruye facturas, fotos y Excel sin perder bytes', () => {
  assert.equal(validateReceiptFile('Facturas/recibo.PDF', pdfBytes).mimeType, 'application/pdf');
  const pieces = encodeReceiptParts(pdfBytes, 10);
  assert.deepEqual(decodeReceiptParts(pieces), pdfBytes);
  const png = Uint8Array.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0x01]);
  assert.equal(validateReceiptFile('factura.png',png).mimeType,'image/png');
  const xlsx = Uint8Array.from([0x50,0x4B,0x03,0x04,0,0,0]);
  assert.equal(validateReceiptFile('factura.xlsx',xlsx).mimeType,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(receiptCategory('image/jpeg'),'Foto');
  assert.equal(receiptCategory('application/pdf'),'PDF');
  assert.equal(receiptCategory('application/vnd.ms-excel'),'Excel');
});

test('impide adjuntar nombres falsos y archivos gigantes', () => {
  assert.throws(()=>validateReceiptFile('reporte.exe',pdfBytes),/Formato no permitido/);
  assert.throws(()=>validateReceiptFile('reporte.jpg',pdfBytes),/JPG/);
  assert.throws(()=>validateReceiptFile('reporte.xlsx',pdfBytes),/XLSX/);
  assert.throws(()=>validateReceiptFile('reporte.pdf',new Uint8Array(MAX_RECEIPT_BYTES+1)),/3 MB/);
  assert.throws(()=>validateReceiptFile('vacío.pdf',new Uint8Array()),/3 MB/);
});

test('codifica archivos cercanos al máximo usando fragmentos inferiores a un documento Firestore', () => {
  const data=new Uint8Array(MAX_RECEIPT_BYTES);
  data.fill(0x63);
  const parts=encodeReceiptParts(data);
  assert.ok(parts.length>10 && parts.length<=MAX_RECEIPT_PARTS);
  assert.ok(parts.every(part=>part.length<=270000));
  assert.deepEqual(decodeReceiptParts(parts),data);
});

test('no acepta partes incompletas o datos en formatos no previstos', () => {
  assert.throws(()=>decodeReceiptParts([]),/incompleto/);
  assert.throws(()=>decodeReceiptParts(['A'.repeat(300001)]),/inválido/);
  assert.equal(MAX_RECEIPTS_PER_PURCHASE,5);
  assert.equal(canAttachToPurchase({purchases:[{id:'buy-one'}]},'buy-one'),true);
  assert.equal(canAttachToPurchase({purchases:[{id:'buy-one'}]},'buy-another'),false);
});

test('la UI y el almacén vinculan recibos a la compra finalizada sin modificar totales', async () => {
  const app=await readFile(new URL('./app.js',import.meta.url),'utf8');
  const store=await readFile(new URL('./store.js',import.meta.url),'utf8');
  assert.match(app,/Facturas y comprobantes/);
  assert.match(app,/purchase-receipt-camera/);
  assert.match(app,/purchase-receipt-file/);
  assert.match(app,/data-action="open-purchase-receipt"/);
  assert.match(app,/data-action="delete-purchase-receipt"/);
  assert.match(store,/writeBatch\(db\)/);
  assert.match(store,/canAttachToPurchase\(purchaseSnapshot\.data\(\)\?\.workspace, purchaseId\)/);
  assert.match(store,/receiptFiles/);
  assert.match(store,/MAX_RECEIPTS_PER_PURCHASE/);
  assert.match(store,/crypto\.subtle\.digest\('SHA-256'/);
});
