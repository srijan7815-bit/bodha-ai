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
 * Rebuilds a service-account private key into valid PEM.
 *
 * Dashboards are rough on PEMs: the newlines survive as real line breaks, as
 * the two characters `\n`, as spaces, or not at all — and `cert()` throws on
 * anything that isn't a well-formed PEM, which takes the whole store down. So
 * keep only the base64 body and re-wrap it at 64 characters, no matter how the
 * value arrived. A key whose *bytes* were altered still cannot be rescued; this
 * only repairs whitespace damage.
 */
function normalizePrivateKey(raw: string | undefined): string | null {
  const input = raw?.trim()
  if (!input) return null

  let value = input
    .replace(/^['"]|['"]$/g, '')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .trim()

  const match = value.match(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/)
  if (match) {
    const [, label, rawBody] = match
    const body = rawBody.replace(/[^A-Za-z0-9+/=]/g, '')
    const lines = body.match(/.{1,64}/g) ?? [body]
    value = `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`
  }

  return value
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

export interface AdminHealth {
  configured: boolean
  /** Whether the SDK initialises (credential parses, app starts). */
  admin: 'ok' | 'error' | 'unconfigured'
  /** Whether a real Firestore round trip succeeds. */
  firestore: 'ok' | 'error' | 'skipped'
  detail?: string
}

/** Error text with anything sensitive taken out — safe to expose on /api/health. */
function sanitize(message: string): string {
  return message
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '<email>')
    .replace(/-----BEGIN[\s\S]*?-----/g, '<key>')
    .replace(/[A-Za-z0-9+/=]{32,}/g, '<redacted>')
    .replace(/\s+/g, ' ')
    .slice(0, 240)
}

/**
 * Diagnostic used by /api/health so a deployment can be checked from outside:
 * distinguishes "credentials missing" from "credentials unusable" from
 * "Firestore unreachable" without leaking secrets.
 */
export async function adminHealth(): Promise<AdminHealth> {
  if (!isFirebaseAdminConfigured()) {
    return { configured: false, admin: 'unconfigured', firestore: 'skipped' }
  }

  let admin: AdminServices
  try {
    admin = await requireAdmin()
  } catch (err) {
    return { configured: true, admin: 'error', firestore: 'skipped', detail: sanitize((err as Error).message) }
  }

  try {
    // A read against a (possibly empty) collection — cheap and side-effect free.
    await admin.db.collection('health').limit(1).get()
    return { configured: true, admin: 'ok', firestore: 'ok' }
  } catch (err) {
    return { configured: true, admin: 'ok', firestore: 'error', detail: sanitize((err as Error).message) }
  }
}

/** Clears the cached SDK instance (hot reload / tests). */
export function resetAdmin(): void {
  cached = null
  initFailure = null
  authReady = null
  authReadyLogged = false
}
