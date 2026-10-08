'use client'

import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUp, Check, Download, FileText, Loader2, Monitor, Square, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { authFetch } from '@/lib/firebase/client-token'

interface Step {
  n: number
  tool: string
  summary: string
  thought?: string
  ok?: boolean
  output?: string
}
interface OutFile {
  name: string
  mime: string
  size: number
  base64: string
}

const IDEAS = [
  'Write a one-page Word handout on Aryabhata’s contributions with 5 key facts',
  'Make an Excel weekly study timetable for Class 11 PCM + CS, 2 hours a day',
  'Read github.com/octocat/Hello-World and write a short summary as a PDF',
  'आयुर्वेद के तीन दोषों पर एक छोटा Word नोट बनाइए',
]

const EASE = [0.22, 1, 0.36, 1] as const

function save(file: OutFile) {
  const fileName = file.name.split('/').pop() || 'file'
  // Inside the Android app, hand the finished file to the wrapper, which puts it
  // in the phone's Downloads folder. In a browser this is undefined and the
  // ordinary blob download below runs exactly as before.
  const native = (window as unknown as {
    BodhaNative?: { saveFile?: (name: string, mime: string, base64: string) => void }
  }).BodhaNative
  if (typeof native?.saveFile === 'function') {
    native.saveFile(fileName, file.mime, file.base64)
    return
  }
  const bytes = Uint8Array.from(atob(file.base64), c => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = file.name.split('/').pop() || 'file'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export default function ComputerPage() {
  const [task, setTask] = useState('')
  const [busy, setBusy] = useState(false)
  const [steps, setSteps] = useState<Step[]>([])
  const [message, setMessage] = useState('')
  const [files, setFiles] = useState<OutFile[]>([])
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)

  async function run(text = task) {
    const clean = text.trim()
    if (clean.length < 4 || busy) return
    setTask(clean)
    setBusy(true)
    setSteps([])
    setFiles([])
    setMessage('')
    setError('')
    const ctl = new AbortController()
    abortRef.current = ctl
    try {
      const res = await authFetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: clean }),
        signal: ctl.signal,
      })
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'The computer could not start.')
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
          const f = JSON.parse(line)
          if (f.t === 'step') setSteps(s => [...s, { n: f.n, tool: f.tool, summary: f.summary, thought: f.thought }])
          else if (f.t === 'result') setSteps(s => s.map(x => (x.n === f.n ? { ...x, ok: f.ok, output: f.output } : x)))
          else if (f.t === 'final') {
            setMessage(f.message)
            setFiles(f.files ?? [])
          } else if (f.t === 'error') setError(f.message)
          setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50)
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError((err as Error).message)
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  return (
    <div className="scrollbar-quiet h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-read px-4 pb-28 pt-4 sm:px-6 md:px-8 md:pt-8">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Monitor className="h-5 w-5" strokeWidth={1.6} />
          </span>
          <div>
            <h1 className="font-display text-[1.6rem] font-semibold leading-tight tracking-[-0.02em]">BODHA’s Computer</h1>
            <p className="text-ui text-muted-foreground">Give it a task. It works in its own private workspace and hands you the files.</p>
          </div>
        </div>

        <div className="mt-6 rounded-[24px] border border-border/80 bg-surface p-2 shadow-soft transition-shadow focus-within:border-primary/45 focus-within:shadow-[0_0_0_4px_rgb(var(--primary)/0.07)]">
          <textarea
            value={task}
            onChange={e => setTask(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void run()
              }
            }}
            rows={3}
            maxLength={1500}
            placeholder="e.g. Download the README of a GitHub repo and make a one-page PDF summary…"
            aria-label="Task for BODHA's computer"
            className="w-full resize-none bg-transparent px-3 pt-3 text-[16px] leading-relaxed outline-none placeholder:text-muted-foreground/70"
          />
          <div className="flex items-center justify-between px-1 pb-1">
            <span className="px-2 text-ui-sm text-muted-foreground/70">Can write, download, read the web &amp; GitHub, and make PDF / Word / Excel files</span>
            {busy ? (
              <button type="button" onClick={() => abortRef.current?.abort()} className="flex h-11 w-11 items-center justify-center rounded-full bg-foreground text-background" aria-label="Stop">
                <Square className="h-3.5 w-3.5" fill="currentColor" strokeWidth={0} />
              </button>
            ) : (
              <button type="button" onClick={() => void run()} disabled={task.trim().length < 4} className={cn('flex h-11 w-11 items-center justify-center rounded-full', task.trim().length >= 4 ? 'bg-primary text-primary-foreground' : 'bg-foreground/10 text-muted-foreground')} aria-label="Run task">
                <ArrowUp className="h-5 w-5" strokeWidth={2.2} />
              </button>
            )}
          </div>
        </div>

        {!busy && !steps.length && !message && !error && (
          <div className="mt-5 flex flex-wrap gap-2">
            {IDEAS.map((idea, i) => (
              <motion.button
                key={idea}
                type="button"
                onClick={() => void run(idea)}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 * i, duration: 0.35, ease: EASE }}
                className="rounded-full border border-border/70 bg-surface px-3.5 py-2 text-left text-ui text-foreground/80 hover:border-primary/40 hover:text-foreground"
              >
                {idea}
              </motion.button>
            ))}
          </div>
        )}

        {(steps.length > 0 || busy) && (
          <ol className="mt-6 space-y-2" aria-live="polite">
            <AnimatePresence initial={false}>
              {steps.map(s => (
                <motion.li key={s.n} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: EASE }} className="rounded-xl border border-border/70 bg-surface px-3.5 py-2.5">
                  <div className="flex items-center gap-2 text-ui">
                    {s.ok === undefined ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : s.ok ? <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2.4} /> : <X className="h-3.5 w-3.5 text-destructive" strokeWidth={2.4} />}
                    <code className="rounded bg-foreground/[0.06] px-1.5 py-0.5 text-ui-sm">{s.tool}</code>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.summary}</span>
                  </div>
                  {s.thought && <p className="mt-1 pl-5 font-serif text-reading-sm italic text-muted-foreground">{s.thought}</p>}
                  {s.output && <p className={cn('mt-1 whitespace-pre-wrap break-words pl-5 text-ui-sm', s.ok ? 'text-foreground/70' : 'text-destructive')}>{s.output.slice(0, 220)}</p>}
                </motion.li>
              ))}
            </AnimatePresence>
            {busy && <li className="flex items-center gap-2 px-1 text-ui-sm text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Working…</li>}
          </ol>
        )}

        {error && <p className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-3 text-ui text-destructive">{error}</p>}

        {message && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }} className="mt-6">
            <p className="whitespace-pre-wrap font-serif text-reading text-foreground">{message}</p>
            {files.length > 0 && (
              <ul className="mt-4 space-y-2">
                {files.map(f => (
                  <li key={f.name} className="flex items-center gap-3 rounded-xl border border-border/70 bg-surface px-3.5 py-3">
                    <FileText className="h-5 w-5 shrink-0 text-primary" strokeWidth={1.6} />
                    <span className="min-w-0 flex-1 truncate text-ui">{f.name}<span className="ml-2 text-ui-sm text-muted-foreground">{f.size < 1024 ? `${f.size} B` : `${Math.round(f.size / 1024)} KB`}</span></span>
                    <button type="button" onClick={() => save(f)} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-foreground px-4 text-ui text-background">
                      <Download className="h-4 w-4" strokeWidth={1.8} /> Download
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  )
}
