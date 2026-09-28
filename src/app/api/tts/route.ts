import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/firebase/server-auth'
import { clientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const FISH_TTS_URL = 'https://api.fish.audio/v1/tts'
const MAX_CHARS = 1200

/**
 * POST /api/tts — text-to-speech proxy (Fish Audio).
 *
 * The key stays server-side and the browser never talks to Fish directly.
 * Fish Audio selects the voice model from the `model` *header* (putting it in
 * the JSON body silently bills a paid model and fails with 402), so that is
 * exactly how we send it. Returns audio/mpeg, or a status the client can use to
 * fall back to the browser's own voice:
 *   402 — out of Fish Audio credit
 *   503 — TTS not configured
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const limited = rateLimit(`tts:${user.id}:${clientIp(req)}`, 60, 10 * 60 * 1000)
  if (!limited.ok) return NextResponse.json({ error: 'Too many read-aloud requests.' }, { status: 429 })

  const body = await req.json().catch(() => null)
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, MAX_CHARS) : ''
  if (!text) return NextResponse.json({ error: 'Nothing to read.' }, { status: 400 })

  const apiKey = process.env.FISH_AUDIO_API_KEY?.trim()
  const model = process.env.FISH_AUDIO_TTS_MODEL?.trim() || 's2.1-pro-free'
  if (!apiKey) return NextResponse.json({ error: 'Text-to-speech is not configured.' }, { status: 503 })

  try {
    const res = await fetch(FISH_TTS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        model, // <- model goes in the header, never the body
      },
      body: JSON.stringify({
        text,
        format: 'mp3',
        mp3_bitrate: 128,
        normalize: true,
        latency: 'normal',
      }),
      signal: AbortSignal.timeout(45_000),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      if (res.status === 402) {
        console.warn('[tts] Fish Audio is out of credit — falling back to the browser voice.')
        return NextResponse.json({ error: 'Voice credit exhausted' }, { status: 402 })
      }
      console.warn('[tts] Fish Audio error', res.status, detail.slice(0, 200))
      return NextResponse.json({ error: 'Voice service unavailable' }, { status: 502 })
    }

    const audio = await res.arrayBuffer()
    if (!audio.byteLength) return NextResponse.json({ error: 'Empty audio' }, { status: 502 })

    return new NextResponse(audio, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audio.byteLength),
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.warn('[tts] failed:', (err as Error).message)
    return NextResponse.json({ error: 'Voice service unavailable' }, { status: 502 })
  }
}
