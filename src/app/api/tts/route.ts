import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/firebase/server-auth'
import { clientIp, rateLimit } from '@/lib/rate-limit'
import { chunkForSpeech, synthesize, type TtsProvider } from '@/lib/speech'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_CHARS = 1500

/**
 * POST /api/tts — one passage of speech, Fish Audio only.
 *
 * Body: { text, voice?, language?, provider? } — `provider` is accepted for
 * older clients and ignored. Hindi (Devanagari) text is read by a Hindi voice.
 * 503 with `fallback: true` tells the client to use the device voice instead.
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const limited = rateLimit(`tts:${user.id}:${clientIp(req)}`, 80, 10 * 60 * 1000)
  if (!limited.ok) return NextResponse.json({ error: 'Too many read-aloud requests.' }, { status: 429 })

  const body = await req.json().catch(() => null)
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, MAX_CHARS) : ''
  const voice = typeof body?.voice === 'string' ? body.voice : null
  const provider: TtsProvider =
    body?.provider === 'fish' || body?.provider === 'magpie' || body?.provider === 'auto'
      ? body.provider
      : 'auto'
  const language = typeof body?.language === 'string' ? body.language : 'en-US'
  if (!text) return NextResponse.json({ error: 'Nothing to read.' }, { status: 400 })

  // The timeout is per piece, not per passage: long text is split into
  // 320-character sentences and synthesised in parallel, so a four-minute-long
  // answer still comes back inside one writer's read-aloud pause. Live Mode
  // wants the faster voice and a shorter leash, because a stall there is heard
  // as dead air.
  const audio = await synthesize(text, {
    voice,
    language,
    provider,
    timeoutMs: 25_000,
  })
  if (!audio) {
    return NextResponse.json(
      { error: 'BODHA\'s voice is taking a breath — the device voice will read this.', fallback: true },
      { status: 503 },
    )
  }

  return new NextResponse(audio.bytes, {
    headers: {
      'Content-Type': audio.contentType,
      'Content-Length': String(audio.bytes.byteLength),
      'Cache-Control': 'no-store',
      'X-TTS-Provider': audio.provider,
      'X-TTS-Pieces': String(chunkForSpeech(text).length),
    },
  })
}
