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

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string().min(1).max(200),
})

/**
 * POST /api/auth/login — email/password sign-in.
 *
 * Works in both stores: the file store checks its on-disk hash, and the
 * Firestore store checks the scrypt hash kept on users/{uid}, so sign-in never
 * depends on Firebase Authentication being enabled. On success an httpOnly
 * session cookie is issued — the same session the app shell reads.
 */
export async function POST(req: NextRequest) {
  const limited = rateLimit(`login:${clientIp(req)}`, 15, 10 * 60 * 1000)
  if (!limited.ok) {
    return NextResponse.json({ error: 'Too many attempts — try again in a few minutes.' }, { status: 429 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Please enter your email and password.' }, { status: 400 })
  }

  // Database unreachable / credentials rejected — say so instead of a bare 500.
  const unavailable = NextResponse.json(
    {
      error:
        'Accounts are temporarily unavailable — the server could not reach its database. Please try again in a moment.',
    },
    { status: 503 },
  )

  try {
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
  } catch (err) {
    // Database unreachable / credentials rejected — say so instead of a bare 500.
    console.error('[auth/login] account store failed:', (err as Error).message)
    return unavailable
  }
}
