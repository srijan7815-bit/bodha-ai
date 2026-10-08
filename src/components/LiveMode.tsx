'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useMotionValue, useTransform, animate } from 'framer-motion'
import { Captions, ChevronUp, Mic, MicOff, PhoneOff, Square, X } from 'lucide-react'
import BodhaOrb, { type OrbState } from '@/components/BodhaOrb'
import LiveTranscript, { type LiveTurn } from '@/components/LiveTranscript'
import { pushMicLevel, resumeOrbAudio, voiceOutputLevel } from '@/lib/orbAudio'
import { createBargeInDetector, type BargeInDetector } from '@/lib/bargeIn'
import {
  createRecognizer,
  micSupported,
  startLiveTurn,
  acquireMic,
  releaseMic,
} from '@/lib/liveSpeech'
import { speakStream, stopSpeaking, splitSentences, type SpeechProvider } from '@/lib/liveTts'

/**
 * Live Mode — BODHA's voice room.
 *
 * This is deliberately NOT read-aloud. Read-aloud lives on each message and
 * reads one passage with Fish Audio; Live Mode is a hands-free conversation
 * with its own microphone, its own turn-taking and its own voice pipeline. The
 * two share no state, and stopping one never touches the other.
 *
 * The interaction model is the one from nrvs-ai, which the user asked to copy:
 * a single orb you can drag down to reveal the transcript, a Mute / Interrupt /
 * End control row, and a loop that listens the moment BODHA stops talking.
 *
 *   idle → listening → thinking → speaking → listening → …
 */

export interface LiveModeProps {
  open: boolean
  onClose: () => void
  /**
   * Send one spoken turn. Resolves with the full answer while streaming partial
   * text through `onDelta`, so the room can start speaking sentence by sentence.
   */
  ask: (text: string, onDelta: (chunk: string) => void, signal: AbortSignal) => Promise<string>
  /** Named voice for the spoken answers. */
  voice?: string
  provider?: SpeechProvider
  language?: string
}

type Phase = 'idle' | 'listening' | 'thinking' | 'speaking' | 'muted'

/** Anything holding the microphone can be stopped and cancelled. */
interface RecHandle {
  stop: () => void
  cancel: () => void
}

const DRAG_MAX = 260
const SNAP_AT = 90

