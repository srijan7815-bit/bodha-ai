/**
 * NVIDIA speech — the voice layer BODHA actually runs on.
 *
 * Both models are NVIDIA-hosted NIM functions reached over their NVCF HTTP
 * invocation endpoints with the same `nvapi-…` key the chat models use, so
 * voice needs no second vendor and no second bill:
 *
 *   TTS  nvidia/magpie-tts-multilingual  /v1/audio/synthesize      → WAV
 *   STT  nvidia/parakeet-ctc-1.1b-asr    /v1/audio/transcriptions  → { text }
 *
 * Verified against the live endpoints from this workspace: Magpie returned a
 * 252 KB WAV in 1.9 s and Parakeet transcribed it back correctly in 1.7 s.
 * whisper-large-v3 is exposed on the same route but its HTTP invocation answers
 * 500 for every request (NVIDIA documents it as gRPC), so Parakeet is primary.
 */

const WHISPER_FUNCTION_ID = process.env.WHISPER_FUNCTION_ID || 'b702f636-f60c-4a3d-a6f4-f3568c13bd7d'
export const PARAKEET_FUNCTION_ID = process.env.PARAKEET_FUNCTION_ID || '1598d209-5e27-4d3c-8079-4751568b1081'
export const MAGPIE_FUNCTION_ID = process.env.MAGPIE_FUNCTION_ID || '877104f7-e885-42b9-8de8-f6e4c6303969'

export function nvcfURL(functionId: string, path: string) {
  return `https://${functionId}.invocation.api.nvcf.nvidia.com${path}`
}

/** Speaker identities Magpie exposes for en-US. */
export const MAGPIE_VOICES = ['Aria', 'Ray', 'Sofia', 'Jason', 'Leo', 'Mia'] as const
export type MagpieVoice = (typeof MAGPIE_VOICES)[number]

export function nvidiaKey(): string | null {
  return process.env.NVIDIA_API_KEY?.trim() || process.env.AI_API_KEY?.trim() || null
}

export function resolveMagpieVoice(input?: string | null, language = 'en-US'): string {
  const raw = String(input ?? '').trim()
  if (/^Magpie-/i.test(raw)) return raw
  const speaker =
    MAGPIE_VOICES.find(v => v.toLowerCase() === raw.toLowerCase()) ?? ('Aria' as MagpieVoice)
  return `Magpie-Multilingual.${language.toUpperCase()}.${speaker}`
}

export interface Synthesized {
  bytes: ArrayBuffer
  contentType: string
  provider: 'fish' | 'magpie'
}

/**
 * Text → speech, best available first.
 *
 * Fish Audio's S2.1 Pro sounds more human, so it goes first when a key exists;
 * NVIDIA Magpie is the fallback that keeps read-aloud alive when Fish is out of
 * credit or slow. Returns null only when neither provider answered, which is
 * the client's cue to use the browser's own voice.
 */
export async function synthesize(
  text: string,
  opts: { voice?: string | null; language?: string; timeoutMs?: number } = {},
): Promise<Synthesized | null> {
  const language = opts.language ?? 'en-US'
  const timeout = opts.timeoutMs ?? 20_000

  const fishKey = process.env.FISH_AUDIO_API_KEY?.trim()
  if (fishKey) {
    try {
      const res = await fetch(process.env.FISH_TTS_URL?.trim() || 'https://api.fish.audio/v1/tts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${fishKey}`,
          'Content-Type': 'application/json',
          // Fish selects the voice model from a HEADER; sending it in the JSON
          // body silently bills a paid model and fails with 402.
          model: process.env.FISH_AUDIO_TTS_MODEL?.trim() || 's2.1-pro-free',
        },
        body: JSON.stringify({ text, format: 'mp3' }),
        signal: AbortSignal.timeout(timeout),
      })
      if (res.ok) {
        const bytes = await res.arrayBuffer()
        if (bytes.byteLength > 1000) {
          return { bytes, contentType: res.headers.get('content-type') || 'audio/mpeg', provider: 'fish' }
        }
      } else {
        console.warn('[speech] Fish Audio TTS declined:', res.status)
      }
    } catch (err) {
      console.warn('[speech] Fish Audio TTS failed:', (err as Error).message)
    }
  }

  const key = nvidiaKey()
  if (!key) return null

  try {
    const form = new FormData()
    form.append('text', text)
    form.append('language', language)
    form.append('voice', resolveMagpieVoice(opts.voice, language))
    form.append('encoding', 'LINEAR_PCM')
    form.append('sample_rate_hz', process.env.TTS_SAMPLE_RATE?.trim() || '22050')

    const res = await fetch(nvcfURL(MAGPIE_FUNCTION_ID, '/v1/audio/synthesize'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(timeout),
    })

    if (!res.ok) {
      console.warn('[speech] Magpie TTS failed:', res.status, (await res.text().catch(() => '')).slice(0, 160))
      return null
    }

    const type = res.headers.get('content-type') || ''
    // Some deployments answer JSON with base64 audio instead of raw bytes.
    if (type.includes('application/json')) {
      const data = (await res.json().catch(() => ({}))) as Record<string, string>
      const b64 = data.audio || data.audio_base64 || data.audio_content || ''
      if (!b64) return null
      const buf = Buffer.from(b64, 'base64')
      return { bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, contentType: 'audio/wav', provider: 'magpie' }
    }

    const bytes = await res.arrayBuffer()
    if (!bytes.byteLength) return null
    return { bytes, contentType: type.startsWith('audio/') ? type : 'audio/wav', provider: 'magpie' }
  } catch (err) {
    console.warn('[speech] Magpie TTS failed:', (err as Error).message)
    return null
  }
}

