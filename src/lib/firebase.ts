// Firebase boundary — the ONLY module that touches firebase/app directly.
// The SDK is loaded via dynamic import so a build without the VITE_FIREBASE_*
// vars never fetches a byte of Firebase code: unconfigured, the app must look,
// load, and behave exactly as it did before Firebase existed. Type-only
// imports below are erased at compile time and pull in nothing.
import type { FirebaseApp } from 'firebase/app'
import type { Auth } from 'firebase/auth'
import type { Firestore } from 'firebase/firestore'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

/** True only when all six env vars are present and non-empty. */
export const isFirebaseConfigured = Object.values(config).every(
  (v) => typeof v === 'string' && v.length > 0
)

function notConfigured(): Error {
  return new Error(
    'Firebase is not configured — set the VITE_FIREBASE_* vars (see .env.example)'
  )
}

let appPromise: Promise<FirebaseApp> | null = null

function getApp(): Promise<FirebaseApp> {
  if (!isFirebaseConfigured) return Promise.reject(notConfigured())
  if (!appPromise) {
    const attempt = import('firebase/app').then((m) => m.initializeApp(config))
    // A transient failure (e.g. a dropped chunk fetch) must not be cached
    // forever — drop the rejected promise so the next call retries.
    attempt.catch(() => {
      if (appPromise === attempt) appPromise = null
    })
    appPromise = attempt
  }
  return appPromise
}

/** Lazily-initialized Auth. Rejects with a clear Error if Firebase is unconfigured — callers gate on isFirebaseConfigured. */
export async function getFirebaseAuth(): Promise<Auth> {
  const [{ getAuth }, app] = await Promise.all([import('firebase/auth'), getApp()])
  return getAuth(app)
}

/** Lazily-initialized Firestore. Rejects with a clear Error if Firebase is unconfigured — callers gate on isFirebaseConfigured. */
export async function getFirebaseDb(): Promise<Firestore> {
  const [{ getFirestore }, app] = await Promise.all([import('firebase/firestore'), getApp()])
  return getFirestore(app)
}
