import { createClient } from '@supabase/supabase-js';
import { createEmptyWorkspace, normalizeWorkspace, mergeWorkspaces } from './model.js';

const CLOUD_TABLE = 'personal_workspace';
const CLOUD_KEY = 'miCompraV2';
const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export function createWorkspaceStore({ onChange = () => {}, onStatus = () => {} } = {}) {
  const configured = Boolean(URL && KEY);
  const client = configured ? createClient(URL, KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  }) : null;
  let workspace = createEmptyWorkspace();
  let user = null;
  let status = configured ? 'Preparando conexión' : 'Solo en este dispositivo';
  let channel = null;
  let timer = null;
  let syncing = false;
  let pendingSync = false;
  let subscription = null;

  const localKey = id => 'mi-compra-v2:' + (id || 'guest');
  const readLocal = id => {
    try {
      const raw = localStorage.getItem(localKey(id));
      return raw ? normalizeWorkspace(JSON.parse(raw)) : createEmptyWorkspace();
    } catch {
      return createEmptyWorkspace();
    }
  };
  const writeLocal = () => {
    try { localStorage.setItem(localKey(user?.id), JSON.stringify(workspace)); }
    catch { setStatus('Almacenamiento del dispositivo lleno'); }
  };
  const setStatus = value => {
    status = value;
    onStatus(status);
  };
  const notify = () => onChange(workspace, user);

  function stopRealtime() {
    if (channel && client) client.removeChannel(channel);
    channel = null;
  }

  async function readCloud() {
    if (!client || !user) return null;
    const { data, error } = await client.from(CLOUD_TABLE)
      .select('data,updated_at')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) throw error;
    const root = data?.data && typeof data.data === 'object' && !Array.isArray(data.data) ? data.data : {};
    return { root, remote: root[CLOUD_KEY] ? normalizeWorkspace(root[CLOUD_KEY]) : null };
  }

  async function writeCloud(next) {
    if (!client || !user) return;
    const { data, error } = await client.from(CLOUD_TABLE)
      .select('data')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) throw error;
    const root = data?.data && typeof data.data === 'object' && !Array.isArray(data.data) ? data.data : {};
    const payload = {
      user_id: user.id,
      data: { ...root, [CLOUD_KEY]: next },
      updated_at: new Date().toISOString()
    };
    const result = await client.from(CLOUD_TABLE).upsert(payload, { onConflict: 'user_id' });
    if (result.error) throw result.error;
  }

  async function syncNow() {
    if (!client || !user) return;
    if (syncing) { pendingSync = true; return; }
    syncing = true;
    setStatus('Sincronizando');
    try {
      do {
        pendingSync = false;
        const localSnapshot = normalizeWorkspace(workspace);
        const { root, remote } = await readCloud();
        const merged = remote ? mergeWorkspaces(localSnapshot, remote) : localSnapshot;
        const localChanged = JSON.stringify(merged) !== JSON.stringify(workspace);
        workspace = merged;
        writeLocal();
        if (localChanged) notify();
        if (!remote || JSON.stringify(remote) !== JSON.stringify(merged)) {
          await writeCloud(merged);
        }
      } while (pendingSync);
      setStatus('Sincronizado');
    } catch (error) {
      setStatus('Sincronización pendiente');
      console.warn('Mi Compra 2.0 cloud sync:', error?.message || error);
    } finally {
      syncing = false;
    }
  }

  function scheduleSync() {
    if (!client || !user) return;
    clearTimeout(timer);
    timer = setTimeout(() => { void syncNow(); }, 650);
  }

  function startRealtime() {
    stopRealtime();
    if (!client || !user) return;
    channel = client.channel('mi-compra-v2-' + user.id)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: CLOUD_TABLE,
        filter: 'user_id=eq.' + user.id
      }, payload => {
        const root = payload.new?.data;
        const remote = root && typeof root === 'object' ? root[CLOUD_KEY] : null;
        if (!remote) return;
        const merged = mergeWorkspaces(workspace, remote);
        const changed = JSON.stringify(merged) !== JSON.stringify(workspace);
        if (changed) {
          workspace = merged;
          writeLocal();
          notify();
          scheduleSync();
        }
      })
      .subscribe();
  }

  async function activateUser(nextUser) {
    const nextId = nextUser?.id || null;
    if ((user?.id || null) === nextId) return;
    stopRealtime();
    user = nextUser || null;
    workspace = readLocal(user?.id);
    writeLocal();
    notify();
    if (user && client) {
      await syncNow();
      startRealtime();
    } else {
      setStatus(configured ? 'Cuenta desconectada · datos guardados localmente' : 'Solo en este dispositivo');
    }
  }

  async function initialize() {
    if (client) {
      const { data, error } = await client.auth.getSession();
      if (!error && data?.session?.user) await activateUser(data.session.user);
      else {
        workspace = readLocal(null);
        setStatus('Inicia sesión para sincronizar');
      }
      subscription = client.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') {
          void activateUser(null);
        } else if (session?.user && session.user.id !== user?.id) {
          void activateUser(session.user);
        }
      }).data.subscription;
    } else {
      workspace = readLocal(null);
      setStatus('Solo en este dispositivo');
    }
    writeLocal();
    notify();
    return { workspace, user, configured };
  }

  async function resetWorkspace() {
    clearTimeout(timer);
    pendingSync = false;
    while (syncing) await new Promise(resolve => setTimeout(resolve, 40));
    stopRealtime();
    const empty = createEmptyWorkspace();
    try {
      // Write the empty workspace directly: merging here would resurrect deleted records.
      if (client && user) await writeCloud(empty);
      workspace = empty;
      writeLocal();
      notify();
      setStatus(user && client ? 'Sincronizado' : configured ? 'Inicia sesión para sincronizar' : 'Solo en este dispositivo');
    } finally {
      if (client && user) startRealtime();
    }
  }

  function save(next) {
    workspace = normalizeWorkspace(next);
    writeLocal();
    notify();
    scheduleSync();
  }

  async function signIn(email, password) {
    if (!client) throw new Error('La conexión en la nube no está configurada.');
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await activateUser(data.user);
    startRealtime();
    return data.user;
  }

  async function signUp(email, password) {
    if (!client) throw new Error('La conexión en la nube no está configurada.');
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) throw error;
    if (data.user && data.session) await activateUser(data.user);
    return data;
  }

  async function signOut() {
    if (client) {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    }
    await activateUser(null);
  }

  async function resetPassword(email) {
    if (!client) throw new Error('La conexión en la nube no está configurada.');
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname
    });
    if (error) throw error;
  }

  function dispose() {
    clearTimeout(timer);
    stopRealtime();
    subscription?.unsubscribe?.();
  }

  return {
    initialize, save, signIn, signUp, signOut, resetPassword, resetWorkspace, dispose,
    getState: () => workspace,
    getUser: () => user,
    getStatus: () => status,
    isConfigured: configured
  };
}
