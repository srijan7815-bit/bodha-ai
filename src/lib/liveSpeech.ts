'use client'

/**
 * The listening half of Live Mode — one microphone, held open for the whole
 * session, with voice-activity detection that ends a turn the moment the
 * student stops talking.
 *
 * Ported from the nrvs-ai implementation. The design points that matter, all
 * learned there the hard way:
 *
 *   • ONE microphone per session. Opening it per turn costs hundreds of
 *     milliseconds before the student can be heard; instead it is acquired once
 *     (ref-counted) and released when the room closes.
 *   • The end-of-turn detector watches smoothed RMS energy against a gate
 *     calibrated to the actual room, so it works on a phone held 20 cm away and
 *     on a laptop across a desk. A fixed threshold fails at one or the other.
 *   • It ships 16 kHz mono WAV, never the browser's native container: the ASR
 *     endpoints answer 500 for a mislabelled or compressed upload, and every
 *     browser can decode what it just recorded.
 */

import { authFetch } from '@/lib/firebase/client-token'
import { toWav } from '@/lib/audio'

/* ─── Capability ───────────────────────────────────────────────────────────── */

export function micSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== 'undefined'
  )
}

/* ─── The session microphone ───────────────────────────────────────────────── */

let micStream: MediaStream | null = null
let micCtx: AudioContext | null = null
let micSource: MediaStreamAudioSourceNode | null = null
let micAnalyser: AnalyserNode | null = null
let micRefs = 0

function audioCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
    null
  )
}

/**
 * Hold the microphone. Ref-counted: callers must pair every acquire with a
 * release. Returns null when permission is refused or the device has no mic.
 */
export async function acquireMic(): Promise<{ stream: MediaStream; analyser: AnalyserNode | null } | null> {
  micRefs++
  if (micStream && micStream.getTracks().some(t => t.readyState === 'live')) {
    if (micCtx?.state === 'suspended') {
      try {
        await micCtx.resume()
      } catch {
        /* the analyser may report silence until the next gesture */
      }
    }
    return { stream: micStream, analyser: micAnalyser }
  }

  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true, // do not re-hear our own voice
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
  } catch {
    micRefs = Math.max(0, micRefs - 1)
    return null
  }

  try {
    const Ctor = audioCtor()
    if (Ctor) {
      micCtx = new Ctor()
      micSource = micCtx.createMediaStreamSource(micStream)
      micAnalyser = micCtx.createAnalyser()
      micAnalyser.fftSize = 1024
      micAnalyser.smoothingTimeConstant = 0.6
      micSource.connect(micAnalyser)
      // iOS hands back a context that starts SUSPENDED, and a suspended
      // analyser reports pure silence — the VAD would then never see speech and
      // every turn would time out, which looks exactly like "it can't hear me".
      if (micCtx.state === 'suspended') {
        try {
          await micCtx.resume()
        } catch {
          /* handled on the next gesture */
        }
      }
    }
  } catch {
    micCtx = null
    micSource = null
    micAnalyser = null
  }

  return { stream: micStream, analyser: micAnalyser }
}

/** Release one reference; tears the device down when the last holder leaves. */
export function releaseMic(): void {
  micRefs = Math.max(0, micRefs - 1)
  if (micRefs > 0) return
  try {
    micSource?.disconnect()
  } catch {
    /* already detached */
  }
  try {
    void micCtx?.close()
  } catch {
    /* already closed */
  }
  try {
    micStream?.getTracks().forEach(t => t.stop())
  } catch {
    /* already stopped */
  }
  micStream = null
  micCtx = null
  micSource = null
  micAnalyser = null
}

export function micActive(): boolean {
  return Boolean(micStream && micStream.getTracks().some(t => t.readyState === 'live'))
}

/* ─── Recording containers ─────────────────────────────────────────────────── */

/**
 * Pick a container this browser will genuinely record.
 *
 * iOS Safari before 18.4 returns false for every audio/webm variant and records
 * audio/mp4 (AAC). Letting the browser choose and then labelling the upload
 * .webm makes the ASR service receive an MP4 claiming to be WebM — which it
 * rejects. That single mislabel is what breaks voice input on every iPhone.
 */
export function pickRecorderMime(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = [
    'audio/webm;codecs=opus', // Chrome, Firefox, Edge, Safari 18.4+
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2', // iOS / older Safari
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ]
  for (const type of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type
    } catch {
      /* keep looking */
    }
  }
  return ''
}

