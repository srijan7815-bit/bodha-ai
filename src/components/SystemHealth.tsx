'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Activity, Loader2, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { authFetch } from '@/lib/firebase/client-token'
import type { SystemState } from '@/lib/types'

const TONE = {
  ok: { dot: 'bg-emerald-500', label: 'All systems normal' },
  fixed: { dot: 'bg-amber-500', label: 'Fixed automatically' },
  degraded: { dot: 'bg-red-500', label: 'Needs attention' },
} as const

function short(model: string) {
  return model.split('/').pop() ?? model
}

function ago(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  return `${Math.round(s / 3600)} h ago`
}

/**
 * The watchdog's report card: what it tested, what it fixed on its own, and a
 * button to test everything again right now (the deep check also asks the
 * voice to speak).
 */
export default function SystemHealth() {
  const [state, setState] = useState<SystemState | null>(null)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    void authFetch('/api/watchdog', { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then(data => alive && setState(data?.state ?? null))
      .catch(() => {})
      .finally(() => alive && setLoaded(true))
    return () => {
      alive = false
    }
  }, [])

  const run = useCallback(async () => {
    setBusy(true)
    try {
      const res = await authFetch('/api/watchdog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true, deep: true }),
      })
      if (res.ok) setState((await res.json()).state ?? null)
    } catch {}
    setBusy(false)
  }, [])

  const tone = state ? TONE[state.overall] : null

  return (
    <section className="mt-7 rounded-2xl border border-border/70 bg-surface p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <Activity className="mt-0.5 h-[18px] w-[18px] shrink-0 text-primary" strokeWidth={1.7} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-medium text-foreground">System health</h2>
          <p className="mt-0.5 text-ui-sm text-muted-foreground">
            {state ? (
              <span className="inline-flex items-center gap-1.5">
                <span className={cn('h-2 w-2 rounded-full', tone?.dot)} />
                {tone?.label} · checked {ago(state.checkedAt)}
              </span>
            ) : loaded ? (
              'No check has run yet.'
            ) : (
              'Loading…'
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border/80 bg-background px-3 text-ui-sm text-foreground hover:border-primary/40 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />}
          {busy ? 'Checking…' : 'Check now'}
        </button>
      </div>

      {state && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="mt-4">
          <p className="font-serif text-reading-sm text-foreground/85">{state.summary}</p>

          <ul className="mt-3 space-y-1.5 text-ui-sm">
            {state.models.map(m => {
              const off = state.disabledModels.includes(m.model)
              return (
                <li key={m.model} className="flex items-center gap-2">
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', m.ok ? 'bg-emerald-500' : 'bg-red-500')} />
                  <span className="min-w-0 flex-1 truncate text-foreground/85">
                    {short(m.model)}
                    {state.promoted === m.model && <span className="ml-1.5 text-primary">· promoted</span>}
                    {off && <span className="ml-1.5 text-muted-foreground">· paused</span>}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{m.ok ? `${(m.ms / 1000).toFixed(1)}s${m.busy ? ' · busy' : ''}` : (m.error ?? 'failed')}</span>
                </li>
              )
            })}
            {(
              [
                ['Dictation', state.services.stt],
                ['Voice', state.services.tts],
                ['Storage', state.services.storage],
              ] as const
            ).map(([label, svc]) => (
              <li key={label} className="flex items-center gap-2">
                <span className={cn('h-2 w-2 shrink-0 rounded-full', svc.ok ? 'bg-emerald-500' : 'bg-amber-500')} />
                <span className="w-20 shrink-0 text-foreground/85">{label}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{svc.detail}</span>
              </li>
            ))}
          </ul>

          {state.actions.length > 0 && (
            <div className="mt-4 border-t border-border/60 pt-3">
              <p className="text-ui-xs uppercase text-muted-foreground">Recent repairs</p>
              <ul className="mt-1.5 space-y-1.5 text-ui-sm text-foreground/80">
                {state.actions.slice(0, 4).map(a => (
                  <li key={a.at + a.target}>
                    <span className="text-muted-foreground">{ago(a.at)} · {a.by === 'ai' ? 'watchdog AI' : 'rule'} · </span>
                    {a.action.replace('_', ' ')} {short(a.target)} — {a.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </motion.div>
      )}
    </section>
  )
}
