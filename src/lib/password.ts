import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/**
 * Password hashing — scrypt, no native dependencies, server only.
 *
 * Lives in its own module (instead of `lib/auth.ts`) so the store can verify
 * passwords without importing `next/headers` or creating an import cycle.
 */

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const key = scryptSync(password, salt, 32).toString('hex')
  return `scrypt$${salt}$${key}`
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, salt, key] = stored.split('$')
    if (scheme !== 'scrypt' || !salt || !key) return false
    const derived = scryptSync(password, salt, 32)
    const expected = Buffer.from(key, 'hex')
    return derived.length === expected.length && timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}
