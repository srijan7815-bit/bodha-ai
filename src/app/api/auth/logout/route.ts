import { NextRequest, NextResponse } from 'next/server'
import { getStore } from '@/lib/store'
import { getSessionUser, hashToken, SESSION_COOKIE } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/logout — clears the local demo-mode session cookie.
 * Firebase sign-out happens client-side (Firebase Auth SDK).
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (token) {
    // Signing out must succeed even if the store is having a bad day — the
    // cookie is cleared either way.
    try {
      const store = await getStore()
      await store.deleteSession(hashToken(token))
    } catch (err) {
      console.warn('[auth/logout] could not delete the stored session:', (err as Error).message)
    }
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.delete(SESSION_COOKIE)
  return res
}

/** GET /api/auth/me — current local-mode user (null when signed out). */
export async function GET() {
  const user = await getSessionUser()
  return NextResponse.json({ user })
}
