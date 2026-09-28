import { initializeApp, getApps, getApp, deleteApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'
import { getStorage, type FirebaseStorage } from 'firebase/storage'

/**
 * Client-side Firebase (Auth + Firestore + Storage).
 *
 * Only initialises when the public config is present — otherwise the app runs
 * in local demo mode (cookie sessions + local file store) and these exports
 * stay null.
 */

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() || undefined,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim() || undefined,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() || undefined,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() || undefined,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim() || undefined,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim() || undefined,
}

/** True when Firebase Auth/Storage/Firestore are available on the client. */
export const firebaseClientEnabled = !!firebaseConfig.apiKey && !!firebaseConfig.authDomain && !!firebaseConfig.projectId

export const firebaseConfigPublic = firebaseClientEnabled ? firebaseConfig : null

let app: FirebaseApp | null = null
let auth: Auth | null = null
let db: Firestore | null = null
let storage: FirebaseStorage | null = null

if (typeof window !== 'undefined' && firebaseClientEnabled) {
  app = getApps().length ? getApp() : initializeApp(firebaseConfig as Record<string, string>)
  auth = getAuth(app)
  db = getFirestore(app)
  storage = getStorage(app)
}

export { app, auth, db, storage }

/** Eagerly clears a partially-initialised app (used by tests / hot reload). */
export function resetFirebaseClient(): void {
  if (typeof window === 'undefined') return
  for (const a of getApps()) deleteApp(a).catch(() => {})
  app = null
  auth = null
  db = null
  storage = null
}
