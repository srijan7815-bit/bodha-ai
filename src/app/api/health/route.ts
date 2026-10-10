import { NextRequest, NextResponse } from 'next/server'
import manifest from '../../../../env.manifest.json'
import { getAuthUser } from '@/lib/firebase/server-auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/health — simple health + config check.
 */
export async function GET(req: NextRequest) {
  const { aiStatus } = await import('@/lib/ai')
  const { storeMode } = await import('@/lib/store')
  const { adminHealth } = await import('@/lib/firebase/admin')
  const { speechStatus } = await import('@/lib/speech')

  const admin = await adminHealth()

  // Are the variables that matter actually present in THIS deployment? The
  // names of any that are missing are shown only to a signed-in user.
  const missing = manifest.required.map(v => v.name).filter(name => !process.env[name]?.trim())
  const signedIn = missing.length ? Boolean(await getAuthUser(req).catch(() => null)) : false

  return NextResponse.json({
    env: { ok: missing.length === 0, ...(signedIn ? { missing } : {}) },
    ok: admin.admin !== 'error' && admin.firestore !== 'error',
    app: 'BODHA AI',
    ai: aiStatus(),
    store: storeMode(),
    speech: speechStatus(),
    admin,
    time: new Date().toISOString(),
  })
}