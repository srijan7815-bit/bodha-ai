import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getStore } from '@/lib/store'
import {
  newSessionToken,
  publicUser,
  sessionCookieOptions,
  sessionExpiry,
  SESSION_COOKIE,
} from '@/lib/auth'
import { clientIp, rateLimit } from '@/lib/rate-limit'
import { isFirebaseAdminConfigured } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string().min(1).max(200),
})

/**
 * POST /api/auth/login — local demo-mode sign-in (email/password).
 * In Firebase mode the client signs in with Firebase Auth instead.
 */
export async function POST(req: NextRequest) {
  if (isFirebaseAdminConfigured()) {
    return NextResponse.json({ error: 'Sign-in is handled by Firebase Auth in this deployment.' }, { status: 409 })
  }

  const limited = rateLimit(`login:${clientIp(req)}`, 15, 10 * 60 * 1000)
  if (!limited.ok) {
    return NextResponse.json({ error: 'Too many attempts — try again in a few minutes.' }, { status: 429 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Please enter your email and password.' }, { status: 400 })
  }

  const store = await getStore()
  const user = await store.getUserByEmail(parsed.data.email)
  const passwordOk = user ? await store.verifyUserPassword(user.id, parsed.data.password) : false
  if (!user || !passwordOk) {
    return NextResponse.json({ error: 'That email or password is not right.' }, { status: 401 })
  }

  const { token, tokenHash } = newSessionToken()
  await store.createSession({ tokenHash, userId: user.id, expiresAt: sessionExpiry().toISOString() })

  const res = NextResponse.json({ user: publicUser(user) })
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions)
  return res
}
