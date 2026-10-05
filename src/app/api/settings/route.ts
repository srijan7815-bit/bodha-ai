import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/firebase/server-auth'
import { getStore } from '@/lib/store'
import { clientIp, rateLimit } from '@/lib/rate-limit'
import {
  BODHA_MODEL,
  DEFAULT_SETTINGS,
  migrateSettings,
  publicSettings,
  type UserSettings,
} from '@/lib/types'
import {
  listEndpointModels,
  normalizeEndpoint,
  testEndpointModels,
  validateEndpoint,
  type ModelTestResult,
} from '@/lib/ai/custom'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * The student's own model endpoint, and their preferences.
 *
 * GET    → { settings }                      everything except the API key
 * PUT    → { settings, results?, warning? }  save; the key only ever travels up
 * POST   → { models } | { error }            ask the endpoint what it serves
 * DELETE → { settings }                      forget the endpoint and its key
 *
 * The key is written here and read only inside the messages route. It is never
 * returned to the browser, not even to the form that typed it.
 */

async function current(userId: string): Promise<UserSettings> {
  const store = await getStore()
  const raw = await store.getUserSettings(userId)
  return migrateSettings(raw) ?? { ...DEFAULT_SETTINGS }
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  return NextResponse.json({ settings: publicSettings(await current(user.id)) })
}

export async function PUT(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const limited = rateLimit(`settings:${user.id}:${clientIp(req)}`, 30, 5 * 60 * 1000)
  if (!limited.ok) {
    return NextResponse.json({ error: 'Too many changes just now — try again in a minute.' }, { status: 429 })
  }

  const body = (await req.json().catch(() => null)) as
    | {
        custom?: {
          baseUrl?: string
          apiKey?: string
          models?: Array<{ id?: string; label?: string }>
          /** Save even though the endpoint did not answer our test. */
          skipTest?: boolean
        } | null
        preferredModel?: string
        voice?: string | null
      }
    | null
  if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const store = await getStore()
  const existing = await current(user.id)

  // ── Connect or update an endpoint ──
  if (body.custom) {
    const incomingKey = body.custom.apiKey?.trim() ?? ''
    // An empty key field means "keep the one you already have" — the browser has
    // never seen it, so it cannot send it back.
    const apiKey = incomingKey || existing.custom?.apiKey || ''

    const candidate = normalizeEndpoint({
      baseUrl: body.custom.baseUrl,
      apiKey,
      models: (body.custom.models ?? []) as never,
      verified: existing.custom?.verified,
      verifiedAt: existing.custom?.verifiedAt,
    })

    const invalid = validateEndpoint(candidate)
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 })

    // Prove each model works before storing the configuration — but never make
    // this a wall. A provider may be down today, or refuse datacenter IPs
    // entirely, and a student who wants to try anyway should be able to.
    const results: ModelTestResult[] = body.custom.skipTest ? [] : await testEndpointModels(candidate)
    const anyOk = results.some(result => result.ok)

    if (!body.custom.skipTest && !anyOk) {
      return NextResponse.json(
        {
          error: results[0]?.error ?? 'None of those models answered.',
          results,
          canSaveAnyway: true,
        },
        { status: 400 },
      )
    }

    const next: UserSettings = {
      ...existing,
      custom: {
        ...candidate,
        verified: anyOk,
        verifiedAt: anyOk ? new Date().toISOString() : candidate.verifiedAt,
      },
      // Land the toggle on a model that actually answered, if we tested.
      preferredModel:
        body.preferredModel ??
        (results.find(result => result.ok)?.id ||
          (anyOk ? candidate.models[0].id : candidate.models[0].id)),
      updatedAt: new Date().toISOString(),
    }
    await store.saveUserSettings(user.id, next)
    return NextResponse.json({
      settings: publicSettings(next),
      results,
      warning: anyOk
        ? undefined
        : 'Saved without a successful test. BODHA will try this endpoint on your next question, and fall back to its own models if it does not answer.',
    })
  }

  // ── Preferences only (the model toggle, the voice) ──
  const wanted = body.preferredModel ?? existing.preferredModel
  const known =
    wanted === BODHA_MODEL ||
    Boolean(existing.custom?.models.some(model => model.id === wanted))
  const next: UserSettings = {
    ...existing,
    preferredModel: known ? wanted : BODHA_MODEL,
    voice: body.voice === undefined ? existing.voice : body.voice,
    updatedAt: new Date().toISOString(),
  }
  await store.saveUserSettings(user.id, next)
  return NextResponse.json({ settings: publicSettings(next) })
}

/** POST — ask the student's endpoint which models it serves. */
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const limited = rateLimit(`settings-list:${user.id}:${clientIp(req)}`, 20, 5 * 60 * 1000)
  if (!limited.ok) return NextResponse.json({ error: 'Too many requests — try again in a minute.' }, { status: 429 })

  const body = (await req.json().catch(() => null)) as
    | { baseUrl?: string; apiKey?: string }
    | null

  const existing = await current(user.id)
  // Same rule as saving: a blank key means "use the stored one".
  const apiKey = body?.apiKey?.trim() || existing.custom?.apiKey || ''
  const result = await listEndpointModels({ baseUrl: body?.baseUrl ?? existing.custom?.baseUrl ?? '', apiKey })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ models: result.models })
}

export async function DELETE(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const store = await getStore()
  const existing = await current(user.id)
  const next: UserSettings = {
    ...existing,
    custom: null,
    preferredModel: BODHA_MODEL,
    updatedAt: new Date().toISOString(),
  }
  await store.saveUserSettings(user.id, next)
  return NextResponse.json({ settings: publicSettings(next) })
}
