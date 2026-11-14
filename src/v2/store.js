import {
  getAuth, onAuthStateChanged, setPersistence, indexedDBLocalPersistence, inMemoryPersistence,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut as firebaseSignOut,
  deleteUser, sendPasswordResetEmail
} from 'firebase/auth';
import {
  doc, getDoc, getDocs, setDoc, deleteDoc, onSnapshot, serverTimestamp, runTransaction, collection, query, where, writeBatch
} from 'firebase/firestore';
import { app, db, memberAuth } from './firebase.js';
import { createEmptyWorkspace, normalizeWorkspace, mergeWorkspaces, WORKSPACE_COLLECTIONS } from './model.js';

// Supabase is retained only as a one-time legacy data importer. All new reads/writes
// and authentication use Firebase. Remove the legacy importer after every account migrates.
const LEGACY_URL = import.meta.env.VITE_SUPABASE_URL;
const LEGACY_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const auth = getAuth(app);
const COLLECTION = 'userWorkspaces';
const PRIMARY_OWNER_EMAIL = 'delosrios9301@gmail.com';
const CLIENT_COMPAT_VERSION = '2.1.0-compat';
const CLIENT_DEVICE_KEY = 'mi-compra-client-device-id';

function getClientDeviceId() {
  try {
    let id = localStorage.getItem(CLIENT_DEVICE_KEY);
    if (!id) {
      id = globalThis.crypto?.randomUUID?.() || ('device_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2));
      localStorage.setItem(CLIENT_DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'session_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
  }
}

function timestampToIso(value) {
  if (value?.toDate) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return value ? String(value) : '';
}

export function createWorkspaceStore({ onChange = () => {}, onStatus = () => {} } = {}) {
  let workspace = createEmptyWorkspace();
  let user = null;
  let status = 'Conectando con Firebase';
  let configured = true;
  let unsubscribeWorkspace = null;
  let unsubscribeAuth = null;
  let timer = null;
  let syncing = false;
  let dirty = false;
  let localRevision = 0;
  let sessionRevision = 0;
  const writerId = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  const pendingWrites = new Map();
  let syncFailures = 0;
  let disposed = false;
  const retryOnReconnect = () => { if (user && dirty && !disposed) { syncFailures = 0; scheduleSync(); } };
  let unsubscribeAccess = null;
  let unsubscribeRevoked = null;
  let pendingCredentials = null;
  let authBusy = false;
  let initialized = false;
  let workspaceId = null;
  let workspaceOwnerUid = null;

  const setStatus = value => { status = value; onStatus(status); };
  const notify = () => onChange(workspace, user);
  const workspaceRef = uid => doc(db, COLLECTION, uid);

  function pendingPrefix() {
    return 'mi-compra-pending:' + user.uid + ':' + workspaceId + ':';
  }

  function persistPending() {
    const key = pendingPrefix() + writerId;
    const serialized = JSON.stringify(workspace);
    try {
      localStorage.setItem(key, serialized);
      pendingWrites.set(key, serialized);
      return true;
    } catch {
      return false;
    }
  }

  function recoverPending() {
    try {
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith(pendingPrefix())) continue;
        const serialized = localStorage.getItem(key);
        if (!serialized) continue;
        try {
          const saved = JSON.parse(serialized);
          if (saved?.version !== workspace.version) continue;
          workspace = dirty ? mergeWorkspaces(workspace, saved) : normalizeWorkspace(saved);
          pendingWrites.set(key, serialized);
          dirty = true;
        } catch (error) {
          console.warn('No se pudo recuperar un guardado pendiente:', error);
        }
      }
    } catch (error) {
      console.warn('Almacenamiento local no disponible:', error);
    }
  }

  function clearPending(writes = pendingWrites) {
    for (const [key, serialized] of writes) {
      try {
        if (localStorage.getItem(key) === serialized) localStorage.removeItem(key);
        if (pendingWrites.get(key) === serialized) pendingWrites.delete(key);
      } catch (error) {
        console.warn('No se pudo limpiar un guardado confirmado:', error);
      }
    }
  }

  async function migrateLegacyWorkspace(firebaseUser, credentials) {
    if (!LEGACY_URL || !LEGACY_KEY || !credentials?.email || !credentials?.password) return false;
    let legacyClient = null;
    const target = workspaceRef(firebaseUser.uid);
    const canImport = snapshot => {
      const data = snapshot.data();
      if (data?.migratedFrom || data?.resetAt || (data?.ownerUid && data.ownerUid !== firebaseUser.uid)) return false;
      if (!data?.workspace) return true;
      return stableJson(normalizeWorkspace(data.workspace)) === stableJson(createEmptyWorkspace());
    };

    try {
      if (!canImport(await getDoc(target))) return false;
      const { createClient } = await import('@supabase/supabase-js');
      legacyClient = createClient(LEGACY_URL, LEGACY_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      const { data: authData, error: authError } = await legacyClient.auth.signInWithPassword({
        email: credentials.email, password: credentials.password
      });
      if (authError || !authData?.user) return false;
      const { data, error } = await legacyClient.from('personal_workspace')
        .select('data').eq('user_id', authData.user.id).maybeSingle();
      if (error) throw error;
      const oldRoot = data?.data && typeof data.data === 'object' ? data.data : {};
      const oldWorkspace = oldRoot.miCompraV2;
      if (!oldWorkspace || typeof oldWorkspace !== 'object') return false;
      return await runTransaction(db, async transaction => {
        if (!canImport(await transaction.get(target))) return false;
        transaction.set(target, {
          uid: firebaseUser.uid,
          ownerUid: firebaseUser.uid,
          email: firebaseUser.email || credentials.email,
          workspace: normalizeWorkspace(oldWorkspace),
          schemaVersion: 2,
          migratedFrom: 'supabase',
          migratedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }, { merge: true });
        return true;
      });
    } catch (error) {
      console.warn('Legacy workspace migration:', error?.message || error);
      return false;
    } finally {
      await legacyClient?.auth.signOut().catch(() => {});
    }
  }

  function stopWorkspaceListener() {
    if (unsubscribeWorkspace) unsubscribeWorkspace();
    unsubscribeWorkspace = null;
    unsubscribeAccess?.(); unsubscribeAccess = null;
    unsubscribeRevoked?.(); unsubscribeRevoked = null;
  }

  async function registerCompatibleDevice() {
    if (!user || !workspaceId) return;
    const deviceId = getClientDeviceId();
    const ref = doc(db, COLLECTION, workspaceId, 'clientDevices', deviceId);
    const existing = await getDoc(ref);
    const now = serverTimestamp();
    await setDoc(ref, {
      uid: user.uid,
      appVersion: CLIENT_COMPAT_VERSION,
      userAgent: String(globalThis.navigator?.userAgent || 'dispositivo no identificado').slice(0, 240),
      firstSeenAt: existing.exists() ? existing.data()?.firstSeenAt || now : now,
      lastSeenAt: now
    }, { merge: true });
  }

  async function activateUser(nextUser) {
    const nextId = nextUser?.uid || null;
    if ((user?.uid || null) === nextId && initialized) return;
    stopWorkspaceListener();
    clearTimeout(timer);
    sessionRevision += 1;
    dirty = false;
    syncFailures = 0;
    pendingWrites.clear();
    user = nextUser || null;
    workspace = createEmptyWorkspace();
    workspaceOwnerUid = null;
    notify();

    if (!user) {
      workspaceId = null;
      initialized = true;
      setStatus('Inicia sesión para cargar tus datos en la nube');
      return;
    }

    setStatus('Cargando tus datos desde Firebase');
    try {
      const revokedSnap = await getDoc(doc(db, 'revokedUsers', user.uid));
      if (revokedSnap.exists()) {
        await firebaseSignOut(auth).catch(() => {});
        user = null;
        workspaceId = null;
        initialized = true;
        setStatus('Acceso revocado por el propietario.');
        notify();
        return;
      }
      const accessRef = doc(db, 'workspaceAccess', user.uid);
      const accessSnap = await getDoc(accessRef);
      const access = accessSnap.exists() ? accessSnap.data() : {};
      const isPrimaryOwner = (user.email || '').trim().toLowerCase() === PRIMARY_OWNER_EMAIL;
      if (!accessSnap.exists() && !isPrimaryOwner) {
        user = null;
        workspaceId = null;
        workspaceOwnerUid = null;
        initialized = true;
        setStatus('Esta cuenta no tiene invitación. Solicita al propietario que te dé acceso.');
        notify();
        await firebaseSignOut(auth).catch(() => {});
        return;
      }
      workspaceId = access.workspaceId || user.uid;

      const ref = workspaceRef(workspaceId);
      const existingWorkspace = await getDoc(ref);

      if (!accessSnap.exists()) {
        if (!existingWorkspace.exists() || !existingWorkspace.data()?.workspace) {
          await setDoc(ref, {
            uid: workspaceId,
            ownerUid: user.uid,
            email: user.email || '',
            workspace: createEmptyWorkspace(),
            schemaVersion: 2,
            updatedAt: serverTimestamp()
          }, { merge: true });
        }
        await setDoc(accessRef, {
          workspaceId,
          ownerUid: user.uid,
          email: user.email || '',
          role: 'owner',
          createdAt: serverTimestamp()
        });
        workspaceOwnerUid = user.uid;
      } else if ((user.email || '').trim().toLowerCase() === PRIMARY_OWNER_EMAIL) {
        // La cuenta principal recupera la propiedad del espacio existente sin
        // crear otro espacio ni tocar los datos compartidos.
        await setDoc(accessRef, {
          workspaceId,
          ownerUid: user.uid,
          email: user.email || PRIMARY_OWNER_EMAIL,
          role: 'owner',
          updatedAt: serverTimestamp()
        }, { merge: true });
        await setDoc(ref, {
          uid: workspaceId,
          ownerUid: user.uid,
          email: user.email || PRIMARY_OWNER_EMAIL,
          schemaVersion: 2,
          updatedAt: serverTimestamp()
        }, { merge: true });
        workspaceOwnerUid = user.uid;
      } else {
        workspaceOwnerUid = existingWorkspace.exists()
          ? (existingWorkspace.data()?.ownerUid || null)
          : null;
      }
    } catch (error) {
      console.error('Workspace membership:', error);
      initialized = true;
      setStatus('Conexión pendiente: verifica los permisos de acceso.');
      return;
    }

    // Registrar después de resolver workspaceId y crear/confirmar la membresía.
    // El fallo de telemetría nunca bloquea el acceso ni modifica los datos compartidos.
    try {
      await registerCompatibleDevice();
    } catch (error) {
      console.warn('Registro de dispositivo compatible:', error?.message || error);
    }

    const accessRef = doc(db, 'workspaceAccess', user.uid);
    const revokedRef = doc(db, 'revokedUsers', user.uid);
    const terminateAccess = async reason => {
      if (!user || user.uid !== nextId) return;
      clearTimeout(timer); clearPending(); sessionRevision += 1; dirty = false; workspace = createEmptyWorkspace(); workspaceId = null; workspaceOwnerUid = null; initialized = false;
      notify(); setStatus(reason);
      await firebaseSignOut(auth).catch(() => {});
    };
    unsubscribeRevoked = onSnapshot(revokedRef, snapshot => {
      if (snapshot.exists()) void terminateAccess('El propietario revocó tu acceso. La sesión se cerró.');
    }, error => console.warn('Revocation listener:', error?.message || error));
    unsubscribeAccess = onSnapshot(accessRef, snapshot => {
      if (!snapshot.exists()) void terminateAccess('Tu autorización fue retirada. La sesión se cerró.');
    }, error => console.warn('Membership listener:', error?.message || error));

    recoverPending();
    const ref = workspaceRef(workspaceId);
    await new Promise(resolve => {
      let firstSnapshot = true;
      unsubscribeWorkspace = onSnapshot(ref, async snapshot => {
        if (snapshot.exists() && snapshot.data()?.workspace) {
          workspaceOwnerUid = snapshot.data()?.ownerUid || null;
          const incoming = normalizeWorkspace(snapshot.data().workspace);
          workspace = dirty ? mergeWorkspaces(workspace, incoming) : incoming;
          if (dirty) scheduleSync();
        } else if (firstSnapshot) {
          if (!dirty) workspace = createEmptyWorkspace();
          try {
            await setDoc(ref, {
              uid: workspaceId,
              ownerUid: user.uid,
              email: user.email || '',
              workspace,
              schemaVersion: 2,
              updatedAt: serverTimestamp()
            }, { merge: true });
            workspaceOwnerUid = user.uid;
          } catch (error) {
            setStatus('No se pudo crear tu espacio en Firebase');
            console.error(error);
          }
        }
        firstSnapshot = false;
        initialized = true;
        notify();
        if (dirty) {
          setStatus('Cambios pendientes de guardar');
          scheduleSync();
        } else {
          setStatus(navigator.onLine ? 'Sincronizado con Firebase' : 'Esperando conexión');
        }
        resolve();
      }, error => {
        console.error('Firebase workspace listener:', error);
        initialized = true;
        setStatus('Error de acceso a Firebase: revisa las reglas de Firestore');
        resolve();
      });
    });
  }
  async function initialize() {
    disposed = false;
    window.addEventListener('online', retryOnReconnect);
    await setPersistence(auth, indexedDBLocalPersistence);
    await setPersistence(memberAuth, inMemoryPersistence);
    await new Promise(resolve => {
      let first = true;
      unsubscribeAuth = onAuthStateChanged(auth, async nextUser => {
        if (authBusy) return;
        await activateUser(nextUser);
        if (first) { first = false; resolve(); }
      }, error => {
        console.error('Firebase Auth:', error);
        setStatus('No se pudo comprobar la sesión de Firebase');
        if (first) { first = false; resolve(); }
      });
    });
    return { workspace, user, configured };
  }

  function scheduleSync() {
    if (!user || !workspaceId || !dirty || disposed) return;
    clearTimeout(timer);
    const delay = syncFailures ? Math.min(30000, 1000 * 2 ** Math.min(syncFailures, 5)) : 450;
    timer = setTimeout(() => { void syncNow(); }, delay);
  }

  async function syncNow() {
    if (!user || !workspaceId || !dirty || disposed) return;
    if (syncing) { scheduleSync(); return; }
    syncing = true;
    const revisionAtStart = localRevision;
    const sessionAtStart = sessionRevision;
    const uid = workspaceId;
    const email = user.email || '';
    const writesAtStart = new Map(pendingWrites);
    setStatus('Guardando en Firebase');
    try {
      const ref = workspaceRef(uid);
      const localSnapshot = normalizeWorkspace(workspace);
      const merged = await runTransaction(db, async transaction => {
        const latest = await transaction.get(ref);
        const remote = latest.exists() ? normalizeWorkspace(latest.data()?.workspace) : createEmptyWorkspace();
        if (sessionAtStart !== sessionRevision || disposed) throw new Error('La sesión cambió durante el guardado.');
        const safeMerge = mergeWorkspaces(localSnapshot, remote);
        transaction.set(ref, {
          uid,
          email,
          workspace: safeMerge,
          schemaVersion: 2,
          updatedAt: serverTimestamp()
        }, { merge: true });
        return safeMerge;
      });
      if (sessionAtStart !== sessionRevision || disposed) return;
      clearPending(writesAtStart);
      syncFailures = 0;
      if (localRevision === revisionAtStart) {
        workspace = normalizeWorkspace(merged);
        dirty = false;
        setStatus('Sincronizado con Firebase');
      } else {
        workspace = mergeWorkspaces(workspace, merged);
        dirty = true;
        scheduleSync();
        setStatus('Guardando cambios recientes');
      }
      notify();
    } catch (error) {
      if (sessionAtStart !== sessionRevision || disposed) return;
      dirty = true;
      syncFailures += 1;
      setStatus(navigator.onLine ? 'Cambios pendientes: reintentando guardar' : 'Sin conexión: cambios pendientes');
      console.error('Mi Compra Firebase sync:', error?.message || error);
      scheduleSync();
    } finally {
      syncing = false;
    }
  }

  async function signIn(email, password) {
    authBusy = true;
    pendingCredentials = { email, password };
    try {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      await migrateLegacyWorkspace(credential.user, pendingCredentials);
      await activateUser(credential.user);
      return credential.user;
    } finally {
      pendingCredentials = null;
      authBusy = false;
    }
  }

  async function createAccessUser(email) {
    const activeUser = auth.currentUser || user;
    if (!activeUser) {
      throw new Error('No se detectó una sesión activa. Vuelve a cargar la aplicación e inténtalo nuevamente.');
    }

    // Resuelve el espacio desde la membresía persistida; workspaceId puede no estar
    // listo todavía cuando el usuario abre directamente el panel de invitaciones.
    const accessSnap = await getDoc(doc(db, 'workspaceAccess', activeUser.uid));
    const access = accessSnap.exists() ? accessSnap.data() : {};
    const targetWorkspaceId = access.workspaceId || workspaceId || activeUser.uid;
    if (!targetWorkspaceId) {
      throw new Error('No se pudo identificar el espacio de trabajo de esta sesión.');
    }

    const workspaceSnap = await getDoc(workspaceRef(targetWorkspaceId));
    const workspaceData = workspaceSnap.exists() ? workspaceSnap.data() : {};
    const isOwner = workspaceData.ownerUid === activeUser.uid;
    if (!isOwner) {
      throw new Error('La cuenta activa no figura como propietaria de este espacio. No necesitas cambiar de sesión: hay que corregir la asignación de propietario en los permisos del espacio.');
    }

    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) throw new Error('Escribe el correo electrónico de la persona que recibirá la invitación.');

    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%*-_';
    const randomBytes = new Uint8Array(48);
    if (!globalThis.crypto?.getRandomValues) throw new Error('No se pudo generar una clave segura para preparar la invitación.');
    globalThis.crypto.getRandomValues(randomBytes);
    const bootstrapPassword = Array.from(randomBytes, byte => alphabet[byte % alphabet.length]).join('') + 'aA1!';

    let credential = null;
    let accessCreated = false;
    try {
      // Si el propietario revocó antes a esta persona, reutiliza su UID de Firebase
      // Auth. No se intenta crear una segunda cuenta para el mismo correo.
      const revokedQuery = query(collection(db, 'revokedUsers'), where('workspaceId', '==', targetWorkspaceId));
      const revokedSnapshot = await getDocs(revokedQuery);
      const previousRevocation = revokedSnapshot.docs.find(row =>
        String(row.data()?.email || '').trim().toLowerCase() === normalizedEmail
      );

      auth.languageCode = 'es';
      if (previousRevocation) {
        const restoredUid = previousRevocation.id;
        await sendPasswordResetEmail(auth, normalizedEmail, {
          url: 'https://mi-compra-d9717.web.app/'
        });
        await setDoc(doc(db, 'workspaceAccess', restoredUid), {
          workspaceId: targetWorkspaceId, ownerUid: activeUser.uid, email: normalizedEmail,
          role: 'member', reactivatedAt: serverTimestamp(), createdAt: previousRevocation.data()?.createdAt || serverTimestamp()
        });
        await deleteDoc(previousRevocation.ref);
        return { uid: restoredUid, email: normalizedEmail, reactivated: true };
      }

      credential = await createUserWithEmailAndPassword(memberAuth, normalizedEmail, bootstrapPassword);
      const memberAccessRef = doc(db, 'workspaceAccess', credential.user.uid);
      await setDoc(memberAccessRef, {
        workspaceId: targetWorkspaceId, ownerUid: activeUser.uid, email: normalizedEmail, role: 'member', createdAt: serverTimestamp()
      });
      accessCreated = true;
      await sendPasswordResetEmail(auth, normalizedEmail, {
        url: 'https://mi-compra-d9717.web.app/'
      });
      return { uid: credential.user.uid, email: normalizedEmail, reactivated: false };
    } catch (error) {
      if (credential?.user) {
        if (accessCreated) {
          await deleteDoc(doc(db, 'workspaceAccess', credential.user.uid)).catch(() => {});
        }
        await deleteUser(credential.user).catch(() => {});
      }
      if (error?.code === 'auth/email-already-in-use') {
        throw new Error('Ese correo ya tiene una cuenta activa. Si fue revocada anteriormente, verifica que siga registrada en la lista de accesos revocados del espacio.');
      }
      if (error?.code === 'auth/unauthorized-continue-uri' || error?.code === 'auth/invalid-continue-uri') {
        throw new Error('Firebase no tiene autorizado el enlace de regreso a Mi Compra para enviar la invitación.');
      }
      if (error?.code === 'permission-denied' || error?.code === 'firestore/permission-denied') {
        throw new Error('Firebase bloqueó la asignación de acceso. Hay que publicar las reglas de Firestore antes de invitar usuarios.');
      }
      throw error;
    } finally {
      await firebaseSignOut(memberAuth).catch(() => {});
    }
  }


  function stableJson(value) {
    if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
    return JSON.stringify(value);
  }

  async function migrateWorkspaceToRecords(onProgress = () => {}) {
    if (!user || workspaceOwnerUid !== user.uid) throw new Error('Solo la cuenta propietaria puede ejecutar la migración.');
    if (syncing) throw new Error('Espera a que termine la sincronización actual e inténtalo de nuevo.');
    if (dirty) {
      clearTimeout(timer);
      await syncNow();
      if (dirty) throw new Error('Hay cambios pendientes que todavía no se han confirmado en Firebase. No se inició la migración.');
    }

    const targetWorkspaceId = workspaceId || user.uid;
    const sourceRef = workspaceRef(targetWorkspaceId);
    const sourceSnapshot = await getDoc(sourceRef);
    if (!sourceSnapshot.exists() || !sourceSnapshot.data()?.workspace) throw new Error('No se encontró el espacio original en Firebase.');
    const originalWorkspace = sourceSnapshot.data().workspace;
    const groups = WORKSPACE_COLLECTIONS;
    const records = [];
    for (const group of groups) {
      const rows = Array.isArray(originalWorkspace[group]) ? originalWorkspace[group] : [];
      const used = new Set();
      rows.forEach((row, index) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Se encontró un registro inválido en ' + group + '. No se modificó el origen.');
        const rawId = String(row.id || '').trim();
        const baseId = rawId || ('legacy_' + index);
        let recordId = baseId;
        if (used.has(recordId)) recordId = baseId + '__duplicate_' + index;
        used.add(recordId);
        records.push({
          key: group + '__' + encodeURIComponent(recordId),
          type: group,
          recordId,
          data: rawId ? row : { ...row, id: recordId }
        });
      });
    }
    records.push({ key: '__profile', type: 'profile', recordId: 'profile', data: originalWorkspace.profile || {} });
    records.push({ key: '__deletedRecords', type: 'deletedRecords', recordId: 'deletedRecords', data: originalWorkspace.deletedRecords || {} });

    const recordsRef = collection(db, COLLECTION, targetWorkspaceId, 'records');
    const batchSize = 350;
    const expectedKeys = new Set(records.map(record => record.key));
    const priorCopy = await getDocs(recordsRef);
    const obsoleteDocs = priorCopy.docs.filter(item => !expectedKeys.has(item.id) && !item.data()?.migrationObsolete);
    for (let offset = 0; offset < obsoleteDocs.length; offset += batchSize) {
      const batch = writeBatch(db);
      obsoleteDocs.slice(offset, offset + batchSize).forEach(item => {
        batch.set(item.ref, { ...item.data(), migrationObsolete: true, obsoleteAt: new Date().toISOString() });
      });
      await batch.commit();
    }
    for (let offset = 0; offset < records.length; offset += batchSize) {
      const batch = writeBatch(db);
      const part = records.slice(offset, offset + batchSize);
      for (const record of part) {
        batch.set(doc(recordsRef, record.key), {
          type: record.type,
          recordId: record.recordId,
          data: record.data,
          sourceSchemaVersion: 2,
          migratedFrom: 'workspace-map-v2'
        });
      }
      await batch.commit();
      onProgress({ completed: Math.min(offset + part.length, records.length), total: records.length });
    }

    const copied = await getDocs(recordsRef);
    const activeCopied = copied.docs.filter(item => !item.data()?.migrationObsolete);
    if (activeCopied.length !== records.length) {
      throw new Error('La verificación detectó diferencias: se esperaban ' + records.length + ' registros activos y se encontraron ' + activeCopied.length + '. El origen permanece intacto; puedes volver a ejecutar la copia.');
    }
    const copiedById = new Map(activeCopied.map(item => [item.id, item.data()]));
    for (const record of records) {
      const target = copiedById.get(record.key);
      if (!target || target.type !== record.type || target.recordId !== record.recordId || stableJson(target.data) !== stableJson(record.data)) {
        throw new Error('La verificación de integridad falló en ' + record.type + ' (' + record.recordId + '). El origen permanece intacto; puedes volver a ejecutar la copia.');
      }
    }

    const verifiedAt = new Date().toISOString();
    const migrationRef = doc(db, COLLECTION, targetWorkspaceId, 'migrations', 'workspace-map-v2');
    await runTransaction(db, async transaction => {
      const latestSource = await transaction.get(sourceRef);
      const latestWorkspace = latestSource.data()?.workspace;
      if (!latestWorkspace || stableJson(latestWorkspace) !== stableJson(originalWorkspace)) {
        throw new Error('El espacio original cambió mientras se copiaban los datos. Vuelve a ejecutar la copia.');
      }
      transaction.set(migrationRef, {
        migrationId: 'workspace-map-v2',
        status: 'copied_and_verified',
        sourceSchemaVersion: 2,
        targetSchemaVersion: 3,
        recordCount: records.length,
        countsByType: groups.reduce((result, group) => {
          result[group] = records.filter(record => record.type === group).length;
          return result;
        }, { profile: 1, deletedRecords: 1 }),
        verifiedAt,
        verifiedBy: user.uid,
        sourceUpdatedAt: timestampToIso(sourceSnapshot.data()?.updatedAt),
        note: 'Copia verificada. El documento original sigue siendo la fuente activa; no se realizó el cambio de lectura/escritura.'
      });
    });
    return { recordCount: records.length, verifiedAt, status: 'copied_and_verified' };
  }

  async function listClientDevices() {
    if (!user || workspaceOwnerUid !== user.uid) throw new Error('Solo el propietario puede consultar los dispositivos.');
    const devicesQuery = query(collection(db, COLLECTION, workspaceId || user.uid, 'clientDevices'));
    const snapshot = await getDocs(devicesQuery);
    return snapshot.docs.map(row => {
      const data = row.data();
      return {
        deviceId: row.id,
        uid: data.uid || '',
        appVersion: data.appVersion || 'versión no identificada',
        userAgent: data.userAgent || 'Dispositivo no identificado',
        firstSeenAt: timestampToIso(data.firstSeenAt),
        lastSeenAt: timestampToIso(data.lastSeenAt)
      };
    }).sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
  }

  async function listAccessUsers() {
    if (!user || workspaceOwnerUid !== user.uid) throw new Error('Solo el propietario puede consultar los usuarios autorizados.');
    const accessQuery = query(collection(db, 'workspaceAccess'), where('workspaceId', '==', workspaceId || user.uid));
    const snapshot = await getDocs(accessQuery);
    return snapshot.docs.map(row => ({ uid: row.id, ...row.data() }))
      .filter(row => row.uid !== user.uid)
      .sort((a, b) => String(a.email || '').localeCompare(String(b.email || '')));
  }

  async function revokeAccessUser(uid) {
    if (!user || workspaceOwnerUid !== user.uid) throw new Error('Solo el propietario puede revocar accesos.');
    if (!uid || uid === user.uid) throw new Error('No puedes revocar la cuenta propietaria.');
    const memberRef = doc(db, 'workspaceAccess', uid);
    const memberSnap = await getDoc(memberRef);
    if (!memberSnap.exists() || memberSnap.data()?.workspaceId !== (workspaceId || user.uid)) {
      throw new Error('El usuario no pertenece a este espacio.');
    }
    await setDoc(doc(db, 'revokedUsers', uid), {
      uid, workspaceId: workspaceId || user.uid, email: memberSnap.data()?.email || '',
      revokedBy: user.uid, revokedAt: serverTimestamp()
    });
    await deleteDoc(memberRef);
    return { uid, email: memberSnap.data()?.email || '' };
  }

  async function signOut() {
    clearTimeout(timer);
    syncFailures = 0;
    await firebaseSignOut(auth);
    workspaceId = null;
    workspaceOwnerUid = null;
    await activateUser(null);
  }

  async function resetPassword(email) {
    await sendPasswordResetEmail(auth, email);
  }

  async function resetWorkspace() {
    if (!user) throw new Error('Inicia sesión para borrar los datos guardados en la nube.');
    if (workspaceOwnerUid !== user.uid) throw new Error('Solo la cuenta propietaria puede restablecer y borrar los datos compartidos.');
    clearTimeout(timer);
    const ref = workspaceRef(workspaceId || user.uid);
    const now = new Date().toISOString();
    const writesAtStart = new Map(pendingWrites);
    const revisionAtStart = localRevision;
    const sessionAtStart = sessionRevision;
    const cleared = await runTransaction(db, async transaction => {
      const latest = await transaction.get(ref);
      const remote = normalizeWorkspace(latest.data()?.workspace || createEmptyWorkspace());
      const empty = createEmptyWorkspace();
      empty.deletedRecords = { ...remote.deletedRecords };
      const groups = WORKSPACE_COLLECTIONS;
      for (const group of groups) for (const row of remote[group]) empty.deletedRecords[group + ':' + row.id] = { deletedAt: now };
      for (const list of remote.lists) for (const item of list.items || []) empty.deletedRecords['listItems:' + list.id + ':' + item.id] = { deletedAt: now };
      const result = mergeWorkspaces(empty, remote);
      transaction.set(ref, { uid: workspaceId || user.uid, ownerUid: workspaceOwnerUid, email: user.email || '', workspace: result, schemaVersion: 2, resetAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
      return result;
    });
    if (sessionAtStart !== sessionRevision || disposed) return;
    clearPending(writesAtStart);
    if (localRevision === revisionAtStart) {
      workspace = normalizeWorkspace(cleared);
      dirty = false;
      clearTimeout(timer);
      setStatus('Sincronizado con Firebase');
    } else {
      workspace = mergeWorkspaces(workspace, cleared);
      persistPending();
      scheduleSync();
    }
    localRevision += 1;
    notify();
  }

  function restoreBackup(backup) {
    if (!user) throw new Error('Inicia sesión para restaurar una copia de seguridad.');
    if (workspaceOwnerUid !== user.uid) throw new Error('Solo la cuenta propietaria puede restaurar copias de seguridad.');
    if (!backup || backup.app !== 'Mi Compra 2.0' || !backup.workspace || typeof backup.workspace !== 'object' || Array.isArray(backup.workspace)) {
      throw new Error('El archivo no corresponde a una copia válida de Mi Compra 2.0.');
    }
    const restored = normalizeWorkspace(backup.workspace);
    const merged = mergeWorkspaces(restored, workspace);
    merged.activity.unshift({
      id: 'act_restore_' + Date.now().toString(36),
      module: 'Configuración',
      action: 'Respaldo restaurado',
      description: 'Se importó una copia de seguridad.',
      createdAt: new Date().toISOString()
    });
    workspace = normalizeWorkspace(merged);
    save(workspace);
    return workspace;
  }

  function save(next) {
    if (!user || !workspaceId || !initialized) {
      setStatus('Espera a que se conecte tu espacio de trabajo');
      return;
    }
    const previous = normalizeWorkspace(workspace);
    const incoming = normalizeWorkspace(next);
    const now = new Date().toISOString();
    const collections = WORKSPACE_COLLECTIONS;
    incoming.deletedRecords = { ...previous.deletedRecords, ...incoming.deletedRecords };
    for (const collectionName of collections) {
      const nextIds = new Set(incoming[collectionName].map(row => row.id));
      for (const row of previous[collectionName]) if (!nextIds.has(row.id)) incoming.deletedRecords[collectionName + ':' + row.id] = { deletedAt: now };
    }
    for (const oldList of previous.lists) {
      const newList = incoming.lists.find(row => row.id === oldList.id);
      const nextItemIds = new Set((newList?.items || []).map(row => row.id));
      for (const item of oldList.items || []) if (!nextItemIds.has(item.id)) incoming.deletedRecords['listItems:' + oldList.id + ':' + item.id] = { deletedAt: now };
    }
    workspace = normalizeWorkspace(incoming);
    syncFailures = 0;
    dirty = true;
    localRevision += 1;
    if (!persistPending()) {
      setStatus('No se pudo guardar el cambio en este dispositivo. Mantén la aplicación abierta hasta sincronizar.');
    }
    notify();
    scheduleSync();
  }

  function dispose() {
    disposed = true;
    window.removeEventListener('online', retryOnReconnect);
    clearTimeout(timer);
    stopWorkspaceListener();
    unsubscribeAuth?.();
  }

  return {
    initialize, save, signIn, signOut, resetPassword, resetWorkspace, restoreBackup, createAccessUser, listAccessUsers, listClientDevices, migrateWorkspaceToRecords, revokeAccessUser, dispose,
    isWorkspaceOwner: () => Boolean(user && workspaceOwnerUid === user.uid),
    getState: () => workspace,
    getUser: () => user,
    getStatus: () => status,
    isConfigured: configured
  };
}