'use client'

/**
 * Searching the shelf by hand.
 *
 * The same retrieval BODHA uses before answering a question, so a student can
 * see what the tutor would have read — and read further themselves.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, Loader2, Search, X } from 'lucide-react'
import { authFetch } from '@/lib/firebase/client-token'
import { cn } from '@/lib/utils'

interface Result {
  id: string
  workId: string
  title: string
  sanskrit: string | null
  ref: string
  translator: string
  year: number
  domain: string
  sourceUrl: string
  excerpt: string
}

const EXAMPLES = ['what is dharma', 'the nature of the self', 'how should a king rule', 'why do we suffer', 'the rules of zero', 'duty and action']

export function IksSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Result[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef(0)

  const run = useCallback(async (text: string) => {
    const clean = text.trim()
    if (clean.length < 3) {
      setResults(null)
      setBusy(false)
      return
    }
    const token = ++latest.current
    setBusy(true)
    setError(null)
    try {
      const res = await authFetch(`/api/iks/search?q=${encodeURIComponent(clean)}`)
      const data = (await res.json()) as { results?: Result[]; error?: string }
      if (token !== latest.current) return
      if (!res.ok) {
        setError(data.error ?? 'The shelf could not be read just now.')
        setResults([])
        return
      }
      setResults(data.results ?? [])
    } catch {
      if (token === latest.current) {
        setError('Could not reach the shelf.')
        setResults([])
      }
    } finally {
      if (token === latest.current) setBusy(false)
    }
  }, [])

  // Debounced, so typing feels like filtering rather than searching.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void run(query), 320)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [query, run])

  return (
    <div>
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.8} />
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search the shelf — a word, a question, a verse"
          className="h-12 w-full rounded-xl border border-border/80 bg-surface pl-10 pr-10 text-[15px] text-foreground shadow-soft outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:border-primary/50"
          spellCheck={false}
          aria-label="Search the Indian Knowledge Systems shelf"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="icon-btn-sm absolute right-1.5 top-1/2 -translate-y-1/2"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.9} />
          </button>
        )}
      </label>

      {!query.trim() && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {EXAMPLES.map(example => (
            <button
              key={example}
              type="button"
              onClick={() => setQuery(example)}
              className="chip"
            >
              {example}
            </button>
          ))}
        </div>
      )}

      {busy && (
        <p className="mt-4 flex items-center gap-2 text-ui-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
          Reading the shelf…
        </p>
      )}

      {error && <p className="mt-4 text-ui-sm text-destructive">{error}</p>}

      {results && !busy && !error && (
        <div className="mt-4">
          <p className="text-ui-sm text-muted-foreground">
            {results.length
              ? `${results.length} passage${results.length === 1 ? '' : 's'} found`
              : 'Nothing on the shelf matches that. Try a plainer word, or ask BODHA directly.'}
          </p>
          <ul className="mt-3 space-y-3">
            {results.map(result => (
              <li key={result.id} className="rounded-xl border border-border/70 bg-surface/60 p-4">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-ui font-medium text-foreground">{result.title}</span>
                  {result.sanskrit && <span className="font-serif text-ui text-muted-foreground">{result.sanskrit}</span>}
                  {result.ref && result.ref !== 'Opening' && (
                    <span className={cn('text-ui-sm text-primary/90')}>{result.ref}</span>
                  )}
                </div>
                <p className="mt-0.5 text-ui-sm text-muted-foreground">
                  {result.translator} · {result.year} · {result.domain}
                </p>
                <blockquote className="mt-2.5 border-l-2 border-primary/25 pl-3 font-serif text-reading-sm leading-relaxed text-foreground/90">
                  {result.excerpt}
                </blockquote>
                <a
                  href={result.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-2.5 inline-flex items-center gap-1.5 text-ui-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  Read the full text
                  <ExternalLink className="h-3 w-3" strokeWidth={1.9} />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
