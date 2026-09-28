'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  BookOpen,
  Columns2,
  Loader2,
  MessageSquare,
  Minus,
  Plus,
  ScanText,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react'
import HTMLFlipBook from 'react-pageflip'
import { cn } from '@/lib/utils'
import { useSpeaker } from '@/lib/voice'
import { extractPageText, ocrPageImage, renderPageToDataUrl, useDocumentScan } from '@/lib/ocr-client'
import { authFetch } from '@/lib/firebase/client-token'
import Markdown from '@/components/Markdown'
import type { DocumentMeta } from '@/lib/types'

export interface ReaderDoc extends DocumentMeta {
  textContent?: string
}

interface DocumentReaderProps {
  doc: ReaderDoc
  onProgress?: (page: number) => void
}

interface FlipProps {
  width: number
  height: number
  size?: 'fixed' | 'stretch'
  minWidth?: number
  maxWidth?: number
  maxHeight?: number
  minHeight?: number
  showCover?: boolean
  mobileScrollSupport?: boolean
  usePortrait?: boolean
  drawShadow?: boolean
  flippingTime?: number
  maxShadowOpacity?: number
  className?: string
  startPage?: number
  onFlip?: (e: { data: number }) => void
  children: React.ReactNode
}

const Flip = HTMLFlipBook as unknown as React.ComponentType<FlipProps>

const SFX_KEY = 'bodha:flip-sfx'

/** A single-book page-turn sound, synthesised so the reader ships no audio files. */
function useFlipSound() {
  const [enabled, setEnabled] = useState(false)
  const ctxRef = useRef<AudioContext | null>(null)
  const usedRef = useRef(0)

  useEffect(() => {
    try {
      setEnabled(localStorage.getItem(SFX_KEY) === 'on')
    } catch {}
  }, [])

  const play = useCallback(() => {
    // Never on the very first flip: browsers block audio before a gesture, and
    // a book that clicks when it opens feels wrong anyway.
    if (!enabled || usedRef.current++ === 0) return
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      const ctx = ctxRef.current ?? new Ctor()
      ctxRef.current = ctx
      if (ctx.state === 'suspended') void ctx.resume()

      const duration = 0.26
      const frames = Math.floor(ctx.sampleRate * duration)
      const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < frames; i++) {
        const t = i / frames
        const envelope = Math.exp(-9 * t) * (1 - Math.exp(-40 * t))
        data[i] = (Math.random() * 2 - 1) * envelope
      }
      const source = ctx.createBufferSource()
      source.buffer = buffer

      const highpass = ctx.createBiquadFilter()
      highpass.type = 'highpass'
      highpass.frequency.value = 700

      const lowpass = ctx.createBiquadFilter()
      lowpass.type = 'lowpass'
      lowpass.frequency.setValueAtTime(2600, ctx.currentTime)
      lowpass.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + duration)

      const gain = ctx.createGain()
      gain.gain.value = 0.16

      source.connect(highpass).connect(lowpass).connect(gain).connect(ctx.destination)
      source.start()
      source.stop(ctx.currentTime + duration)
    } catch {}
  }, [enabled])

  const toggle = useCallback(() => {
    setEnabled(on => {
      const next = !on
      try {
        localStorage.setItem(SFX_KEY, next ? 'on' : 'off')
      } catch {}
      return next
    })
  }, [])

  return { enabled, toggle, play }
}

/**
 * The reading room.
 *
 * A PDF becomes a real book: facing pages, a page-turn you can hear, and zoom
 * for dense printing. Selecting text opens a little "ask BODHA" tab so a
 * question about the paragraph you are stuck on is one tap away.
 */
