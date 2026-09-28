import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/firebase/server-auth'
import { clientIp, rateLimit } from '@/lib/rate-limit'
import { transcribe } from '@/lib/speech'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_BYTES = 12 * 1024 * 1024

/**
 * POST /api/stt — dictation.
 *
 * Multipart form: { audio: File } (optionally `language`).
 *
 * NVIDIA Parakeet answers this reliably; Fish Audio transcribe-1 and Whisper
 * are tried in turn if it does not. When every provider declines, the client is
 * told to fall back to the browser's own recogniser (`fallback: true`).
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const limited = rateLimit(`stt:${user.id}:${clientIp(req)}`, 60, 10 * 60 * 1000)
  if (!limited.ok) return NextResponse.json({ error: 'Too many dictation requests.' }, { status: 429 })

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
    return NextResponse.json({ error: 'That recording is too long.', fallback: true }, { status: 413 })
  }

  const language = typeof form.get('language') === 'string' ? String(form.get('language')) : undefined
  const result = await transcribe(Buffer.from(await audio.arrayBuffer()), audio.type || 'audio/webm', { language })

  if ('error' in result) {
    return NextResponse.json({ error: result.error, fallback: true }, { status: result.status })
  }

  return NextResponse.json({ text: result.text, provider: result.provider })
}
