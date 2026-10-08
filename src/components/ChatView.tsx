'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowDown, BookOpen, Check, Copy, FileText, GraduationCap, Lightbulb, Menu, Moon, RefreshCw, Sigma, Sun, SquarePen, Volume2, VolumeX, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { authFetch } from '@/lib/firebase/client-token'
import { useSpeaker, useDictation } from '@/lib/voice'
import Markdown, { type RunnableLang } from '@/components/Markdown'
import Composer from '@/components/Composer'
import LiveMode from '@/components/LiveMode'
import SandboxDrawer from '@/components/SandboxDrawer'
import { BodhaMark } from '@/components/Brand'
import { useAuth } from '@/components/AuthProvider'
import { activeModel, toggleOptions, useSettings } from '@/lib/settings-client'
import { resumeOrbAudio } from '@/lib/orbAudio'
import DocPicker from '@/components/DocPicker'
import { announceChatsChanged, useShell } from '@/components/AppShell'
import { Sources } from '@/components/Sources'
import type { Chat, DocumentMeta, Message, MessageSource } from '@/lib/types'

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
  { icon: Lightbulb, text: 'What did Aryabhata really discover?' },
  { icon: GraduationCap, text: 'भगवद्गीता का कर्मयोग सरल भाषा में समझाइए' },
  { icon: Sigma, text: 'Explain the Kerala school’s infinite series' },
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
  /** Citations for the answer currently streaming in. */
  const [liveSources, setLiveSources] = useState<MessageSource[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [doc, setDoc] = useState<DocumentMeta | null>(documentMeta)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [liveOpen, setLiveOpen] = useState(false)
  const [readingId, setReadingId] = useState<string | null>(null)
  const [atBottom, setAtBottom] = useState(true)

  const [runCode, setRunCode] = useState<{ lang: RunnableLang; code: string } | null>(null)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const router = useRouter()
  const shell = useShell()
  const { user } = useAuth()
  const { settings, connected, savePreferences } = useSettings()

  // Which brain answers: 'bodha', or the id of one of the student's own models.
  // Resolved against what actually exists, so a renamed or deleted model falls
  // back to BODHA instead of pointing the toggle at nothing.
  const model = activeModel(settings)
  const modelOptions = toggleOptions(settings)

  // The chosen voice is read through a ref inside callbacks so switching it in
  // Settings does not rebuild the streaming loop.
  const voiceRef = useRef<string | undefined>(undefined)
  voiceRef.current = settings.voice ?? undefined

  const speaker = useSpeaker()

  // Dictation is typing by voice, into the draft. It is deliberately separate
  // from Live Mode, which owns its own microphone, its own turn-taking and its
  // own voice pipeline and never touches what you have typed.
  const dictation = useDictation(text => {
    setDraft(prev => (prev ? `${prev} ${text}` : text))
  })

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
    if (atBottom) scrollToBottom(streaming || messages.length <= 2 ? 'auto' : 'smooth')
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

  // ─── Streaming ────────────────────────────────────────────────────────────
  const runStream = useCallback(
    async (targetChatId: string, body: { content?: string; regenerate?: boolean; model?: string }, optimistic?: Message) => {
      setBusy(true)
      setError(null)
      setNotice(null)
      setStreaming('')

      const controller = new AbortController()
      abortRef.current = controller
      let streamed = ''

      // Re-parsing Markdown + KaTeX + syntax highlighting for every token is
      // what made long answers stutter. Render at most ~14 times a second;
      // the text itself is never held back, only how often it is painted.
      let lastPaint = 0
      let paintTimer: ReturnType<typeof setTimeout> | null = null
      const paint = () => {
        paintTimer = null
        lastPaint = performance.now()
        setStreaming(streamed)
      }
      const scheduleStream = () => {
        if (paintTimer) return
        const wait = Math.max(0, 70 - (performance.now() - lastPaint))
        paintTimer = setTimeout(paint, wait)
      }
      const cancelStream = () => {
        if (paintTimer) clearTimeout(paintTimer)
        paintTimer = null
      }


      try {
        const res = await authFetch(`/api/chats/${targetChatId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, model }),
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
            let frame: {
              t: string
              v?: string
              message?: Message | null
              errorMessage?: string
              items?: MessageSource[]
            }
            try {
              frame = JSON.parse(line)
            } catch {
              continue
            }

            if (frame.t === 'sources') {
            setLiveSources(frame.items ?? [])
          } else if (frame.t === 'user' && frame.message) {
              const persisted = frame.message
              setMessages(prev => {
                const idx = optimistic ? prev.findIndex(m => m.id === optimistic.id) : -1
                if (idx === -1) return [...prev, persisted]
                const next = [...prev]
                next[idx] = persisted
                return next
              })
            } else if (frame.t === 'sources' && frame.items) {
              setLiveSources(frame.items)
            } else if (frame.t === 'delta' && frame.v) {
              streamed += frame.v
              scheduleStream()
            } else if (frame.t === 'notice' && frame.v) {
              setNotice(frame.v)
            } else if (frame.t === 'done') {
              cancelStream()
              if (frame.message) {
                const finished = frame.message as Message
                setMessages(prev => [...prev, finished])
              }
              setStreaming('')
              setLiveSources([])
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
        cancelStream()
        if (streamed.trim()) setStreaming('')
        setBusy(false)
        abortRef.current = null
        announceChatsChanged()
      }
    },
    [model],
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

  /**
   * Live Mode's question path.
   *
   * A spoken turn goes through exactly the same endpoint as a typed one, so a
   * voice conversation lands in the same chat history and is waiting on any
   * other device. It resolves with the full answer while streaming partial text
   * through `onDelta` — which is what lets the room start speaking after the
   * first sentence instead of after the last one.
   */
  const askLive = useCallback(
    async (text: string, onDelta: (chunk: string) => void, signal: AbortSignal): Promise<string> => {
      const clean = text.trim()
      if (!clean) return ''

      let targetId = chatId
      if (!targetId) {
        const res = await authFetch('/api/chats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: deriveTitle(clean), documentId: doc?.id ?? null }),
        })
        if (!res.ok) throw new Error('Could not start a new conversation.')
        const data = await res.json()
        targetId = data.chat.id as string
        setChatId(targetId)
        setTitle(data.chat.title as string)
        window.history.replaceState(null, '', `/chat/${targetId}`)
        announceChatsChanged()
      }

      const optimistic: Message = {
        id: `live-${Date.now()}`,
        chatId: targetId,
        role: 'user',
        content: clean,
        createdAt: new Date().toISOString(),
      }
      setMessages(prev => [...prev, optimistic])
      setAtBottom(true)

      const res = await authFetch(`/api/chats/${targetId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: clean, model, live: true }),
        signal,
      })
      if (!res.ok || !res.body) throw new Error('The connection dropped mid-answer.')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let streamed = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          let frame: {
            t: string
            v?: string
            message?: Message | null
            errorMessage?: string
            items?: MessageSource[]
          }
          try {
            frame = JSON.parse(line)
          } catch {
            continue
          }

          if (frame.t === 'sources') {
            setLiveSources(frame.items ?? [])
          } else if (frame.t === 'user' && frame.message) {
            const persisted = frame.message
            setMessages(prev => {
              const index = prev.findIndex(m => m.id === optimistic.id)
              if (index === -1) return [...prev, persisted]
              const next = [...prev]
              next[index] = persisted
              return next
            })
          } else if (frame.t === 'delta' && frame.v) {
            streamed += frame.v
            onDelta(frame.v)
          } else if (frame.t === 'notice' && frame.v) {
            setNotice(frame.v)
          } else if (frame.t === 'done' && frame.message) {
            setMessages(prev => [...prev, frame.message as Message])
          } else if (frame.t === 'error' && frame.errorMessage) {
            setError(frame.errorMessage)
          }
        }
      }

      announceChatsChanged()
      return streamed
    },
    [chatId, doc],
  )


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

  /**
   * Read this message aloud — the button under a finished answer.
   *
   * Fish Audio is asked for by name here; if it is unavailable the browser's
   * own voice reads instead. This is a
   * self-contained feature: it shares no state with Live Mode, and Live Mode's
   * own speech never goes through here.
   */
  const speak = useCallback(
    (message: Message) => {
      if (readingId === message.id && speaker.speaking) {
        speaker.stop()
        setReadingId(null)
        return
      }
      setReadingId(message.id)
      void speaker
        .speak(message.content, { provider: 'fish', voice: voiceRef.current })
        .finally(() => setReadingId(current => (current === message.id ? null : current)))
    },
    [readingId, speaker],
  )

  const lastAssistantId = [...messages].reverse().find(m => m.role === 'assistant')?.id

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="z-20 flex h-14 shrink-0 items-center gap-1 px-2 md:border-b md:border-border/60 md:bg-background/85 md:px-6 md:backdrop-blur">
          <button type="button" onClick={shell.openDrawer} className="icon-btn h-11 w-11 md:hidden" aria-label="Open menu">
            <Menu className="h-[22px] w-[22px]" strokeWidth={1.6} />
          </button>

          <h1 className="min-w-0 flex-1 truncate px-1 text-center text-ui font-medium text-foreground/90 md:text-left">
            {messages.length > 0 || streaming ? title : ''}
          </h1>

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

          {messages.length > 0 && (
            <button type="button" onClick={shell.newChat} className="icon-btn h-11 w-11" aria-label="New chat" title="New chat">
              <SquarePen className="h-5 w-5" strokeWidth={1.6} />
            </button>
          )}
          <button
            type="button"
            onClick={shell.toggleTheme}
            className="icon-btn h-11 w-11"
            aria-label={shell.dark ? 'Switch to paper mode' : 'Switch to night mode'}
            title={shell.dark ? 'Paper mode' : 'Night mode'}
          >
            <motion.span key={shell.dark ? 'sun' : 'moon'} initial={{ rotate: -40, opacity: 0, scale: 0.7 }} animate={{ rotate: 0, opacity: 1, scale: 1 }} transition={{ duration: 0.25 }} className="flex">
              {shell.dark ? <Sun className="h-5 w-5" strokeWidth={1.6} /> : <Moon className="h-5 w-5" strokeWidth={1.6} />}
            </motion.span>
          </button>
        </header>

        {/* ── Messages ───────────────────────────────────────────────────── */}
        <div ref={scrollRef} className="scrollbar-quiet min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-read px-4 pb-8 pt-6 md:px-6">
            {messages.length === 0 && !streaming && (
              <EmptyState name={user?.name?.trim().split(/\s+/)[0]} hasDocument={!!doc} docTitle={doc?.title} onPick={text => setDraft(text)} />
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
                        sources={message.sources}
                        onRun={(lang, code) => setRunCode({ lang, code })}
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
                  <Markdown content={streaming} onRun={(lang, code) => setRunCode({ lang, code })} />
                  <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-[2px] animate-blink-caret rounded-sm bg-primary align-middle" />
                  {liveSources.length > 0 && <Sources sources={liveSources} />}
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
              className="absolute bottom-40 left-1/2 z-20 -translate-x-1/2 rounded-full border border-border/80 bg-surface/95 p-2 shadow-card backdrop-blur"
              aria-label="Jump to the latest message"
            >
              <ArrowDown className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
            </motion.button>
          )}
        </AnimatePresence>

        {/* ── Composer ───────────────────────────────────────────────────── */}
        <div className="relative z-10 shrink-0 bg-gradient-to-t from-background from-70% to-transparent pb-safe">
          <div className="mx-auto w-full max-w-read px-3 pb-3 pt-2 md:px-6">
            <Composer
              value={draft}
              onChange={setDraft}
              onSend={() => void send()}
              onStop={stop}
              busy={busy}
              dictation={dictation}
              onAttach={() => setPickerOpen(true)}
              attachLabel={doc ? `Linked: ${doc.title}` : 'Link a document'}
              linkedDoc={doc}
              onClearDoc={() => setDoc(null)}
              onLive={() => {
                setLiveOpen(true)
                void resumeOrbAudio()
              }}
              liveActive={liveOpen}
              modelOptions={connected && settings.custom ? modelOptions : [{ id: 'bodha', label: 'BODHA' }]}
              modelValue={model}
              onModelChange={choice => void savePreferences({ preferredModel: choice })}
            />
          </div>
        </div>
      </div>

      {/* ── Code from an answer, runnable without leaving the chat ──────── */}
      <SandboxDrawer
        code={runCode}
        onClose={() => setRunCode(null)}
        onFull={() => {
          setRunCode(null)
          router.push('/sandbox')
        }}
      />

      {/* ── Live Mode — a voice room of its own, not read-aloud ─────────── */}
      <LiveMode
        open={liveOpen}
        onClose={() => setLiveOpen(false)}
        ask={askLive}
        provider="magpie"
        voice={settings.voice ?? undefined}
        language="en-US"
      />

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
  sources,
  speaking,
  onSpeak,
  onRegenerate,
  showActions,
  onRun,
}: {
  content: string
  sources?: MessageSource[]
  speaking: boolean
  onSpeak: () => void
  onRegenerate?: () => void
  showActions?: boolean
  onRun?: (lang: RunnableLang, code: string) => void
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
      <Markdown content={content} onRun={onRun} />
      {showActions !== false && (
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
      {sources && sources.length > 0 && <Sources sources={sources} />}
    </div>
  )
}

function EmptyState({
  name,
  hasDocument,
  docTitle,
  onPick,
}: {
  name?: string
  hasDocument: boolean
  docTitle?: string
  onPick: (text: string) => void
}) {
  return (
    <div className="flex min-h-[56dvh] flex-col items-center justify-center pb-4 text-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.8, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="animate-flame mb-6"
      >
        <BodhaMark size={64} />
      </motion.div>

      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
        className="font-deva text-[18px] text-primary"
      >
        नमस्ते{name ? `, ${name}` : ''}
      </motion.p>
      <motion.h2
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="mt-1.5 max-w-[16ch] font-display text-[2.1rem] font-normal leading-[1.15] tracking-[-0.02em] text-foreground sm:max-w-none sm:text-[2.4rem]"
      >
        What shall we learn today?
      </motion.h2>

      {hasDocument && docTitle && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35 }}
          className="mt-3 max-w-[40ch] font-serif text-reading-sm text-muted-foreground"
        >
          “{docTitle}” is open — ask about any part of it.
        </motion.p>
      )}

      <div className="mt-8 flex max-w-[640px] flex-wrap justify-center gap-2">
        {SUGGESTIONS.map(({ icon: Icon, text }, i) => (
          <motion.button
            key={text}
            type="button"
            onClick={() => onPick(text)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.38 + i * 0.07, ease: [0.22, 1, 0.36, 1] }}
            className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-surface px-3.5 py-2 text-left text-ui text-foreground/80 hover:border-primary/40 hover:text-foreground"
          >
            <Icon className="h-4 w-4 shrink-0 text-primary/80" strokeWidth={1.7} />
            <span className="text-pretty">{text}</span>
          </motion.button>
        ))}
      </div>
    </div>
  )
}
