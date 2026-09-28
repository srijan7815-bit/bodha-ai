'use client'

/**
 * Voice barge-in: let the student cut BODHA off mid-sentence by simply talking.
 *
 * Ported from the nrvs-ai implementation, which solved the hard part properly.
 * The hard part is echo: the microphone hears BODHA through the speaker, so a
 * naive "any sound = interrupt" detector stops the tutor constantly. The
 * alternative — muting the mic while speaking — makes interruption impossible
 * and forces a button press, which is exactly what makes a voice room feel
 * robotic.
 *
 * This watches the mic during playback and fires only when the incoming level
 * clearly exceeds what our own output can explain:
 *
 *   • a reference level is tracked from the voice output itself, so loud
 *     passages raise the bar and quiet ones lower it,
 *   • the mic must beat that reference by a margin,
 *   • it must stay above for a sustained window, so a cough or a door does not
 *     cut the answer off,
 *   • a short grace period after speech starts avoids clipping the first word.
 *
 * Echo cancellation is already on in getUserMedia, so this only has to catch
 * what leaks through.
 */

export interface BargeInOptions {
  /** Current mic RMS, 0..1. */
  micLevel: () => number
  /** Current spoken-output RMS, 0..1. */
  outputLevel: () => number
  /** Is BODHA talking right now? */
  isSpeaking: () => boolean
  /** Fired once per spoken turn. */
  onBargeIn: () => void
  graceMs?: number
  sustainMs?: number
  marginDb?: number
  minLevel?: number
  releaseMs?: number
}

export interface BargeInDetector {
  start: () => void
  stop: () => void
  /** Call when a new spoken turn begins so it can fire again. */
  armForNewTurn: () => void
  readonly isArmed: boolean
}

const DEFAULTS = {
  graceMs: 350, // ignore the first moments of playback
  sustainMs: 220, // speech must persist this long to count
  marginDb: 9, // how far above the echo reference the mic must sit
  minLevel: 0.012, // absolute floor; below this it is never speech
  releaseMs: 400, // how quickly the reference decays
}

const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-6))

export function createBargeInDetector(opts: BargeInOptions): BargeInDetector {
  const cfg = { ...DEFAULTS, ...opts }
  let speakingSince = 0
  let aboveSince = 0
  let fired = false
  let ref = 0
  let raf = 0
  let running = false

  const reset = () => {
    speakingSince = 0
    aboveSince = 0
    fired = false
    ref = 0
  }

  const tick = () => {
    if (!running) return
    raf = requestAnimationFrame(tick)

    if (!cfg.isSpeaking()) {
      reset()
      return
    }

    const now = performance.now()
    if (!speakingSince) speakingSince = now
    if (fired) return
    if (now - speakingSince < cfg.graceMs) return

    const out = Math.max(0, Number(cfg.outputLevel() || 0))
    const mic = Math.max(0, Number(cfg.micLevel() || 0))

    // Track the loudest recent output as the echo reference, decaying slowly so
    // a pause in speech does not instantly make the mic look loud.
    ref = Math.max(out, ref - ref * (16 / Math.max(1, cfg.releaseMs)))

    const loudEnough = mic >= cfg.minLevel
    const beatsEcho = db(mic) - db(ref) >= cfg.marginDb

    if (loudEnough && beatsEcho) {
      if (!aboveSince) aboveSince = now
      if (now - aboveSince >= cfg.sustainMs) {
        fired = true
        aboveSince = 0
        cfg.onBargeIn()
      }
    } else {
      aboveSince = 0
    }
  }

  return {
    start() {
      if (!running) {
        running = true
        reset()
        raf = requestAnimationFrame(tick)
      }
    },
    stop() {
      running = false
      cancelAnimationFrame(raf)
      reset()
    },
    armForNewTurn() {
      reset()
    },
    get isArmed() {
      return running && !fired
    },
  }
}
