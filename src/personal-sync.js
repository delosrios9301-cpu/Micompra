export const PERSONAL_WORKSPACE_KEYS = {
  catalog: 'micompra_personal_catalog_v1',
  cart: 'micompra_guest_cart_v1',
  purchases: 'micompra_saved_purchases_v1',
  pantry: 'micompra_guest_pantry_v1',
  settings: 'micompra_settings_v1'
};

const BASELINE_KEY = 'micompra_workspace_baseline_v1';
const COLLECTIONS = ['catalog', 'cart', 'purchases', 'pantry'];
const emptyWorkspace = () => ({ version: 1, catalog: [], cart: [], purchases: [], pantry: [], settings: {} });

function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

export function hashWorkspaceRecord(value) {
  const source = stableStringify(value);
  let first = 0x811c9dc5, second = 0x9e3779b9;
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return (first >>> 0).toString(36) + (second >>> 0).toString(36);
}

function conflictId(id, record) {
  return String(id) + '-conflict-' + hashWorkspaceRecord(record);
}

export function mergeWorkspaceCollection(localRows = [], remoteRows = [], previousHashes = {}) {
  const local = new Map((localRows || []).map(row => [String(row.id), row]));
  const remote = new Map((remoteRows || []).map(row => [String(row.id), row]));
  const ids = [...new Set([...local.keys(), ...remote.keys(), ...Object.keys(previousHashes || {})])];
  const merged = [], conflicts = [];
  for (const id of ids) {
    const left = local.get(id), right = remote.get(id), previous = previousHashes?.[id];
    if (!previous) {
      if (left && right && hashWorkspaceRecord(left) !== hashWorkspaceRecord(right)) {
        merged.push(left);
        const copy = { ...right, id: conflictId(id, right), syncConflictOf: id };
        merged.push(copy);
        conflicts.push({ id, copyId: copy.id });
      } else if (left || right) merged.push(left || right);
      continue;
    }
    const leftChanged = left ? hashWorkspaceRecord(left) !== previous : true;
    const rightChanged = right ? hashWorkspaceRecord(right) !== previous : true;
    if (left && right) {
      if (leftChanged && rightChanged && hashWorkspaceRecord(left) !== hashWorkspaceRecord(right)) {
        merged.push(left);
        const copy = { ...right, id: conflictId(id, right), syncConflictOf: id };
        merged.push(copy);
        conflicts.push({ id, copyId: copy.id });
      } else merged.push(leftChanged ? left : rightChanged ? right : left);
    } else if (left) {
      // A remote deletion wins only when this device did not edit the record.
      if (right === undefined && leftChanged) merged.push(left);
    } else if (right) {
      // A local deletion wins only when the remote copy was not edited.
      if (rightChanged) merged.push(right);
    }
  }
  return { items: merged, conflicts };
}

function readJson(storage, key, fallback) {
  const raw = storage.getItem(key);
  if (raw === null) return fallback;
  try { return JSON.parse(raw); }
  catch { throw new Error('No se pudo leer ' + key + '. No se modificó ningún dato.'); }
}

function readLocalWorkspace(storage) {
  const workspace = emptyWorkspace();
  for (const collection of COLLECTIONS) {
    const rows = readJson(storage, PERSONAL_WORKSPACE_KEYS[collection], []);
    if (!Array.isArray(rows)) throw new Error('El contenido local de ' + collection + ' no tiene el formato esperado. No se modificó ningún dato.');
    workspace[collection] = rows.map((row, index) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Hay un registro inválido en ' + collection + '. No se modificó ningún dato.');
      return row.id === undefined || row.id === null || row.id === ''
        ? { ...row, id: collection + '-legacy-' + index }
        : row;
    });
  }
  const settings = readJson(storage, PERSONAL_WORKSPACE_KEYS.settings, {});
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Las preferencias locales no tienen el formato esperado. No se modificó ningún dato.');
  workspace.settings = settings;
  return workspace;
}

function normalizeRemoteWorkspace(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return emptyWorkspace();
  if (data.version !== undefined && data.version !== 1) throw new Error('La versión de los datos en la nube no es compatible. No se modificó ningún dato.');
  const result = emptyWorkspace();
  for (const collection of COLLECTIONS) {
    if (data[collection] !== undefined && !Array.isArray(data[collection])) throw new Error('La colección ' + collection + ' en la nube no es válida. No se modificó ningún dato.');
    result[collection] = (data[collection] || []).filter(row => row && typeof row === 'object' && !Array.isArray(row) && row.id !== undefined).map(row => row);
  }
  result.settings = data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings) ? data.settings : {};
  return result;
}