/* ─── Transcription ────────────────────────────────────────────────────────── */

/** Send a finished recording to our own /api/stt and return the transcript. */
export async function transcribeBlob(raw: Blob, language?: string): Promise<string> {
  // Normalise to 16 kHz mono WAV so the server never has to guess the container
  // and the ASR model gets exactly what it expects.
  const wav = await toWav(raw)
  const blob = wav ?? raw
  const form = new FormData()
  const ext = wav ? 'wav' : blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'
  form.append('audio', blob, `audio.${ext}`)
  if (language) form.append('language', language)

  const res = await authFetch('/api/stt', { method: 'POST', body: form })
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string }
    const err = new Error(detail.error || `stt ${res.status}`)
    ;(err as Error & { status?: number }).status = res.status
    throw err
  }
  const data = (await res.json().catch(() => ({}))) as { text?: string }
  return (data.text || '').trim()
}

/* ─── One live turn ────────────────────────────────────────────────────────── */

const VAD = {
  silenceMs: 430, // stop this long after speech ends
  minSpeechMs: 220, // ignore blips (coughs, clicks, doors)
  maxTurnMs: 30_000, // hard stop so a turn cannot run forever
  // Thresholds are RELATIVE to the measured noise floor, not absolute — a fixed
  // gate fails on far-field mics, where speech can peak below what is sensible
  // for a phone held close.
  startRatio: 2.6,
  stopRatio: 1.6,
  minStart: 0.0055,
  calibrateMs: 350,
  smoothing: 0.25, // EMA so one loud/quiet frame cannot start or end a turn
}

export interface LiveTurnHandle {
  stop: () => void
  cancel: () => void
}

export interface LiveTurnOptions {
  /** Called with the transcript; empty text means "nothing was said". */
  onText?: (text: string, info: { silent: boolean }) => void
  onError?: (reason: string) => void
  onReady?: () => void
  onSpeechStart?: () => void
  onSpeechEnd?: () => void
  /** Smoothed mic RMS each frame, for the orb and the barge-in detector. */
  onLevel?: (rms: number) => void
  language?: string
  /** Return true while BODHA is speaking, so our own audio cannot trip the VAD. */
  isMuted?: () => boolean
}

/**
 * Record one turn with automatic endpointing, then transcribe it.
 *
 * `onSpeechEnd` fires the instant silence is detected — before the network round
 * trip — so the room can flip to "Thinking…" and feel immediate.
 */
