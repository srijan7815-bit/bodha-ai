'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Cpu,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Mic,
  Moon,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Square,
  Sun,
  Trash2,
  Volume2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/components/AuthProvider'
import { useSettings } from '@/lib/settings-client'
import type { CustomModel } from '@/lib/types'

/**
 * Settings — one page, three quiet sections.
 *
 * The headline feature is the student's own model endpoint: any service that
 * speaks the OpenAI chat API can answer their questions instead of BODHA's
 * models. The key is written to our server, checked with a live request before
 * anything is saved, and never sent back to the browser.
 */

/**
 * The voices BODHA can read in. These are Fish Audio reference voices, so the
 * name the student picks here is the exact voice they will hear — and the same
 * one behind Live Mode when Fish answers there too.
 */
const VOICES = [
  { id: 'Aria', name: 'Aria', trait: 'warm, female' },
  { id: 'Sofia', name: 'Sofia', trait: 'young, female' },
  { id: 'Mia', name: 'Mia', trait: 'light, female' },
  { id: 'Ray', name: 'Ray', trait: 'narration, male' },
  { id: 'Jason', name: 'Jason', trait: 'confident, male' },
  { id: 'Leo', name: 'Leo', trait: 'clear, male' },
]
const DEFAULT_VOICE = 'Aria'
/** One line, long enough to judge a voice and short enough to feel instant. */
const PREVIEW_LINE = 'Bodha means awakening — the moment understanding clicks.'

