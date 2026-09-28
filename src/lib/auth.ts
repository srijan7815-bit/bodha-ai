import { createHash, randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { getStore } from '@/lib/store'
import type { User } from '@/lib/types'

export const SESSION_COOKIE = 'bodha_session'
export const SESSION_DAYS = 30

// ─── Passwords (scrypt, no native deps) ────────────────────────────────────
// Defined in ./password (which the stores can import without pulling in
// next/headers) and re-exported here so existing imports keep working.

export { hashPassword, verifyPassword } from './password'

// ─── Sessions ────────────────────────────────────────────────────────────────

export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('hex')
  const tokenHash = hashToken(token)
  return { token, tokenHash }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function sessionExpiry(): Date {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: SESSION_DAYS * 24 * 60 * 60,
}

// ─── Request Helpers ────────────────────────────────────────────────────────

/** Returns the signed-in user for the current request, or null. */
export async function getSessionUser(): Promise<User | null> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (!token) return null
  const store = await getStore()
  const session = await store.getSession(hashToken(token))
  if (!session) return null
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    await store.deleteSession(session.tokenHash).catch(() => {})
    return null
  }
  return store.getUser(session.userId)
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

/** The shape of a user that is safe to send to the client. */
export function publicUser(user: User): { id: string; email: string; name: string; createdAt: string; avatarUrl?: string } {
  return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt, avatarUrl: user.avatarUrl }
}