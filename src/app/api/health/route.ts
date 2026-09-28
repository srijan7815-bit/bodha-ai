import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/health — simple health + config check.
 */
export async function GET() {
  const { aiStatus } = await import('@/lib/ai')
  const { storeMode } = await import('@/lib/store')

  return NextResponse.json({
    ok: true,
    app: 'BODHA AI',
    ai: aiStatus(),
    store: storeMode(),
    time: new Date().toISOString(),
  })
}