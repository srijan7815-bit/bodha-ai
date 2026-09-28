'use client'

/**
 * BODHA's audio bus for the Live Mode orb.
 *
 * The orb must react to REAL sound, and playback must never break for the sake
 * of an animation. Two rules follow from that, learned the hard way:
 *
 *   1. A voice <audio> element is NEVER routed through the Web Audio graph.
 *      `createMediaElementSource` diverts the element's output into the graph,
 *      so if that graph's context is suspended (which is the normal state until
 *      a gesture resumes it) the audio plays in complete silence. That is
 *      exactly how "read aloud does nothing" happens.
 *   2. The voice envelope is therefore measured OFFLINE: the mp3/wav bytes are
 *      decoded once with `decodeAudioData`, sampled into a small RMS curve, and
 *      replayed against `audio.currentTime`. Same real lip-sync, no routing.
 *
 * The microphone is different — nothing is being played through it, so a plain
 * AnalyserNode on the getUserMedia stream is safe and gives the orb its
 * listening energy.
 */

export interface AudioEnvelope {
  /** RMS per window, 0..1, already normalised against the clip's own peak. */
  values: Float32Array
  /** Seconds per window. */
  step: number
  duration: number
}

let ctx: AudioContext | null = null

function audioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (ctx) return ctx
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try {
    ctx = new Ctor()
  } catch {
    ctx = null
  }
  return ctx
}

/** Called from a user gesture (mic tap / Live Mode open) so analysis works. */
export async function resumeOrbAudio(): Promise<void> {
  const c = audioCtx()
  if (c && c.state === 'suspended') await c.resume().catch(() => {})
}

/* ─── Microphone ───────────────────────────────────────────────────────────── */

let micAnalyser: AnalyserNode | null = null
let micSource: MediaStreamAudioSourceNode | null = null
let micBuf: Float32Array<ArrayBuffer> | null = null
let micLevel = 0
let micAt = 0
const MIC_STALE_MS = 400

/**
 * Attach an analyser to a live microphone stream. Returns a detach function.
 * Safe to call repeatedly with the same stream.
 */
export async function attachMic(stream: MediaStream): Promise<() => void> {
  await resumeOrbAudio()
  const c = audioCtx()
  if (!c) return () => {}
  try {
    detachMic()
    micSource = c.createMediaStreamSource(stream)
    micAnalyser = c.createAnalyser()
    micAnalyser.fftSize = 1024
    micAnalyser.smoothingTimeConstant = 0.7
    micSource.connect(micAnalyser)
    micBuf = new Float32Array(new ArrayBuffer(micAnalyser.fftSize * 4))
    return detachMic
  } catch {
    return () => {}
  }
}

function readMic() {
  if (!micAnalyser || !micBuf) return
  try {
    micAnalyser.getFloatTimeDomainData(micBuf)
    let sum = 0
    for (let i = 0; i < micBuf.length; i++) sum += micBuf[i] * micBuf[i]
    micLevel = Math.min(1, Math.sqrt(sum / micBuf.length) * 12)
    micAt = Date.now()
  } catch {
    /* a dropped frame is not worth reporting */
  }
}

/** Push a level measured elsewhere (e.g. a recorder's own meter). */
export function pushMicLevel(rms: number) {
  micLevel = Math.max(0, Math.min(1, rms))
  micAt = Date.now()
}

export function detachMic() {
  try {
    micSource?.disconnect()
    micAnalyser?.disconnect()
  } catch {}
  micSource = null
  micAnalyser = null
  micBuf = null
  micLevel = 0
  micAt = 0
}

/* ─── Voice playback (offline envelope) ────────────────────────────────────── */

let envelope: AudioEnvelope | null = null
let envelopeProgress = 0
let envelopeAt = 0
let decayLevel = 0

/**
 * Decode a finished audio clip into an RMS curve. Called once per spoken
 * answer, before playback starts.
 */
