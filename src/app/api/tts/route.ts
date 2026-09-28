import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/firebase/server-auth'
import { clientIp, rateLimit } from '@/lib/rate-limit'
import { synthesize, type TtsProvider } from '@/lib/speech'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_CHARS = 1500

/**
 * POST /api/tts — one passage of speech.
 *
 * Body: { text, voice?, language?, provider? }
 *
 * `provider` lets the two voice features ask for what they actually need:
 *   'fish'   → Fish Audio S2.1 Pro first — read-aloud, one clip, best voice.
 *   'magpie' → NVIDIA Magpie first — Live Mode, one clip per sentence, faster.
 *   'auto'   → Fish first, Magpie second (the default).
 * The other provider is always the fallback, so a single vendor outage degrades
 * the voice rather than silencing it. Proxied, so no key reaches the browser.
 *
 * 503 with `fallback: true` tells the client to use the browser voice instead.
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

  // Live Mode speaks one clip per sentence, so its budget is short — a long
  // Fish stall there would be heard as dead air between sentences.
  const audio = await synthesize(text, {
    voice,
    language,
    provider,
    timeoutMs: provider === 'magpie' ? 10_000 : 20_000,
  })
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
