import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const envApiKey = import.meta.env.VITE_FIREBASE_API_KEY?.trim();
const envProjectId = import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim();
const envAuthDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim();
const envStorageBucket = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET?.trim();
const envMessagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim();
const envAppId = import.meta.env.VITE_FIREBASE_APP_ID?.trim();
const envMeasurementId = import.meta.env.VITE_FIREBASE_MEASUREMENT_ID?.trim();
const envDatabaseId = import.meta.env.VITE_FIREBASE_DATABASE_ID?.trim();

const isCustomProject = Boolean(envProjectId && envProjectId !== firebaseConfig.projectId);

if (envApiKey && isCustomProject && (!envAuthDomain || !envAppId)) {
  console.warn(
    'Custom VITE_FIREBASE_PROJECT_ID detected, make sure VITE_FIREBASE_AUTH_DOMAIN and VITE_FIREBASE_APP_ID are also configured in your environment variables.'
  );
}

const activeFirebaseConfig = envApiKey
  ? {
      apiKey: envApiKey,
      authDomain: envAuthDomain || (isCustomProject ? `${envProjectId}.firebaseapp.com` : firebaseConfig.authDomain),
      projectId: envProjectId || firebaseConfig.projectId,
      storageBucket:
        envStorageBucket || (isCustomProject ? `${envProjectId}.firebasestorage.app` : firebaseConfig.storageBucket),
      messagingSenderId:
        envMessagingSenderId || (isCustomProject ? '' : firebaseConfig.messagingSenderId),
      appId: envAppId || (isCustomProject ? '' : firebaseConfig.appId),
      measurementId:
        envMeasurementId || (isCustomProject ? '' : firebaseConfig.measurementId),
    }
  : firebaseConfig;

const activeDatabaseId =
  envDatabaseId || (isCustomProject ? undefined : firebaseConfig.firestoreDatabaseId);

const app = initializeApp(activeFirebaseConfig);
export const db = activeDatabaseId ? getFirestore(app, activeDatabaseId) : getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Firestore is offline. Please verify your Firebase configuration.');
    }
  }
}

export async function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export async function signOutChair() {
  return signOut(auth);
}
