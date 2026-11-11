import {
  getAuth, onAuthStateChanged, setPersistence, indexedDBLocalPersistence, inMemoryPersistence,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut as firebaseSignOut,
  deleteUser, sendPasswordResetEmail
} from 'firebase/auth';
import {
  doc, getDoc, getDocs, setDoc, deleteDoc, onSnapshot, serverTimestamp, runTransaction, collection, query, where
} from 'firebase/firestore';
import { app, db, memberAuth } from './firebase.js';
import { createEmptyWorkspace, normalizeWorkspace, mergeWorkspaces } from './model.js';

// Supabase is retained only as a one-time legacy data importer. All new reads/writes
// and authentication use Firebase. Remove the legacy importer after every account migrates.
const LEGACY_URL = import.meta.env.VITE_SUPABASE_URL;
const LEGACY_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const auth = getAuth(app);
const COLLECTION = 'userWorkspaces';
const PRIMARY_OWNER_EMAIL = 'delosrios9301@gmail.com';

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

  async function migrateLegacyWorkspace(firebaseUser, credentials) {
    if (!LEGACY_URL || !LEGACY_KEY || !credentials?.email || !credentials?.password) return false;
    let legacyClient = null;
    const target = workspaceRef(firebaseUser.uid);
    const existing = await getDoc(target);
    if (existing.exists() && existing.data()?.workspace) return false;

    try {
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
      await setDoc(target, {
        uid: firebaseUser.uid,
        ownerUid: firebaseUser.uid,
        email: firebaseUser.email || credentials.email,
        workspace: normalizeWorkspace(oldWorkspace),
        schemaVersion: 2,
        migratedFrom: 'supabase',
        migratedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      return true;
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

  async function activateUser(nextUser) {
    const nextId = nextUser?.uid || null;
    if ((user?.uid || null) === nextId && initialized) return;
    stopWorkspaceListener();
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

    const accessRef = doc(db, 'workspaceAccess', user.uid);
    const revokedRef = doc(db, 'revokedUsers', user.uid);
    const terminateAccess = async reason => {
      if (!user || user.uid !== nextId) return;
      clearTimeout(timer); dirty = false; workspace = createEmptyWorkspace(); workspaceId = null; workspaceOwnerUid = null; initialized = false;
      notify(); setStatus(reason);
      await firebaseSignOut(auth).catch(() => {});
    };
    unsubscribeRevoked = onSnapshot(revokedRef, snapshot => {
      if (snapshot.exists()) void terminateAccess('El propietario revocó tu acceso. La sesión se cerró.');
    }, error => console.warn('Revocation listener:', error?.message || error));
    unsubscribeAccess = onSnapshot(accessRef, snapshot => {
      if (!snapshot.exists()) void terminateAccess('Tu autorización fue retirada. La sesión se cerró.');
    }, error => console.warn('Membership listener:', error?.message || error));

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
          workspace = createEmptyWorkspace();
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
        setStatus(navigator.onLine ? 'Sincronizado con Firebase' : 'Esperando conexión');
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
    if (!user) return;
    clearTimeout(timer);
    timer = setTimeout(() => { void syncNow(); }, 450);
  }

  async function syncNow() {
    if (!user) return;
    if (syncing) { scheduleSync(); return; }
    syncing = true;
    const revisionAtStart = localRevision;
    setStatus('Guardando en Firebase');
    try {
      const ref = workspaceRef(workspaceId || user.uid);
      const localSnapshot = normalizeWorkspace(workspace);
      const merged = await runTransaction(db, async transaction => {
        const latest = await transaction.get(ref);
        const remote = latest.exists() ? normalizeWorkspace(latest.data()?.workspace) : createEmptyWorkspace();
        const safeMerge = mergeWorkspaces(localSnapshot, remote);
        transaction.set(ref, {
          uid: workspaceId || user.uid,
          email: user.email || '',
          workspace: safeMerge,
          schemaVersion: 2,
          updatedAt: serverTimestamp()
        }, { merge: true });
        return safeMerge;
      });
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
      setStatus('Error al guardar en Firebase');
      console.error('Mi Compra Firebase sync:', error?.message || error);
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

  async function signUp(email, password) {
    authBusy = true;
    pendingCredentials = { email, password };
    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await migrateLegacyWorkspace(credential.user, pendingCredentials);
      await activateUser(credential.user);
      // The app's UI uses result.session to distinguish confirmation-required providers.
      return { ...credential, session: credential.user };
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
      credential = await createUserWithEmailAndPassword(memberAuth, normalizedEmail, bootstrapPassword);
      const memberAccessRef = doc(db, 'workspaceAccess', credential.user.uid);
      await setDoc(memberAccessRef, {
        workspaceId: targetWorkspaceId, ownerUid: activeUser.uid, email: normalizedEmail, role: 'member', createdAt: serverTimestamp()
      });
      accessCreated = true;

      auth.languageCode = 'es';
      await sendPasswordResetEmail(auth, normalizedEmail, {
        url: 'https://mi-compra-d9717.web.app/'
      });
      return { uid: credential.user.uid, email: normalizedEmail };
    } catch (error) {
      if (credential?.user) {
        if (accessCreated) {
          await deleteDoc(doc(db, 'workspaceAccess', credential.user.uid)).catch(() => {});
        }
        await deleteUser(credential.user).catch(() => {});
      }
      if (error?.code === 'auth/email-already-in-use') {
        throw new Error('Ese correo ya tiene una cuenta en Mi Compra. No se creó otra invitación.');
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
    const cleared = await runTransaction(db, async transaction => {
      const latest = await transaction.get(ref);
      const remote = normalizeWorkspace(latest.data()?.workspace || createEmptyWorkspace());
      const empty = createEmptyWorkspace();
      empty.deletedRecords = { ...remote.deletedRecords };
      const groups = ['products', 'stores', 'lists', 'purchases', 'inventory', 'movements', 'expenses', 'budgets', 'activity'];
      for (const group of groups) for (const row of remote[group]) empty.deletedRecords[group + ':' + row.id] = { deletedAt: now };
      for (const list of remote.lists) for (const item of list.items || []) empty.deletedRecords['listItems:' + list.id + ':' + item.id] = { deletedAt: now };
      const result = mergeWorkspaces(empty, remote);
      transaction.set(ref, { uid: workspaceId || user.uid, ownerUid: workspaceOwnerUid, email: user.email || '', workspace: result, schemaVersion: 2, updatedAt: serverTimestamp() }, { merge: true });
      return result;
    });
    workspace = normalizeWorkspace(cleared);
    dirty = false; localRevision += 1;
    notify();
    setStatus('Sincronizado con Firebase');
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
    if (!user) {
      setStatus('Inicia sesión: los datos solo se guardan en la nube');
      return;
    }
    const previous = normalizeWorkspace(workspace);
    const incoming = normalizeWorkspace(next);
    const now = new Date().toISOString();
    const collections = ['products', 'stores', 'lists', 'purchases', 'inventory', 'movements', 'expenses', 'budgets', 'activity'];
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
    dirty = true;
    localRevision += 1;
    notify();
    scheduleSync();
  }

  function dispose() {
    clearTimeout(timer);
    stopWorkspaceListener();
    unsubscribeAuth?.();
  }

  return {
    initialize, save, signIn, signUp, signOut, resetPassword, resetWorkspace, restoreBackup, createAccessUser, listAccessUsers, revokeAccessUser, dispose,
    isWorkspaceOwner: () => Boolean(user && workspaceOwnerUid === user.uid),
    getState: () => workspace,
    getUser: () => user,
    getStatus: () => status,
    isConfigured: configured
  };
}