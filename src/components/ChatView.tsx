'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { Chat, DocumentMeta, Message, User } from '@/lib/types'
import { authFetch } from '@/lib/firebase/server-auth'
import { useDictation, useSpeaker, speechSupported } from '@/lib/voice'
import Markdown, { type RunnableLang } from '@/components/Markdown'
import SandboxDrawer from '@/components/SandboxDrawer'
import DocPicker from '@/components/DocPicker'
import { announceChatsChanged } from '@/components/AppShell'
const PENDING_KEY = 'bodha:pending-message'
const AUTOSPEAK_KEY = 'bodha:auto-speak'
const SUGGESTIONS = [
  { icon: '🌱', text: 'Explain photosynthesis with an everyday analogy' },
  { icon: '∑', text: 'Help me understand quadratic equations step by step' },
  { icon: '🇪🇸', text: 'Teach me ten Spanish words for food, with a mini quiz' },
  { icon: '⌨️', text: 'Show me a bouncing ball animation in HTML and explain the code' },
  { icon: '🧪', text: 'Why does ice float on water? Walk me through the physics' },
  { icon: '📜', text: 'Summarize the causes of World War I like a story' },
]
interface Props {
  user: User
  chat: Chat | null
  initialMessages: Message[]
  documentMeta: DocumentMeta | null
}
export default function ChatView({ user, chat, initialMessages, documentMeta }: Props) {
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [docChip, setDocChip] = useState<DocumentMeta | null>(documentMeta)
  const [docPickerOpen, setDocPickerOpen] = useState(false)
  const [autoSpeak, setAutoSpeak] = useState(false)
  const [sandboxCode, setSandboxCode] = useState<{ lang: RunnableLang; code: string } | null>(null)
  const [thinkingPhase, setThinkingPhase] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const pinnedToBottomRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)
  const speaker = useSpeaker()
  useEffect(() => {
    try {
      setAutoSpeak(localStorage.getItem(AUTOSPEAK_KEY) === '1')
    } catch {}
  }, [])
  const toggleAutoSpeak = () => {
    setAutoSpeak(v => {
      const next = !v
      try {
        localStorage.setItem(AUTOSPEAK_KEY, next ? '1' : '0')
      } catch {}
      return next
    })
  }
  // ─── Scrolling ────────────────────────────────────────────────────────────
  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    pinnedToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }
  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' })
  }, [])
  useEffect(() => {
    if (pinnedToBottomRef.current) scrollToBottom(false)
  }, [messages, streamText, scrollToBottom])
  // ─── Streaming ───────────────────────────────────────────────────────────
  const runStream = useCallback(
    async (payload: { content?: string; regenerate?: boolean }) => {
      if (!chat || streaming) return
      setStreaming(true)
      setError(null)
      setStreamText('')
      setThinkingPhase(true)
      if (!payload.regenerate && payload.content) {
        // optimistic user bubble
        setMessages(prev => [
          ...prev,
          {
            id: `optimistic-${Date.now()}`,
            chatId: chat.id,
            role: 'user',
            content: payload.content!,
            createdAt: new Date().toISOString(),
          },
        ])
      }
      if (payload.regenerate) {
        setMessages(prev => {
          const next = [...prev]
          while (next.length && next[next.length - 1].role === 'assistant') next.pop()
          return next
        })
      }
      pinnedToBottomRef.current = true
      const ctl = new AbortController()
      abortRef.current = ctl
      let full = ''
      try {
        const res = await authFetch(`/api/chats/${chat.id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: ctl.signal,
        })
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => null)
          throw new Error(data?.errorMessage ?? 'The tutor could not be reached. Please try again.')
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let nl: number
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl)
            buffer = buffer.slice(nl + 1)
            if (!line.trim()) continue
            let evt: { t: string; v?: string; message?: Message | null; errorMessage?: string }
            try {
              evt = JSON.parse(line)
            } catch {
              continue
            }
            if (evt.t === 'user' && evt.message) {
              // replace optimistic bubble with the saved one
              setMessages(prev => prev.map(m => (m.id.startsWith('optimistic-') ? evt.message! : m)))
            } else if (evt.t === 'delta' && evt.v) {
              setThinkingPhase(false)
              full += evt.v
              setStreamText(full)
            } else if (evt.t === 'error' && evt.errorMessage) {
              setError(evt.errorMessage)
            } else if (evt.t === 'done') {
              setStreamText('')
              if (evt.message) setMessages(prev => [...prev, evt.message!])
              if (evt.message && autoSpeak) speaker.speak(evt.message.content)
              announceChatsChanged()
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
        }
        if (full.trim()) {
          setStreamText('')
          setMessages(prev => [
            ...prev,
            {
              id: `partial-${Date.now()}`,
              chatId: chat.id,
              role: 'assistant',
              content: full,
              createdAt: new Date().toISOString(),
            },
          ])
        }
      } finally {
        setStreaming(false)
        setThinkingPhase(false)
        setStreamText('')
        abortRef.current = null
      }
    },
    [chat, streaming, autoSpeak, speaker],
  )
  // ─── Sending ────────────────────────────────────────────────────────────
  const send = useCallback(
    async (raw: string) => {
      const content = raw.trim()
      if (!content || streaming) return
      setInput('')
      // clear autosaved draft on send
      try {
        sessionStorage.removeItem(PENDING_KEY)
      } catch {}
      if (chat) {
        await runStream({ content })
      } else {
        // first message from the fresh-chat page → create the chat, then
        // hand the text to the new page so it streams there
        try {
          const res = await authFetch('/api/chats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: content.slice(0, 52) }),
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data?.error ?? 'Could not start the conversation.')
          try {
            sessionStorage.setItem(PENDING_KEY, content)
          } catch {}
          announceChatsChanged()
          router.replace(`/chat/${data.chat.id}`)
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not start the conversation.')
        }
      }
    },
    [chat, streaming, router, runStream],
  )
  // auto-send a pending first message once the chat page mounts
  const pendingConsumed = useRef(false)
  useEffect(() => {
    if (!chat || pendingConsumed.current) return
    let pending: string | null = null
    try {
      pending = sessionStorage.getItem(PENDING_KEY)
      sessionStorage.removeItem(PENDING_KEY)
    } catch {}
    if (pending && messages.length === 0) {
      pendingConsumed.current = true
      runStream({ content: pending })
    }
  }, [chat, messages.length, runStream])
  // ─── Dictation ──────────────────────────────────────────────────────────
  const dictation = useDictation(finalText => {
    setInput(prev => (prev ? `${prev} ${finalText}` : finalText))
  })
  // ─── Sandbox bridge ────────────────────────────────────────────────────
  const openSandbox = useCallback((lang: RunnableLang, code: string) => {
    setSandboxCode({ lang, code })
  }, [])
  const firstName = user.name.split(' ')[0]
  const greeting = useMemo(() => {
    const h = new Date().getHours()
    if (h < 5) return 'Studying late'
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  }, [])
  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i].id
    }
    return null
  }, [messages])
  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      {/* header */}
      <div className="relative z-10 flex items-center gap-3 border-b border-border/60 bg-background/85 px-4 py-3 backdrop-blur md:px-8">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[15px] font-semibold text-foreground">
            {chat?.title ?? 'New chat'}
          </h1>
          {docChip && (
            <button
              onClick={async () => {
                if (!chat) return
                await authFetch(`/api/chats/${chat.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ documentId: null }),
                })
                setDocChip(null)
              }}
              className="group mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"
              title="Unlink document"
            >
              <span>📖</span>
              <span className="max-w-[240px] truncate group-hover:line-through">{docChip.title}</span>
              <span className="opacity-0 group-hover:opacity-100">×</span>
            </button>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={toggleAutoSpeak}
          className={cn(
            autoSpeak ? 'border-primary/40 bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
          title={speaker.supported ? 'Read new answers aloud automatically' : 'Speech is not supported in this browser'}
        >
          <span aria-hidden>{speaker.speaking ? '🔊' : autoSpeak ? '🗣️' : '🔇'}</span>
          {speaker.speaking ? 'Speaking…' : autoSpeak ? 'Auto-read on' : 'Auto-read off'}
        </Button>
        {speaker.speaking && (
          <Button variant="outline" size="sm" onClick={speaker.stop} className="text-muted-foreground hover:text-primary">
            Stop
          </Button>
        )}
      </div>
      {/* scroll area */}
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 pb-6 pt-8 md:px-6">
          {/* empty state */}
          {messages.length === 0 && !streaming && (
            <div className="animate-fade-up select-none pt-10 md:pt-20">
              <p className="font-serif text-lg italic text-muted-foreground">{greeting},</p>
              <h2 className="mt-1 font-display text-4xl font-semibold tracking-tight text-foreground md:text-5xl">
                {firstName} <span className="text-primary">🪔</span>
              </h2>
              <p className="mt-4 max-w-md font-serif text-lg italic leading-relaxed text-muted-foreground">
                What shall we learn today? Ask me anything — or speak it aloud.
              </p>
              <div className="mt-8 grid gap-2.5 sm:grid-cols-2">
                {SUGGESTIONS.map(s => (
                  <button
                    key={s.text}
                    onClick={() => send(s.text)}
                    className="card-warm flex items-start gap-3 p-4 text-left text-sm text-foreground/85 transition-all hover:-translate-y-0.5 hover:border-primary/40"
                  >
                    <span className="text-lg leading-none">{s.icon}</span>
                    {s.text}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* messages */}
          {messages.length > 0 && (
            <div className="space-y-7">
              {messages.map(m =>
                m.role === 'user' ? (
                  <UserBubble key={m.id} message={m} />
                ) : (
                  <AssistantMessage
                    key={m.id}
                    message={m}
                    speaker={speaker}
                    onRun={openSandbox}
                    onRegenerate={
                      !streaming && m.id === lastAssistantId
                        ? () => runStream({ regenerate: true })
                        : undefined
                    }
                  />
                ),
              )}
            </div>
          )}
          {/* streaming bubble */}
          {streaming && (
            <div className="mt-7 animate-fade-up">
              {thinkingPhase && (
                <div className="flex items-center gap-1.5 text-muted-foreground" aria-live="polite">
                  <Dot delay="0ms" />
                  <Dot delay="180ms" />
                  <Dot delay="360ms" />
                  <span className="ml-2 font-serif italic">BODHA is thinking…</span>
                </div>
              )}
              {streamText && (
                <div className="prose-bodha writing-caret">
                  <Markdown content={streamText} onRun={openSandbox} />
                </div>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="mt-6 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <div ref={bottomRef} className="h-px" />
        </div>
      </div>
      {/* composer */}
      <div className="border-t border-border/60 bg-background/90 px-4 pb-4 pt-3 backdrop-blur md:px-8">
        <div className="mx-auto w-full max-w-3xl">
          <Composer
            input={input}
            setInput={setInput}
            onSend={send}
            streaming={streaming}
            onStop={() => abortRef.current?.abort()}
            dictation={dictation}
            onAttach={() => setDocPickerOpen(true)}
            showAttach={!!chat}
          />
          <p className="mt-2 text-center text-[11px] text-muted-foreground/70">
            BODHA is strictly educational · created by <span className="font-medium">Srijan Singh and Parv Mishra</span> · Enter ↵ sends, Shift+Enter adds a line
          </p>
        </div>
      </div>
      {/* overlays */}
      {chat && (
        <DocPicker
          open={docPickerOpen}
          onClose={() => setDocPickerOpen(false)}
          onPick={async docId => {
            setDocPickerOpen(false)
            const res = await authFetch(`/api/chats/${chat.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ documentId: docId }),
            })
            if (res.ok) {
              const docRes = await authFetch('/api/documents', { cache: 'no-store' })
              const all = (await docRes.json()).documents as DocumentMeta[]
              setDocChip(all.find(d => d.id === docId) ?? null)
            }
          }}
        />
      )}
      <SandboxDrawer
        code={sandboxCode}
        onClose={() => setSandboxCode(null)}
        onFull={() => {
          setSandboxCode(null)
          router.push('/sandbox')
        }}
      />
    </div>
  )
}

// ─── Message pieces ──────────────────────────────────────────────────────────
function UserBubble({ message }: { message: Message }) {
  return (
    <div className="animate-fade-up flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary/15 px-4.5 py-2.5 text-[0.95rem] leading-relaxed text-foreground shadow-warm">
        <p className="whitespace-pre-wrap break-words px-1 py-0.5 font-sans">{message.content}</p>
      </div>
    </div>
  )
}

function AssistantMessage({
  message,
  speaker,
  onRun,
  onRegenerate,
}: {
  message: Message
  speaker: ReturnType<typeof useSpeaker>
  onRun: (lang: RunnableLang, code: string) => void
  onRegenerate?: () => void
}) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }
  return (
    <div className="animate-fade-up group/msg">
      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-primary text-[10px] text-primary-foreground">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 2c-3.5 3.6-5.5 7-5.5 10.2a5.5 5.5 0 0 0 11 0C17.5 9 15.5 5.6 12 2z" />
          </svg>
        </span>
        BODHA
      </div>
      <Markdown content={message.content} onRun={onRun} />
      <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity group-hover/msg:opacity-100">
        <ActionBtn onClick={copy} label={copied ? 'Copied ✓' : 'Copy'} />
        {speaker.supported && (
          <ActionBtn
            onClick={() => (speaker.speaking ? speaker.stop() : speaker.speak(message.content))}
            label={speaker.speaking ? 'Stop' : 'Listen'}
          />
        )}
        {onRegenerate && <ActionBtn onClick={onRegenerate} label="↻ Try again" />}
      </div>
    </div>
  )
}

function ActionBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
    >
      {label}
    </button>
  )
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="inline-block h-2 w-2 animate-pulse-soft rounded-full bg-primary"
      style={{ animationDelay: delay }}
    />
  )
}

// ─── Composer ────────────────────────────────────────────────────────────────
interface ComposerProps {
  input: string
  setInput: (v: string) => void
  onSend: (text: string) => void
  streaming: boolean
  onStop: () => void
  dictation: ReturnType<typeof useDictation>
  onAttach: () => void
  showAttach: boolean
}

function Composer({ input, setInput, onSend, streaming, onStop, dictation, onAttach, showAttach }: ComposerProps) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const canDictate = typeof window !== 'undefined' && speechSupported()
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = '0px'
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`
  }, [input])
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (input.trim() && !streaming) onSend(input)
    }
  }
  return (
    <div className="card-warm relative p-2.5 focus-within:border-primary/50">
      {/* live dictation state */}
      {dictation.listening && (
        <div className="mx-2 mt-1 mb-1 flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-1.5 text-xs text-primary">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
          </span>
          Listening…
          {dictation.interim && <span className="italic text-muted-foreground">“{dictation.interim}”</span>}
        </div>
      )}
      <textarea
        ref={taRef}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        rows={1}
        placeholder={dictation.listening ? 'Speak now — I am listening…' : 'Ask anything you are learning…'}
        className="w-full resize-none bg-transparent px-3 pb-1 pt-2 text-[0.95rem] text-foreground placeholder:text-muted-foreground/70"
        aria-label="Your message"
      />
      <div className="mt-1 flex items-center gap-1.5 px-1">
        {canDictate && (
          <Button
            variant="ghost"
            size="icon"
            onClick={dictation.toggle}
            className={cn(
              'h-9 w-9 rounded-full',
              dictation.listening ? 'bg-primary text-primary-foreground hover:bg-primary' : 'text-muted-foreground hover:text-primary',
            )}
            title={dictation.listening ? 'Stop listening' : 'Speak your question'}
            aria-label="Voice input"
          >
            <MicIcon />
          </Button>
        )}
        {showAttach && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onAttach}
            className="h-9 w-9 rounded-full text-muted-foreground hover:text-primary"
            title="Discuss one of your library documents"
            aria-label="Attach document"
          >
            <PaperclipIcon />
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {streaming ? (
            <Button variant="outline" size="sm" onClick={onStop} title="Stop generating">
              ■ Stop
            </Button>
          ) : (
            <Button
              onClick={() => input.trim() && onSend(input)}
              disabled={!input.trim()}
              size="icon"
              className="h-9 w-9"
              aria-label="Send message"
              title="Send (Enter)"
            >
              <ArrowUpIcon />
            </Button>
          )}
        </div>
      </div>
      {dictation.error && (
        <p className="absolute -top-9 left-2 rounded-lg bg-foreground px-3 py-1.5 text-xs text-background shadow-warm">
          {dictation.error === 'denied' && 'Microphone access was blocked — allow it in your browser settings.'}
          {dictation.error === 'unsupported' && 'Voice input is not supported in this browser — try Chrome or Edge.'}
          {dictation.error === 'network' && 'The speech service could not be reached.'}
          {dictation.error === 'no-speech' && 'I could not hear anything — try again a bit louder.'}
          {dictation.error === 'failed' && 'Voice input hit a snag — try again.'}
        </p>
      )}
    </div>
  )
}
// small inline icons
function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4" />
    </svg>
  )
}

function PaperclipIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  )
}

function ArrowUpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  )
}