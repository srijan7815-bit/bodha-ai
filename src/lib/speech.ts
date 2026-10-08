/**
 * BODHA's voice layer.
 *
 *   TTS  Fish Audio only (S2.1 Pro). Hindi text is detected by script and read
 *        with a Hindi reference voice, so Devanagari is spoken like a native
 *        speaker would, not with an English voice reading Hindi letters.
 *   STT  Groq Whisper large v3 turbo first (fast, free tier, 99 languages,
 *        auto-detects Hindi / English / Hinglish), then Groq Whisper large v3,
 *        then Fish Audio ASR, then NVIDIA Parakeet (English only) as a last
 *        resort so dictation never just dies.
 *
 * Keys are read from the server environment only — nothing reaches the browser.
 */

import { chunkForSpeech, mapLimit } from './speech-chunks'

export { chunkForSpeech, SPEECH_CHUNK_CHARS } from './speech-chunks'

/** Kept so older callers compile; every value now means "Fish Audio". */
export type TtsProvider = 'fish' | 'magpie' | 'auto'

const PARAKEET_FUNCTION_ID = process.env.PARAKEET_FUNCTION_ID || '1598d209-5e27-4d3c-8079-4751568b1081'

function nvcfURL(functionId: string, path: string) {
  return `https://${functionId}.invocation.api.nvcf.nvidia.com${path}`
}

function nvidiaKey(): string | null {
  return process.env.NVIDIA_API_KEY?.trim() || process.env.AI_API_KEY?.trim() || null
}

function groqKey(): string | null {
  return process.env.GROQ_API_KEY?.trim() || null
}

/* ───────────────────────────── Fish Audio TTS ───────────────────────────── */

/**
 * Fish Audio reference ids, keyed by the speaker names the voice picker uses.
 * Override any of them from the environment.
 */
const FISH_VOICES: Record<string, string> = {
  Aria: process.env.FISH_VOICE_ARIA || '933563129e564b19a115bedd57b7406a', // warm female
  Sofia: process.env.FISH_VOICE_SOFIA || 'f48d143a59a946ab87c0130fd081f349',
  Mia: process.env.FISH_VOICE_MIA || '98655a12fa944e26b274c535e5e03842',
  Ray: process.env.FISH_VOICE_RAY || '536d3a5e000945adb7038665781a4aca', // male narration
  Jason: process.env.FISH_VOICE_JASON || 'd8a1340984ee4b63ad1ffae27a6a4339',
  Leo: process.env.FISH_VOICE_LEO || 'c5f56a6cc2ec4fa8920cb4c5889a3fb7',
}

/** Hindi reference voices (public Fish Audio models). Override with FISH_VOICE_HINDI_F / _M. */
const HINDI_FEMALE = process.env.FISH_VOICE_HINDI_F || 'a36c5e7d7dfb439c8d571acab05db554' // Hindi conversational narrator
const HINDI_MALE = process.env.FISH_VOICE_HINDI_M || 'da7bf83f01104a86b460c52e6153b24a' // Hindi narration, mature male
const MALE_SPEAKERS = new Set(['Ray', 'Jason', 'Leo'])

/** Share of letters that are Devanagari — the cheapest reliable "this is Hindi" test. */
export function devanagariShare(text: string): number {
  const letters = text.match(/[\p{L}\p{M}]/gu)
  if (!letters?.length) return 0
  const deva = text.match(/[\u0900-\u097F]/g)?.length ?? 0
  return deva / letters.length
}

/** Chosen once per passage, so a long answer never changes voice halfway through. */
function fishReference(voice: string | null | undefined, text: string): string {
  const raw = String(voice ?? '').trim()
  if (/^[0-9a-f]{32}$/i.test(raw)) return raw // already a Fish reference id
  if (devanagariShare(text) > 0.2) return MALE_SPEAKERS.has(raw) ? HINDI_MALE : HINDI_FEMALE
  return FISH_VOICES[raw] ?? FISH_VOICES.Aria
}

/**
 * Fish's free tier answers 429 when too many requests arrive together. All
 * synthesis on this server instance goes through a small gate, so read-aloud
 * chunks and Live Mode sentences queue politely instead of failing each other.
 */
const FISH_SLOTS = Math.max(1, Number(process.env.FISH_CONCURRENCY) || 2)
let fishBusy = 0
const fishWaiting: Array<() => void> = []
async function fishAcquire() {
  if (fishBusy < FISH_SLOTS) {
    fishBusy++
    return
  }
  await new Promise<void>(resolve => fishWaiting.push(resolve))
}
function fishRelease() {
  const next = fishWaiting.shift()
  if (next) next()
  else fishBusy--
}

