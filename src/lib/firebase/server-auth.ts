import type { NextRequest } from 'next/server'
import type { User } from '@/lib/types'

/**
 * Server-side auth for API routes (dual mode):
 *
 *  1. Firebase mode — when a Bearer ID token is presented, it is verified with
 *     the Admin SDK (real signature verification, never plain JWT decoding)
 *     and the user's profile is auto-provisioned at users/{uid}.
 *  2. Local demo mode — with no token (or Firebase unset), the httpOnly
 *     session cookie from the /api/auth routes is used instead.
 *
 * getAuthUser never throws — it returns null when unauthenticated.
 */

export async function getAuthUser(req: NextRequest): Promise<User | null> {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null

  if (token) {
    const user = await verifyFirebaseToken(token)
    if (user) return user
  }

  // Local demo mode: cookie session (file store). Safe to import — server only.
  const { getSessionUser } = await import('@/lib/auth')
  try {
    return await getSessionUser()
  } catch {
    return null
  }
}

/** Verifies a Firebase ID token with the Admin SDK; null when invalid/unconfigured. */
async function verifyFirebaseToken(token: string): Promise<User | null> {
  const { getAdmin } = await import('@/lib/firebase/admin')
  const admin = await getAdmin()
  if (!admin) return null

  try {
    const decoded = await admin.auth.verifyIdToken(token)
    return await ensureUserProfile(admin.db, decoded.uid, {
      email: decoded.email,
      name: decoded.name,
      avatarUrl: decoded.picture,
    })
  } catch (err) {
    console.warn('[auth] Firebase token verification failed:', (err as Error).message)
    return null
  }
}

/** Gets or creates the users/{uid} profile document. */
async function ensureUserProfile(
  db: import('firebase-admin/firestore').Firestore,
  uid: string,
  info: { email?: string; name?: string; avatarUrl?: string },
): Promise<User> {
  const ref = db.collection('users').doc(uid)
  const doc = await ref.get()

  if (!doc.exists) {
    const email = info.email ?? `${uid}@bodha.local`
    const name = info.name?.trim() || email.split('@')[0] || 'Student'
    const createdAt = new Date()
    await ref.set({ email, name, createdAt, ...(info.avatarUrl ? { avatarUrl: info.avatarUrl } : {}) })
    return { id: uid, email, name, createdAt: createdAt.toISOString(), avatarUrl: info.avatarUrl }
  }

  const data = doc.data()!
  return {
    id: uid,
    email: data.email ?? info.email ?? '',
    name: data.name ?? info.name ?? 'Student',
    createdAt: toISO(data.createdAt),
    avatarUrl: data.avatarUrl ?? info.avatarUrl,
  }
}

function toISO(v: unknown): string {
  if (v && typeof v === 'object' && 'toDate' in (v as Record<string, unknown>)) {
    return (v as { toDate(): Date }).toDate().toISOString()
  }
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'string') return v
  return new Date().toISOString()
}
