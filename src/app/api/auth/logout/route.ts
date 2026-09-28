import { NextRequest, NextResponse } from 'next/server'
import { getStore } from '@/lib/store'
import { getSessionUser, hashToken, SESSION_COOKIE } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/logout — clears the local demo-mode session cookie.
 * Firebase sign-out happens client-side (Firebase Auth SDK).
 */
export async function POST(req: NextRequest) {
  const store = await getStore()

  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (token) {
    await store.deleteSession(hashToken(token)).catch(() => {})
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
