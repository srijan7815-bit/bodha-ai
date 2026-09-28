'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowDown, BookOpen, Check, Copy, FileText, GraduationCap, Lightbulb, RefreshCw, Sigma, Sparkles, SquarePen, Volume2, VolumeX, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { authFetch } from '@/lib/firebase/client-token'
import { useSpeaker, useDictation } from '@/lib/voice'
import Markdown from '@/components/Markdown'
import Composer from '@/components/Composer'
import LiveMode from '@/components/LiveMode'
import type { OrbState } from '@/components/BodhaOrb'
import { resumeOrbAudio } from '@/lib/orbAudio'
import DocPicker from '@/components/DocPicker'
import { announceChatsChanged } from '@/components/AppShell'
import type { Chat, DocumentMeta, Message } from '@/lib/types'

interface ChatViewProps {
  chat: Chat | null
  initialMessages: Message[]
  documentMeta: DocumentMeta | null
  /** `/chat?document=<id>` — the Library hands a document straight to the chat. */
  initialDocumentId?: string | null
  /** `/chat?q=<text>` — the reader's “ask about this paragraph” tab. */
  initialDraft?: string | null
}

const DRAFT_PREFIX = 'bodha:draft:'
const DRAFT_MAX_AGE = 20 * 60 * 1000

const SUGGESTIONS = [
  { icon: Sigma, text: 'Explain the chain rule with a simple example' },
  { icon: Lightbulb, text: 'Why is the sky blue? Teach me step by step' },
  { icon: GraduationCap, text: 'Quiz me on the French Revolution' },
  { icon: BookOpen, text: 'Summarise the chapter I uploaded' },
]

function deriveTitle(text: string) {
  const clean = text.trim().replace(/\s+/g, ' ')
  return clean.length > 52 ? `${clean.slice(0, 52)}…` : clean || 'New chat'
}