function readBaseline(storage) {
  const value = readJson(storage, BASELINE_KEY, {});
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function createBaseline(workspace) {
  const result = { version: 1, settings: hashWorkspaceRecord(workspace.settings || {}) };
  for (const collection of COLLECTIONS) {
    result[collection] = Object.fromEntries((workspace[collection] || []).map(row => [String(row.id), hashWorkspaceRecord(row)]));
  }
  return result;
}

function mergeSettings(local, remote, previousHash) {
  const localHash = hashWorkspaceRecord(local || {}), remoteHash = hashWorkspaceRecord(remote || {});
  if (!previousHash) return Object.keys(local || {}).length ? local : remote || {};
  const localChanged = localHash !== previousHash, remoteChanged = remoteHash !== previousHash;
  if (localChanged && !remoteChanged) return local || {};
  if (remoteChanged && !localChanged) return remote || {};
  return localChanged ? (local || {}) : (remote || {});
}

function writeLocalWorkspace(storage, workspace) {
  const keys = COLLECTIONS.map(collection => PERSONAL_WORKSPACE_KEYS[collection]).concat(PERSONAL_WORKSPACE_KEYS.settings);
  const values = COLLECTIONS.map(collection => JSON.stringify(workspace[collection])).concat(JSON.stringify(workspace.settings || {}));
  const previous = keys.map(key => storage.getItem(key));
  try {
    keys.forEach((key, index) => storage.setItem(key, values[index]));
  } catch (error) {
    keys.forEach((key, index) => {
      try {
        if (previous[index] === null) storage.removeItem(key);
        else storage.setItem(key, previous[index]);
      } catch {}
    });
    throw new Error('El dispositivo no tuvo espacio para aplicar la sincronización. Los datos locales anteriores se conservaron.');
  }
}

export async function syncPersonalWorkspace({ supabase, user, storage = globalThis.localStorage }) {
  if (!supabase || !user?.id || !storage) return { ok: false, message: 'Inicia sesión para sincronizar.' };
  let local;
  try { local = readLocalWorkspace(storage); }
  catch (error) { return { ok: false, message: error.message }; }
  let baseline;
  try { baseline = readBaseline(storage); }
  catch { baseline = {}; }
  const { data: cloudRow, error: readError } = await supabase
    .from('personal_workspace').select('data,updated_at').eq('user_id', user.id).maybeSingle();
  if (readError) return { ok: false, message: 'No se pudieron consultar los datos de la nube: ' + readError.message };
  let remote;
  try { remote = normalizeRemoteWorkspace(cloudRow?.data); }
  catch (error) { return { ok: false, message: error.message }; }
  const merged = emptyWorkspace();
  let conflicts = [];
  for (const collection of COLLECTIONS) {
    const result = mergeWorkspaceCollection(local[collection], remote[collection], baseline[collection] || {});
    merged[collection] = result.items;
    conflicts = conflicts.concat(result.conflicts.map(conflict => ({ ...conflict, collection })));
  }
  merged.settings = mergeSettings(local.settings, remote.settings, baseline.settings);
  const remotePayload = stableStringify(remote);
  const mergedPayload = stableStringify(merged);
  if (!cloudRow || remotePayload !== mergedPayload) {
    const { error: writeError } = await supabase.from('personal_workspace').upsert({
      user_id: user.id,
      data: merged,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (writeError) return { ok: false, message: 'No se pudo guardar la sincronización: ' + writeError.message };
  }
  try {
    writeLocalWorkspace(storage, merged);
    storage.setItem(BASELINE_KEY, JSON.stringify(createBaseline(merged)));
  } catch (error) {
    return { ok: false, message: error.message || 'No se pudo actualizar el almacenamiento local.' };
  }
  return { ok: true, conflicts: conflicts.length, updatedAt: cloudRow?.updated_at || new Date().toISOString(), workspace: merged };
}

export async function startPersonalWorkspaceSync({ supabase, user, onStatus = () => {} }) {
  if (!supabase || !user?.id || typeof window === 'undefined') return () => {};
  let stopped = false, running = false, pending = false, timer = null;
  const run = async () => {
    if (stopped) return;
    if (running) { pending = true; return; }
    running = true;
    do {
      pending = false;
      onStatus('Sincronizando tus datos…');
      const result = await syncPersonalWorkspace({ supabase, user });
      if (!result.ok) onStatus(result.message);
      else {
        onStatus(result.conflicts
          ? 'Sincronizado. Se conservaron ' + result.conflicts + ' cambio(s) simultáneo(s) como copias para evitar pérdidas.'
          : 'Sincronizado con tu cuenta. Tus datos están disponibles en tus otros dispositivos.');
        window.dispatchEvent(new CustomEvent('micompra:workspace-synced', { detail: { conflicts: result.conflicts } }));
      }
    } while (pending && !stopped);
    running = false;
  };
  const schedule = delay => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, delay);
  };
  const localChangeHandler = () => schedule(450);
  window.addEventListener('micompra:local-data-changed', localChangeHandler);
  const channel = supabase.channel('micompra-workspace-' + user.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'personal_workspace', filter: 'user_id=eq.' + user.id }, () => schedule(100))
    .subscribe((status, error) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onStatus('Datos guardados; la actualización instantánea no está disponible. Se sincronizarán al volver a abrir la app.' + (error?.message ? ' ' + error.message : ''));
    });
  await run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    window.removeEventListener('micompra:local-data-changed', localChangeHandler);
    supabase.removeChannel(channel);
  };
}