export async function startLiveTurn(opts: LiveTurnOptions = {}): Promise<LiveTurnHandle | null> {
  if (!micSupported()) {
    opts.onError?.('unsupported')
    return null
  }

  const mic = await acquireMic()
  if (!mic?.stream) {
    opts.onError?.('permission')
    return null
  }
  const { stream, analyser } = mic
  const mime = pickRecorderMime()

  let raf = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  const chunks: Blob[] = []
  let cancelled = false
  let finished = false
  let released = false
  let speaking = false
  let speechStartedAt = 0
  let silenceSince = 0
  const startedAt = Date.now()

  // Adaptive gate, learned from the room instead of hard-coded.
  let noiseFloor = 0
  let level = 0
  let calibN = 0
  let armed = false
  let startGate = VAD.minStart
  let stopGate = VAD.minStart * 0.6

  let recorder: MediaRecorder
  try {
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  } catch {
    releaseMic()
    opts.onError?.('unsupported')
    return null
  }
  recorder.ondataavailable = e => {
    if (e.data && e.data.size) chunks.push(e.data)
  }

  const cleanup = () => {
    if (released) return
    released = true
    cancelAnimationFrame(raf)
    if (timer) clearTimeout(timer)
    releaseMic() // drops this turn's reference; the session keeps the mic open
  }

  recorder.onstop = () => {
    cleanup()
    if (cancelled) return
    void (async () => {
      try {
        // Read the type back: the browser may normalise or override our
        // request, and iOS hands back audio/mp4 whatever we asked for.
        const actual = recorder.mimeType || mime || chunks[0]?.type || ''
        const blob = new Blob(chunks, actual ? { type: actual } : undefined)
        if (!blob.size || !speechStartedAt) {
          opts.onText?.('', { silent: true })
          return
        }
        const text = await transcribeBlob(blob, opts.language)
        opts.onText?.(text, { silent: false })
      } catch (err) {
        opts.onError?.((err as Error).message || 'transcription failed')
      }
    })()
  }

  const finish = (cancel: boolean) => {
    if (finished) return
    finished = true
    cancelled = cancel
    if (!cancel && speaking) opts.onSpeechEnd?.()
    try {
      recorder.stop()
    } catch {
      cleanup()
    }
  }

  // The energy meter that drives endpointing.
  if (analyser) {
    const buf = new Float32Array(analyser.fftSize)
    const tick = () => {
      if (finished) return
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      const raw = Math.sqrt(sum / buf.length)
      level = level === 0 ? raw : level + VAD.smoothing * (raw - level)
      const rms = level
      opts.onLevel?.(rms)

      const now = Date.now()
      const elapsed = now - startedAt

      // While BODHA is speaking, keep the mic rolling but ignore it entirely —
      // otherwise our own voice through the speakers retriggers the detector.
      if (opts.isMuted?.()) {
        silenceSince = 0
        raf = requestAnimationFrame(tick)
        return
      }

      if (!armed) {
        // Phase 1 — learn the room's noise floor.
        noiseFloor = calibN === 0 ? rms : (noiseFloor * calibN + rms) / (calibN + 1)
        calibN++
        if (elapsed >= VAD.calibrateMs) {
          startGate = Math.max(VAD.minStart, noiseFloor * VAD.startRatio)
          stopGate = Math.max(VAD.minStart * 0.6, noiseFloor * VAD.stopRatio)
          armed = true
        }
        raf = requestAnimationFrame(tick)
        return
      }

      // Phase 2 — endpointing.
      if (!speaking) {
        if (rms > startGate) {
          speaking = true
          speechStartedAt = now
          silenceSince = 0
          opts.onSpeechStart?.()
        } else {
          // Let the floor drift with the room (a fan starting, people settling)
          // without ever chasing speech itself.
          noiseFloor = noiseFloor * 0.995 + rms * 0.005
          startGate = Math.max(VAD.minStart, noiseFloor * VAD.startRatio)
          stopGate = Math.max(VAD.minStart * 0.6, noiseFloor * VAD.stopRatio)
        }
      } else if (rms < stopGate) {
        if (!silenceSince) silenceSince = now
        const longEnough = now - speechStartedAt > VAD.minSpeechMs
        if (longEnough && now - silenceSince >= VAD.silenceMs) {
          finish(false)
          return
        }
      } else {
        silenceSince = 0
      }

      if (elapsed > VAD.maxTurnMs) {
        finish(false)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
  } else {
    // No AudioContext → fall back to a plain fixed-length recording.
    timer = setTimeout(() => finish(false), 6000)
  }

  recorder.start(200)
  opts.onReady?.()

  return {
    stop: () => finish(false),
    cancel: () => finish(true),
  }
}

/* ─── Browser recogniser (last resort) ─────────────────────────────────────── */

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: unknown) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
}

export interface BrowserRecognizer {
  start: () => void
  stop: () => void
  cancel: () => void
}

export function browserRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition)
}

/**
 * The browser's own recogniser, used only when our transcription service cannot
 * be reached. It keeps Live Mode usable on a phone with no server round trip,
 * at the cost of accuracy and a slower end-of-speech timeout.
 */
export function createRecognizer({
  onResult,
  onEnd,
  onError,
  language = 'en-US',
}: {
  onResult?: (text: string, isFinal: boolean) => void
  onEnd?: (finalText: string) => void
  onError?: (reason: string) => void
  language?: string
}): BrowserRecognizer | null {
  if (!browserRecognitionSupported()) return null
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition
  if (!Ctor) return null

  const recognition = new Ctor()
  recognition.lang = language
  recognition.continuous = false
  recognition.interimResults = true
  recognition.maxAlternatives = 1

  let finalText = ''

  recognition.onresult = (event: unknown) => {
    const e = event as {
      resultIndex: number
      results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>
    }
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i]
      if (result.isFinal) finalText += result[0].transcript
      else interim += result[0].transcript
    }
    onResult?.((finalText + interim).trim(), Boolean(finalText))
  }

  recognition.onerror = event => onError?.(event?.error || 'recognition error')
  recognition.onend = () => onEnd?.(finalText.trim())

  return {
    start: () => {
      try {
        recognition.start()
      } catch {
        /* already started */
      }
    },
    stop: () => {
      try {
        recognition.stop()
      } catch {
        /* already stopped */
      }
    },
    cancel: () => {
      try {
        recognition.abort()
      } catch {
        /* already stopped */
      }
    },
  }
}