export async function buildEnvelope(bytes: ArrayBuffer, windowMs = 40): Promise<AudioEnvelope | null> {
  const c = audioCtx()
  if (!c) return null
  try {
    const copy = bytes.slice(0)
    const buffer = await c.decodeAudioData(copy)
    const step = windowMs / 1000
    const rate = buffer.sampleRate
    const per = Math.max(1, Math.floor(step * rate))
    const total = buffer.length
    const windows = Math.max(1, Math.ceil(total / per))
    const data = buffer.getChannelData(0)
    const values = new Float32Array(windows)
    let peak = 0
    for (let w = 0; w < windows; w++) {
      const start = w * per
      const end = Math.min(start + per, total)
      let sum = 0
      for (let i = start; i < end; i++) sum += data[i] * data[i]
      const rms = Math.sqrt(sum / Math.max(1, end - start))
      values[w] = rms
      if (rms > peak) peak = rms
    }
    if (peak > 0) for (let i = 0; i < windows; i++) values[i] = Math.min(1, values[i] / peak)
    return { values, step, duration: buffer.duration }
  } catch {
    return null
  }
}

export function setVoiceEnvelope(next: AudioEnvelope | null) {
  envelope = next
  envelopeProgress = 0
  envelopeAt = Date.now()
}

/** Called by the speaker as the clip plays. */
export function trackVoicePlayback(currentTime: number, playing: boolean) {
  if (!playing) {
    envelopeProgress = currentTime
    envelopeAt = Date.now()
  } else {
    envelopeProgress = currentTime
    envelopeAt = Date.now()
  }
}

/** 0..1 — the voice's loudness right now, from the decoded envelope. */
export function voiceOutputLevel(): number {
  if (!envelope) return 0
  const stale = Date.now() - envelopeAt > 250
  if (stale) return 0
  const index = Math.min(envelope.values.length - 1, Math.max(0, Math.round(envelopeProgress / envelope.step)))
  return envelope.values[index] ?? 0
}

/* ─── The orb's sampler ────────────────────────────────────────────────────── */

// Attack fast, release slow: a syllable registers immediately, the surface then
// settles instead of flickering.
const ATTACK_MS = 90
const RELEASE_MS = 340

function damp(current: number, target: number, ms: number, dt: number) {
  const k = 1 - Math.exp((-1000 / Math.max(1, ms)) * dt)
  return current + (target - current) * k
}

const env = { rms: 0, low: 0, mid: 0, high: 0 }

/**
 * `sampleAudio(dt)` for the orb engine. Called every frame by the renderer.
 * Mic first (it is what makes "listening" feel alive), voice second.
 */
export function sampleAudio(dt: number): { rms: number; low: number; mid: number; high: number } {
  readMic()

  let rms = 0
  let low = 0
  let mid = 0
  let high = 0

  // Voice output — the real envelope of the clip being played.
  const voice = voiceOutputLevel()
  if (voice > 0) {
    rms = Math.max(rms, voice)
    low = Math.max(low, voice * 0.95)
    mid = Math.max(mid, voice * 0.7)
    high = Math.max(high, voice * 0.45)
  } else {
    // Ease out so the orb does not snap flat between sentences.
    decayLevel = damp(decayLevel, 0, RELEASE_MS, dt)
    if (decayLevel > 0.01) {
      rms = Math.max(rms, decayLevel)
      low = Math.max(low, decayLevel * 0.9)
      mid = Math.max(mid, decayLevel * 0.65)
      high = Math.max(high, decayLevel * 0.4)
    }
  }
  if (voice > decayLevel) decayLevel = voice

  if (Date.now() - micAt < MIC_STALE_MS) {
    const m = Math.min(1, micLevel * 22)
    rms = Math.max(rms, m)
    low = Math.max(low, m * 0.75)
    mid = Math.max(mid, m * 0.55)
  }

  env.rms = damp(env.rms, Math.min(1, rms), rms > env.rms ? ATTACK_MS : RELEASE_MS, dt)
  env.low = damp(env.low, Math.min(1, low), low > env.low ? ATTACK_MS : RELEASE_MS, dt)
  env.mid = damp(env.mid, Math.min(1, mid), mid > env.mid ? ATTACK_MS : RELEASE_MS, dt)
  env.high = damp(env.high, Math.min(1, high), high > env.high ? ATTACK_MS : RELEASE_MS, dt)
  return env
}

/** 0..1 for the mouth/level meters in the UI. */
export function currentLevel(): number {
  return env.rms
}
