import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/firebase/server-auth'
import { getStore } from '@/lib/store'
import { clientIp, rateLimit } from '@/lib/rate-limit'
import { DEFAULT_SETTINGS, publicSettings, type CustomEndpoint, type ModelChoice } from '@/lib/types'
import { defaultLabel, normalizeBaseUrl, testEndpoint, validateEndpoint } from '@/lib/ai/custom'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * The student's own model endpoint, and their preferences.
 *
 * GET    → { settings }            everything except the API key
 * PUT    → { settings, test?, error? }   save; the key only ever travels up
 * DELETE → disconnect the endpoint
 *
 * The key is written here and read only inside the messages route. It is never
 * returned to the browser, not even to the form that typed it — the form shows
 * a masked placeholder once a key is stored.
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const store = await getStore()
  return NextResponse.json({ settings: publicSettings(await store.getUserSettings(user.id)) })
}

export async function PUT(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const limited = rateLimit(`settings:${user.id}:${clientIp(req)}`, 20, 5 * 60 * 1000)
  if (!limited.ok) {
    return NextResponse.json({ error: 'Too many changes just now — try again in a minute.' }, { status: 429 })
  }

  const body = (await req.json().catch(() => null)) as
    | {
        custom?: { baseUrl?: string; apiKey?: string; model?: string; label?: string } | null
        preferredModel?: ModelChoice
        voice?: string | null
      }
    | null
  if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const store = await getStore()
  const current = (await store.getUserSettings(user.id)) ?? { ...DEFAULT_SETTINGS }

  // ── Connect or update an endpoint ──
  if (body.custom) {
    const incomingKey = body.custom.apiKey?.trim() ?? ''
    // An empty key field means "keep the one you already have" — the browser has
    // never seen it, so it cannot send it back.
    const apiKey = incomingKey || current.custom?.apiKey || ''
    const candidate: CustomEndpoint = {
      baseUrl: normalizeBaseUrl(body.custom.baseUrl ?? ''),
      apiKey,
      model: (body.custom.model ?? '').trim(),
      label: body.custom.label?.trim() ?? '',
    }

    const invalid = validateEndpoint(candidate)
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 })

    // Prove it works before storing a broken configuration.
    const tested = await testEndpoint(candidate)
    if (!tested.ok) return NextResponse.json({ error: tested.error }, { status: 400 })

    candidate.label = defaultLabel(candidate)
    await store.saveUserSettings(user.id, {
      ...current,
      custom: candidate,
      preferredModel: body.preferredModel ?? 'custom',
      updatedAt: new Date().toISOString(),
    })
    return NextResponse.json({
      settings: publicSettings(await store.getUserSettings(user.id)),
      test: { ok: true, sample: tested.sample },
    })
  }

  // ── Preferences only (the model toggle, the voice) ──
  const next = {
    ...current,
    preferredModel: body.preferredModel ?? current.preferredModel,
    voice: body.voice === undefined ? current.voice : body.voice,
    updatedAt: new Date().toISOString(),
  }
  // Asking for the custom model when none is connected would leave the toggle
  // pointing at nothing.
  if (next.preferredModel === 'custom' && !next.custom) next.preferredModel = 'bodha'
  await store.saveUserSettings(user.id, next)
  return NextResponse.json({ settings: publicSettings(next) })
}

export async function DELETE(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const store = await getStore()
  const current = (await store.getUserSettings(user.id)) ?? { ...DEFAULT_SETTINGS }
  await store.saveUserSettings(user.id, {
    ...current,
    custom: null,
    preferredModel: 'bodha',
    updatedAt: new Date().toISOString(),
  })
  return NextResponse.json({ settings: publicSettings(await store.getUserSettings(user.id)) })
}
