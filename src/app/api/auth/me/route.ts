import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, publicUser } from '@/lib/auth'
import { isFirebaseAdminConfigured } from '@/lib/firebase/admin'
import { aiStatus } from '@/lib/ai'
import { storeMode } from '@/lib/store'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/me — the signed-in student, and how this deployment stores data.
 *
 * Sign-in is always the same: email and password against /api/auth/*, with an
 * httpOnly session cookie. `store` only says whether the data lives in Firestore
 * or in the local file store of a demo deployment.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  return NextResponse.json({
    user: user ? publicUser(user) : null,
    mode: isFirebaseAdminConfigured() ? 'firestore' : 'local',
    ai: aiStatus(),
    store: storeMode(),
  })
}
