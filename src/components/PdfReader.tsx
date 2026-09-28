'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import type { DocumentMeta } from '@/lib/types'
import { authFetch } from '@/lib/firebase/server-auth'
import { announceChatsChanged } from '@/components/AppShell'

/**
 * The warm, book-style reader.
 *  - pdf.js for PDFs (paged, spread view on wide screens, selectable text)
 *  - serif reading column for txt/md documents
 *  - sepia / paper / night reading themes, progress memory, keyboard navigation
 */

type PdfJs = typeof import('pdfjs-dist')

type ReaderTheme = 'sepia' | 'paper' | 'night'

const THEME_PAGE: Record<ReaderTheme, string> = {
  sepia: '#f6ecdc',
  paper: '#ffffff',
  night: '#241f19',
}
const THEME_AROUND: Record<ReaderTheme, string> = {
  sepia: '#e8dbc5',
  paper: '#efe9dd',
  night: '#141110',
}

interface Props {
  userId: string
  document: DocumentMeta
}

export default function PdfReader({ userId, document: doc }: Props) {
  const router = useRouter()
  const isPdf = doc.kind === 'pdf'

  return (
    <div className="reader-root flex h-dvh flex-col" style={{ background: THEME_AROUND[isPdf ? 'sepia' : 'paper'] }}>
      {isPdf ? <PdfBody userId={userId} doc={doc} /> : <TextBody doc={doc} />}

      {/* shared chrome */}
      <ReaderTopBar doc={doc} onAsk={async () => {
        const res = await authFetch('/api/chats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentId: doc.id }),
        })
        if (res.ok) {
          const { chat } = await res.json()
          announceChatsChanged()
          router.push(`/chat/${chat.id}`)
        }
      }} />
    </div>
  )
}

// ─── top bar ─────────────────────────────────────────────────────────────────

function ReaderTopBar({ doc, onAsk }: { doc: DocumentMeta; onAsk: () => void }) {
  return (
    <header className="flex items-center gap-3 border-b border-black/10 px-4 py-2.5 backdrop-blur-md md:px-6"
      style={{ background: 'rgba(246, 236, 220, 0.7)' }}>
      <Link href="/library" className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-[#6b5b40] transition-colors hover:bg-black/5">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Library
      </Link>
      <h1 className="min-w-0 flex-1 truncate text-center font-serif text-base font-semibold text-[#3e3426]">
        {doc.title}
      </h1>
      <button onClick={onAsk} className="btn-primary px-3.5 py-1.5 text-xs">
        🪔 Ask BODHA
      </button>
    </header>
  )
}

// ─── text documents ─────────────────────────────────────────────────────────

function TextBody({ doc }: { doc: DocumentMeta }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    authFetch(`/api/documents/${doc.id}`)
      .then(async r => (r.ok ? await r.text() : Promise.reject(new Error('Could not open the document.'))))
      .then(setText)
      .catch(e => setError(e instanceof Error ? e.message : 'Could not open the document.'))
  }, [doc.id])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-10" style={{ background: THEME_AROUND.paper }}>
      <article className="mx-auto max-w-[46rem] rounded-lg bg-[#fffdf8] px-6 py-10 shadow-[0_2px_30px_rgba(90,70,40,.15)] md:px-14 md:py-14">
        {error && <p className="text-sm text-red-700">{error}</p>}
        {text === null && !error && <p className="animate-pulse-soft text-sm text-[#8f8068]">Opening the page…</p>}
        {text !== null && (
          <div className="whitespace-pre-wrap font-serif text-[1.06rem] leading-[1.85] text-[#3e3426]">
            {text}
          </div>
        )}
      </article>
    </div>
  )
}

// ─── pdf body ────────────────────────────────────────────────────────────────

