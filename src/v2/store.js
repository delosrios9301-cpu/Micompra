import { createClient } from '@supabase/supabase-js';
import {
  getAuth, onAuthStateChanged, setPersistence, indexedDBLocalPersistence, inMemoryPersistence,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut as firebaseSignOut,
  deleteUser, sendPasswordResetEmail
} from 'firebase/auth';
import {
  doc, getDoc, setDoc, deleteDoc, onSnapshot, serverTimestamp, runTransaction
} from 'firebase/firestore';
import { app, db, memberAuth } from './firebase.js';
import { createEmptyWorkspace, normalizeWorkspace, mergeWorkspaces } from './model.js';

// Supabase is retained only as a one-time legacy data importer. All new reads/writes
// and authentication use Firebase. Remove the legacy importer after every account migrates.
const LEGACY_URL = import.meta.env.VITE_SUPABASE_URL;
const LEGACY_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const legacy = LEGACY_URL && LEGACY_KEY ? createClient(LEGACY_URL, LEGACY_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
}) : null;

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
  let pendingCredentials = null;
  let authBusy = false;
  let initialized = false;
  let workspaceId = null;
  let workspaceOwnerUid = null;

  const setStatus = value => { status = value; onStatus(status); };
  const notify = () => onChange(workspace, user);
  const workspaceRef = uid => doc(db, COLLECTION, uid);

  async function migrateLegacyWorkspace(firebaseUser, credentials) {
    if (!legacy || !credentials?.email || !credentials?.password) return false;
    const target = workspaceRef(firebaseUser.uid);
    const existing = await getDoc(target);
    if (existing.exists() && existing.data()?.workspace) return false;

    try {
      const { data: authData, error: authError } = await legacy.auth.signInWithPassword({
        email: credentials.email, password: credentials.password
      });
      if (authError || !authData?.user) return false;
      const { data, error } = await legacy.from('personal_workspace')
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
      await legacy.auth.signOut().catch(() => {});
    }
  }

  function stopWorkspaceListener() {
    if (unsubscribeWorkspace) unsubscribeWorkspace();
    unsubscribeWorkspace = null;
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

    const ref = workspaceRef(workspaceId);
    await new Promise(resolve => {
      let firstSnapshot = true;
      unsubscribeWorkspace = onSnapshot(ref, async snapshot => {
        if (snapshot.exists() && snapshot.data()?.workspace) {
          workspaceOwnerUid = snapshot.data()?.ownerUid || null;
          workspace = normalizeWorkspace(snapshot.data().workspace);
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
      workspace = normalizeWorkspace(merged);
      notify();
      setStatus('Sincronizado con Firebase');
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
    workspace = createEmptyWorkspace();
    await setDoc(workspaceRef(workspaceId || user.uid), {
      uid: workspaceId || user.uid, ownerUid: workspaceId || user.uid, email: user.email || '', workspace,
      schemaVersion: 2, updatedAt: serverTimestamp()
    }, { merge: true });
    notify();
    setStatus('Sincronizado con Firebase');
  }

  function save(next) {
    if (!user) {
      setStatus('Inicia sesión: los datos solo se guardan en la nube');
      return;
    }
    workspace = normalizeWorkspace(next);
    notify();
    scheduleSync();
  }

  function dispose() {
    clearTimeout(timer);
    stopWorkspaceListener();
    unsubscribeAuth?.();
  }

  return {
    initialize, save, signIn, signUp, signOut, resetPassword, resetWorkspace, createAccessUser, dispose,
    isWorkspaceOwner: () => Boolean(user && workspaceOwnerUid === user.uid),
    getState: () => workspace,
    getUser: () => user,
    getStatus: () => status,
    isConfigured: configured
  };
}