/**
 * Speech → text.
 *
 * Parakeet CTC first (it is the model that actually answers on HTTP), then
 * Fish Audio's transcribe-1 if it has credit, then Whisper as a last resort for
 * accounts NVIDIA restores it for.
 */
export async function transcribe(
  audio: Buffer,
  mime: string,
  opts: { language?: string; timeoutMs?: number } = {},
): Promise<{ text: string; provider: string } | { error: string; status: number }> {
  const timeout = opts.timeoutMs ?? 25_000
  // The container matters: iOS Safari records audio/mp4, and a file mislabelled
  // .webm is rejected outright.
  const extension = /wav/i.test(mime)
    ? 'wav'
    : /mpeg|mp3/i.test(mime)
      ? 'mp3'
      : /mp4|m4a|aac/i.test(mime)
        ? 'm4a'
        : /ogg|opus/i.test(mime)
          ? 'ogg'
          : /flac/i.test(mime)
            ? 'flac'
            : 'webm'

  const bare = (opts.language || process.env.STT_LANGUAGE || 'en').toLowerCase()
  const regional = /^[a-z]{2}$/.test(bare) ? `${bare}-US` : bare

  const attempts: Array<{ label: string; run: () => Promise<Response> }> = []
  const key = nvidiaKey()

  if (key) {
    attempts.push({
      label: 'parakeet',
      run: () => {
        const form = new FormData()
        form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `audio.${extension}`)
        form.append('language', regional)
        form.append('response_format', 'json')
        return fetch(nvcfURL(PARAKEET_FUNCTION_ID, '/v1/audio/transcriptions'), {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}` },
          body: form,
          signal: AbortSignal.timeout(timeout),
        })
      },
    })
    attempts.push({
      label: 'whisper',
      run: () => {
        const form = new FormData()
        form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `audio.${extension}`)
        form.append('model', 'whisper-large-v3')
        form.append('language', bare)
        form.append('response_format', 'json')
        return fetch(nvcfURL(WHISPER_FUNCTION_ID, '/v1/audio/transcriptions'), {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}` },
          body: form,
          signal: AbortSignal.timeout(timeout),
        })
      },
    })
  }

  const fishKey = process.env.FISH_AUDIO_API_KEY?.trim()
  if (fishKey) {
    attempts.push({
      label: 'fish',
      run: () => {
        const form = new FormData()
        form.append('audio', new Blob([new Uint8Array(audio)], { type: mime }), `audio.${extension}`)
        return fetch(process.env.FISH_STT_URL?.trim() || 'https://api.fish.audio/v1/asr', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${fishKey}`,
            model: process.env.FISH_AUDIO_STT_MODEL?.trim() || 'transcribe-1',
          },
          body: form,
          signal: AbortSignal.timeout(timeout),
        })
      },
    })
  }

  if (!attempts.length) return { error: 'Dictation is not configured.', status: 503 }

  let lastStatus = 502
  for (const attempt of attempts) {
    try {
      const res = await attempt.run()
      if (!res.ok) {
        lastStatus = res.status
        console.warn(`[speech] ${attempt.label} STT → HTTP ${res.status}`)
        continue
      }
      const data = (await res.json().catch(() => ({}))) as {
        text?: string
        transcript?: string
        results?: Array<{ alternatives?: Array<{ transcript?: string }> }>
      }
      const text = (data.text || data.transcript || data.results?.[0]?.alternatives?.[0]?.transcript || '').trim()
      if (text) return { text, provider: attempt.label }
      lastStatus = 422
    } catch (err) {
      console.warn(`[speech] ${attempt.label} STT failed:`, (err as Error).message)
      lastStatus = 504
    }
  }

  return {
    error:
      lastStatus === 422
        ? 'I could not hear any speech in that recording.'
        : 'The dictation service could not be reached. Your browser can still listen directly.',
    status: lastStatus === 422 ? 422 : 502,
  }
}