export default function LiveMode({
  open,
  onClose,
  ask,
  voice,
  provider = 'auto',
  language = 'en-US',
}: LiveModeProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [transcript, setTranscript] = useState('')
  const [reply, setReply] = useState('')
  const [error, setError] = useState('')
  const [muted, setMuted] = useState(false)

  // The conversation shown in the pull-down transcript.
  const [turns, setTurns] = useState<LiveTurn[]>([])
  const [replyCommitted, setReplyCommitted] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const turnIdRef = useRef(0)

  const recRef = useRef<RecHandle | null>(null)
  const historyRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  const activeRef = useRef(false)
  const mutedRef = useRef(false)
  const turnRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const speechRef = useRef<{ cancel: () => void } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const serverSttRef = useRef(true) // false once the browser recogniser takes over
  const micHeldRef = useRef(false) // session-long microphone reference
  const startingRef = useRef(false) // a listen session is being created
  const speakingRef = useRef(false) // BODHA audio is playing (echo guard)
  const micLevelRef = useRef(0) // latest mic RMS, for barge-in
  const bargeRef = useRef<BargeInDetector | null>(null)
  const interruptRef = useRef<(() => void) | null>(null)
  const sttFailsRef = useRef(0)
  const phaseRef = useRef<Phase>('idle')

  phaseRef.current = phase

  const supported = micSupported()

  /* ── Drag-to-reveal transcript ─────────────────────────────────────────── */
  const drag = useMotionValue(0)
  const orbScale = useTransform(drag, [0, DRAG_MAX], [1, 0.42])
  const orbY = useTransform(drag, [0, DRAG_MAX], [0, 250])
  const glowOpacity = useTransform(drag, [0, DRAG_MAX * 0.7], [1, 0.15])
  const sheetOpacity = useTransform(drag, [30, DRAG_MAX * 0.8], [0, 1])
  const labelOpacity = useTransform(drag, [0, 70], [1, 0])
  const hintOpacity = useTransform(drag, [0, 40], [1, 0])
  const dragStartRef = useRef(0)

  const snapTo = useCallback(
    (to: number) => {
      animate(drag, to, { type: 'spring', stiffness: 420, damping: 38, restDelta: 0.5 })
      setExpanded(to > 0)
    },
    [drag],
  )

  const onDragStart = () => {
    dragStartRef.current = drag.get()
  }
  const onDrag = (_e: unknown, info: { offset: { y: number } }) => {
    const next = dragStartRef.current + info.offset.y
    // Rubber-band past the ends instead of hard-stopping.
    drag.set(next < 0 ? next * 0.25 : next > DRAG_MAX ? DRAG_MAX + (next - DRAG_MAX) * 0.25 : next)
  }
  const onDragEnd = (_e: unknown, info: { velocity: { y: number } }) => {
    const v = info.velocity.y
    if (v > 400) {
      snapTo(DRAG_MAX)
      return
    }
    if (v < -400) {
      snapTo(0)
      return
    }
    snapTo(drag.get() > SNAP_AT ? DRAG_MAX : 0)
  }
  const toggleExpanded = () => snapTo(expanded ? 0 : DRAG_MAX)

  /* ── Session lifecycle ─────────────────────────────────────────────────── */

  const pushTurn = useCallback((role: 'user' | 'assistant', content: string) => {
    const text = String(content || '').trim()
    if (!text) return
    setTurns(prev => [...prev, { id: ++turnIdRef.current, role, content: text }])
  }, [])

  const teardown = useCallback(() => {
    activeRef.current = false
    turnRef.current++
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    const rec = recRef.current
    if (rec) {
      try {
        rec.cancel()
      } catch {
        /* already finished */
      }
    }
    recRef.current = null
    try {
      abortRef.current?.abort()
    } catch {
      /* no request in flight */
    }
    abortRef.current = null
    try {
      speechRef.current?.cancel()
    } catch {
      /* nothing playing */
    }
    speechRef.current = null
    speakingRef.current = false
    startingRef.current = false
    bargeRef.current?.stop()
    stopSpeaking()
    if (micHeldRef.current) {
      micHeldRef.current = false
      releaseMic()
    }
    setPhase('idle')
  }, [])

  const scheduleListening = useCallback(
    (delay: number) => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      retryTimerRef.current = setTimeout(() => {
        if (activeRef.current && !mutedRef.current) startListeningRef.current?.()
      }, delay)
    },
    [],
  )

  /**
   * Stream the answer and speak it sentence by sentence, so BODHA starts talking
   * as soon as the first sentence exists instead of waiting for the whole reply.
   */
  const handleUser = useCallback(
    async (text: string) => {
      setPhase('thinking')
      setReply('')
      setReplyCommitted(false)
      historyRef.current = [...historyRef.current, { role: 'user', content: text }]

      const turn = turnRef.current
      const controller = new AbortController()
      abortRef.current = controller

      // Sentence queue shared between the model stream and the speech pipeline.
      const queue: string[] = []
      let buffered = ''
      let streamDone = false

      const pushChunk = (chunk: string) => {
        buffered += chunk
        const parts = splitSentences(buffered)
        while (parts.length > 1) queue.push(parts.shift() as string)
        const remainder = parts[0] || ''
        // A trailing sentence-final punctuation means the fragment is complete.
        if (remainder && /[.!?…]["')\]]*\s*$/.test(buffered)) {
          queue.push(remainder)
          buffered = ''
        } else {
          buffered = remainder
        }
      }

      const speakPromise = new Promise<string>(resolve => {
        let began = false
        speakingRef.current = true
        bargeRef.current?.armForNewTurn()
        bargeRef.current?.start()
        speechRef.current = speakStream({
          provider,
          voice,
          language,
          next: async () => {
            // Wait for the next complete sentence, or for the stream to end.
            while (true) {
              if (turn !== turnRef.current || !activeRef.current) return null
              if (queue.length) return queue.shift() as string
              if (streamDone) {
                const tail = buffered.trim()
                buffered = ''
                return tail || null
              }
              await new Promise(r => setTimeout(r, 30))
            }
          },
          onStart: () => {
            if (turn !== turnRef.current || !activeRef.current) return
            began = true
            setPhase('speaking')
          },
          onend: () => {
            speakingRef.current = false
            bargeRef.current?.stop()
            resolve('done')
          },
        })
        void began
      })

      try {
        const full = await ask(text, chunk => {
          if (turn !== turnRef.current || !activeRef.current) return
          setReply(r => r + chunk)
          pushChunk(chunk)
        }, controller.signal)

        streamDone = true
        if (turn !== turnRef.current || !activeRef.current) return
        historyRef.current = [...historyRef.current, { role: 'assistant', content: full }]
        pushTurn('assistant', full)
        // Keep the on-orb subtitle for while the audio finishes, then let the
        // transcript own it so the reply is not shown twice.
        setReplyCommitted(true)

        if (!full.trim()) {
          try {
            speechRef.current?.cancel()
          } catch {
            /* nothing playing */
          }
          speakingRef.current = false
          scheduleListening(150)
          return
        }

        await speakPromise
        if (turn !== turnRef.current || !activeRef.current) return
        // A small gap so the tail of our own audio has drained from the room
        // before the microphone is armed again.
        scheduleListening(250)
      } catch (err) {
        streamDone = true
        if (turn !== turnRef.current || !activeRef.current) return
        try {
          speechRef.current?.cancel()
        } catch {
          /* nothing playing */
        }
        speechRef.current = null
        speakingRef.current = false
        if ((err as Error)?.name !== 'AbortError') {
          setError('I could not reach my own answer just now.')
          scheduleListening(600)
        }
      }
    },
    [ask, language, provider, pushTurn, scheduleListening, voice],
  )

  const startListening = useCallback(() => {
    if (!activeRef.current) return
    // Guard against re-entry: the recorder awaits getUserMedia before it can
    // store a handle, and a second timer tick in that gap would start a SECOND
    // recorder on the same stream. The two then fight and the mic appears to
    // flicker on and off.
    if (recRef.current || startingRef.current) return
    if (mutedRef.current) {
      setPhase('muted')
      return
    }
    setTranscript('')
    setError('')
    setPhase('listening')
    const turn = ++turnRef.current

    // PRIMARY: our own endpointing + server transcription (Groq Whisper large v3 turbo).
    if (serverSttRef.current && micSupported()) {
      startingRef.current = true
      void startLiveTurn({
        // No language hint: Whisper detects Hindi, English or a mix from the audio.
        // Ignore the microphone entirely while BODHA is talking, so our own
        // voice coming back through the speakers cannot retrigger the detector.
        isMuted: () => speakingRef.current || mutedRef.current,
        onReady: () => {
          if (turn === turnRef.current && activeRef.current) setPhase('listening')
        },
        onSpeechStart: () => {
          if (turn === turnRef.current && activeRef.current) setTranscript('')
        },
        // Real microphone amplitude, straight from the detector's own analyser —
        // the orb never animates on synthetic values.
        onLevel: rms => {
          micLevelRef.current = rms
          pushMicLevel(rms)
        },
        onSpeechEnd: () => {
          // Flip the room the instant silence is detected, before the network
          // round trip, so the turn feels immediate.
          if (turn === turnRef.current && activeRef.current) setPhase('thinking')
        },
        onText: (text, info) => {
          if (turn !== turnRef.current || !activeRef.current) return
          recRef.current = null
          const said = (text || '').trim()
          if (said) {
            sttFailsRef.current = 0
            setError('')
            setTranscript(said)
            pushTurn('user', said)
            void handleUser(said)
            return
          }
          setPhase('listening')
          scheduleListening(info?.silent ? 120 : 400)
        },
        onError: reason => {
          if (turn !== turnRef.current || !activeRef.current) return
          recRef.current = null
          if (reason === 'permission') {
            setError('Microphone permission is blocked. Allow microphone access, then reopen Live Mode.')
            setPhase('idle')
            return
          }
          if (reason === 'unsupported') {
            serverSttRef.current = false
            scheduleListening(150)
            return
          }
          // Transcription failed. Back off and retry rather than looping
          // silently — the student should never watch "Thinking…" flicker back
          // with no explanation.
          sttFailsRef.current += 1
          console.warn('[live-stt]', reason)
          if (sttFailsRef.current >= 3) {
            serverSttRef.current = false
            setError('Transcription is unavailable right now — using the browser voice input.')
          } else {
            setError('I did not catch that — try again.')
          }
          scheduleListening(600)
        },
      })
        .then(session => {
          startingRef.current = false
          if (!session) return
          if (turn !== turnRef.current || !activeRef.current || mutedRef.current) {
            session.cancel()
            return
          }
          recRef.current = session
        })
        .catch(() => {
          startingRef.current = false
          serverSttRef.current = false
          scheduleListening(300)
        })
      return
    }

    // FALLBACK: the browser's own recogniser, so the room still works when the
    // transcription service is unreachable.
    let failed = false
    const rec = createRecognizer({
      onResult: text => {
        if (turn === turnRef.current && activeRef.current) setTranscript(text)
      },
      onEnd: finalText => {
        if (failed || turn !== turnRef.current || !activeRef.current || mutedRef.current) return
        recRef.current = null
        const said = (finalText || '').trim()
        if (said) {
          setTranscript(said)
          pushTurn('user', said)
          void handleUser(said)
        } else {
          scheduleListening(300)
        }
      },
      onError: reason => {
        failed = true
        if (turn !== turnRef.current || !activeRef.current) return
        recRef.current = null
        if (/not-allowed|service-not-allowed|permission/i.test(reason || '')) {
          setError('Microphone permission is blocked. Allow microphone access, then reopen Live Mode.')
          setPhase('idle')
          return
        }
        scheduleListening(500)
      },
    })
    if (!rec) {
      setError('Voice input is not available in this browser — try Chrome or Safari on a phone.')
      setPhase('idle')
      return
    }
    recRef.current = rec
    try {
      rec.start()
    } catch {
      /* already started */
    }
  }, [handleUser, pushTurn, scheduleListening])

  // A stable handle so the retry timer always calls the current function.
  const startListeningRef = useRef<(() => void) | null>(null)
  startListeningRef.current = startListening

  /* ── Interrupt / mute ──────────────────────────────────────────────────── */

  const interrupt = useCallback(() => {
    turnRef.current++ // invalidate the in-flight turn
    try {
      abortRef.current?.abort()
    } catch {
      /* nothing in flight */
    }
    abortRef.current = null
    try {
      speechRef.current?.cancel()
    } catch {
      /* nothing playing */
    }
    speechRef.current = null
    speakingRef.current = false
    stopSpeaking()
    if (activeRef.current && !mutedRef.current) scheduleListening(150)
  }, [scheduleListening])

  interruptRef.current = interrupt

  const toggleMute = () => {
    const next = !mutedRef.current
    mutedRef.current = next
    setMuted(next)
    if (next) {
      turnRef.current++
      startingRef.current = false
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      const rec = recRef.current
      if (rec) {
        try {
          rec.cancel()
        } catch {
          /* already finished */
        }
      }
      recRef.current = null
      if (phaseRef.current !== 'speaking') setPhase('muted')
    } else if (phaseRef.current !== 'speaking') {
      scheduleListening(120)
    }
  }

  /* ── Open / close ──────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!open) {
      teardown()
      return
    }

    historyRef.current = []
    mutedRef.current = false
    setMuted(false)
    setTranscript('')
    setReply('')
    setError('')
    setTurns([])
    setReplyCommitted(false)
    setExpanded(false)
    drag.set(0)
    sttFailsRef.current = 0
    serverSttRef.current = true
    startingRef.current = false
    speakingRef.current = false

    void resumeOrbAudio()

    if (!bargeRef.current) {
      bargeRef.current = createBargeInDetector({
        micLevel: () => micLevelRef.current,
        outputLevel: () => voiceOutputLevel(),
        isSpeaking: () => speakingRef.current,
        onBargeIn: () => {
          // The student started talking over BODHA — stop and listen.
          if (!activeRef.current || mutedRef.current) return
          interruptRef.current?.()
        },
      })
    }

    if (!supported) return

    activeRef.current = true
    void acquireMic().then(mic => {
      if (!mic) {
        if (activeRef.current) {
          setError(
            !window.isSecureContext
              ? 'Voice needs a secure (https) connection.'
              : 'Microphone unavailable. Check this site’s microphone permission, then reopen Live Mode.',
          )
          setPhase('idle')
        }
        return
      }
      micHeldRef.current = true
      if (!activeRef.current) {
        releaseMic()
        micHeldRef.current = false
      }
    })
    startListening()

    return teardown
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Esc leaves the room. It is the one shortcut a voice UI cannot do without.
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  /* ── Presentation ──────────────────────────────────────────────────────── */

  const orbState: OrbState = error && phase === 'idle'
    ? 'error'
    : phase === 'listening'
      ? 'listening'
      : phase === 'thinking'
        ? 'thinking'
        : phase === 'speaking'
          ? 'speaking'
          : 'idle'

  const label = error && phase === 'idle'
    ? 'Voice unavailable'
    : phase === 'muted'
      ? 'Muted'
      : phase === 'listening'
        ? 'Listening…'
        : phase === 'thinking'
          ? 'Thinking…'
          : phase === 'speaking'
            ? 'BODHA is speaking…'
            : 'Live mode'

  const subtitle = phase === 'speaking' && reply
    ? reply.slice(0, 160)
    : transcript || (phase === 'listening' ? 'Say something…' : ' ')

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="pt-safe-top fixed inset-0 z-[90] flex flex-col items-center justify-center overflow-hidden bg-[#161311] px-6 text-center"
          role="dialog"
          aria-modal="true"
          aria-label="Live voice mode"
        >
          <button
            onClick={onClose}
            className="absolute right-4 top-4 z-30 flex h-10 w-10 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/90 sm:right-5 sm:top-5"
            aria-label="End Live Mode"
          >
            <X size={18} />
          </button>

          {!supported ? (
            <div className="max-w-sm">
              <MicOff className="mx-auto mb-3 text-white/35" size={30} />
              <p className="text-ui text-white/60">
                Live Mode needs microphone access and audio playback. It isn’t available in this
                browser — try Chrome or Safari.
              </p>
              <button
                onClick={onClose}
                className="mt-5 rounded-full border border-white/15 px-4 py-2 text-ui text-white/80 transition-colors hover:bg-white/[0.06]"
              >
                Go back to typing
              </button>
            </div>
          ) : (
            <>
              {/* Transcript sheet — revealed as the orb is dragged down */}
              <motion.div
                className="pointer-events-none absolute inset-x-0 top-0 z-0 flex flex-col"
                style={{ opacity: sheetOpacity, height: 'calc(50% + 40px)', paddingTop: '3.5rem' }}
                aria-hidden={!expanded}
              >
                <LiveTranscript
                  turns={turns}
                  partial={
                    reply && !replyCommitted ? { role: 'assistant', content: reply } : null
                  }
                />
              </motion.div>

              {/* The orb — drag it down to reveal the conversation */}
              <motion.div
                drag="y"
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={0}
                dragMomentum={false}
                onDragStart={onDragStart}
                onDrag={onDrag}
                onDragEnd={onDragEnd}
                onClick={() => {
                  if (Math.abs(drag.get()) < 3) toggleExpanded()
                }}
                style={{ y: orbY, scale: orbScale }}
                className="relative z-10 mb-8 flex h-56 w-56 cursor-grab touch-none items-center justify-center active:cursor-grabbing sm:mb-10 sm:h-72 sm:w-72"
                role="button"
                tabIndex={0}
                aria-label={expanded ? 'Hide conversation' : 'Show conversation'}
                aria-expanded={expanded}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    toggleExpanded()
                  } else if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    snapTo(DRAG_MAX)
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    snapTo(0)
                  }
                }}
              >
                {/* The orb is the identity of the room. Every state it shows is
                    also stated in words beneath it, so it stays decorative and
                    the room still works without WebGL. */}
                <motion.div className="h-full w-full" style={{ opacity: glowOpacity }}>
                  <BodhaOrb state={orbState} />
                </motion.div>
              </motion.div>

              <motion.p
                style={{ opacity: labelOpacity }}
                className="mb-3 text-[15px] font-medium tracking-tight text-white/90"
              >
                {label}
              </motion.p>

              <motion.p
                style={{ opacity: labelOpacity }}
                className="min-h-[3.25rem] max-w-md px-2 text-reading text-white/55"
                aria-live="polite"
              >
                {subtitle}
              </motion.p>

              {/* Pull-down affordance */}
              <motion.button
                style={{ opacity: hintOpacity }}
                onClick={toggleExpanded}
                className="absolute left-1/2 top-5 z-20 flex -translate-x-1/2 items-center gap-1 px-3 py-2"
                aria-label="Show conversation"
              >
                <span className="h-1 w-8 rounded-full bg-white/20" />
              </motion.button>

              {expanded && (
                <button
                  onClick={toggleExpanded}
                  className="absolute left-1/2 top-5 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-ui-xs text-white/70 transition-colors hover:bg-white/[0.1]"
                  aria-label="Hide conversation"
                >
                  <ChevronUp size={12} /> Hide
                </button>
              )}

              {error && <p className="mt-3 max-w-sm text-ui text-amber-300/80">{error}</p>}

              {/* Mute · Interrupt · End */}
              <div className="absolute bottom-20 flex items-center gap-3 sm:gap-4">
                <button
                  onClick={toggleMute}
                  className={`flex h-14 w-14 items-center justify-center rounded-full border transition-colors ${
                    muted
                      ? 'border-destructive/60 bg-destructive/15 text-destructive'
                      : 'border-white/15 bg-white/[0.06] text-white/85 hover:bg-white/[0.1]'
                  }`}
                  title={muted ? 'Unmute microphone' : 'Mute microphone'}
                  aria-label={muted ? 'Unmute' : 'Mute'}
                  aria-pressed={muted}
                >
                  {muted ? <MicOff size={21} /> : <Mic size={21} />}
                </button>

                <button
                  onClick={toggleExpanded}
                  className={`flex h-14 w-14 items-center justify-center rounded-full border transition-colors ${
                    expanded
                      ? 'border-primary/60 bg-primary/20 text-white'
                      : 'border-white/15 bg-white/[0.06] text-white/85 hover:bg-white/[0.1]'
                  }`}
                  title={expanded ? 'Hide conversation panel' : 'Show conversation panel'}
                  aria-label={expanded ? 'Hide conversation panel' : 'Show conversation panel'}
                  aria-pressed={expanded}
                >
                  <Captions size={21} />
                </button>

                <button
                  onClick={interrupt}
                  disabled={phase !== 'speaking'}
                  className="flex h-14 w-14 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-white/85 transition-colors hover:bg-white/[0.1] disabled:opacity-25"
                  title="Stop speaking"
                  aria-label="Stop speaking"
                >
                  <Square size={19} fill="currentColor" strokeWidth={0} />
                </button>

                <button
                  onClick={onClose}
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive text-white transition-opacity hover:opacity-90"
                  title="End Live Mode"
                  aria-label="End"
                >
                  <PhoneOff size={19} />
                </button>
              </div>

              <p className="pb-safe-bottom absolute bottom-7 flex items-center gap-1.5 text-ui-xs uppercase tracking-[0.14em] text-white/30">
                Mute · Panel · Interrupt · End
              </p>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
