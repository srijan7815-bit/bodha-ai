'use client'

/**
 * The speaking half of Live Mode.
 *
 * Two things make a voice room feel like a conversation rather than a form
 * submission, both ported from nrvs-ai:
 *
 *   1. STREAMING BY SENTENCE. The reply is split at sentence boundaries as it
 *      generates, and the first sentence starts playing while the rest is still
 *      being written. Waiting for the whole answer before speaking is the single
 *      biggest source of dead air in a voice UI.
 *   2. PRE-FETCH. The next sentence's audio is synthesised during playback of
 *      the current one, so the gap between sentences is ~0.
 *
 * SAFETY RULE, carried over from BODHA's own audio layer: a spoken clip is
 * played through a plain <audio> element and NEVER routed through the Web Audio
 * graph. `createMediaElementSource` diverts an element's output into the graph,
 * so a suspended AudioContext (the normal state until a gesture resumes it)
 * plays it in complete silence. The orb's lip-sync comes from an envelope
 * decoded OFFLINE from the same bytes instead — same real waveform, no routing.
 */

import { authFetch } from '@/lib/firebase/client-token'
import { buildEnvelope, setVoiceEnvelope, trackVoicePlayback } from '@/lib/orbAudio'

export type SpeechProvider = 'fish' | 'magpie' | 'auto'

/** One synthesised sentence, ready to play. */
interface SpeechClip {
  url: string
  blob: Blob
}

/* ─── Text preparation ─────────────────────────────────────────────────────── */

