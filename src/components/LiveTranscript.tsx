'use client'

import { useEffect, useRef } from 'react'

export interface LiveTurn {
  id: number
  role: 'user' | 'assistant'
  content: string
}

/**
 * Scrolling transcript of the live conversation, revealed by dragging the orb
 * down. Purely presentational — LiveMode owns the turns.
 *
 * `partial` is the in-flight assistant text (still streaming), shown as the last
 * bubble so the conversation reads as it happens.
 */
export default function LiveTranscript({
  turns = [],
  partial = null,
}: {
  turns?: LiveTurn[]
  partial?: { role: 'user' | 'assistant'; content: string } | null
}) {
  const endRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const pinnedRef = useRef(true)

  // Keep the newest turn in view, but never yank the view away from a student
  // who has scrolled up to re-read something.
  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  useEffect(() => {
    if (!pinnedRef.current) return
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [turns, partial])

  const empty = !turns.length && !partial?.content

  return (
    <div
      className="flex h-full w-full flex-col"
      aria-live="polite"
      aria-label="Live conversation transcript"
    >
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="scrollbar-quiet flex-1 space-y-2.5 overflow-y-auto px-5 pb-2 pt-1"
      >
        {empty ? (
          <p className="pt-6 text-center text-ui text-white/40">
            Your conversation will appear here.
          </p>
        ) : (
          <>
            {turns.map(turn => (
              <Bubble key={turn.id} role={turn.role} text={turn.content} />
            ))}
            {partial?.content ? (
              <Bubble role={partial.role} text={partial.content} pending />
            ) : null}
          </>
        )}
        <div ref={endRef} />
      </div>
    </div>
  )
}

function Bubble({
  role,
  text,
  pending,
}: {
  role: 'user' | 'assistant'
  text: string
  pending?: boolean
}) {
  const isUser = role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-left text-ui leading-relaxed ${
          isUser ? 'bg-primary/25 text-white/95' : 'bg-white/[0.06] text-white/75'
        } ${pending ? 'opacity-80' : ''}`}
      >
        {text}
        {pending && (
          <span className="ml-0.5 inline-block h-3 w-[3px] animate-pulse rounded-sm bg-white/60 align-middle" />
        )}
      </div>
    </div>
  )
}
