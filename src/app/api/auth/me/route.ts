import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, publicUser } from '@/lib/auth'
import { isFirebaseAdminConfigured } from '@/lib/firebase/admin'
import { aiStatus } from '@/lib/ai'
import { storeMode } from '@/lib/store'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/me — the signed-in user + which auth mode the app runs in.
 *  - mode 'firebase': client should use Firebase Auth and Bearer ID tokens
 *  - mode 'local':    email/password + httpOnly session cookie (demo mode)
 */
export async function GET(req: NextRequest) {
  const mode = isFirebaseAdminConfigured() ? 'firebase' : 'local'
  const user = await getSessionUser()
  return NextResponse.json({
    user: user ? publicUser(user) : null,
    mode,
    ai: aiStatus(),
    store: storeMode(),
  })
}