export default function DocumentReader({ doc }: DocumentReaderProps) {
  const [pdf, setPdf] = useState<unknown>(null)
  const [pageCount, setPageCount] = useState(doc.pageCount ?? 0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [zoom, setZoom] = useState(1)
  const [spread, setSpread] = useState(true)
  const [images, setImages] = useState<Record<number, string>>({})
  const [pageText, setPageText] = useState('')
  const [reading, setReading] = useState(false)
  const [selection, setSelection] = useState<{ text: string } | null>(null)

  const shellRef = useRef<HTMLDivElement | null>(null)
  const [shellWidth, setShellWidth] = useState(760)
  const isPdf = useMemo(() => doc.mime === 'application/pdf' || doc.kind === 'pdf', [doc.kind, doc.mime])
  const speaker = useSpeaker()
  const sound = useFlipSound()
  const scan = useDocumentScan()

  const textPages = useMemo(() => {
    const source = (doc.textContent ?? '').trim()
    if (isPdf || !source) return [] as string[]
    const chunks: string[] = []
    let cursor = 0
    const CHARS = 1800
    while (cursor < source.length) {
      let end = Math.min(cursor + CHARS, source.length)
      const nl = source.lastIndexOf('\n\n', end)
      if (nl > cursor + CHARS * 0.6) end = nl
      chunks.push(source.slice(cursor, end).trim())
      cursor = end
    }
    return chunks
  }, [doc.textContent, isPdf])

  const totalPages = isPdf ? pageCount : textPages.length

  // ── Shell width → page geometry ───────────────────────────────────────────
  useEffect(() => {
    const el = shellRef.current
    if (!el) return
    const measure = () => setShellWidth(el.clientWidth)
    measure()
    const obs = new ResizeObserver(measure)
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const singlePage = shellWidth < 720 || !spread
  const aspect = 1.414 // A4-ish portrait ratio
  const pageWidth = Math.round(
    Math.max(240, Math.min((singlePage ? shellWidth - 48 : shellWidth / 2 - 40) * zoom, 620)),
  )
  const pageHeight = Math.round(pageWidth * aspect)

  // ── Load the PDF ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isPdf) {
      setStatus('ready')
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await authFetch(`/api/documents/${doc.id}`, { cache: 'no-store' })
        if (!res.ok) throw new Error('Could not open document')
        const buffer = await res.arrayBuffer()
        const lib = await import('pdfjs-dist')
        lib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
        const loaded = await lib.getDocument({ data: new Uint8Array(buffer) }).promise
        if (cancelled) return
        setPdf(loaded)
        setPageCount(loaded.numPages)
        setStatus('ready')
      } catch (err) {
        console.warn('[reader] failed to load PDF:', (err as Error).message)
        if (!cancelled) setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doc.id, isPdf])

  // ── Rasterise the pages near the reader's current position ────────────────
  useEffect(() => {
    if (!pdf || !isPdf) return
    const target = [page, page + 1, page + 2, page - 1].filter(n => n >= 1 && n <= pageCount)
    const missing = target.filter(n => !images[n])
    if (!missing.length) return

    let cancelled = false
    void (async () => {
      for (const n of missing) {
        try {
          const url = await renderPageToDataUrl(pdf as { getPage: (n: number) => Promise<unknown> }, n, 1.6)
          if (cancelled) return
          setImages(prev => ({ ...prev, [n]: url }))
        } catch {
          // A page that will not rasterise simply stays blank; the rest work.
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pdf, isPdf, page, pageCount, images])

  // ── Text of the current page, for read-aloud ──────────────────────────────
  useEffect(() => {
    if (!isPdf) {
      setPageText(textPages[page - 1] ?? '')
      return
    }
    if (!pdf) return
    let cancelled = false
    void (async () => {
      try {
        const text = await extractPageText(pdf as { getPage: (n: number) => Promise<unknown> }, page)
        if (!cancelled) setPageText(text)
      } catch {
        if (!cancelled) setPageText('')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pdf, isPdf, page, textPages])

  useEffect(() => () => speaker.stop(), [speaker])

  const readAloud = useCallback(async () => {
    if (reading) {
      speaker.stop()
      setReading(false)
      return
    }
    let text = pageText
    if (isPdf && text.trim().length < 40 && pdf) {
      // No text layer — read the picture of the page instead.
      try {
        const image = images[page] ?? (await renderPageToDataUrl(pdf as { getPage: (n: number) => Promise<unknown> }, page, 2))
        text = await ocrPageImage(image, doc.id)
      } catch {
        text = ''
      }
    }
    if (!text.trim()) return
    setReading(true)
    await speaker.speak(text)
    setReading(false)
  }, [doc.id, images, isPdf, page, pageText, pdf, reading, speaker])

  const onFlip = useCallback(
    (e: { data: number }) => {
      const next = Math.max(1, Math.min(e.data + 1, pageCount || 1))
      setPage(next)
      sound.play()
      speaker.stop()
      setReading(false)
    },
    [pageCount, sound, speaker],
  )

  const goTo = useCallback(
    (delta: number) => setPage(p => Math.max(1, Math.min(p + delta, Math.max(totalPages, 1)))),
    [totalPages],
  )

  // ── “Ask BODHA about this paragraph” ──────────────────────────────────────
  useEffect(() => {
    const onUp = () => {
      const sel = window.getSelection()
      const text = sel?.toString().trim() ?? ''
      if (text.length > 12) setSelection({ text: text.slice(0, 1200) })
      else setSelection(null)
    }
    document.addEventListener('mouseup', onUp)
    document.addEventListener('touchend', onUp)
    return () => {
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('touchend', onUp)
    }
  }, [])

  const askSelection = useCallback(() => {
    if (!selection) return
    const query = new URLSearchParams({ document: doc.id, q: selection.text })
    window.location.href = `/chat?${query.toString()}`
  }, [doc.id, selection])

  const progressPct = totalPages ? Math.round((page / totalPages) * 100) : 0

  return (
    <div className="flex h-full min-h-0 flex-col bg-background-soft">
      {/* Toolbar */}
      <header className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/60 bg-background/90 px-3 py-2 backdrop-blur md:px-5">
        <Link href="/library" className="icon-btn" aria-label="Back to the library" title="Library">
          <ArrowLeft className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-ui font-medium text-foreground/90">{doc.title}</h1>
          <p className="text-ui-xs text-muted-foreground">
            {isPdf ? 'Book reader' : 'Reading pane'} · page {page} of {totalPages || 1}
          </p>
        </div>

        {isPdf && (
          <>
            <button
              type="button"
              onClick={() => setSpread(s => !s)}
              className="icon-btn hidden md:inline-flex"
              title={singlePage ? 'Show two pages' : 'Show one page'}
              aria-label={singlePage ? 'Show two pages' : 'Show one page'}
            >
              {singlePage ? <Square className="h-[17px] w-[17px]" strokeWidth={1.7} /> : <Columns2 className="h-[17px] w-[17px]" strokeWidth={1.7} />}
            </button>
            <div className="hidden items-center gap-0.5 rounded-lg border border-border/70 bg-surface px-0.5 sm:flex">
              <button
                type="button"
                onClick={() => setZoom(z => Math.max(0.6, Number((z - 0.15).toFixed(2))))}
                className="icon-btn-sm"
                title="Zoom out"
                aria-label="Zoom out"
              >
                <Minus className="h-3.5 w-3.5" strokeWidth={1.9} />
              </button>
              <span className="w-9 text-center text-ui-sm tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                onClick={() => setZoom(z => Math.min(2.2, Number((z + 0.15).toFixed(2))))}
                className="icon-btn-sm"
                title="Zoom in"
                aria-label="Zoom in"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />
              </button>
            </div>
          </>
        )}

        <button
          type="button"
          onClick={() => void readAloud()}
          className={cn('icon-btn', reading && 'text-primary')}
          title={reading ? 'Stop reading' : 'Read this page aloud'}
          aria-label={reading ? 'Stop reading' : 'Read this page aloud'}
        >
          {reading ? <VolumeX className="h-[18px] w-[18px]" strokeWidth={1.7} /> : <Volume2 className="h-[18px] w-[18px]" strokeWidth={1.7} />}
        </button>

        <button
          type="button"
          onClick={sound.toggle}
          className={cn('icon-btn', sound.enabled && 'text-primary')}
          title={sound.enabled ? 'Page-turn sound on' : 'Page-turn sound off'}
          aria-label={sound.enabled ? 'Page-turn sound on' : 'Page-turn sound off'}
        >
          <BookOpen className="h-[18px] w-[18px]" strokeWidth={1.7} />
        </button>

        <Link
          href={`/chat?document=${doc.id}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-3 text-ui-sm font-medium text-primary-foreground shadow-soft"
          title="Ask BODHA about this document"
        >
          <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.9} />
          Ask
        </Link>
      </header>

      {/* Progress hairline */}
      <div className="h-px w-full bg-transparent">
        <div className="h-px bg-primary/60 transition-[width] duration-300" style={{ width: `${progressPct}%` }} />
      </div>

      {/* Stage */}
      <div ref={shellRef} className="scrollbar-quiet relative min-h-0 flex-1 overflow-y-auto">
        {status === 'loading' && (
          <div className="flex h-full items-center justify-center">
            <p className="flex items-center gap-2 font-serif text-reading-sm italic text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
              Laying out the pages…
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className="mx-auto max-w-md px-6 py-20 text-center">
            <h2 className="font-display text-lg font-semibold text-foreground">This file will not open as a book</h2>
            <p className="mt-2 font-serif text-reading-sm italic text-muted-foreground">
              It may be damaged or password-protected. You can still ask me about its extracted text, or upload it
              again.
            </p>
            <Link
              href={`/chat?document=${doc.id}`}
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-ui font-medium text-primary-foreground"
            >
              <MessageSquare className="h-4 w-4" strokeWidth={1.8} />
              Ask BODHA instead
            </Link>
          </div>
        )}

        {status === 'ready' && isPdf && (
          <div className="flex min-h-full flex-col items-center justify-center px-4 py-6">
            <Flip
              width={pageWidth}
              height={pageHeight}
              size="fixed"
              showCover
              usePortrait={singlePage}
              mobileScrollSupport
              drawShadow
              maxShadowOpacity={0.28}
              flippingTime={750}
              startPage={Math.max(0, page - 1)}
              onFlip={onFlip}
              className="mx-auto"
            >
              {Array.from({ length: pageCount || 1 }, (_, i) => i + 1).map(n => (
                <div key={n} className="overflow-hidden rounded-[3px] bg-white shadow-[0_1px_3px_rgba(43,39,35,0.18)]">
                  {images[n] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={images[n]} alt={`Page ${n}`} width={pageWidth} height={pageHeight} className="h-full w-full select-text object-contain" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-white">
                      <span className="text-ui-sm text-muted-foreground/60">Page {n}</span>
                    </div>
                  )}
                </div>
              ))}
            </Flip>

            {/* Page controls — the book itself is draggable, these are for keyboards and thumbs */}
            <div className="mt-5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => goTo(-2)}
                disabled={page <= 1}
                className="rounded-full border border-border/70 bg-surface px-3.5 py-1.5 text-ui-sm text-foreground/80 transition-colors hover:border-primary/40 disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-ui-sm tabular-nums text-muted-foreground">
                {page} / {pageCount || 1}
              </span>
              <button
                type="button"
                onClick={() => goTo(2)}
                disabled={page >= (pageCount || 1)}
                className="rounded-full border border-border/70 bg-surface px-3.5 py-1.5 text-ui-sm text-foreground/80 transition-colors hover:border-primary/40 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {status === 'ready' && !isPdf && (
          <div className="mx-auto w-full max-w-read px-5 py-8">
            {textPages.length ? (
              <article key={page} className="animate-fade-in rounded-2xl border border-border/60 bg-surface/70 p-5 shadow-soft md:p-8">
                <Markdown content={textPages[page - 1] ?? ''} />
                <div className="mt-6 flex items-center justify-between border-t border-border/60 pt-4">
                  <button
                    type="button"
                    onClick={() => goTo(-1)}
                    disabled={page <= 1}
                    className="rounded-full border border-border/70 bg-surface px-3.5 py-1.5 text-ui-sm text-foreground/80 transition-colors hover:border-primary/40 disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="text-ui-sm tabular-nums text-muted-foreground">
                    {page} / {textPages.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => goTo(1)}
                    disabled={page >= textPages.length}
                    className="rounded-full border border-border/70 bg-surface px-3.5 py-1.5 text-ui-sm text-foreground/80 transition-colors hover:border-primary/40 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </article>
            ) : (
              <div className="py-20 text-center">
                <h2 className="font-display text-lg font-semibold text-foreground">Nothing to read yet</h2>
                <p className="mx-auto mt-2 max-w-sm font-serif text-reading-sm italic text-muted-foreground">
                  I could not find any text in this file. Read it with OCR, or just ask me about it.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* OCR strip — only for documents with no usable text */}
      {!doc.hasText && (
        <div className="shrink-0 border-t border-border/60 bg-surface/80 px-3 py-2.5 backdrop-blur md:px-5">
          {scan.progress ? (
            <div className="flex items-center gap-3">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" strokeWidth={1.8} />
              <div className="min-w-0 flex-1">
                <p className="text-ui-sm text-foreground">
                  Reading scanned pages… {scan.progress.page}/{scan.progress.total}
                </p>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-foreground/[0.08]">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-500"
                    style={{ width: `${(scan.progress.page / scan.progress.total) * 100}%` }}
                  />
                </div>
              </div>
              <button type="button" onClick={scan.cancel} className="text-ui-sm text-muted-foreground hover:text-foreground">
                Stop
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <ScanText className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" strokeWidth={1.8} />
              <p className="min-w-0 flex-1 font-serif text-reading-sm text-muted-foreground">
                This looks like a scan, so I cannot search it yet.
              </p>
              <button
                type="button"
                onClick={() => void scan.scan(doc.id)}
                disabled={scan.scanning}
                className="rounded-full bg-primary px-3.5 py-1.5 text-ui-sm font-medium text-primary-foreground shadow-soft transition-transform hover:scale-[1.02] disabled:opacity-50"
              >
                Read the pages with OCR
              </button>
            </div>
          )}
          {scan.error && <p className="mt-2 text-ui-sm text-destructive">{scan.error}</p>}
        </div>
      )}

      {/* Ask about a selected paragraph */}
      <AnimatePresence>
        {selection && (
          <motion.button
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            onClick={askSelection}
            className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-foreground px-4 py-2.5 text-ui font-medium text-background shadow-lift"
          >
            Ask BODHA about this
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