let lastFishError: string | null = null
/** The most recent reason Fish declined, for the health card and the TTS route. */
export function fishLastError(): string | null {
  return lastFishError
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

export interface Synthesized {
  bytes: ArrayBuffer
  contentType: string
  provider: 'fish'
}

/**
 * Text → speech with Fish Audio. Long text is cut into sentences and
 * synthesised a few at a time, then joined in order (MP3 frames concatenate
 * into a file every player accepts). Returns null only when Fish itself is
 * unreachable, which is the client's cue to use the device voice.
 */
export async function synthesize(
  text: string,
  opts: { voice?: string | null; language?: string; timeoutMs?: number; provider?: TtsProvider } = {},
): Promise<Synthesized | null> {
  const timeout = opts.timeoutMs ?? 25_000
  // Emojis and pictograms are never read aloud.
  text = text.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0E\uFE0F\u200D\u20E3\u{1F3FB}-\u{1F3FF}\u2600-\u27BF\u2B00-\u2BFF]/gu, '')
  const chunks = chunkForSpeech(text)
  if (!chunks.length) return null

  const reference = fishReference(opts.voice, text)
  if (chunks.length === 1) return fishSynthesize(chunks[0], reference, timeout)

  const parts = await mapLimit(chunks, FISH_SLOTS, chunk => fishSynthesize(chunk, reference, timeout))
  // A missing piece would silently cut the answer in half, so a partial result
  // is treated as no result.
  if (parts.some(part => !part)) return null
  const bytes = Buffer.concat(parts.map(part => Buffer.from(part!.bytes)))
  return { bytes: toArrayBuffer(bytes), contentType: 'audio/mpeg', provider: 'fish' }
}

async function fishSynthesize(text: string, reference: string, timeout: number): Promise<Synthesized | null> {
  const fishKey = process.env.FISH_AUDIO_API_KEY?.trim()
  if (!fishKey) return null

  // Retries: Fish answers 429/5xx under load, and a moment later it lands.
  // Anything else (bad key, no credit) is final.
  await fishAcquire()
  try {
  for (let attempt = 0; attempt < 3; attempt++) {
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
        body: JSON.stringify({ text, format: 'mp3', reference_id: reference }),
        signal: AbortSignal.timeout(timeout),
      })
      if (res.ok) {
        const bytes = await res.arrayBuffer()
        if (bytes.byteLength > 1000) {
          lastFishError = null
          return { bytes, contentType: res.headers.get('content-type') || 'audio/mpeg', provider: 'fish' }
        }
        lastFishError = 'Fish returned an empty clip'
        return null
      }
      lastFishError = `Fish Audio answered HTTP ${res.status}${res.status === 402 ? ' (out of credit)' : res.status === 401 || res.status === 403 ? ' (key rejected)' : res.status === 429 ? ' (rate limited)' : ''}`
      console.warn('[speech] Fish Audio TTS declined:', res.status)
      if (res.status !== 429 && res.status < 500) return null
      const wait = Number(res.headers.get('retry-after'))
      await new Promise(r => setTimeout(r, Math.min(2000, wait > 0 ? wait * 1000 : 500 * (attempt + 1))))
      continue
    } catch (err) {
      lastFishError = `Fish Audio was unreachable (${(err as Error).message})`
      console.warn('[speech] Fish Audio TTS failed:', (err as Error).message)
    }
    await new Promise(r => setTimeout(r, 400))
  }
  return null
  } finally {
    fishRelease()
  }
}

/* ──────────────────────────────── STT ──────────────────────────────── */

const GROQ_URL = process.env.GROQ_STT_URL?.trim() || 'https://api.groq.com/openai/v1/audio/transcriptions'
const GROQ_MODELS = [process.env.GROQ_STT_MODEL?.trim() || 'whisper-large-v3-turbo', 'whisper-large-v3']

/**
 * Whisper reads this as "what was said just before", which steers spelling of
 * names and terms it would otherwise guess: BODHA, Sanskrit philosophy, Hindi
 * mixed with English. It is vocabulary, not an instruction.
 */
const STT_PROMPT =
  'BODHA AI, Srijan Singh, Parv Mishra. Indian Knowledge Systems: Vedas, Upanishads, Bhagavad Gita, ' +
  'Ramayana, Mahabharata, Vedanta, Yoga Sutras, Patanjali, Panini, Aryabhata, Charaka, Sushruta, Ayurveda, ' +
  'dharma, karma, moksha, atman, brahman, sutra, shloka. ' +
  'यह हिंदी और English मिलकर बोले गए सवाल हैं: भगवद्गीता, उपनिषद, वेद, योग, आयुर्वेद, धर्म, कर्म, मोक्ष।'

/** Languages worth forcing when the caller names one. English is left to auto-detect on purpose. */
const FORCEABLE = new Set(['hi', 'bn', 'ta', 'te', 'mr', 'gu', 'kn', 'ml', 'pa', 'ur', 'sa', 'ne'])

/** Things Whisper invents out of silence and room noise. */
const PHANTOMS =
  /^(thank you( so much)?( for watching)?|thanks for watching|please subscribe|you|bye|\.|…|धन्यवाद|शुक्रिया)[.!\s]*$/i

