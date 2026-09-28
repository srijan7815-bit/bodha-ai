'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Keyboard, Loader2, Mic, MicOff, RotateCcw, VolumeX, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import BodhaOrb, { type OrbState } from '@/components/BodhaOrb'
import { BodhaWordmark } from '@/components/Brand'
import type { Message } from '@/lib/types'

export interface LiveControls {
  listening: boolean
  transcribing: boolean
  interim: string
  onToggleMic: () => void
  handsFree: boolean
  onToggleHandsFree: () => void
  onStopSpeaking: () => void
  onTypeInstead: () => void
  onEnd: () => void
  onMinimize: () => void
}

interface LiveModeProps extends LiveControls {
  state: OrbState
  messages: Message[]
  /** The answer as it streams in, if any. */
  streaming: string
  /** A one-line description of what BODHA is doing right now. */
  caption: string
  busy: boolean
  error?: string | null
  minimized: boolean
  onExpand: () => void
}

/**
 * Live Mode — talking with BODHA, not reading with it.
 *
 * This is deliberately NOT read-aloud: read-aloud stays on each message where
 * it belongs. Live Mode is a room you step into when your hands are busy and
 * your eyes are tired — one orb, one mic, and the conversation in your ears,
 * with the transcript kept quietly underneath so nothing is lost.
 */
