'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Speaker } from '@/lib/voice'

export type LiveState = 'idle' | 'listening' | 'thinking' | 'speaking'

interface LiveModeProps {
  state: LiveState
  speaker: Speaker
  /** Where the student's attention should be: the chat, or the document panel. */
  gaze?: 'center' | 'left' | 'right'
  minimized: boolean
  onMinimize: (minimized: boolean) => void
  onClose: () => void
  /** A short line describing what BODHA is doing. */
  caption?: string
}

const LABELS: Record<LiveState, string> = {
  idle: 'Ready when you are',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Explaining',
}

/**
 * Live Mode — BODHA's face.
 *
 * A 2D SVG rig (eyes that blink and look around, a mouth driven by the real
 * amplitude of the voice) rather than a heavy 3D avatar: it stays crisp at any
 * size, costs nothing to load, and can live in a corner without stealing the
 * page. Framer Motion handles the transitions between states.
 */
export default function LiveMode({
  state,
  speaker,
  gaze = 'center',
  minimized,
  onMinimize,
  onClose,
  caption,
}: LiveModeProps) {
  const [amplitude, setAmplitude] = useState(0)
  const [blink, setBlink] = useState(false)
  const ampRef = useRef(0)

  // Amplitude → mouth. Sampled on rAF while speaking, eased for a soft mouth.
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const next = state === 'speaking' ? speaker.getAmplitude() : 0
      ampRef.current += (next - ampRef.current) * (next > ampRef.current ? 0.45 : 0.18)
      setAmplitude(ampRef.current)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [speaker, state])

  // Natural, slightly irregular blinking.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const loop = () => {
      setBlink(true)
      setTimeout(() => setBlink(false), 120)
      timer = setTimeout(loop, 2600 + Math.random() * 3800)
    }
    timer = setTimeout(loop, 1800)
    return () => clearTimeout(timer)
  }, [])

  // Listening: a soft level meter from the mic so the face feels alive.
  const [pulse, setPulse] = useState(0)
  useEffect(() => {
    if (state !== 'listening') return
    const id = setInterval(() => setPulse(p => (p + 1) % 3), 420)
    return () => clearInterval(id)
  }, [state])

  const eyeShift = gaze === 'left' ? -2.2 : gaze === 'right' ? 2.2 : 0
  const mouthOpen = state === 'speaking' ? 1.2 + amplitude * 7 : state === 'listening' ? 2.2 : 1.4

  const dot =
    state === 'speaking' ? 'bg-primary' : state === 'listening' ? 'bg-emerald-500' : state === 'thinking' ? 'bg-amber-500' : 'bg-muted-foreground/50'

  if (minimized) {
    return (
      <motion.button
        layout
        initial={{ opacity: 0, y: 8, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.95 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        onClick={() => onMinimize(false)}
        title="Expand Live Mode"
        className="group flex items-center gap-2 rounded-full border border-border/80 bg-surface/95 py-1.5 pl-2 pr-3 shadow-card backdrop-blur"
      >
        <span className="relative flex h-6 w-9 items-center justify-center">
          <Face eyes={eyeShift} blink={blink} mouthOpen={mouthOpen} compact />
        </span>
        <span className={cn('h-1.5 w-1.5 rounded-full transition-colors', dot)} />
        <span className="text-ui-sm text-muted-foreground group-hover:text-foreground">{LABELS[state]}</span>
      </motion.button>
    )
  }

  return (
    <motion.section
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ type: 'spring', stiffness: 400, damping: 34 }}
      className="panel overflow-hidden"
      aria-label="Live Mode"
    >
      <header className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
        <span className="text-ui-sm font-medium text-foreground/80">Live Mode</span>
        <div className="flex-1" />
        <button type="button" onClick={() => onMinimize(true)} className="icon-btn-sm" title="Minimize" aria-label="Minimize Live Mode">
          <ChevronDown className="h-4 w-4" strokeWidth={1.8} />
        </button>
        <button type="button" onClick={onClose} className="icon-btn-sm" title="Close" aria-label="Close Live Mode">
          <X className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </header>

      <div className="relative flex flex-col items-center px-4 pb-4 pt-5">
        {/* halo — quiet, state-tinted */}
        <motion.span
          aria-hidden
          className="absolute left-1/2 top-[42px] -z-0 h-32 w-32 -translate-x-1/2 rounded-full"
          animate={{
            opacity: state === 'idle' ? 0.35 : 0.6,
            scale: state === 'speaking' ? 1 + Math.min(amplitude, 0.5) * 0.18 : 1,
            backgroundColor:
              state === 'listening' ? 'rgba(16,185,129,0.10)' : state === 'thinking' ? 'rgba(245,158,11,0.10)' : 'rgba(193,99,59,0.10)',
          }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
        />

        <Face eyes={eyeShift} blink={blink} mouthOpen={mouthOpen} pulse={state === 'listening' ? pulse : 0} />

        <AnimatePresence mode="wait">
          <motion.p
            key={caption ?? LABELS[state]}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className="mt-4 text-center font-serif text-reading-sm italic text-muted-foreground"
          >
            {caption ?? LABELS[state]}
          </motion.p>
        </AnimatePresence>

        {(state === 'speaking' || state === 'listening') && (
          <div className="mt-3 flex h-4 items-end gap-[3px]" aria-hidden>
            {[0, 1, 2, 3, 4].map(i => (
              <motion.span
                key={i}
                className="w-[3px] rounded-full bg-primary/70"
                animate={{ height: `${4 + (i === 2 ? 12 : i === 1 || i === 3 ? 8 : 5) * (0.4 + amplitude)}px` }}
                transition={{ duration: 0.12 }}
              />
            ))}
          </div>
        )}
      </div>
    </motion.section>
  )
}

