// Comprobantes pequeños en Firestore (plan gratuito Spark).
// NO usa Cloud Storage ni introduce dependencias de facturación.
export const MAX_RECEIPT_BYTES = 3 * 1024 * 1024;
export const MAX_RECEIPTS_PER_PURCHASE = 5;
export const RECEIPT_PART_BYTES = 190 * 1024;
export const MAX_RECEIPT_PARTS = Math.ceil(MAX_RECEIPT_BYTES / RECEIPT_PART_BYTES);

const EXTENSIONS = Object.freeze({
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv'
});

function extensionOf(name) {
  return String(name || '').split('.').pop().toLowerCase();
}

export function receiptDisplayName(name) {
  const normalized = String(name || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/]/g, '-').trim();
  return normalized.length > 140 ? normalized.slice(0, 140) : normalized;
}

export function validateReceiptFile(name, bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const suffix = extensionOf(name);
  const mimeType = EXTENSIONS[suffix];
  if (!mimeType) throw new Error('Formato no permitido. Utiliza JPG, PNG, WEBP, PDF, Excel (.xls/.xlsx) o CSV.');
  if (!data.byteLength || data.byteLength > MAX_RECEIPT_BYTES) {
    throw new Error('El comprobante debe tener contenido y ocupar como máximo 3 MB.');
  }
  const match = (...prefix) => prefix.every((byte, i) => data[i] === byte);
  const ascii = (start, word) => [...word].every((char, index) => data[start + index] === char.charCodeAt(0));
  if ((suffix === 'jpg' || suffix === 'jpeg') && !match(0xFF, 0xD8, 0xFF)) throw new Error('La foto JPG no parece ser válida.');
  if (suffix === 'png' && !match(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)) throw new Error('La foto PNG no parece ser válida.');
  if (suffix === 'webp' && !(ascii(0, 'RIFF') && ascii(8, 'WEBP'))) throw new Error('La foto WEBP no parece ser válida.');
  if (suffix === 'pdf' && !ascii(0, '%PDF-')) throw new Error('El archivo PDF no tiene una cabecera válida.');
  if (suffix === 'xlsx' && !(match(0x50, 0x4B, 0x03, 0x04) || match(0x50, 0x4B, 0x05, 0x06))) throw new Error('El archivo Excel XLSX no tiene una cabecera válida.');
  if (suffix === 'xls' && !match(0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1)) throw new Error('El archivo Excel XLS no tiene una cabecera válida.');
  return { name: receiptDisplayName(name), mimeType, size: data.byteLength };
}

export function encodeReceiptParts(bytes, partBytes = RECEIPT_PART_BYTES) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!Number.isInteger(partBytes) || partBytes < 1 || partBytes > RECEIPT_PART_BYTES) {
    throw new Error('Tamaño de fragmento no permitido.');
  }
  const parts = [];
  for (let offset = 0; offset < data.length; offset += partBytes) {
    const chunk = data.subarray(offset, offset + partBytes);
    let binary = '';
    for (let start = 0; start < chunk.length; start += 8192) {
      binary += String.fromCharCode(...chunk.subarray(start, start + 8192));
    }
    parts.push(btoa(binary));
  }
  if (!parts.length || parts.length > MAX_RECEIPT_PARTS) throw new Error('El comprobante excede el límite de fragmentos permitidos.');
  return parts;
}

export function decodeReceiptParts(parts) {
  if (!Array.isArray(parts) || !parts.length || parts.length > MAX_RECEIPT_PARTS) throw new Error('El comprobante guardado está incompleto.');
  const chunks = parts.map(part => {
    if (typeof part !== 'string' || part.length > 300000) throw new Error('Se encontró un fragmento de factura inválido.');
    const raw = atob(part);
    const data = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) data[i] = raw.charCodeAt(i);
    return data;
  });
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (!total || total > MAX_RECEIPT_BYTES) throw new Error('El comprobante excede el límite permitido.');
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

export function canAttachToPurchase(workspace, purchaseId) {
  return Boolean(workspace?.purchases?.some(row => row && row.id === purchaseId));
}

export function receiptCategory(mimeType) {
  if (String(mimeType).startsWith('image/')) return 'Foto';
  if (mimeType === 'application/pdf') return 'PDF';
  return 'Excel';
}


/**
 * El mismo archivo dentro de la misma compra recibe siempre el mismo ID.
 * Dos dispositivos que suben simultáneamente un PDF idéntico intentarán
 * crear el mismo documento, y las reglas Firestore prohíben sobrescribirlo.
 * Distintas compras y archivos diferentes generan IDs distintos.
 */
export async function deterministicReceiptId(purchaseId, sha256) {
  if (typeof purchaseId !== 'string' || !purchaseId.trim() ||
      typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error('No se pudo identificar la factura para evitar duplicados.');
  }
  const input = new TextEncoder().encode(purchaseId + '\u0000' + sha256);
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', input));
  return 'receipt_' + [...hash].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Algunas compras anteriores pueden contener documentos duplicados por cargas
 * simultáneas. Los agrupamos al visualizar, pero JAMÁS los borramos sin
 * intervención explícita del propietario.
 */
export function groupDistinctReceipts(receipts = []) {
  const seen = new Set();
  const unique = [];
  const duplicates = [];
  for (const row of receipts) {
    const digest = String(row?.sha256 || '');
    const key = /^[a-f0-9]{64}$/.test(digest)
      ? String(row.purchaseId || '') + ':' + digest
      : 'legacy:' + String(row.id);
    if (seen.has(key)) duplicates.push(row);
    else { seen.add(key); unique.push(row); }
  }
  return { unique, duplicates };
}
