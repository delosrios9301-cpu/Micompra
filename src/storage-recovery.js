const RECOVERY_PREFIX = 'micompra_recovery_v1_';
const PERSONAL_KEYS = [
  'micompra_personal_catalog_v1',
  'micompra_guest_cart_v1',
  'micompra_saved_purchases_v1',
  'micompra_guest_pantry_v1',
  'micompra_settings_v1'
];

export function readStoredArraySafely(key, storage = globalThis.localStorage) {
  if (!storage) return [];
  let raw;
  try { raw = storage.getItem(key); } catch { return []; }
  if (raw === null) return [];
  try {
    const value = JSON.parse(raw);
    if (Array.isArray(value)) return value;
    throw new Error('El contenido no es una lista.');
  } catch {
    try {
      const recoveryKey = RECOVERY_PREFIX + key;
      if (storage.getItem(recoveryKey) === null) {
        storage.setItem(recoveryKey, JSON.stringify({
          key,
          raw,
          savedAt: new Date().toISOString()
        }));
      }
    } catch {}
    const status = globalThis.document?.querySelector('#workspace-sync-status')
      || globalThis.document?.querySelector('#connection small');
    if (status) status.textContent = 'Se detectó un dato local dañado. Se guardó una copia de recuperación; descarga un respaldo desde Configuración antes de continuar.';
    return [];
  }
}

export function readStoredObjectSafely(key, fallback = {}, storage = globalThis.localStorage) {
  if (!storage) return fallback;
  let raw;
  try { raw = storage.getItem(key); } catch { return fallback; }
  if (raw === null) return fallback;
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    throw new Error('El contenido no es un objeto.');
  } catch {
    try {
      const recoveryKey = RECOVERY_PREFIX + key;
      if (storage.getItem(recoveryKey) === null) {
        storage.setItem(recoveryKey, JSON.stringify({ key, raw, savedAt: new Date().toISOString() }));
      }
    } catch {}
    const status = globalThis.document?.querySelector('#workspace-sync-status')
      || globalThis.document?.querySelector('#connection small');
    if (status) status.textContent = 'Se detectó una preferencia local dañada. Se guardó una copia de recuperación; descarga un respaldo desde Configuración antes de continuar.';
    return fallback;
  }
}

export function collectLocalRecoveryCopies(storage = globalThis.localStorage) {
  if (!storage) return {};
  const copies = {};
  for (const key of PERSONAL_KEYS) {
    try {
      const raw = storage.getItem(RECOVERY_PREFIX + key);
      if (raw !== null) copies[key] = JSON.parse(raw);
    } catch {}
  }
  if (Object.keys(copies).length) {
    const status = globalThis.document?.querySelector('#workspace-sync-status')
      || globalThis.document?.querySelector('#connection small');
    if (status) status.textContent = 'Hay copias de recuperación de datos anteriores. Descarga un respaldo desde Configuración para conservarlas.';
  }
  return copies;
}

export function restoreLocalRecoveryCopies(copies, storage = globalThis.localStorage) {
  if (!storage || !copies || typeof copies !== 'object' || Array.isArray(copies)) return;
  for (const key of PERSONAL_KEYS) {
    const record = copies[key];
    if (!record || typeof record !== 'object' || typeof record.raw !== 'string') continue;
    try {
      storage.setItem(RECOVERY_PREFIX + key, JSON.stringify({
        key,
        raw: record.raw,
        savedAt: record.savedAt || new Date().toISOString()
      }));
    } catch {}
  }
}