export function browserTtsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** Strip markdown so the spoken words sound natural instead of literal. */
export function cleanForSpeech(text: string): string {
  return String(text || '')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0E\uFE0F\u200D\u20E3\u{1F3FB}-\u{1F3FF}\u2600-\u27BF\u2B00-\u2BFF]/gu, '')
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' image ')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/[*_#>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Split text into speakable chunks at sentence boundaries.
 *
 * `min` is deliberately small: in a live conversation the whole point is to
 * start speaking the moment a complete sentence exists, even a short one
 * ("Sure."). Pre-fetching means short leading chunks cost nothing.
 */
export function splitSentences(text: string, { min = 40, max = 240 } = {}): string[] {
  const clean = cleanForSpeech(text)
  if (!clean) return []
  const parts = (clean.match(/[^.!?…।॥]+[.!?…।॥]+["')\]]*\s*|[^.!?…।॥]+$/g) || [clean])
    .map(p => p.trim())
    .filter(Boolean)

  const out: string[] = []
  let buf = ''
  for (const piece of parts) {
    const complete = /[.!?…।॥]["')\]]*$/.test(piece)
    // The FIRST complete sentence is always emitted on its own, however short —
    // it is what decides how fast the student hears an answer.
    if (!out.length && !buf && complete) {
      out.push(piece)
      continue
    }
    if (buf) {
      if (buf.length + piece.length + 1 <= max) buf = `${buf} ${piece}`
      else {
        out.push(buf)
        buf = piece
      }
    } else {
      buf = piece
    }
    if (complete && buf.length >= min) {
      out.push(buf)
      buf = ''
    }
  }
  if (buf) out.push(buf)
  return out
}

/* ─── Playback state (read-aloud and Live Mode never share a clip) ─────────── */

let currentAudio: HTMLAudioElement | null = null
let currentUtterance: SpeechSynthesisUtterance | null = null
let currentToken = 0
let queueToken = 0

/** Stop whatever is being spoken right now, including a streaming queue. */
export function stopSpeaking(): void {
  currentToken++
  queueToken++
  if (currentAudio) {
    try {
      currentAudio.pause()
    } catch {
      /* already finished */
    }
    currentAudio = null
  }
  setVoiceEnvelope(null)
  if (browserTtsSupported()) {
    try {
      window.speechSynthesis.cancel()
    } catch {
      /* nothing queued */
    }
  }
  currentUtterance = null
}

export function isSpeaking(): boolean {
  const browser = browserTtsSupported() && window.speechSynthesis.speaking
  const server = Boolean(currentAudio && !currentAudio.paused)
  return browser || server
}

/* ─── Providers ────────────────────────────────────────────────────────────── */

function speakBrowser(text: string, { rate = 1, onend }: { rate?: number; onend?: () => void } = {}): void {
  if (!browserTtsSupported()) {
    onend?.()
    return
  }
  const u = new SpeechSynthesisUtterance(text)
  u.rate = rate
  u.onend = () => {
    currentUtterance = null
    onend?.()
  }
  u.onerror = () => {
    currentUtterance = null
    onend?.()
  }
  currentUtterance = u
  window.speechSynthesis.speak(u)
}

/**
 * Synthesise one chunk and return its object URL, or null to let the caller
 * fall back to the browser voice.
 *
 * The clip is decoded once, before playback, into a small RMS curve that the
 * orb animates against — real lip-sync without ever touching the audio graph.
 *
 * `timeoutMs` bounds a single synthesis: in a live conversation a stalled
 * request must turn into the browser voice after a few seconds, not into dead
 * air that runs on until the server gives up.
 */
async function fetchSpeech(
  text: string,
  opts: { voice?: string; language?: string; provider?: SpeechProvider; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ url: string; blob: Blob } | null> {
  try {
    // `timeoutMs` bounds one synthesis. When a caller signal is also given it
    // wins — the live pipeline never passes one, so the timeout is what fires.
    const signal =
      opts.signal ?? (opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined)
    const res = await authFetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        voice: opts.voice,
        language: opts.language ?? 'en-US',
        provider: opts.provider ?? 'auto',
      }),
      signal,
    })
    if (!res.ok) return null
    const blob = await res.blob()
    if (!blob.size) return null
    return { url: URL.createObjectURL(blob), blob }
  } catch {
    return null
  }
}

/** Play one clip to completion, driving the orb from its decoded envelope. */
function playClip(url: string, blob: Blob, { onend }: { onend?: () => void } = {}): Promise<void> {
  return new Promise(resolve => {
    const audio = new Audio(url)
    currentAudio = audio
    let done = false
    let raf = 0

    const cleanup = () => {
      if (done) return
      done = true
      cancelAnimationFrame(raf)
      URL.revokeObjectURL(url)
      setVoiceEnvelope(null)
      if (currentAudio === audio) currentAudio = null
      onend?.()
      resolve()
    }

    // Real envelope, measured offline from the exact bytes being played.
    void (async () => {
      try {
        const env = await buildEnvelope(await blob.arrayBuffer())
        setVoiceEnvelope(env)
      } catch {
        /* the orb simply stays calm for this clip */
      }
    })()

    const follow = () => {
      if (done) return
      trackVoicePlayback(audio.currentTime, true)
      raf = requestAnimationFrame(follow)
    }
    raf = requestAnimationFrame(follow)

    audio.onended = cleanup
    audio.onerror = cleanup
    audio.play().catch(cleanup)
  })
}

/* ─── Streaming speech ─────────────────────────────────────────────────────── */

export interface SpeakStreamOptions {
  /** Async supplier of the next text chunk, or null when the reply is finished. */
  next: () => Promise<string | null>
  voice?: string
  language?: string
  provider?: SpeechProvider
  /** Called when audio genuinely starts, so the room can show "speaking". */
  onStart?: () => void
  onend?: () => void
}

/**
 * Low-latency streaming speech for Live Mode: speaks chunks in order while
 * TWO chunks ahead are always synthesising during playback of the current one.
 * One-ahead is not enough in a real conversation — a single slow synthesis
 * would open an audible gap mid-answer; with two in flight the queue absorbs
 * one slow provider response and still plays the next sentence on time.
 */
export function speakStream(opts: SpeakStreamOptions): { cancel: () => void } {
  stopSpeaking()
  const myQueue = ++queueToken
  const token = ++currentToken
  let cancelled = false
  const alive = () => !cancelled && myQueue === queueToken

  void (async () => {
    // Every object URL created for this reply, so nothing leaks even when the
    // queue is cancelled mid-flight with synthesised clips still unresolved.
    const outstanding = new Set<string>()
    try {
      const makeFrame = async (): Promise<{ text: string | null; clip: Promise<SpeechClip | null> | null }> => {
        const text = await opts.next()
        return {
          text,
          clip: text
            ? fetchSpeech(text, {
                voice: opts.voice,
                language: opts.language,
                provider: opts.provider,
                timeoutMs: 8_000, // a stalled synthesis must not stall the room
              })
            : null,
        }
      }

      // The pipeline: up to three frames requested at once — the one being
      // spoken and two being prepared. `drained` stops us calling next() after
      // it has said the reply is finished.
      const pipes: Array<Promise<{ text: string | null; clip: Promise<SpeechClip | null> | null }>> = []
      let drained = false
      const fill = () => {
        while (!drained && pipes.length < 3) pipes.push(makeFrame())
      }
      fill()

      while (alive() && pipes.length) {
        const frame = await pipes.shift()!
        if (!alive()) break
        if (!frame.text) {
          drained = true
          break
        }
        if (!drained) fill()

        const spoken: string = frame.text
        const clip: SpeechClip | null = frame.clip ? await frame.clip : null
        if (!alive()) {
          if (clip) URL.revokeObjectURL(clip.url)
          break
        }

        if (clip && token === currentToken) {
          outstanding.add(clip.url)
          opts.onStart?.()
          await playClip(clip.url, clip.blob)
          outstanding.delete(clip.url)
        } else {
          if (clip) URL.revokeObjectURL(clip.url)
          // No server audio → the browser voice, so the room is never silent.
          opts.onStart?.()
          await new Promise<void>(resolve => {
            if (!browserTtsSupported()) {
              resolve()
              return
            }
            speakBrowser(spoken, { onend: resolve })
          })
        }
      }
    } catch {
      /* never throw at the caller */
    }
    for (const url of outstanding) {
      try {
        URL.revokeObjectURL(url)
      } catch {
        /* already gone */
      }
    }
    outstanding.clear()
    if (alive()) opts.onend?.()
  })()

  return {
    cancel: () => {
      cancelled = true
      queueToken++
      stopSpeaking()
    },
  }
}

/**
 * Read one passage aloud — the per-message read-aloud button, which is its own
 * feature and deliberately separate from Live Mode.
 *
 * Fish Audio is the voice the user asked for here; the server falls back to
 * NVIDIA Magpie and then to the browser voice on its own.
 */
export async function speakOnce(
  text: string,
  opts: { voice?: string; provider?: SpeechProvider; onend?: () => void } = {},
): Promise<void> {
  const clean = cleanForSpeech(text)
  if (!clean) {
    opts.onend?.()
    return
  }
  stopSpeaking()
  const token = ++currentToken

  const clip = await fetchSpeech(clean, { voice: opts.voice, provider: opts.provider ?? 'fish' })
  if (token !== currentToken) {
    if (clip) URL.revokeObjectURL(clip.url)
    return
  }
  if (clip) {
    await playClip(clip.url, clip.blob, { onend: opts.onend })
    return
  }
  speakBrowser(clean, { onend: opts.onend })
}