export default function LiveMode({
  state,
  messages,
  streaming,
  caption,
  busy,
  error,
  minimized,
  onExpand,
  ...controls
}: LiveModeProps) {
  const turns = useMemo(() => messages.slice(-8), [messages])
  const [pinned, setPinned] = useState(true)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (pinned) endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [turns, streaming, controls.interim, pinned])

  const { onMinimize, onToggleMic } = controls
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onMinimize()
      if (event.code === 'Space' && (event.target as HTMLElement)?.tagName === 'BODY') {
        event.preventDefault()
        onToggleMic()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onMinimize, onToggleMic])

  if (minimized) {
    return (
      <motion.button
        layout
        initial={{ opacity: 0, y: 10, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        onClick={onExpand}
        title="Return to Live Mode"
        className="flex items-center gap-2.5 rounded-full border border-white/10 bg-[#191512]/95 py-1.5 pl-2.5 pr-4 shadow-lift backdrop-blur"
      >
        <span className="h-7 w-7 overflow-hidden rounded-full">
          <BodhaOrb state={state} />
        </span>
        <span className="text-ui font-medium text-[#F3E9DD]">Live Mode</span>
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            state === 'speaking' ? 'bg-primary' : state === 'listening' ? 'bg-emerald-400' : 'bg-white/35',
          )}
        />
      </motion.button>
    )
  }

  const micLabel = controls.listening ? 'Stop listening' : 'Start talking'

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-[#161311]"
      role="dialog"
      aria-modal="true"
      aria-label="Live Mode"
    >
      {/* Ambient warmth — the orb is the light source of this room. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(120% 80% at 50% 12%, rgba(193,99,59,0.22) 0%, rgba(193,99,59,0.06) 42%, rgba(22,19,17,0) 72%)',
        }}
      />

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <header className="relative z-10 flex shrink-0 items-center gap-3 px-4 pt-safe-top pb-2 sm:px-6">
        <div className="pointer-events-none flex items-center gap-2 text-[#F3E9DD]/90">
          <BodhaWordmark size="sm" tone="inverse" />
          <span className="text-ui-sm text-[#F3E9DD]/45">· Live</span>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={controls.onMinimize}
          title="Minimise (Esc)"
          aria-label="Minimise Live Mode"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#F3E9DD]/70 transition-colors hover:bg-white/10 hover:text-[#F3E9DD]"
        >
          <ChevronDown className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={controls.onEnd}
          title="End the session"
          aria-label="End Live Mode"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#F3E9DD]/70 transition-colors hover:bg-white/10 hover:text-[#F3E9DD]"
        >
          <X className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </button>
      </header>

      {/* ── The orb ─────────────────────────────────────────────────────── */}
      <div className="relative z-10 flex shrink-0 flex-col items-center px-6 pt-1">
        <div className="relative h-[min(46vw,240px)] w-[min(46vw,240px)] sm:h-[280px] sm:w-[280px]">
          <BodhaOrb state={state} />
        </div>

        <AnimatePresence mode="wait">
          <motion.p
            key={caption}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.18 }}
            className="mt-4 max-w-[34ch] text-center font-serif text-reading-sm text-[#F3E9DD]/70"
          >
            {caption}
          </motion.p>
        </AnimatePresence>

        {controls.interim && (
          <p className="mt-2 max-w-[36ch] text-center font-serif text-reading-sm italic text-[#F3E9DD]/45">
            “{controls.interim}”
          </p>
        )}
      </div>

      {/* ── Transcript ──────────────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        onScroll={event => {
          const el = event.currentTarget
          setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 56)
        }}
        className="scrollbar-quiet relative z-10 mx-auto mt-4 min-h-0 w-full max-w-2xl flex-1 overflow-y-auto px-4 sm:px-6"
        aria-live="polite"
        aria-label="Live transcript"
      >
        <div className="space-y-2.5 pb-4">
          {!turns.length && !streaming && !busy && (
            <p className="pt-4 text-center font-serif text-reading-sm text-[#F3E9DD]/40">
              Tap the mic and just talk — I will answer out loud. Everything we say is saved to this chat.
            </p>
          )}

          {turns.map(turn => (
            <div key={turn.id} className={cn('flex', turn.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[86%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 font-serif text-reading-sm leading-relaxed',
                  turn.role === 'user'
                    ? 'rounded-br-md bg-primary/22 text-[#F8EFE4]'
                    : 'rounded-bl-md bg-white/[0.06] text-[#EFE5D8]/90',
                )}
              >
                {turn.content}
              </div>
            </div>
          ))}

          {streaming && (
            <div className="flex justify-start">
              <div className="max-w-[86%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-white/[0.06] px-3.5 py-2 font-serif text-reading-sm leading-relaxed text-[#EFE5D8]/90">
                {streaming}
                <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-[1px] animate-blink-caret rounded-sm bg-primary" />
              </div>
            </div>
          )}

          {busy && !streaming && (
            <p className="flex items-center gap-2 pl-1 text-ui-sm text-[#F3E9DD]/45">
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
              Thinking…
            </p>
          )}

          {error && (
            <p className="rounded-xl border border-red-400/25 bg-red-500/10 px-3.5 py-2 text-ui text-red-200/90">{error}</p>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {/* ── Controls ────────────────────────────────────────────────────── */}
      <footer className="relative z-10 shrink-0 border-t border-white/[0.07] px-4 pb-safe pt-3 sm:px-6">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-2 pb-3">
          <button
            type="button"
            onClick={controls.onToggleHandsFree}
            aria-pressed={controls.handsFree}
            className={cn(
              'inline-flex h-11 items-center gap-2 rounded-full border px-3.5 text-ui-sm transition-colors',
              controls.handsFree
                ? 'border-primary/50 bg-primary/15 text-[#F8EFE4]'
                : 'border-white/10 text-[#F3E9DD]/60 hover:text-[#F3E9DD]',
            )}
            title={
              controls.handsFree
                ? 'Hands-free on: I listen again as soon as I finish answering'
                : 'Hands-free off: tap the mic for each question'
            }
          >
            <RotateCcw className="h-4 w-4" strokeWidth={1.8} />
            <span className="hidden sm:inline">Hands-free</span>
          </button>

          <div className="flex-1" />

          {/* The one big control: talk. */}
          <button
            type="button"
            onClick={controls.onToggleMic}
            disabled={controls.transcribing}
            aria-label={micLabel}
            title={`${micLabel} (Space)`}
            className={cn(
              'relative inline-flex h-16 w-16 items-center justify-center rounded-full transition-transform active:scale-95',
              controls.listening
                ? 'bg-red-500/90 text-white'
                : 'bg-primary text-primary-foreground hover:scale-[1.03]',
              controls.transcribing && 'opacity-70',
            )}
          >
            {controls.transcribing ? (
              <Loader2 className="h-6 w-6 animate-spin" strokeWidth={1.9} />
            ) : controls.listening ? (
              <MicOff className="h-6 w-6" strokeWidth={1.9} />
            ) : (
              <Mic className="h-6 w-6" strokeWidth={1.9} />
            )}
            {controls.listening && (
              <span className="absolute inset-0 -z-10 animate-ping rounded-full bg-red-500/30" aria-hidden />
            )}
          </button>

          <div className="flex-1" />

          <button
            type="button"
            onClick={controls.onStopSpeaking}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-[#F3E9DD]/60 transition-colors hover:text-[#F3E9DD]"
            title="Stop BODHA speaking"
            aria-label="Stop BODHA speaking"
          >
            <VolumeX className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </button>

          <button
            type="button"
            onClick={controls.onTypeInstead}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-[#F3E9DD]/60 transition-colors hover:text-[#F3E9DD]"
            title="Type instead"
            aria-label="Type instead of talking"
          >
            <Keyboard className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </button>
        </div>

        <p className="pb-3 text-center text-ui-xs text-[#F3E9DD]/30">
          Space starts and stops the mic · Esc minimises · your words stay on your account
        </p>
      </footer>
    </motion.div>
  )
}
