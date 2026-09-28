import type { App } from 'firebase-admin/app'
import type { Auth } from 'firebase-admin/auth'
import type { Firestore } from 'firebase-admin/firestore'
import type { Storage } from 'firebase-admin/storage'

/**
 * Firebase Admin SDK — server only.
 *
 * Two rules matter here, both learned the hard way:
 *
 *  1. NEVER initialise at import time. Next.js evaluates route modules while
 *     collecting page data during `next build`, so a top-level `cert(...)` call
 *     with credentials that are not present in that context aborts the build.
 *     Initialisation is therefore lazy, inside `getAdmin()`, which only runs
 *     while serving a real request.
 *  2. `getAdmin()` returns `null` when the credentials are absent (the app then
 *     uses the local file store) and only throws when credentials exist but the
 *     SDK genuinely cannot start — that error text is meant to be read in the
 *     Vercel logs.
 */

export interface AdminServices {
  app: App
  auth: Auth
  db: Firestore
  storage: Storage
}

interface AdminCredentials {
  projectId: string
  clientEmail: string
  privateKey: string
}

let cached: AdminServices | null = null
let initFailure: Error | null = null

/**
 * Service-account keys are usually pasted into a dashboard as a single line,
 * so newlines arrive as the two characters `\` `n`. Accept both that form and
 * a real multi-line PEM, with or without wrapping quotes.
 */
function normalizePrivateKey(raw: string | undefined): string | null {
  const value = raw?.trim()
  if (!value) return null
  return value
    .replace(/^['"]|['"]$/g, '')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .trim()
}

function readCredentials(): AdminCredentials | null {
  const projectId = (process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '').trim()
  const clientEmail = (process.env.FIREBASE_ADMIN_CLIENT_EMAIL || '').trim()
  const privateKey = normalizePrivateKey(process.env.FIREBASE_ADMIN_PRIVATE_KEY)

  if (!projectId || !clientEmail || !privateKey) return null
  return { projectId, clientEmail, privateKey }
}

/** Check whether Firebase Admin credentials are configured (never touches the SDK). */
export function isFirebaseAdminConfigured(): boolean {
  return readCredentials() !== null
}

/**
 * The initialised Admin services, or `null` when Firebase is not configured.
 * Safe to call at any time from server code.
 */
export async function getAdmin(): Promise<AdminServices | null> {
  if (cached) return cached

  const credentials = readCredentials()
  if (!credentials) return null
  if (initFailure) throw initFailure

  try {
    const [{ initializeApp, getApps, getApp, cert }, { getAuth }, { getFirestore }, { getStorage }] = await Promise.all([
      import('firebase-admin/app'),
      import('firebase-admin/auth'),
      import('firebase-admin/firestore'),
      import('firebase-admin/storage'),
    ])

    const storageBucket = (
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
      process.env.FIREBASE_STORAGE_BUCKET ||
      `${credentials.projectId}.appspot.com`
    ).trim()

    const app = getApps().length
      ? getApp()
      : initializeApp({ credential: cert(credentials), storageBucket })

    cached = { app, auth: getAuth(app), db: getFirestore(app), storage: getStorage(app) }
    return cached
  } catch (err) {
    initFailure = new Error(
      `Firebase Admin SDK could not initialise: ${(err as Error).message}. ` +
        'Check FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY ' +
        '(the private key must be the full PEM, with newlines written as \\n).',
    )
    console.error('[firebase-admin]', initFailure.message)
    throw initFailure
  }
}

/**
 * Like `getAdmin()` but throws when Firebase is not configured — used by the
 * Firebase-backed store, which must never silently fall back to local files.
 */
export async function requireAdmin(): Promise<AdminServices> {
  const admin = await getAdmin()
  if (!admin) {
    throw new Error(
      'Firebase Admin credentials are not configured. Set FIREBASE_ADMIN_PROJECT_ID, ' +
        'FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY.',
    )
  }
  return admin
}

let authReady: { value: boolean; checkedAt: number } | null = null
let authReadyLogged = false

/**
 * Is Firebase Authentication actually usable on this project?
 *
 * The Admin SDK happily constructs an Auth instance for a project where
 * Authentication was never initialised, but every call then fails with
 * `auth/configuration-not-found`. Probe once (cheap `listUsers`) and cache the
 * answer so sign-up doesn't pay for a doomed round trip every time.
 */
export async function firebaseAuthReady(): Promise<boolean> {
  const TTL_MS = 5 * 60 * 1000
  if (authReady && Date.now() - authReady.checkedAt < TTL_MS) return authReady.value

  const admin = await getAdmin().catch(() => null)
  if (!admin) return false

  let value = false
  try {
    await admin.auth.listUsers(1)
    value = true
  } catch (err) {
    value = false
    if (!authReadyLogged) {
      authReadyLogged = true
      console.warn(
        '[firebase-admin] Firebase Authentication is not available:',
        (err as Error).message,
        '— falling back to Firestore-backed email/password sign-in.',
      )
    }
  }

  authReady = { value, checkedAt: Date.now() }
  return value
}

/** Clears the cached SDK instance (hot reload / tests). */
export function resetAdmin(): void {
  cached = null
  initFailure = null
  authReady = null
  authReadyLogged = false
}
