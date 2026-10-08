'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUp, AudioLines, BookMarked, BookOpen, Boxes, ChevronDown, FileText, Loader2, Mic, Paperclip, Plus, Square, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Dictation } from '@/lib/voice'
import { BodhaMark } from '@/components/Brand'

interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  busy: boolean
  dictation: Dictation
  /** Opens the document picker. */
  onAttach?: () => void
  attachLabel?: string
  /** The book or notes currently linked to this chat. */
  linkedDoc?: { title: string } | null
  onClearDoc?: () => void
  /** Starts Live Mode — shown in place of Send while the field is empty. */
  onLive?: () => void
  liveActive?: boolean
  /** Which brain answers. With one option the chip simply opens Settings. */
  modelOptions?: Array<{ id: string; label: string }>
  modelValue?: string
  onModelChange?: (id: string) => void
  placeholder?: string
  hint?: boolean
}

const EASE = [0.22, 1, 0.36, 1] as const

/**
 * The writing surface — one rounded card: the text on top, and under it the
 * round "+" menu, the model chip, the mic, and a single action button that is
 * Live Mode while the field is empty, Send once there is something to send,
 * and Stop while BODHA is answering.
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
  linkedDoc,
  onClearDoc,
  onLive,
  liveActive,
  modelOptions = [],
  modelValue,
  onModelChange,
  placeholder = 'Ask BODHA…',
  hint = true,
}: ComposerProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const router = useRouter()
  const [menu, setMenu] = useState<'plus' | 'model' | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`
  }, [value])

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

  const plusItems = [
    ...(onAttach ? [{ icon: Paperclip, label: linkedDoc ? 'Change linked book' : 'Link a book or notes', run: onAttach }] : []),
    { icon: BookOpen, label: 'Upload to Library', run: () => router.push('/library') },
    { icon: BookMarked, label: 'Knowledge Shelf', run: () => router.push('/iks') },
    { icon: Boxes, label: 'Code sandbox', run: () => router.push('/sandbox') },
  ]

  const activeModel = modelOptions.find(o => o.id === modelValue) ?? modelOptions[0]
  const circle = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full'

  return (
    <div className="w-full">
      <div
        className={cn(
          'relative rounded-[28px] border bg-surface shadow-soft transition-[border-color,box-shadow] duration-200',
          dictation.listening
            ? 'border-primary/60 shadow-[0_0_0_4px_rgb(var(--primary)/0.10)]'
            : 'border-border/80 focus-within:border-primary/45 focus-within:shadow-[0_0_0_4px_rgb(var(--primary)/0.07)]',
        )}
      >
        <AnimatePresence initial={false}>
          {linkedDoc && (
            <motion.div
              key="doc"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22, ease: EASE }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-2 px-4 pt-3">
                <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-primary/10 py-1 pl-2.5 pr-1 text-ui-sm text-primary">
                  <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                  <span className="truncate">{linkedDoc.title}</span>
                  {onClearDoc && (
                    <button type="button" onClick={onClearDoc} className="rounded-full p-1 hover:bg-primary/15" aria-label="Unlink this book">
                      <X className="h-3 w-3" strokeWidth={2.2} />
                    </button>
                  )}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {dictation.interim && <p className="px-5 pt-3 font-serif text-reading-sm italic text-muted-foreground">{dictation.interim}…</p>}

        <textarea
          ref={ref}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder={placeholder}
          aria-label="Message BODHA"
          className="scrollbar-quiet max-h-[168px] min-h-[52px] w-full resize-none bg-transparent px-5 pb-1 pt-4 text-[17px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70"
        />

        <div className="flex items-center gap-2 px-2.5 pb-2.5 pt-1">
          {/* + menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenu(menu === 'plus' ? null : 'plus')}
              aria-label="Add"
              aria-expanded={menu === 'plus'}
              className={cn(circle, 'bg-foreground/[0.07] text-foreground/80 hover:bg-foreground/[0.11]')}
            >
              <motion.span animate={{ rotate: menu === 'plus' ? 45 : 0 }} transition={{ duration: 0.2, ease: EASE }} className="flex">
                <Plus className="h-[22px] w-[22px]" strokeWidth={1.7} />
              </motion.span>
            </button>
          </div>

          {/* model chip */}
          <div className="relative min-w-0">
            <button
              type="button"
              onClick={() => (modelOptions.length > 1 ? setMenu(menu === 'model' ? null : 'model') : router.push('/settings'))}
              className="inline-flex h-11 max-w-[11.5rem] items-center gap-2 rounded-full bg-foreground/[0.07] pl-3 pr-3.5 text-[15px] text-foreground hover:bg-foreground/[0.11]"
              aria-label="Which model answers"
            >
              <BodhaMark size={20} tone="plain" className="-ml-0.5" />
              <span className="truncate">{activeModel?.label ?? 'BODHA'}</span>
              {modelOptions.length > 1 && <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />}
            </button>
          </div>

          <div className="flex-1" />

          <button
            type="button"
            onClick={dictation.toggle}
            disabled={!dictation.supported}
            title={dictation.listening ? 'Stop dictation' : 'Dictate with your voice'}
            aria-label={dictation.listening ? 'Stop dictation' : 'Dictate with your voice'}
            className={cn(
              circle,
              'relative bg-foreground/[0.07] text-foreground/80 hover:bg-foreground/[0.11]',
              dictation.listening && 'bg-primary/15 text-primary hover:bg-primary/20',
            )}
          >
            {dictation.transcribing ? <Loader2 className="h-5 w-5 animate-spin" strokeWidth={1.7} /> : <Mic className="h-5 w-5" strokeWidth={1.7} />}
            {dictation.listening && <span className="absolute inset-0 -z-10 animate-ping rounded-full bg-primary/25" aria-hidden />}
          </button>

          {/* one action button: Stop → Send → Live */}
          <AnimatePresence mode="popLayout" initial={false}>
            {busy ? (
              <motion.button
                key="stop"
                type="button"
                onClick={onStop}
                aria-label="Stop generating"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={{ duration: 0.18, ease: EASE }}
                className={cn(circle, 'bg-foreground text-background')}
              >
                <Square className="h-3.5 w-3.5" strokeWidth={2.4} fill="currentColor" />
              </motion.button>
            ) : canSend || !onLive ? (
              <motion.button
                key="send"
                type="button"
                onClick={onSend}
                disabled={!canSend}
                aria-label="Send message"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={{ duration: 0.18, ease: EASE }}
                className={cn(circle, canSend ? 'bg-primary text-primary-foreground' : 'bg-foreground/10 text-muted-foreground')}
              >
                <ArrowUp className="h-5 w-5" strokeWidth={2.2} />
              </motion.button>
            ) : (
              <motion.button
                key="live"
                type="button"
                onClick={onLive}
                aria-label="Start Live Mode — talk with BODHA"
                aria-pressed={liveActive}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={{ duration: 0.18, ease: EASE }}
                className={cn(circle, 'bg-foreground text-background')}
              >
                <AudioLines className="h-[22px] w-[22px]" strokeWidth={1.9} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* menus open upward from the card */}
        <AnimatePresence>
          {menu && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenu(null)} aria-hidden />
              <motion.div
                key={menu}
                initial={{ opacity: 0, scale: 0.94, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 6 }}
                transition={{ duration: 0.18, ease: EASE }}
                style={{ transformOrigin: menu === 'plus' ? 'bottom left' : 'bottom center' }}
                className={cn(
                  'absolute bottom-[calc(100%+10px)] z-40 w-[min(18rem,86vw)] rounded-2xl border border-border/80 bg-popover p-1.5 shadow-lift',
                  menu === 'plus' ? 'left-0' : 'left-12',
                )}
                role="menu"
              >
                {menu === 'plus'
                  ? plusItems.map(({ icon: Icon, label, run }, i) => (
                      <motion.button
                        key={label}
                        type="button"
                        role="menuitem"
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.03 * i, duration: 0.2, ease: EASE }}
                        onClick={() => {
                          setMenu(null)
                          run()
                        }}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[15.5px] text-foreground hover:bg-foreground/[0.06]"
                      >
                        <Icon className="h-[19px] w-[19px] text-muted-foreground" strokeWidth={1.6} />
                        {label}
                      </motion.button>
                    ))
                  : modelOptions.map(option => (
                      <button
                        key={option.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={option.id === activeModel?.id}
                        onClick={() => {
                          setMenu(null)
                          if (option.id !== activeModel?.id) onModelChange?.(option.id)
                        }}
                        className={cn(
                          'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left text-[15.5px] hover:bg-foreground/[0.06]',
                          option.id === activeModel?.id && 'bg-foreground/[0.06] font-medium',
                        )}
                      >
                        <span className="truncate">{option.label}</span>
                        {option.id === activeModel?.id && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
                      </button>
                    ))}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      {dictationError && <p className="mt-2 px-1 text-ui-sm text-muted-foreground">{dictationError}</p>}
      {hint && !dictationError && (
        <p className="mt-2 hidden px-1 text-ui-sm text-muted-foreground/70 md:block">
          <kbd className="font-sans">Enter</kbd> to send · <kbd className="font-sans">Shift</kbd>+<kbd className="font-sans">Enter</kbd> for a new line
        </p>
      )}
    </div>
  )
}
