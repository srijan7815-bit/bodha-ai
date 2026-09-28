import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/firebase/server-auth'
import { clientIp, rateLimit } from '@/lib/rate-limit'
import { synthesize } from '@/lib/speech'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_CHARS = 1500

/**
 * POST /api/tts — read-aloud.
 *
 * Fish Audio first (the nicer voice), NVIDIA Magpie second. Both are proxied so
 * the keys stay on the server. Status codes the client acts on:
 *   503 — no provider configured/available → use the browser voice
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const limited = rateLimit(`tts:${user.id}:${clientIp(req)}`, 80, 10 * 60 * 1000)
  if (!limited.ok) return NextResponse.json({ error: 'Too many read-aloud requests.' }, { status: 429 })

  const body = await req.json().catch(() => null)
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, MAX_CHARS) : ''
  const voice = typeof body?.voice === 'string' ? body.voice : null
  if (!text) return NextResponse.json({ error: 'Nothing to read.' }, { status: 400 })

  const audio = await synthesize(text, { voice })
  if (!audio) {
    return NextResponse.json(
      { error: 'No voice service answered — the browser voice will read this.', fallback: true },
      { status: 503 },
    )
  }

  return new NextResponse(audio.bytes, {
    headers: {
      'Content-Type': audio.contentType,
      'Content-Length': String(audio.bytes.byteLength),
      'Cache-Control': 'no-store',
      'X-TTS-Provider': audio.provider,
    },
  })
}
