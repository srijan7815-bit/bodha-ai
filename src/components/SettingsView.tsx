'use client'

import { useEffect, useState } from 'react'
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
  Plug,
  Sun,
  Trash2,
  Volume2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/components/AuthProvider'
import { useSettings } from '@/lib/settings-client'

/**
 * Settings — one page, three quiet sections.
 *
 * The headline feature is the student's own model endpoint: any service that
 * speaks the OpenAI chat API can answer their questions instead of BODHA's
 * models. The key is written to our server, checked with a live request before
 * anything is saved, and never sent back to the browser.
 */

const VOICES = [
  { id: 'Aria', label: 'Aria — warm, female' },
  { id: 'Sofia', label: 'Sofia — young, female' },
  { id: 'Mia', label: 'Mia — light, female' },
  { id: 'Ray', label: 'Ray — narration, male' },
  { id: 'Jason', label: 'Jason — confident, male' },
  { id: 'Leo', label: 'Leo — clear, male' },
]

export default function SettingsView() {
  const { user } = useAuth()
  const { settings, connected, savePreferences, connectEndpoint, disconnectEndpoint } = useSettings()

  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [label, setLabel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [dark, setDark] = useState(false)

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'))
  }, [])

  // A connected endpoint fills the form so it can be edited; the key stays
  // blank on purpose — the browser has never seen it and cannot show it.
  useEffect(() => {
    if (!settings.custom) return
    setBaseUrl(settings.custom.baseUrl)
    setModel(settings.custom.model)
    setLabel(settings.custom.label)
  }, [settings.custom])

  async function saveEndpoint(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setResult(null)
    const res = await connectEndpoint({ baseUrl, model, label, apiKey })
    setBusy(false)
    if (res.ok) {
      setApiKey('')
      setResult({
        kind: 'ok',
        text: res.sample
          ? `Connected. Your model answered: “${res.sample}”`
          : 'Connected. Your model answered.',
      })
    } else {
      setResult({ kind: 'error', text: res.error })
    }
  }

  async function removeEndpoint() {
    setBusy(true)
    const res = await disconnectEndpoint()
    setBusy(false)
    if (res.ok) {
      setApiKey('')
      setBaseUrl('')
      setModel('')
      setLabel('')
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
      <div className="mx-auto w-full max-w-read px-4 pb-24 pt-6 md:px-6 md:pt-10">
        <h1 className="font-serif text-[26px] leading-tight tracking-tight text-foreground">Settings</h1>
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
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-primary/25 bg-primary/[0.06] px-3 py-2.5">
              <Check className="h-4 w-4 shrink-0 text-primary" strokeWidth={2} />
              <span className="min-w-0 flex-1 text-ui text-foreground/90">
                <span className="font-medium">{settings.custom.label}</span>
                <span className="text-muted-foreground"> · {settings.custom.model}</span>
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
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field
                label="Model name"
                hint="Exactly as the provider spells it."
                value={model}
                onChange={setModel}
                placeholder="gpt-4o-mini"
              />
              <Field
                label="Name on the switch"
                hint="Optional."
                value={label}
                onChange={setLabel}
                placeholder="My model"
              />
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
            <p
              role="status"
              className={cn(
                'mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-ui-sm',
                result.kind === 'ok'
                  ? 'border-primary/25 bg-primary/[0.06] text-foreground/90'
                  : 'border-destructive/30 bg-destructive/[0.06] text-destructive',
              )}
            >
              {result.kind === 'ok' ? (
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              ) : (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              )}
              {result.text}
            </p>
          )}
        </Section>

        {/* ── Voice ──────────────────────────────────────────────────────── */}
        <Section
          icon={Volume2}
          title="Voice"
          hint="Used by read-aloud and by Live Mode. Read-aloud always asks Fish Audio first; Live Mode uses NVIDIA's faster voice and falls back to Fish."
        >
          <label className="flex items-center justify-between gap-4">
            <span className="text-ui font-medium text-foreground">Speaking voice</span>
            <select
              value={settings.voice ?? 'Aria'}
              onChange={event => void savePreferences({ voice: event.target.value })}
              className="h-9 min-w-0 flex-1 max-w-[260px] rounded-lg border border-border/80 bg-surface px-3 text-ui text-foreground outline-none transition-colors focus-visible:border-primary/50"
            >
              {VOICES.map(voice => (
                <option key={voice.id} value={voice.id}>
                  {voice.label}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-2 flex items-start gap-2 text-ui-sm text-muted-foreground">
            <Mic className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
            Dictation is separate and has no setting: speak into the chat composer and your words are
            typed for you.
          </p>
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
