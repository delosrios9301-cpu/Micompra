const REQUIRED_COLLECTIONS = ['catalog', 'cart', 'purchases'];
const OPTIONAL_COLLECTIONS = ['pantry'];

export function validateBackupPayload(backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) {
    return { valid: false, message: 'El archivo no contiene una copia válida.' };
  }
  if (backup.format !== 'micompra-backup-v1') {
    return { valid: false, message: 'El formato de copia no es compatible con Mi Compra.' };
  }
  for (const key of REQUIRED_COLLECTIONS) {
    if (!Array.isArray(backup[key])) {
      return { valid: false, message: 'La copia está incompleta: falta la colección ' + key + '.' };
    }
  }
  for (const key of OPTIONAL_COLLECTIONS) {
    if (backup[key] !== undefined && !Array.isArray(backup[key])) {
      return { valid: false, message: 'La colección ' + key + ' tiene un formato inválido.' };
    }
  }
  for (const key of [...REQUIRED_COLLECTIONS, ...OPTIONAL_COLLECTIONS]) {
    if (!Array.isArray(backup[key])) continue;
    if (backup[key].some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
      return { valid: false, message: 'La colección ' + key + ' contiene registros inválidos.' };
    }
  }
  if (!backup.settings || typeof backup.settings !== 'object' || Array.isArray(backup.settings)) {
    return { valid: false, message: 'La copia no contiene preferencias válidas.' };
  }
  if (backup.customStores !== undefined &&
      (!Array.isArray(backup.customStores) || backup.customStores.some(value => typeof value !== 'string'))) {
    return { valid: false, message: 'La lista de supermercados personalizados tiene un formato inválido.' };
  }
  if (backup.recoveryCopies !== undefined &&
      (!backup.recoveryCopies || typeof backup.recoveryCopies !== 'object' || Array.isArray(backup.recoveryCopies))) {
    return { valid: false, message: 'Las copias de recuperación tienen un formato inválido.' };
  }
  return { valid: true, message: '' };
}

export function writeStorageEntriesAtomically(storage, entries) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new Error('El almacenamiento local no está disponible.');
  }
  const keys = Object.keys(entries || {});
  const previous = keys.map(key => storage.getItem(key));
  try {
    keys.forEach((key, index) => storage.setItem(key, String(entries[key])));
  } catch (error) {
    let rollbackFailed = false;
    keys.forEach((key, index) => {
      try {
        if (previous[index] === null) storage.removeItem(key);
        else storage.setItem(key, previous[index]);
      } catch {
        rollbackFailed = true;
      }
    });
    throw new Error(rollbackFailed
      ? 'No se pudo completar la restauración y el dispositivo tampoco pudo revertir todos los cambios. No cierres la aplicación; descarga o conserva una copia de los datos que aún estén disponibles.'
      : 'No hubo espacio suficiente para restaurar la copia. Los datos anteriores se conservaron.');
  }
  return { written: keys.length };
}
