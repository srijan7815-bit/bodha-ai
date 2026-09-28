import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getStore } from '@/lib/store'
import {
  getSessionUser,
  isValidEmail,
  newSessionToken,
  publicUser,
  sessionCookieOptions,
  hashToken,
  hashPassword,
  sessionExpiry,
  SESSION_COOKIE,
} from '@/lib/auth'
import { clientIp, rateLimit } from '@/lib/rate-limit'
import { isFirebaseAdminConfigured } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase(),
  password: z.string().min(6).max(200),
})

/**
 * POST /api/auth/register — local demo-mode sign-up (email/password).
 * In Firebase mode the client signs up with Firebase Auth instead.
 */
export async function POST(req: NextRequest) {
  if (isFirebaseAdminConfigured()) {
    return NextResponse.json({ error: 'Registration is handled by Firebase Auth in this deployment.' }, { status: 409 })
  }

  const limited = rateLimit(`register:${clientIp(req)}`, 10, 10 * 60 * 1000)
  if (!limited.ok) {
    return NextResponse.json({ error: 'Too many attempts — try again in a few minutes.' }, { status: 429 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const message =
      issue?.code === 'too_small' && issue.path[0] === 'password'
        ? 'Password must be at least 6 characters.'
        : 'Please fill in your name, email and a password of at least 6 characters.'
    return NextResponse.json({ error: message }, { status: 400 })
  }
  const { name, email, password } = parsed.data
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'That email address does not look right.' }, { status: 400 })
  }

  const store = await getStore()
  if (await store.getUserByEmail(email)) {
    return NextResponse.json({ error: 'An account with that email already exists.' }, { status: 409 })
  }

  const user = await store.createUser({ email, name, passwordHash: hashPassword(password) })
  const { token, tokenHash } = newSessionToken()
  await store.createSession({ tokenHash, userId: user.id, expiresAt: sessionExpiry().toISOString() })

  const res = NextResponse.json({ user: publicUser(user) })
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions)
  return res
}
