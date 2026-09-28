import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/firebase/server-auth'
import { clientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const FISH_ASR_URL = 'https://api.fish.audio/v1/asr'
const MAX_BYTES = 12 * 1024 * 1024

/**
 * POST /api/stt — speech-to-text proxy (Fish Audio transcribe-1).
 *
 * Multipart form: { audio: File }
 *
 * Returns { text }. Status codes the client uses to decide about fallbacks:
 *   402 — no Fish Audio credit  → the browser's own recogniser takes over
 *   503 — not configured
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const limited = rateLimit(`stt:${user.id}:${clientIp(req)}`, 40, 10 * 60 * 1000)
  if (!limited.ok) return NextResponse.json({ error: 'Too many dictation requests.' }, { status: 429 })

  const apiKey = process.env.FISH_AUDIO_API_KEY?.trim()
  const model = process.env.FISH_AUDIO_STT_MODEL?.trim() || 'transcribe-1'
  if (!apiKey) return NextResponse.json({ error: 'Dictation is not configured.', fallback: true }, { status: 503 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 })
  }

  const audio = form.get('audio')
  if (!(audio instanceof File) || audio.size === 0) {
    return NextResponse.json({ error: 'Missing audio' }, { status: 400 })
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json({ error: 'That recording is too long.' }, { status: 413 })
  }

  const upstream = new FormData()
  upstream.append('audio', audio, audio.name || 'recording.webm')

  try {
    const res = await fetch(FISH_ASR_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, model },
      body: upstream,
      signal: AbortSignal.timeout(45_000),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      if (res.status === 402) {
        console.warn('[stt] Fish Audio is out of credit — the browser recogniser will be used.')
        return NextResponse.json({ error: 'Dictation credit exhausted', fallback: true }, { status: 402 })
      }
      console.warn('[stt] Fish Audio error', res.status, detail.slice(0, 200))
      return NextResponse.json({ error: 'Dictation service unavailable', fallback: true }, { status: 502 })
    }

    const data = (await res.json().catch(() => ({}))) as { text?: string; transcript?: string; duration?: number }
    const text = (data.text ?? data.transcript ?? '').trim()
    if (!text) return NextResponse.json({ error: 'I could not hear any speech.', fallback: true }, { status: 422 })

    return NextResponse.json({ text })
  } catch (err) {
    console.warn('[stt] failed:', (err as Error).message)
    return NextResponse.json({ error: 'Dictation service unavailable', fallback: true }, { status: 502 })
  }
}