/**
 * The face itself. Kept as plain SVG so it scales and prints crisply, and so
 * the eyes/mouth can be animated without any image assets.
 */
function Face({
  eyes,
  blink,
  mouthOpen,
  compact = false,
  pulse = 0,
}: {
  eyes: number
  blink: boolean
  mouthOpen: number
  compact?: boolean
  pulse?: number
}) {
  const w = compact ? 38 : 132
  const h = compact ? 26 : 92
  const eyeY = compact ? 10 : 34
  const eyeRx = compact ? 2.4 : 6.4

  return (
    <svg viewBox="0 0 160 112" width={w} height={h} className="relative z-[1]" aria-hidden>
      {/* head */}
      <ellipse cx="80" cy="52" rx="58" ry="50" fill="rgb(var(--card))" stroke="rgb(var(--border))" strokeWidth="1.5" />

      {/* listening: pulse rings */}
      {pulse > 0 && (
        <ellipse
          cx="80"
          cy="52"
          rx={62 + pulse * 2.5}
          ry={54 + pulse * 2.5}
          fill="none"
          stroke="rgb(16 185 129)"
          strokeOpacity={0.35 - pulse * 0.1}
          strokeWidth="1.5"
        />
      )}

      {/* eyes */}
      <g transform={`translate(${eyes} 0)`}>
        <ellipse cx="58" cy={eyeY} rx={eyeRx} ry={blink ? eyeRx * 0.12 : eyeRx * 1.12} fill="rgb(var(--foreground))" />
        <ellipse cx="102" cy={eyeY} rx={eyeRx} ry={blink ? eyeRx * 0.12 : eyeRx * 1.12} fill="rgb(var(--foreground))" />
        {!blink && <circle cx="60.4" cy={eyeY - 2.4} r={compact ? 0.9 : 2.1} fill="rgb(var(--background))" opacity="0.85" />}
        {!blink && <circle cx="104.4" cy={eyeY - 2.4} r={compact ? 0.9 : 2.1} fill="rgb(var(--background))" opacity="0.85" />}
      </g>

      {/* brows — a small tell of attention */}
      <path
        d="M48 22 q10 -5 20 -1 M92 21 q10 -4 20 1"
        stroke="rgb(var(--muted-foreground))"
        strokeOpacity="0.55"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />

      {/* mouth — driven by voice amplitude */}
      <path
        d={`M62 68 q18 ${mouthOpen * 1.6} 36 0`}
        stroke="rgb(var(--foreground))"
        strokeOpacity="0.72"
        strokeWidth={compact ? 1.8 : 2.6}
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}
