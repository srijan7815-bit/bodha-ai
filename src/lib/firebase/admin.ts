import { initializeApp, getApps, cert, App } from 'firebase-admin/app'
import { getAuth, Auth } from 'firebase-admin/auth'
import { getFirestore, Firestore } from 'firebase-admin/firestore'
import { getStorage, Storage } from 'firebase-admin/storage'

let adminApp: App
let adminAuth: Auth
let adminDb: Firestore
let adminStorage: Storage

function initAdmin() {
  if (getApps().length) {
    adminApp = getApps()[0]
  } else {
    const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID
    const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL
    const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n')

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error('Firebase Admin SDK credentials not configured. Set FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, and FIREBASE_ADMIN_PRIVATE_KEY.')
    }

    adminApp = initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    })
  }

  adminAuth = getAuth(adminApp)
  adminDb = getFirestore(adminApp)
  adminStorage = getStorage(adminApp)
}

if (typeof window === 'undefined') {
  initAdmin()
}

/** Check whether Firebase Admin SDK credentials are configured. */
export function isFirebaseAdminConfigured(): boolean {
  return !!(
    process.env.FIREBASE_ADMIN_PROJECT_ID?.trim() &&
    process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim() &&
    process.env.FIREBASE_ADMIN_PRIVATE_KEY?.trim()
  )
}

export { adminAuth, adminDb, adminStorage }