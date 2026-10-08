import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/firebase/server-auth'
import { getStore } from '@/lib/store'
import { runWatchdog } from '@/lib/ai/watchdog'
import { applySystemState } from '@/lib/ai/system-state'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** A background check is skipped if the last one is newer than this. */
const MIN_GAP_MS = 4 * 60 * 1000

/** GET /api/watchdog — the last health report (no new tests are run). */
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const state = await (await getStore()).getSystemState().catch(() => null)
  if (state) applySystemState(state)
  return NextResponse.json({ state })
}

/**
 * POST /api/watchdog — run a check now.
 * Body: { force?: boolean, deep?: boolean }. Without `force` the check is
 * skipped when a recent one exists, so many open tabs cost one test run.
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { force?: boolean; deep?: boolean }
  const store = await getStore()
  const last = await store.getSystemState().catch(() => null)
  const age = last ? Date.now() - new Date(last.checkedAt).getTime() : Infinity

  // Even a forced run is held to 20 s apart, so the button cannot be hammered.
  if (age < (body.force ? 20_000 : MIN_GAP_MS) && last) {
    applySystemState(last)
    return NextResponse.json({ state: last, skipped: true })
  }
  const state = await runWatchdog({ deep: Boolean(body.deep) })
  return NextResponse.json({ state, skipped: false })
}
