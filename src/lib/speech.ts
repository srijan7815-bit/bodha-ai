/**
 * NVIDIA speech — the voice layer BODHA actually runs on.
 *
 * Both models are NVIDIA-hosted NIM functions reached over their NVCF HTTP
 * invocation endpoints with the same `nvapi-…` key the chat models use, so
 * voice needs no second vendor and no second bill:
 *
 *   TTS  nvidia/magpie-tts-multilingual  /v1/audio/synthesize      → WAV
 *   STT  openai/whisper-large-v3        /v1/audio/transcriptions  → { text }
 *        nvidia/parakeet-ctc-1.1b-asr   /v1/audio/transcriptions  → { text }
 *
 * Two features with different needs, so they ask for different voices:
 *   • Read-aloud (the button under a message) asks for `fish` — Fish Audio's
 *     S2.1 Pro, the most natural voice, one clip at a time.
 *   • Live Mode asks for `magpie` — NVIDIA's own voice, which answers in ~1.9 s.
 *     A conversation speaks one clip per sentence, so latency beats timbre.
 * Either way the other provider is the fallback, and the browser voice is last,
 * so speech never just stops working.
 *
 * STT is Whisper large v3 first, as specified. Whisper's hosted HTTP route is
 * currently broken at NVIDIA's end — it answers 500 for every request shape
 * (verified 8 ways, including the older pexec API), while Parakeet answers 200
 * on the same audio. Rather than let a dead route add a second to every single
 * turn forever, a short-lived breaker skips Whisper after a 5xx and retries it
 * ten minutes later, so the moment NVIDIA's function recovers it takes over with
 * no code change and no redeploy.
 */

const WHISPER_FUNCTION_ID = process.env.WHISPER_FUNCTION_ID || 'b702f636-f60c-4a3d-a6f4-f3568c13bd7d'
export const PARAKEET_FUNCTION_ID = process.env.PARAKEET_FUNCTION_ID || '1598d209-5e27-4d3c-8079-4751568b1081'
export const MAGPIE_FUNCTION_ID = process.env.MAGPIE_FUNCTION_ID || '877104f7-e885-42b9-8de8-f6e4c6303969'

/**
 * Whisper's route is dead upstream at the moment. Ten minutes is long enough
 * that a broken route costs nothing, and short enough that a recovery is picked
 * up while the student is still using the app.
 */
const WHISPER_BREAKER_MS = 10 * 60 * 1000
let whisperDownUntil = 0

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

/** Which voice a caller wants first. */
export type TtsProvider = 'fish' | 'magpie' | 'auto'

/**
 * Fish Audio reference ids, so the read-aloud voice is a chosen voice rather
 * than whatever Fish picks by default. Keyed by the same speaker names Magpie
 * uses, so switching provider never changes which voice the student picked.
 */
const FISH_VOICES: Record<string, string> = {
  Aria: process.env.FISH_VOICE_ARIA || '933563129e564b19a115bedd57b7406a', // warm female
  Sofia: process.env.FISH_VOICE_SOFIA || 'f48d143a59a946ab87c0130fd081f349',
  Mia: process.env.FISH_VOICE_MIA || '98655a12fa944e26b274c535e5e03842',
  Ray: process.env.FISH_VOICE_RAY || '536d3a5e000945adb7038665781a4aca', // male narration
  Jason: process.env.FISH_VOICE_JASON || 'd8a1340984ee4b63ad1ffae27a6a4339',
  Leo: process.env.FISH_VOICE_LEO || 'c5f56a6cc2ec4fa8920cb4c5889a3fb7',
}

function fishReference(voice?: string | null): string {
  const raw = String(voice ?? '').trim()
  if (!raw) return FISH_VOICES.Aria
  if (/^[0-9a-f]{32}$/i.test(raw)) return raw // already a Fish reference id
  return FISH_VOICES[raw] ?? FISH_VOICES.Aria
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
  opts: { voice?: string | null; language?: string; timeoutMs?: number; provider?: TtsProvider } = {},
): Promise<Synthesized | null> {
  const language = opts.language ?? 'en-US'
  const timeout = opts.timeoutMs ?? 20_000
  // 'magpie' puts NVIDIA's voice in front: Live Mode speaks one clip per
  // sentence and needs the faster answer. 'fish' and 'auto' lead with Fish.
  const magpieFirst = opts.provider === 'magpie'

  if (!magpieFirst) {
    const early = await fishSynthesize(text, opts.voice, timeout)
    if (early) return early
  }

  const magpie = await magpieSynthesize(text, opts.voice, language, timeout)
  if (magpie) return magpie
  if (magpieFirst) return fishSynthesize(text, opts.voice, timeout)

  return null
}

async function fishSynthesize(
  text: string,
  voice: string | null | undefined,
  timeout: number,
): Promise<Synthesized | null> {
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
        body: JSON.stringify({ text, format: 'mp3', reference_id: fishReference(voice) }),
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
  return null
}

async function magpieSynthesize(
  text: string,
  voice: string | null | undefined,
  language: string,
  timeout: number,
): Promise<Synthesized | null> {
  const key = nvidiaKey()
  if (!key) return null

  try {
    const form = new FormData()
    form.append('text', text)
    form.append('language', language)
    form.append('voice', resolveMagpieVoice(voice, language))
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
 * Speech → text: Whisper large v3, then Parakeet CTC, then Fish Audio.
 *
 * Whisper is the model the product asked for and is tried first on every
 * attempt the breaker allows; Parakeet is what answers while NVIDIA's Whisper
 * function is down. Both are NVIDIA NIM, reached with the same key as the chat
 * models, so dictation needs no second vendor.
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

  const attempts: Array<{
    label: string
    run: () => Promise<Response>
    onFail?: (status: number) => void
  }> = []
  const key = nvidiaKey()

  /** One multipart body, built fresh for each provider. */
  const formFor = (model: string | null, lang: string) => {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `audio.${extension}`)
    // Whisper takes a `model` field; Parakeet rejects an unknown one.
    if (model) form.append('model', model)
    form.append('language', lang)
    form.append('response_format', 'json')
    return form
  }

  if (key) {
    // ── Whisper large v3 first, as specified ──
    // Its hosted HTTP route is down at NVIDIA's end right now (a hard 500 for
    // every request shape, on both the invocation and pexec hosts, while
    // Parakeet answers 200 on the same audio). A dead route must not add a
    // second to every single turn forever, so a short breaker steps over it and
    // retries every ten minutes — the moment NVIDIA's function recovers,
    // Whisper becomes the model that answers, with no code change.
    if (Date.now() >= whisperDownUntil) {
      attempts.push({
        label: 'whisper-large-v3',
        run: () =>
          fetch(nvcfURL(WHISPER_FUNCTION_ID, '/v1/audio/transcriptions'), {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}` },
            body: formFor('whisper-large-v3', bare),
            signal: AbortSignal.timeout(timeout),
          }),
        onFail: status => {
          if (status >= 500) {
            whisperDownUntil = Date.now() + WHISPER_BREAKER_MS
            console.warn('[speech] whisper-large-v3 answered', status, '— skipping it for 10 minutes')
          }
        },
      })
    }

    // ── Parakeet CTC: the model that actually answers on HTTP ──
    attempts.push({
      label: 'parakeet',
      run: () =>
        fetch(nvcfURL(PARAKEET_FUNCTION_ID, '/v1/audio/transcriptions'), {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}` },
          body: formFor(null, regional),
          signal: AbortSignal.timeout(timeout),
        }),
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
        attempt.onFail?.(res.status)
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
