import { createEmptyWorkspace, normalizeSharedDraft, normalizeWorkspace } from './model.js';

const COLLECTIONS = Object.keys(createEmptyWorkspace()).filter(key => Array.isArray(createEmptyWorkspace()[key]));
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validateWorkspaceBackup(backup, expectedWorkspaceId = '') {
  if (!isObject(backup) || backup.app !== 'Mi Compra 2.0' || backup.version !== 2 || !isObject(backup.workspace)) {
    throw new Error('El archivo no es un respaldo válido de Mi Compra 2.0.');
  }
  if (backup.workspaceId !== undefined && typeof backup.workspaceId !== 'string') {
    throw new Error('El identificador del espacio en el respaldo no es válido.');
  }
  if (backup.workspaceId && expectedWorkspaceId && backup.workspaceId !== expectedWorkspaceId) {
    throw new Error('Esta copia pertenece a otro espacio de compras y no puede importarse aquí.');
  }
  if (!isObject(backup.workspace.profile) || !isObject(backup.workspace.deletedRecords)) {
    throw new Error('La copia está incompleta: faltan las preferencias o el historial de eliminaciones.');
  }
  for (const group of COLLECTIONS) {
    const rows = backup.workspace[group];
    if (!Array.isArray(rows) || rows.some(row => !isObject(row) || !row.id || typeof row.id !== 'string')) {
      throw new Error('La copia contiene registros inválidos o incompletos en ' + group + '.');
    }
  }
  for (const list of backup.workspace.lists) {
    if (!Array.isArray(list.items) || list.items.some(item => !isObject(item) || typeof item.id !== 'string' || !item.id)) {
      throw new Error('La copia incluye una lista con productos incompletos.');
    }
  }
  if (backup.activePurchaseDraft !== undefined) {
    if (!isObject(backup.activePurchaseDraft) || !Array.isArray(backup.activePurchaseDraft.items)) {
      throw new Error('La copia contiene un borrador de compra inválido.');
    }
    if (backup.activePurchaseDraft.items.some(item => !isObject(item) || typeof item.id !== 'string' || !item.id)) {
      throw new Error('La copia contiene productos inválidos en el borrador compartido.');
    }
  }
  return true;
}

export function createWorkspaceBackup({ workspace, activePurchaseDraft, workspaceId, exportedAt = new Date().toISOString() }) {
  const payload = {
    app: 'Mi Compra 2.0',
    version: 2,
    exportedAt,
    workspaceId: String(workspaceId || ''),
    workspace: normalizeWorkspace(workspace),
    activePurchaseDraft: normalizeSharedDraft(activePurchaseDraft)
  };
  validateWorkspaceBackup(payload);
  return payload;
}

/**
 * Una compra que ya fue cerrada desde otro dispositivo nunca debe reaparecer
 * por restaurar una copia antigua: solo recuperamos un borrador si la copia
 * es estrictamente más reciente que el estado vacío que existe en Firebase.
 */
export function shouldRecoverBackupDraft(backupDraft, currentDraft) {
  const backup = normalizeSharedDraft(backupDraft);
  const current = normalizeSharedDraft(currentDraft);
  if (!backup.id || !backup.items.length || current.items.length || current.id) return false;
  const backupTime = Date.parse(backup.updatedAt);
  const currentTime = Date.parse(current.updatedAt);
  return Number.isFinite(backupTime) && backupTime > (Number.isFinite(currentTime) ? currentTime : 0);
}

export function backupSummary(backup) {
  validateWorkspaceBackup(backup);
  const space = backup.workspace;
  return {
    products: space.products.length,
    lists: space.lists.length,
    purchases: space.purchases.length,
    draftItems: backup.activePurchaseDraft?.items.length || 0
  };
}
