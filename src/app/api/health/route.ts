import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/health — simple health + config check.
 */
export async function GET() {
  const { aiStatus } = await import('@/lib/ai')
  const { storeMode } = await import('@/lib/store')
  const { adminHealth } = await import('@/lib/firebase/admin')
  const { speechStatus } = await import('@/lib/speech')

  const admin = await adminHealth()

  return NextResponse.json({
    ok: admin.admin !== 'error' && admin.firestore !== 'error',
    app: 'BODHA AI',
    ai: aiStatus(),
    store: storeMode(),
    speech: speechStatus(),
    admin,
    time: new Date().toISOString(),
  })
}