export function speechStatus() {
  return {
    tts: {
      primary: 'Fish Audio s2.1 pro (Hindi voice for Devanagari)',
      fallback: null,
      configured: Boolean(process.env.FISH_AUDIO_API_KEY?.trim()),
    },
    stt: {
      primary: GROQ_MODELS[0],
      fallback: [GROQ_MODELS[1], 'fish transcribe-1', 'parakeet-ctc-1.1b-asr'],
      configured: Boolean(groqKey()),
    },
  }
}

interface GroqVerbose {
  text?: string
  segments?: Array<{ text?: string; avg_logprob?: number; no_speech_prob?: number }>
}

/** True when Whisper itself says this was silence or noise. */
function looksLikeSilence(data: GroqVerbose): boolean {
  const segs = data.segments
  if (!segs?.length) return false
  return segs.every(s => (s.no_speech_prob ?? 0) > 0.6 && (s.avg_logprob ?? 0) < -0.7)
}

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

  const hint = (opts.language || process.env.STT_LANGUAGE || '').toLowerCase().split(/[-_]/)[0]
  // Forcing "en" would make Whisper transliterate Hindi speech into English
  // nonsense, so English (and anything unknown) is detected from the audio.
  const forced = FORCEABLE.has(hint) ? hint : undefined

  const attempts: Array<{ label: string; run: () => Promise<Response> }> = []

  const gKey = groqKey()
  if (gKey) {
    for (const model of GROQ_MODELS) {
      attempts.push({
        label: `groq ${model}`,
        run: () => {
          const form = new FormData()
          form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `audio.${extension}`)
          form.append('model', model)
          form.append('response_format', 'verbose_json')
          form.append('temperature', '0')
          // A vocabulary prompt makes Whisper echo its words into short clips,
          // so it is off unless STT_PROMPT is set deliberately.
          if (process.env.STT_PROMPT?.trim()) form.append('prompt', process.env.STT_PROMPT.trim().slice(0, 400))
          if (forced) form.append('language', forced)
          return fetch(GROQ_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${gKey}` },
            body: form,
            signal: AbortSignal.timeout(timeout),
          })
        },
      })
    }
  }

  const fishKey = process.env.FISH_AUDIO_API_KEY?.trim()
  if (fishKey) {
    attempts.push({
      label: 'fish transcribe-1',
      run: () => {
        const form = new FormData()
        form.append('audio', new Blob([new Uint8Array(audio)], { type: mime }), `audio.${extension}`)
        return fetch(process.env.FISH_STT_URL?.trim() || 'https://api.fish.audio/v1/asr', {
          method: 'POST',
          headers: { Authorization: `Bearer ${fishKey}`, model: process.env.FISH_AUDIO_STT_MODEL?.trim() || 'transcribe-1' },
          body: form,
          signal: AbortSignal.timeout(timeout),
        })
      },
    })
  }

  // Parakeet only understands English, so it is the very last resort and only
  // when nobody asked for another language.
  const nKey = nvidiaKey()
  if (nKey && !forced) {
    attempts.push({
      label: 'parakeet',
      run: () => {
        const form = new FormData()
        form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `audio.${extension}`)
        form.append('language', 'en-US')
        form.append('response_format', 'json')
        return fetch(nvcfURL(PARAKEET_FUNCTION_ID, '/v1/audio/transcriptions'), {
          method: 'POST',
          headers: { Authorization: `Bearer ${nKey}` },
          body: form,
          signal: AbortSignal.timeout(timeout),
        })
      },
    })
  }

  if (!attempts.length) return { error: 'Dictation is not configured.', status: 503 }

  let lastStatus = 502
  let heardSilence = false
  for (const attempt of attempts) {
    try {
      const res = await attempt.run()
      if (!res.ok) {
        lastStatus = res.status
        console.warn(`[speech] ${attempt.label} STT → HTTP ${res.status}`)
        continue
      }
      const data = (await res.json().catch(() => ({}))) as GroqVerbose & {
        transcript?: string
        results?: Array<{ alternatives?: Array<{ transcript?: string }> }>
      }
      // Whisper pads clips with invented trailing words. Segments it is unsure
      // are speech (high no-speech probability or very low confidence) are dropped.
      const sure = data.segments?.filter(s => (s.no_speech_prob ?? 0) <= 0.6 && (s.avg_logprob ?? 0) > -1.2)
      const text = (
        data.segments?.length
          ? (sure ?? []).map(s => (s.text ?? '').trim()).filter(Boolean).join(' ')
          : data.text || data.transcript || data.results?.[0]?.alternatives?.[0]?.transcript || ''
      ).trim()
      if (!text || PHANTOMS.test(text) || looksLikeSilence(data)) {
        // A clean "nothing there" answer is final — trying a weaker model on
        // silence only invites it to invent words.
        heardSilence = true
        break
      }
      return { text, provider: attempt.label }
    } catch (err) {
      console.warn(`[speech] ${attempt.label} STT failed:`, (err as Error).message)
      lastStatus = 504
    }
  }

  if (heardSilence) return { error: 'I could not hear any speech in that recording.', status: 422 }
  return {
    error: 'The dictation service could not be reached. Your browser can still listen directly.',
    status: 502,
  }
}