export default function SettingsView() {
  const { user } = useAuth()
  const { settings, connected, savePreferences, connectEndpoint, disconnectEndpoint, fetchModels } = useSettings()

  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<CustomModel[]>([{ id: '', label: '' }])
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [listing, setListing] = useState(false)
  const [canSaveAnyway, setCanSaveAnyway] = useState(false)
  const [result, setResult] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null)
  /** Per-model outcome of the last test, keyed by model id. */
  const [marks, setMarks] = useState<Record<string, { ok: boolean; note: string }>>({})
  const [dark, setDark] = useState(false)
  /** Voice previews — one clip at a time, from the same route read-aloud uses. */
  const [preview, setPreview] = useState<{
    loading: string | null
    playing: string | null
    note: { kind: 'ok' | 'error'; text: string } | null
  }>({ loading: null, playing: null, note: null })
  const previewAudio = useRef<HTMLAudioElement | null>(null)
  const previewAbort = useRef<AbortController | null>(null)
  const playingRef = useRef<string | null>(null)
  /** What the server says about dictation right now, so this page never lies. */
  const [stt, setStt] = useState<{ trying: boolean; lastError: string | null } | null>(null)

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'))
  }, [])

  useEffect(() => {
    let alive = true
    void fetch('/api/health')
      .then(res => res.json())
      .then((data: { speech?: { stt?: { primaryTrying?: boolean; lastError?: string | null } } }) => {
        const state = data.speech?.stt
        if (alive && state) setStt({ trying: state.primaryTrying !== false, lastError: state.lastError ?? null })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const stopPreview = useCallback(() => {
    previewAbort.current?.abort()
    previewAbort.current = null
    const audio = previewAudio.current
    previewAudio.current = null
    playingRef.current = null
    if (audio) {
      audio.onended = null
      audio.onerror = null
      audio.pause()
      URL.revokeObjectURL(audio.src)
    }
    setPreview(state => ({ ...state, loading: null, playing: null }))
  }, [])

  useEffect(() => stopPreview, [stopPreview])

  /**
   * Plays one line in a voice, through /api/tts with Fish Audio asked for
   * explicitly — the same call the read-aloud button makes, so what is heard
   * here is what will be heard there.
   */
  const previewVoice = useCallback(
    async (voiceId: string) => {
      if (playingRef.current === voiceId) {
        stopPreview()
        return
      }
      stopPreview()
      setPreview({ loading: voiceId, playing: null, note: null })
      const controller = new AbortController()
      previewAbort.current = controller
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: PREVIEW_LINE, voice: voiceId, provider: 'fish', language: 'en-US' }),
          signal: controller.signal,
        })
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string }
          setPreview({
            loading: null,
            playing: null,
            note: { kind: 'error', text: data.error || 'The voice service did not answer. Try again in a moment.' },
          })
          return
        }
        const provider = res.headers.get('X-TTS-Provider')
        const bytes = await res.arrayBuffer()
        const url = URL.createObjectURL(
          new Blob([bytes], { type: res.headers.get('Content-Type') || 'audio/mpeg' }),
        )
        const audio = new Audio(url)
        audio.preload = 'auto'
        previewAudio.current = audio
        audio.onended = () => stopPreview()
        audio.onerror = () =>
          setPreview(state => ({
            ...state,
            loading: null,
            playing: null,
            note: { kind: 'error', text: 'This browser could not play that clip.' },
          }))
        await audio.play()
        playingRef.current = voiceId
        setPreview({
          loading: null,
          playing: voiceId,
          note: {
            kind: 'ok',
            text:
              provider === 'magpie'
                ? 'Fish Audio did not answer, so NVIDIA’s voice read this preview.'
                : 'Read by Fish Audio — the voice your read-aloud button will use.',
          },
        })
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setPreview(state => ({
            ...state,
            loading: null,
            playing: null,
            note: { kind: 'error', text: 'Could not reach the voice service.' },
          }))
        }
      }
    },
    [stopPreview],
  )

  // A connected endpoint fills the form so it can be edited; the key stays
  // blank on purpose — the browser has never seen it and cannot show it.
  useEffect(() => {
    if (!settings.custom) return
    setBaseUrl(settings.custom.baseUrl)
    setModels(settings.custom.models.length ? settings.custom.models : [{ id: '', label: '' }])
  }, [settings.custom])

  /** Rows are edited as plain strings until saved; blanks are dropped on the way. */
  function updateModel(index: number, patch: Partial<CustomModel>) {
    setModels(prev => prev.map((model, i) => (i === index ? { ...model, ...patch } : model)))
  }

  function addModelRow() {
    setModels(prev => [...prev, { id: '', label: '' }])
  }

  function removeModelRow(index: number) {
    setModels(prev => (prev.length === 1 ? [{ id: '', label: '' }] : prev.filter((_, i) => i !== index)))
  }

  /** Pull the provider's own list, when it publishes one. */
  async function loadModelList() {
    setListing(true)
    setResult(null)
    const res = await fetchModels({ baseUrl, apiKey })
    setListing(false)
    if (!res.ok) {
      setResult({ kind: 'error', text: res.error })
      return
    }
    setModels(res.models)
    setResult({ kind: 'ok', text: `Found ${res.models.length} models on this endpoint — remove any you do not want.` })
  }

  async function submitEndpoint(skipTest: boolean) {
    setBusy(true)
    setResult(null)
    const cleaned = models
      .map(model => ({ id: model.id.trim(), label: model.label.trim() }))
      .filter(model => model.id)
    const res = await connectEndpoint({ baseUrl, apiKey, models: cleaned, skipTest })
    setBusy(false)

    if (res.ok) {
      setApiKey('')
      const marks: Record<string, { ok: boolean; note: string }> = {}
      for (const r of res.results ?? []) {
        marks[r.id] = { ok: r.ok, note: r.ok ? `answered: “${r.sample}”` : (r.error ?? 'did not answer') }
      }
      setMarks(marks)
      if (res.status === 'untested') {
        setResult({ kind: 'warn', text: res.warning ?? 'Saved without a successful test.' })
      } else {
        setResult({
          kind: 'ok',
          text: res.sample ? `Connected. Your model answered: “${res.sample}”` : 'Connected and tested.',
        })
      }
      return
    }

    const marks: Record<string, { ok: boolean; note: string }> = {}
    for (const r of res.results ?? []) {
      marks[r.id] = { ok: r.ok, note: r.ok ? `answered: “${r.sample}”` : (r.error ?? 'did not answer') }
    }
    setMarks(marks)
    setResult({
      kind: 'error',
      text: res.error ?? 'That endpoint could not be saved.',
    })
    setCanSaveAnyway(Boolean(res.canSaveAnyway))
  }

  async function saveEndpoint(event: React.FormEvent) {
    event.preventDefault()
    setCanSaveAnyway(false)
    await submitEndpoint(false)
  }

  async function saveAnyway() {
    setCanSaveAnyway(false)
    await submitEndpoint(true)
  }

  async function removeEndpoint() {
    setBusy(true)
    const res = await disconnectEndpoint()
    setBusy(false)
    if (res.ok) {
      setApiKey('')
      setBaseUrl('')
      setModels([{ id: '', label: '' }])
      setMarks({})
      setResult({ kind: 'ok', text: 'Endpoint removed. BODHA will answer with its own models.' })
    } else {
      setResult({ kind: 'error', text: res.error ?? 'Could not remove that.' })
    }
  }

  function toggleTheme() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('bodha:theme', next ? 'dark' : 'light')
    } catch {}
  }

  return (
    <div className="scrollbar-quiet h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-read px-4 pb-24 pt-6 sm:px-6 sm:pt-8 md:px-8">
        <h1 className="font-display text-[1.65rem] font-semibold leading-tight tracking-[-0.02em] text-foreground sm:text-[1.8rem]">Settings</h1>
        <p className="mt-1.5 text-ui text-muted-foreground">
          Your account, your voice, and your own model.
        </p>

        {/* ── Your own model ─────────────────────────────────────────────── */}
        <Section
          icon={Plug}
          title="Your own model"
          hint="Connect any OpenAI-compatible endpoint — OpenAI, OpenRouter, Together, Groq, or a model running on your own machine. It then appears as a switch in the chat."
        >
          {connected && settings.custom && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-primary/25 bg-primary/[0.06] px-3 py-2.5">
              {settings.custom.verified ? (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={2} />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" strokeWidth={2} />
              )}
              <span className="min-w-0 flex-1 text-ui text-foreground/90">
                <span className="font-medium">
                  {settings.custom.models.length} model{settings.custom.models.length === 1 ? '' : 's'} on{' '}
                  {settings.custom.baseUrl.replace(/^https?:\/\//, '')}
                </span>
                {!settings.custom.verified && (
                  <span className="block text-ui-sm text-amber-700 dark:text-amber-400">
                    Not verified — BODHA could not reach this endpoint when it was saved. It is still tried on
                    every question, and falls back to BODHA’s models if it stays silent.
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => void removeEndpoint()}
                disabled={busy}
                className="icon-btn-sm text-muted-foreground hover:text-destructive"
                title="Remove this endpoint"
                aria-label="Remove this endpoint"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
              </button>
            </div>
          )}

          <form onSubmit={saveEndpoint} className="space-y-3.5">
            <Field
              label="Endpoint URL"
              hint="Everything before /chat/completions."
              value={baseUrl}
              onChange={setBaseUrl}
              placeholder="https://api.openai.com/v1"
              type="url"
              inputMode="url"
              autoComplete="off"
            />
            <Field
              label="API key"
              hint={
                connected
                  ? 'Leave blank to keep the key already stored.'
                  : 'Stored on the server and never sent back to your browser.'
              }
              value={apiKey}
              onChange={setApiKey}
              placeholder={connected ? '••••••••••••••• (saved)' : 'sk-…'}
              type={showKey ? 'text' : 'password'}
              trailing={
                <button
                  type="button"
                  onClick={() => setShowKey(v => !v)}
                  className="icon-btn-sm"
                  aria-label={showKey ? 'Hide key' : 'Show key'}
                  title={showKey ? 'Hide' : 'Show'}
                >
                  {showKey ? <EyeOff className="h-3.5 w-3.5" strokeWidth={1.7} /> : <Eye className="h-3.5 w-3.5" strokeWidth={1.7} />}
                </button>
              }
            />
            {/* ── The models on this endpoint ── */}
            <div className="rounded-xl border border-border/70 bg-background/60 p-3">
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <span className="text-ui-sm font-medium text-foreground/90">
                  Models on this endpoint
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    — the switch in the chat will offer all of them
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => void loadModelList()}
                  disabled={listing || !baseUrl.trim()}
                  className="chip disabled:opacity-50"
                  title="Ask the endpoint which models it serves"
                >
                  {listing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
                  )}
                  Fetch list
                </button>
              </div>

              <div className="space-y-2">
                {models.map((entry, index) => {
                  const mark = marks[entry.id.trim()]
                  return (
                    <div key={index} className="flex items-start gap-2">
                      <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1fr_1.2fr]">
                        <input
                          value={entry.label}
                          onChange={event => updateModel(index, { label: event.target.value })}
                          placeholder="Name — e.g. Fast, or Smart"
                          spellCheck={false}
                          className="h-9 w-full rounded-lg border border-border/80 bg-background px-2.5 text-ui text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:border-primary/50"
                        />
                        <input
                          value={entry.id}
                          onChange={event => updateModel(index, { id: event.target.value })}
                          placeholder="Model id — e.g. gpt-4o-mini"
                          spellCheck={false}
                          autoComplete="off"
                          className="h-9 w-full rounded-lg border border-border/80 bg-background px-2.5 font-mono text-[12.5px] text-foreground outline-none transition-colors placeholder:font-sans placeholder:text-muted-foreground/60 focus-visible:border-primary/50"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeModelRow(index)}
                        className="icon-btn-sm mt-1"
                        aria-label={`Remove model ${index + 1}`}
                        title="Remove"
                      >
                        <X className="h-3.5 w-3.5" strokeWidth={1.8} />
                      </button>
                      {mark && (
                        <span
                          className={cn(
                            'mt-2 shrink-0 text-ui-sm',
                            mark.ok ? 'text-primary' : 'text-amber-700 dark:text-amber-400',
                          )}
                          title={mark.note}
                        >
                          {mark.ok ? '✓' : '!'}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>

              <button type="button" onClick={addModelRow} className="chip mt-2.5">
                <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />
                Add another model
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={busy}
                className="inline-flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-ui font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : <KeyRound className="h-3.5 w-3.5" strokeWidth={1.9} />}
                {busy ? 'Testing…' : connected ? 'Test & update' : 'Test & connect'}
              </button>
              <p className="text-ui-sm text-muted-foreground">
                BODHA sends one small test message before saving anything.
              </p>
            </div>
          </form>

          {result && (
            <div
              role="status"
              className={cn(
                'mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-ui-sm',
                result.kind === 'ok'
                  ? 'border-primary/25 bg-primary/[0.06] text-foreground/90'
                  : result.kind === 'warn'
                    ? 'border-amber-500/30 bg-amber-500/[0.07] text-amber-800 dark:text-amber-300'
                    : 'border-destructive/30 bg-destructive/[0.06] text-destructive',
              )}
            >
              {result.kind === 'ok' ? (
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              ) : (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              )}
              <span className="min-w-0 flex-1">
                {result.text}
                {canSaveAnyway && (
                  <span className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void saveAnyway()}
                      disabled={busy}
                      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/80 bg-surface px-3 text-ui-sm font-medium text-foreground transition-colors hover:border-primary/40 disabled:opacity-60"
                    >
                      Save anyway
                    </button>
                    <span className="text-ui-sm text-muted-foreground">
                      The details are kept and tried on every question — useful when a provider is down, or
                      refuses requests from servers.
                    </span>
                  </span>
                )}
              </span>
            </div>
          )}
        </Section>

        {/* ── Voice ──────────────────────────────────────────────────────── */}
        <Section
          icon={Volume2}
          title="Voice"
          hint="Every voice here is Fish Audio. Tap one to use it for read-aloud and Live Mode, or press ▶ to hear it first — the preview is the same call the read-aloud button makes."
        >
          <ul className="space-y-1.5">
            {VOICES.map(voice => {
              const active = (settings.voice ?? DEFAULT_VOICE) === voice.id
              const loading = preview.loading === voice.id
              const playing = preview.playing === voice.id
              return (
                <li key={voice.id}>
                  <div
                    className={cn(
                      'flex items-center gap-3 rounded-xl border px-3 py-2 transition-colors',
                      active
                        ? 'border-primary/40 bg-primary/[0.06]'
                        : 'border-border/70 bg-background/40 hover:border-primary/25',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => void savePreferences({ voice: voice.id })}
                      aria-pressed={active}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    >
                      <span
                        className={cn(
                          'grid h-4 w-4 shrink-0 place-items-center rounded-full border transition-colors',
                          active ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                        )}
                      >
                        {active && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-ui font-medium text-foreground">
                          {voice.name}
                          {active && !settings.voice && (
                            <span className="ml-2 text-ui-sm font-normal text-muted-foreground">default</span>
                          )}
                        </span>
                        <span className="block truncate text-ui-sm text-muted-foreground">{voice.trait}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void previewVoice(voice.id)}
                      title={playing ? 'Stop the preview' : `Hear ${voice.name}`}
                      aria-label={playing ? 'Stop the preview' : `Hear ${voice.name}`}
                      className="icon-btn-sm shrink-0"
                    >
                      {loading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
                      ) : playing ? (
                        <Square className="h-3 w-3" strokeWidth={2} />
                      ) : (
                        <Play className="h-3.5 w-3.5" strokeWidth={1.9} />
                      )}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>

          <p
            className={cn(
              'mt-3 text-ui-sm',
              preview.note?.kind === 'error' ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {preview.note ? preview.note.text : `Previews read: “${PREVIEW_LINE}”`}
          </p>

          <div className="mt-4 flex items-start gap-2.5 border-t border-border/60 pt-4">
            <Mic className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={1.8} />
            <div className="min-w-0 text-ui-sm">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium text-foreground/90">Dictation — Whisper large v3</span>
                {stt && (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                      stt.trying
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                        : 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
                    )}
                  >
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        stt.trying ? 'bg-emerald-500' : 'bg-amber-500',
                      )}
                    />
                    {stt.trying ? 'answering' : 'upstream outage'}
                  </span>
                )}
              </p>
              <p className="mt-1 text-muted-foreground">
                {!stt || stt.trying
                  ? 'NVIDIA’s Whisper large v3 transcribes whatever you say into the composer.'
                  : `NVIDIA’s Whisper function is refusing requests at their end (${stt.lastError ?? 'HTTP 500'}). BODHA keeps asking it first — until NVIDIA restores it, Parakeet types your words so dictation never goes quiet. Nothing to change; it switches back by itself.`}
              </p>
            </div>
          </div>
        </Section>

        {/* ── Appearance + account ───────────────────────────────────────── */}
        <Section icon={Cpu} title="Appearance and account">
          <div className="flex items-center justify-between gap-4">
            <span className="text-ui font-medium text-foreground">Theme</span>
            <button
              type="button"
              onClick={toggleTheme}
              className="chip"
              aria-pressed={dark}
            >
              {dark ? <Sun className="h-3.5 w-3.5" strokeWidth={1.8} /> : <Moon className="h-3.5 w-3.5" strokeWidth={1.8} />}
              {dark ? 'Night' : 'Paper'}
            </button>
          </div>
          <dl className="mt-4 space-y-1.5 border-t border-border/60 pt-4 text-ui">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Signed in as</dt>
              <dd className="truncate font-medium text-foreground">{user?.name}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Email</dt>
              <dd className="truncate text-foreground/90">{user?.email}</dd>
            </div>
          </dl>
        </Section>

        <p className="mt-8 text-center font-serif text-reading-sm italic text-muted-foreground/80">
          बोध — created by Srijan Singh and Parv Mishra.
        </p>
      </div>
    </div>
  )
}

function Section({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: typeof Cpu
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-7 rounded-2xl border border-border/70 bg-surface/70 p-4 shadow-soft sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" strokeWidth={1.9} />
        <h2 className="text-ui font-semibold tracking-tight text-foreground">{title}</h2>
      </div>
      {hint && <p className="mb-4 text-ui-sm leading-relaxed text-muted-foreground">{hint}</p>}
      {children}
    </section>
  )
}

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  type = 'text',
  inputMode,
  autoComplete,
  trailing,
}: {
  label: string
  hint?: string
  value: string
  onChange: (next: string) => void
  placeholder?: string
  type?: string
  inputMode?: 'url' | 'text'
  autoComplete?: string
  trailing?: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-ui-sm font-medium text-foreground/90">{label}</span>
      <span className="relative block">
        <input
          type={type}
          value={value}
          onChange={event => onChange(event.target.value)}
          placeholder={placeholder}
          inputMode={inputMode}
          autoComplete={autoComplete}
          spellCheck={false}
          className={cn(
            'h-10 w-full rounded-lg border border-border/80 bg-background px-3 text-ui text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:border-primary/50',
            trailing && 'pr-11',
          )}
        />
        {trailing && <span className="absolute right-1 top-1/2 -translate-y-1/2">{trailing}</span>}
      </span>
      {hint && <span className="mt-1 block text-ui-sm text-muted-foreground">{hint}</span>}
    </label>
  )
}