export default function ChatView({ chat, initialMessages, documentMeta, initialDocumentId, initialDraft }: ChatViewProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [chatId, setChatId] = useState<string | null>(chat?.id ?? null)
  const [title, setTitle] = useState(chat?.title ?? 'New chat')
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [doc, setDoc] = useState<DocumentMeta | null>(documentMeta)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [liveOpen, setLiveOpen] = useState(false)
  const [liveMinimized, setLiveMinimized] = useState(false)
  const [readingId, setReadingId] = useState<string | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [handsFree, setHandsFree] = useState(false)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const speaker = useSpeaker()

  // Live Mode needs to reach into the stream loop without rebuilding it, and
  // dictation must know whether a transcript should be sent or typed.
  const liveOpenRef = useRef(false)
  const handsFreeRef = useRef(false)
  const speakAnswerRef = useRef<((text: string) => void) | null>(null)

  const dictation = useDictation(text => {
    if (liveOpenRef.current) {
      // Spoken question in Live Mode: send it the moment it lands.
      void askRef.current?.(text)
      return
    }
    setDraft(prev => (prev ? `${prev} ${text}` : text))
  })
  const askRef = useRef<((text: string) => Promise<void>) | null>(null)

  // ─── Draft autosave (restore anything under 20 minutes old) ───────────────
  useEffect(() => {
    const key = `${DRAFT_PREFIX}${chatId ?? 'new'}`
    try {
      const raw = sessionStorage.getItem(key) ?? localStorage.getItem(key)
      if (!raw) return
      const parsed = JSON.parse(raw) as { text?: string; at?: number }
      if (parsed?.text && typeof parsed.at === 'number' && Date.now() - parsed.at < DRAFT_MAX_AGE) {
        setDraft(parsed.text)
      } else {
        localStorage.removeItem(key)
      }
    } catch {}
  }, [chatId])

  useEffect(() => {
    const key = `${DRAFT_PREFIX}${chatId ?? 'new'}`
    const id = setTimeout(() => {
      try {
        if (draft.trim()) localStorage.setItem(key, JSON.stringify({ text: draft, at: Date.now() }))
        else localStorage.removeItem(key)
      } catch {}
    }, 400)
    return () => clearTimeout(id)
  }, [draft, chatId])

  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(`${DRAFT_PREFIX}${chatId ?? 'new'}`)
    } catch {}
  }, [chatId])

  // Text handed over from the reader ("ask about this paragraph").
  useEffect(() => {
    if (initialDraft) setDraft(initialDraft)
  }, [initialDraft])

  // A document handed over from the Library.
  useEffect(() => {
    if (!initialDocumentId || doc) return
    let cancelled = false
    void (async () => {
      try {
        const res = await authFetch(`/api/documents/${initialDocumentId}?meta=1`, { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && data.document) setDoc(data.document as DocumentMeta)
      } catch {}
    })()
    return () => {
      cancelled = true
    }
  }, [initialDocumentId, doc])

  // ─── Scrolling ────────────────────────────────────────────────────────────
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  useLayoutEffect(() => {
    if (atBottom) scrollToBottom(messages.length > 2 ? 'smooth' : 'auto')
  }, [messages, streaming, atBottom, scrollToBottom])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      setAtBottom(distance < 120)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // Stop speaking when leaving the page.
  useEffect(() => () => speaker.stop(), [speaker])

  useEffect(() => {
    liveOpenRef.current = liveOpen && !liveMinimized
    handsFreeRef.current = handsFree
  }, [liveOpen, liveMinimized, handsFree])

  // In Live Mode the answer is spoken as soon as it is complete; hands-free
  // opens the mic again the moment BODHA stops talking, so a student can revise
  // out loud without touching the screen.
  useEffect(() => {
    speakAnswerRef.current = (text: string) => {
      if (!liveOpenRef.current || !text.trim()) return
      void speaker.speak(text, {
        onDone: () => {
          if (handsFreeRef.current) dictation.start()
        },
      })
    }
  }, [speaker, dictation.start])

  // Opening Live Mode starts listening — it is a conversation, not a form.
  const autoListenRef = useRef(false)
  useEffect(() => {
    if (!liveOpen) {
      autoListenRef.current = false
      return
    }
    if (liveMinimized || autoListenRef.current) return
    autoListenRef.current = true
    const id = setTimeout(() => {
      void resumeOrbAudio()
      dictation.start()
    }, 550)
    return () => clearTimeout(id)
  }, [liveOpen, liveMinimized, dictation.start])

  // ─── Streaming ────────────────────────────────────────────────────────────
  const runStream = useCallback(
    async (targetChatId: string, body: { content?: string; regenerate?: boolean }, optimistic?: Message) => {
      setBusy(true)
      setError(null)
      setNotice(null)
      setStreaming('')

      const controller = new AbortController()
      abortRef.current = controller
      let streamed = ''

      try {
        const res = await authFetch(`/api/chats/${targetChatId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        })

        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}))
          setError(data.errorMessage ?? data.error ?? 'I could not answer just now. Please try again.')
          setBusy(false)
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.trim()) continue
            let frame: { t: string; v?: string; message?: Message | null; errorMessage?: string }
            try {
              frame = JSON.parse(line)
            } catch {
              continue
            }

            if (frame.t === 'user' && frame.message) {
              const persisted = frame.message
              setMessages(prev => {
                const idx = optimistic ? prev.findIndex(m => m.id === optimistic.id) : -1
                if (idx === -1) return [...prev, persisted]
                const next = [...prev]
                next[idx] = persisted
                return next
              })
            } else if (frame.t === 'delta' && frame.v) {
              streamed += frame.v
              setStreaming(streamed)
            } else if (frame.t === 'notice' && frame.v) {
              setNotice(frame.v)
            } else if (frame.t === 'done') {
              if (frame.message) {
                const finished = frame.message as Message
                setMessages(prev => [...prev, finished])
                speakAnswerRef.current?.(finished.content)
              }
              setStreaming('')
            } else if (frame.t === 'error') {
              if (frame.errorMessage) setError(frame.errorMessage)
            }
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          console.warn('[chat] stream failed', err)
          setError('The connection dropped. Your message is saved — try again.')
        }
      } finally {
        if (streamed.trim()) setStreaming('')
        setBusy(false)
        abortRef.current = null
        announceChatsChanged()
      }
    },
    [],
  )

  const send = useCallback(async () => {
    const text = draft.trim()
    if (!text || busy) return
    setError(null)
    dictation.stop()
    speaker.stop()

    let targetId = chatId
    try {
      if (!targetId) {
        const res = await authFetch('/api/chats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: deriveTitle(text), documentId: doc?.id ?? null }),
        })
        if (!res.ok) throw new Error('create failed')
        const data = await res.json()
        targetId = data.chat.id as string
        setChatId(targetId)
        setTitle(data.chat.title as string)
        window.history.replaceState(null, '', `/chat/${targetId}`)
        announceChatsChanged()
      }
    } catch {
      setError('I could not start a new conversation. Please try again.')
      return
    }

    const optimistic: Message = {
      id: `local-${Date.now()}`,
      chatId: targetId,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    }
    setMessages(prev => [...prev, optimistic])
    setDraft('')
    clearDraft()
    setAtBottom(true)
    await runStream(targetId, { content: text }, optimistic)
  }, [busy, chatId, clearDraft, dictation, doc, draft, runStream, speaker])

  /** Same path as typing, for a question that arrived by voice. */
  const ask = useCallback(
    async (text: string) => {
      const clean = text.trim()
      if (!clean || busy) return
      setDraft(clean)
      // Let the composer reflect it, then send through the normal flow.
      await new Promise(resolve => setTimeout(resolve, 0))
      setDraft('')
      clearDraft()
      dictation.stop()
      speaker.stop()
      setAtBottom(true)

      let targetId = chatId
      try {
        if (!targetId) {
          const res = await authFetch('/api/chats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: deriveTitle(clean), documentId: doc?.id ?? null }),
          })
          if (!res.ok) throw new Error('create failed')
          const data = await res.json()
          targetId = data.chat.id as string
          setChatId(targetId)
          setTitle(data.chat.title as string)
          window.history.replaceState(null, '', `/chat/${targetId}`)
          announceChatsChanged()
        }
      } catch {
        setError('I could not start a new conversation. Please try again.')
        return
      }

      const optimistic: Message = {
        id: `local-${Date.now()}`,
        chatId: targetId,
        role: 'user',
        content: clean,
        createdAt: new Date().toISOString(),
      }
      setMessages(prev => [...prev, optimistic])
      await runStream(targetId, { content: clean }, optimistic)
    },
    [busy, chatId, clearDraft, dictation, doc, runStream, speaker],
  )
  askRef.current = ask

  const regenerate = useCallback(async () => {
    if (!chatId || busy) return
    speaker.stop()
    setMessages(prev => {
      const next = [...prev]
      while (next.length && next[next.length - 1].role === 'assistant') next.pop()
      return next
    })
    setAtBottom(true)
    await runStream(chatId, { regenerate: true })
  }, [busy, chatId, runStream, speaker])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    setBusy(false)
    setStreaming('')
  }, [])

  const speak = useCallback(
    (message: Message) => {
      if (readingId === message.id && speaker.speaking) {
        speaker.stop()
        setReadingId(null)
        return
      }
      setReadingId(message.id)
      void speaker.speak(message.content).finally(() => setReadingId(current => (current === message.id ? null : current)))
    },
    [readingId, speaker],
  )

  const orbState: OrbState = busy
    ? 'thinking'
    : speaker.speaking
      ? 'speaking'
      : dictation.listening
        ? 'listening'
        : 'idle'

  const liveCaption = busy
    ? 'Thinking about that…'
    : speaker.speaking
      ? 'Answering out loud'
      : dictation.transcribing
        ? 'Writing down what you said…'
        : dictation.listening
          ? 'Listening — take your time'
          : error
            ? 'Something went wrong just now'
            : 'Tap the mic and ask me anything'
  const lastAssistantId = [...messages].reverse().find(m => m.role === 'assistant')?.id

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="z-20 flex h-13 shrink-0 items-center gap-2 border-b border-border/60 bg-background/85 px-3 py-2 backdrop-blur md:px-6">
          <h1 className="min-w-0 flex-1 truncate text-ui font-medium text-foreground/90">{title}</h1>

          {doc && (
            <Link
              href={`/library/${doc.id}`}
              className="hidden max-w-[220px] items-center gap-1.5 rounded-full border border-border/70 bg-surface px-2.5 py-1 text-ui-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground sm:inline-flex"
              title={`Reading: ${doc.title}`}
            >
              <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
              <span className="truncate">{doc.title}</span>
            </Link>
          )}

          <button
            type="button"
            onClick={() => {
              const next = !(liveOpen && !liveMinimized)
              setLiveOpen(next)
              setLiveMinimized(false)
              if (next) void resumeOrbAudio()
              else speaker.stop()
            }}
            aria-pressed={liveOpen}
            title="Live Mode — talk with BODHA out loud"
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-ui-sm transition-colors',
              liveOpen
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border/70 bg-surface text-muted-foreground hover:text-foreground',
            )}
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.8} />
            <span className="hidden sm:inline">Live</span>
          </button>
        </header>

        {/* ── Messages ───────────────────────────────────────────────────── */}
        <div ref={scrollRef} className="scrollbar-quiet min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-read px-4 pb-8 pt-6 md:px-6">
            {messages.length === 0 && !streaming && (
              <EmptyState hasDocument={!!doc} docTitle={doc?.title} onPick={text => setDraft(text)} />
            )}

            <div className="space-y-6">
              <AnimatePresence initial={false}>
                {messages.map((message, index) => (
                  <motion.div
                    key={message.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {message.role === 'user' ? (
                      <UserMessage content={message.content} />
                    ) : (
                      <AssistantMessage
                        content={message.content}
                        speaking={readingId === message.id && speaker.speaking}
                        onSpeak={() => speak(message)}
                        onRegenerate={message.id === lastAssistantId && !busy ? regenerate : undefined}
                        showActions={!busy || index < messages.length - 1}
                      />
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>

              {notice && (
                <p className="flex items-start gap-2 font-serif text-reading-sm italic text-muted-foreground">
                  <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
                  {notice}
                </p>
              )}

              {streaming && (
                <div className="animate-fade-in">
                  <Markdown content={streaming} />
                  <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-[2px] animate-blink-caret rounded-sm bg-primary align-middle" />
                </div>
              )}

              {busy && !streaming && (
                <p className="flex items-center gap-2 text-ui-sm text-muted-foreground">
                  <span className="flex gap-1">
                    {[0, 1, 2].map(i => (
                      <span
                        key={i}
                        className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-primary/70"
                        style={{ animationDelay: `${i * 180}ms` }}
                      />
                    ))}
                  </span>
                  BODHA is thinking…
                </p>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/[0.06] px-3.5 py-2.5 text-ui text-destructive">
                  <span className="flex-1">{error}</span>
                  <button type="button" onClick={() => setError(null)} className="icon-btn-sm -my-1 -mr-1" aria-label="Dismiss">
                    <X className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Scroll affordance ──────────────────────────────────────────── */}
        <AnimatePresence>
          {!atBottom && (
            <motion.button
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              onClick={() => {
                setAtBottom(true)
                scrollToBottom()
              }}
              className="absolute bottom-36 left-1/2 z-20 -translate-x-1/2 rounded-full border border-border/80 bg-surface/95 p-2 shadow-card backdrop-blur"
              aria-label="Jump to the latest message"
            >
              <ArrowDown className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
            </motion.button>
          )}
        </AnimatePresence>

        {/* ── Composer ───────────────────────────────────────────────────── */}
        <div className="relative z-10 shrink-0 border-t border-border/60 bg-background/95 pb-safe backdrop-blur">
          <div className="mx-auto w-full max-w-read px-3 py-3 md:px-6">
            <Composer
              value={draft}
              onChange={setDraft}
              onSend={() => void send()}
              onStop={stop}
              busy={busy}
              dictation={dictation}
              onAttach={() => setPickerOpen(true)}
              attachLabel={doc ? `Linked: ${doc.title}` : 'Link a document'}
            />
          </div>
        </div>
      </div>

      {/* ── Live Mode — a full room for talking, not reading ───────────── */}
      <AnimatePresence>
        {liveOpen && (
          <LiveMode
            key="live-mode"
            state={orbState}
            messages={messages}
            streaming={streaming}
            caption={liveCaption}
            busy={busy}
            error={error}
            minimized={liveMinimized}
            onExpand={() => setLiveMinimized(false)}
            listening={dictation.listening}
            transcribing={dictation.transcribing}
            interim={dictation.interim}
            onToggleMic={() => {
              void resumeOrbAudio()
              if (dictation.listening) dictation.stop()
              else dictation.start()
            }}
            handsFree={handsFree}
            onToggleHandsFree={() => setHandsFree(value => !value)}
            onStopSpeaking={() => speaker.stop()}
            onTypeInstead={() => {
              setLiveOpen(false)
              speaker.stop()
              dictation.stop()
            }}
            onEnd={() => {
              setLiveOpen(false)
              setLiveMinimized(false)
              speaker.stop()
              dictation.stop()
            }}
            onMinimize={() => setLiveMinimized(true)}
          />
        )}
      </AnimatePresence>

      <DocPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={picked => {
          setDoc(picked)
          setPickerOpen(false)
        }}
        onClear={() => {
          setDoc(null)
          setPickerOpen(false)
        }}
        selectedId={doc?.id}
      />
    </div>
  )
}

/* ─── Pieces ──────────────────────────────────────────────────────────────── */

function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[88%] whitespace-pre-wrap rounded-[20px] rounded-br-md bg-card px-4 py-2.5 text-[15.5px] leading-relaxed text-foreground/90 shadow-soft md:max-w-[80%]">
        {content}
      </div>
    </div>
  )
}

function AssistantMessage({
  content,
  speaking,
  onSpeak,
  onRegenerate,
  showActions,
}: {
  content: string
  speaking: boolean
  onSpeak: () => void
  onRegenerate?: () => void
  showActions: boolean
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {}
  }

  return (
    <div className="group">
      <Markdown content={content} />
      {showActions && (
        <div className="mt-2 flex items-center gap-0.5 opacity-60 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100 md:opacity-0">
          <button type="button" onClick={copy} className="icon-btn-sm" title={copied ? 'Copied' : 'Copy answer'} aria-label="Copy answer">
            {copied ? <Check className="h-3.5 w-3.5" strokeWidth={1.9} /> : <Copy className="h-3.5 w-3.5" strokeWidth={1.7} />}
          </button>
          <button
            type="button"
            onClick={onSpeak}
            className={cn('icon-btn-sm', speaking && 'text-primary')}
            title={speaking ? 'Stop reading' : 'Read this aloud'}
            aria-label={speaking ? 'Stop reading' : 'Read this aloud'}
          >
            {speaking ? <VolumeX className="h-3.5 w-3.5" strokeWidth={1.7} /> : <Volume2 className="h-3.5 w-3.5" strokeWidth={1.7} />}
          </button>
          {onRegenerate && (
            <button type="button" onClick={onRegenerate} className="icon-btn-sm" title="Answer again" aria-label="Answer again">
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.7} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function EmptyState({
  hasDocument,
  docTitle,
  onPick,
}: {
  hasDocument: boolean
  docTitle?: string
  onPick: (text: string) => void
}) {
  return (
    <div className="animate-fade-up pb-4 pt-6 text-center md:pt-12">
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" aria-hidden>
          <path d="M12 2.6c-2.6 2.9-4.1 5.4-4.1 7.7a4.1 4.1 0 0 0 8.2 0c0-2.3-1.5-4.8-4.1-7.7Z" fill="currentColor" />
          <path d="M4.6 15.4c1.3 2.9 4.1 4.6 7.4 4.6s6.1-1.7 7.4-4.6c-2 .9-4.6 1.4-7.4 1.4s-5.4-.5-7.4-1.4Z" fill="currentColor" opacity=".8" />
        </svg>
      </div>
      <h2 className="font-display text-[1.6rem] font-semibold tracking-[-0.02em] text-foreground">
        Namaste, I am <span className="font-deva">बोध</span>
      </h2>
      <p className="mx-auto mt-2.5 max-w-[46ch] font-serif text-reading text-muted-foreground text-pretty">
        {hasDocument && docTitle
          ? `I have “${docTitle}” open. Ask me about any part of it, or we can start somewhere new.`
          : 'Your patient tutor for anything you are studying. Ask a question, upload a book, or turn on Live Mode and simply talk.'}
      </p>

      <div className="mx-auto mt-7 grid max-w-[560px] gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map(({ icon: Icon, text }) => (
          <button
            key={text}
            type="button"
            onClick={() => onPick(text)}
            className="group flex items-start gap-2.5 rounded-2xl border border-border/70 bg-surface px-3.5 py-3 text-left transition-colors hover:border-primary/40 hover:bg-surface"
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary/80" strokeWidth={1.7} />
            <span className="font-serif text-reading-sm text-foreground/80 group-hover:text-foreground">{text}</span>
          </button>
        ))}
      </div>

      <p className="mt-6 flex items-center justify-center gap-1.5 text-ui-sm text-muted-foreground/70">
        <SquarePen className="h-3.5 w-3.5" strokeWidth={1.7} />
        Everything is saved to your account — across devices.
      </p>
    </div>
  )
}
