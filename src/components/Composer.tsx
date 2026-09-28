'use client'

import { useEffect, useRef } from 'react'
import { ArrowUp, Loader2, Mic, Paperclip, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Dictation } from '@/lib/voice'

interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  busy: boolean
  dictation: Dictation
  onAttach?: () => void
  attachLabel?: string
  placeholder?: string
  /** Shown under the field on pointer devices. */
  hint?: boolean
}

/**
 * The writing surface: one calm card that grows with the message.
 * Enter sends, Shift+Enter breaks the line, the mic dictates, ⟶ sends.
 */
export default function Composer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  dictation,
  onAttach,
  attachLabel,
  placeholder = 'Ask BODHA anything you are learning…',
  hint = true,
}: ComposerProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null)

  // Auto-grow up to ~7 lines.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`
  }, [value])

  // Focus when the dictation transcript arrives.
  useEffect(() => {
    if (dictation.interim) ref.current?.focus()
  }, [dictation.interim])

  const canSend = value.trim().length > 0 && !busy

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      if (canSend) onSend()
    }
  }

  const dictationError =
    dictation.error === 'denied'
      ? 'Microphone access was blocked — allow it in your browser settings.'
      : dictation.error === 'unsupported'
        ? 'This browser cannot record audio.'
        : dictation.error === 'failed'
          ? 'I could not catch that — please try again.'
          : dictation.error === 'no-credit'
            ? 'Cloud dictation has no credit left — using the browser voice.'
            : null

  return (
    <div className="w-full">
      <div
        className={cn(
          'relative rounded-[22px] border bg-surface shadow-soft transition-colors',
          dictation.listening ? 'border-primary/50' : 'border-border/80 focus-within:border-primary/40',
        )}
      >
        {dictation.interim && (
          <p className="px-4 pt-3 font-serif text-reading-sm italic text-muted-foreground">{dictation.interim}…</p>
        )}

        <textarea
          ref={ref}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder={placeholder}
          aria-label="Message BODHA"
          className="scrollbar-quiet max-h-[168px] w-full resize-none bg-transparent px-4 pb-2 pt-3.5 text-[15.5px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70"
        />

        <div className="flex items-center gap-1 px-2.5 pb-2.5 pt-0.5">
          {onAttach && (
            <button type="button" onClick={onAttach} className="icon-btn" title={attachLabel ?? 'Add a document'} aria-label={attachLabel ?? 'Add a document'}>
              <Paperclip className="h-[18px] w-[18px]" strokeWidth={1.7} />
            </button>
          )}

          <button
            type="button"
            onClick={dictation.toggle}
            disabled={!dictation.supported}
            title={dictation.listening ? 'Stop dictation' : 'Dictate with your voice'}
            aria-label={dictation.listening ? 'Stop dictation' : 'Dictate with your voice'}
            className={cn(
              'icon-btn relative',
              dictation.listening && 'bg-primary/12 text-primary hover:bg-primary/15 hover:text-primary',
            )}
          >
            {dictation.transcribing ? (
              <Loader2 className="h-[18px] w-[18px] animate-spin" strokeWidth={1.7} />
            ) : (
              <Mic className="h-[18px] w-[18px]" strokeWidth={1.7} />
            )}
            {dictation.listening && (
              <span className="absolute inset-0 -z-10 animate-ping rounded-lg bg-primary/20" aria-hidden />
            )}
          </button>

          <div className="flex-1" />

          {busy ? (
            <button
              type="button"
              onClick={onStop}
              title="Stop"
              aria-label="Stop generating"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-foreground/85 text-background transition-transform hover:scale-[1.03]"
            >
              <Square className="h-3.5 w-3.5" strokeWidth={2.4} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onSend}
              disabled={!canSend}
              title="Send"
              aria-label="Send message"
              className={cn(
                'inline-flex h-9 w-9 items-center justify-center rounded-full transition-all',
                canSend
                  ? 'bg-primary text-primary-foreground hover:scale-[1.04] hover:brightness-[1.04]'
                  : 'bg-foreground/10 text-muted-foreground',
              )}
            >
              <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.2} />
            </button>
          )}
        </div>
      </div>

      {dictationError && <p className="mt-2 px-1 text-ui-sm text-muted-foreground">{dictationError}</p>}

      {hint && !dictationError && (
        <p className="mt-2 hidden px-1 text-ui-sm text-muted-foreground/70 md:block">
          <kbd className="font-sans">Enter</kbd> to send · <kbd className="font-sans">Shift</kbd>+
          <kbd className="font-sans">Enter</kbd> for a new line
        </p>
      )}
    </div>
  )
}