function PdfBody({ userId, doc }: { userId: string; doc: DocumentMeta }) {
  const [pdfjs, setPdfjs] = useState<PdfJs | null>(null)
  const [pdf, setPdf] = useState<Awaited<ReturnType<PdfJs['getDocument']>['promise']> | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [page, setPage] = useState(1)
  const [theme, setTheme] = useState<ReaderTheme>('sepia')
  const [spread, setSpread] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const viewportRef = useRef<HTMLDivElement>(null)
  const renderHostRef = useRef<HTMLDivElement>(null)
  const progressKey = `bodha:progress:${userId}:${doc.id}`

  // load pdf.js and the document
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const lib = await import('pdfjs-dist')
        lib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
        if (cancelled) return
        setPdfjs(lib)

        const res = await authFetch(`/api/documents/${doc.id}`)
        if (!res.ok) throw new Error('Could not fetch the file.')
        const data = new Uint8Array(await res.arrayBuffer())
        const task = lib.getDocument({ data })
        const document_ = await task.promise
        if (cancelled) return
        setPdf(document_)
        setNumPages(document_.numPages)

        // resume saved position
        try {
          const saved = Number(localStorage.getItem(progressKey) ?? '1')
          if (Number.isFinite(saved) && saved >= 1 && saved <= document_.numPages) setPage(saved)
        } catch {}
        setReady(true)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'The PDF could not be opened.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doc.id, progressKey])

  // remember position + theme
  useEffect(() => {
    if (!ready) return
    try {
      localStorage.setItem(progressKey, String(page))
    } catch {}
  }, [page, ready, progressKey])

  useEffect(() => {
    try {
      const t = localStorage.getItem('bodha:reader-theme') as ReaderTheme | null
      if (t === 'sepia' || t === 'paper' || t === 'night') setTheme(t)
    } catch {}
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('bodha:reader-theme', theme)
    } catch {}
    const meta = document.querySelector('meta[name="theme-color"]')
    meta?.setAttribute('content', THEME_AROUND[theme])
  }, [theme])

  // auto spread on wide screens
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const observer = new ResizeObserver(entries => {
      setSpread(entries[0].contentRect.width > 1024 && window.innerWidth > 1024)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') setPage(p => clamp(p + (spread ? 2 : 1), 1, numPages))
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setPage(p => clamp(p - (spread ? 2 : 1), 1, numPages))
      if (e.key === 'Home') setPage(1)
      if (e.key === 'End') setPage(numPages)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [numPages, spread])

  const setThemePage = (t: ReaderTheme) => {
    setTheme(t)
  }

  return (
    <>
      <div
        ref={viewportRef}
        className="reader-scroll relative min-h-0 flex-1 overflow-auto"
        style={{ background: THEME_AROUND[theme] }}
        onClick={e => {
          // click left/right thirds to turn pages
          if (!(e.target instanceof HTMLElement) || e.target.closest('button, input, a')) return
          const rect = e.currentTarget.getBoundingClientRect()
          const x = e.clientX - rect.left
          if (x < rect.width * 0.3) setPage(p => clamp(p - (spread ? 2 : 1), 1, numPages))
          else if (x > rect.width * 0.7) setPage(p => clamp(p + (spread ? 2 : 1), 1, numPages))
        }}
      >
        {error && (
          <div className="mx-auto mt-20 max-w-md rounded-xl bg-red-500/10 p-6 text-center text-sm text-red-700">{error}</div>
        )}
        {!ready && !error && <ReaderSkeleton />}
        {ready && pdf && pdfjs && (
          <div className="flex min-h-full items-center justify-center px-2 py-6 md:px-8 md:py-10">
            <div className="relative flex items-stretch gap-0 rounded-md shadow-[0_10px_60px_rgba(60,40,10,.35)]" style={{ background: THEME_PAGE[theme] }}>
              <PagePane
                pdf={pdf}
                pdfjs={pdfjs}
                pageNumber={page}
                theme={theme}
                hostRef={renderHostRef}
                side="left"
                spread={spread}
                numPages={numPages}
              />
              {spread && (
                <>
                  <div
                    aria-hidden
                    className="relative z-10 w-[1px] shrink-0"
                    style={{ background: 'linear-gradient(to bottom, transparent, rgba(60,40,10,.35) 12%, rgba(60,40,10,.45) 50%, rgba(60,40,10,.35) 88%, transparent)' }}
                  />
                  <PagePane
                    pdf={pdf}
                    pdfjs={pdfjs}
                    pageNumber={page + 1}
                    theme={theme}
                    hostRef={renderHostRef}
                    side="right"
                    spread={spread}
                    numPages={numPages}
                  />
                </>
              )}
            </div>
          </div>
        )}

        {/* bottom bar */}
        {ready && (
          <div className="sticky bottom-4 mx-auto mt-4 flex w-fit items-center gap-3 rounded-full border border-black/10 bg-[rgba(246,236,220,.92)] px-4 py-2 shadow-warmlg backdrop-blur">
            <NavBtn dir="prev" onClick={() => setPage(p => clamp(p - (spread ? 2 : 1), 1, numPages))} disabled={page <= 1} />
            <input
              type="range"
              min={1}
              max={numPages}
              value={page}
              onChange={e => setPage(Number(e.target.value))}
              className="w-36 accent-[#bd5221] md:w-56"
              aria-label="Page position"
            />
            <NavBtn dir="next" onClick={() => setPage(p => clamp(p + (spread ? 2 : 1), 1, numPages))} disabled={page >= numPages} />
            <span className="w-20 text-center font-mono text-xs text-[#6b5b40]">
              {page}
              {spread && page + 1 <= numPages ? `–${page + 1}` : ''} / {numPages}
            </span>
            <div className="ml-1 flex items-center gap-1 border-l border-black/10 pl-2">
              {(['sepia', 'paper', 'night'] as ReaderTheme[]).map(t => (
                <button
                  key={t}
                  onClick={() => setThemePage(t)}
                  className={clsx(
                    'rounded-full px-2.5 py-1 text-xs transition-colors',
                    theme === t ? 'bg-[#bd5221] text-white' : 'text-[#6b5b40] hover:bg-black/10',
                  )}
                  title={`${t} theme`}
                >
                  {t === 'sepia' ? ' parchment' : t === 'paper' ? ' paper' : ' night'}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}

function NavBtn({ dir, onClick, disabled }: { dir: 'prev' | 'next'; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-full p-1.5 text-[#6b5b40] transition-colors hover:bg-black/10 disabled:opacity-30"
      aria-label={dir === 'prev' ? 'Previous page' : 'Next page'}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: dir === 'prev' ? 'rotate(180deg)' : undefined }} aria-hidden>
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  )
}

function ReaderSkeleton() {
  return (
    <div className="mx-auto mt-10 w-fit">
      <div className="h-[560px] w-[380px] animate-pulse-soft rounded-md bg-black/10 md:w-[420px]" />
      <div className="mx-auto mt-6 w-fit rounded-full bg-black/10 px-4 py-2 font-serif text-sm italic text-[#6b5b40]/70">
        Opening your book…
      </div>
    </div>
  )
}

// ─── one rendered page ───────────────────────────────────────────────────────

interface PagePaneProps {
  pdf: Awaited<ReturnType<PdfJs['getDocument']>['promise']>
  pdfjs: PdfJs
  pageNumber: number
  theme: ReaderTheme
  hostRef: React.RefObject<HTMLDivElement>
  side: 'left' | 'right'
  spread: boolean
  numPages: number
}

function PagePane({ pdf, pdfjs, pageNumber, theme, hostRef, side, spread, numPages }: PagePaneProps) {
  const canvasWrapRef = useRef<HTMLDivElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)

  const invalid = pageNumber > numPages

  useEffect(() => {
    if (invalid) return
    let cancelled = false
    let renderTask: { cancel(): void; promise: Promise<void> } | null = null

    ;(async () => {
      const wrap = canvasWrapRef.current
      const host = hostRef.current
      if (!wrap || !host) return

      const availableWidth = spread
        ? Math.max(320, (host.clientWidth - 24) / 2 - 8)
        : Math.min(900, host.clientWidth - 32)
      const maxPagePx = 720
      const targetWidth = Math.min(availableWidth, maxPagePx)

      try {
        const pageObj = await pdf.getPage(pageNumber)
        if (cancelled) return
        const base = pageObj.getViewport({ scale: 1 })
        const scale = targetWidth / base.width
        const viewport = pageObj.getViewport({ scale })
        const dpr = Math.min(2, window.devicePixelRatio || 1)

        // canvas
        let canvas = wrap.querySelector('canvas')
        if (!canvas) {
          canvas = document.createElement('canvas')
          wrap.appendChild(canvas)
        }
        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        // fill page background (sepia/dark PDFs remain readable)
        ctx.save()
        ctx.fillStyle = theme === 'night' ? '#241f19' : '#fffdf8'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.restore()

        renderTask = pageObj.render({
          canvasContext: ctx,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        } as Parameters<typeof pageObj.render>[0])
        await renderTask.promise
        if (cancelled) return

        // selectable text layer (best-effort; degrades silently if unavailable)
        const textDiv = textLayerRef.current
        if (textDiv) {
          textDiv.innerHTML = ''
          textDiv.style.width = `${Math.floor(viewport.width)}px`
          textDiv.style.height = `${Math.floor(viewport.height)}px`
          try {
            const AnyPdfjs = pdfjs as unknown as {
              TextLayer?: new (opts: {
                textContentSource: unknown
                container: HTMLElement
                viewport: unknown
              }) => { render(): Promise<void> }
            }
            if (AnyPdfjs.TextLayer) {
              const textContent = await pageObj.getTextContent()
              const textLayer = new AnyPdfjs.TextLayer({ textContentSource: textContent, container: textDiv, viewport })
              await textLayer.render()
            }
          } catch {
            /* selection is a bonus, not a requirement */
          }
        }
      } catch (err) {
        if (!cancelled && !(err instanceof Error && /cancel/i.test(err.message))) {
          // leave canvas as-is on transient errors
        }
      }
    })()

    return () => {
      cancelled = true
      try {
        renderTask?.cancel()
      } catch {}
    }
  }, [pdf, pdfjs, pageNumber, theme, spread, invalid, hostRef, side, numPages])

  if (invalid) {
    return (
      <div
        className="flex w-8 items-center justify-center rounded-md text-[10px] font-semibold uppercase tracking-widest text-[#b5a784]"
        style={{ background: THEME_PAGE[theme], minWidth: 0 }}
      >
        end
      </div>
    )
  }

  return (
    <div
      ref={canvasWrapRef}
      className={clsx('relative', side === 'right' && 'rounded-r-md', side === 'left' && 'rounded-l-md')}
      style={{ background: THEME_PAGE[theme] }}
    >
      <div ref={textLayerRef} className="textLayer" />
    </div>
  )
}
