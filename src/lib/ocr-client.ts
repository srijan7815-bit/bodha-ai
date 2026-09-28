'use client'

import { useCallback, useRef, useState } from 'react'
import { authFetch } from '@/lib/firebase/client-token'
import type { DocumentMeta } from '@/lib/types'

/**
 * Browser-side page rasteriser + OCR.
 *
 * Scanned books have no text layer, so the server cannot read them without an
 * image. The browser is where a canvas lives, so we render each PDF page here
 * and hand the picture to /api/ocr (nvidia/nemotron-parse) — which also merges
 * the recognised text back into the document for future questions.
 */

type PdfJs = typeof import('pdfjs-dist')

let pdfjsPromise: Promise<PdfJs> | null = null

async function loadPdfjs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const lib = (await import('pdfjs-dist')) as unknown as PdfJs
      lib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
      return lib
    })()
  }
  return pdfjsPromise
}

export interface OcrProgress {
  page: number
  total: number
  chars: number
}

/** Rasterise a page of an already-open PDF to a JPEG data URL. */
export async function renderPageToDataUrl(
  pdf: { getPage: (n: number) => Promise<unknown> },
  pageNumber: number,
  scale = 2,
): Promise<string> {
  const page = (await pdf.getPage(pageNumber)) as {
    getViewport: (o: { scale: number }) => { width: number; height: number }
    render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> }
  }
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.min(Math.ceil(viewport.width), 2000)
  canvas.height = Math.ceil((canvas.width / viewport.width) * viewport.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: context, viewport }).promise
  return canvas.toDataURL('image/jpeg', 0.82)
}

/** Extract the text layer of one page (no OCR, instant — works for born-digital PDFs). */
export async function extractPageText(pdf: { getPage: (n: number) => Promise<unknown> }, pageNumber: number): Promise<string> {
  const page = (await pdf.getPage(pageNumber)) as { getTextContent: () => Promise<{ items: Array<{ str?: string; hasEOL?: boolean }> }> }
  const content = await page.getTextContent()
  let out = ''
  for (const item of content.items) {
    out += item.str ?? ''
    if (item.hasEOL) out += '\n'
  }
  return out.replace(/[ \t]{2,}/g, ' ').trim()
}

/** OCR one rendered page through the server route (also merges into the document). */
export async function ocrPageImage(dataUrl: string, documentId?: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob()
  const form = new FormData()
  form.append('image', new File([blob], 'page.jpg', { type: 'image/jpeg' }))
  if (documentId) form.append('documentId', documentId)
  const res = await authFetch('/api/ocr', { method: 'POST', body: form })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? 'OCR failed')
  return (data.text ?? '') as string
}

export interface ScanResult {
  ok: number
  failed: number
  chars: number
}

/**
 * Read a whole scanned document, page by page, and save the text back.
 * Bounded on purpose: the first `maxPages` pages are enough to make the tutor
 * useful, and it keeps a single tap from burning an hour of OCR quota.
 */
export function useDocumentScan() {
  const [progress, setProgress] = useState<OcrProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setProgress(null)
  }, [])

  const scan = useCallback(
    async (documentId: string, maxPages = 12): Promise<ScanResult> => {
      if (!documentId) return { ok: 0, failed: 0, chars: 0 }
      setError(null)
      const controller = new AbortController()
      abortRef.current = controller

      const result: ScanResult = { ok: 0, failed: 0, chars: 0 }
      try {
        const res = await authFetch(`/api/documents/${documentId}`, { cache: 'no-store' })
        if (!res.ok) throw new Error('I could not open that document.')
        const buffer = await res.arrayBuffer()

        const lib = await loadPdfjs()
        const pdf = await lib.getDocument({ data: new Uint8Array(buffer) }).promise
        const total = Math.min(pdf.numPages, maxPages)

        for (let page = 1; page <= total; page++) {
          if (controller.signal.aborted) break
          setProgress({ page, total, chars: result.chars })
          try {
            const image = await renderPageToDataUrl(pdf, page, 2)
            const text = await ocrPageImage(image, documentId)
            result.chars += text.length
            result.ok += 1
          } catch (err) {
            console.warn(`[ocr] page ${page} failed:`, (err as Error).message)
            result.failed += 1
          }
        }

        if (result.ok === 0) setError('None of the pages could be read. Please try again later.')
      } catch (err) {
        setError((err as Error).message || 'Scanning failed.')
      } finally {
        abortRef.current = null
        setProgress(null)
      }
      return result
    },
    [],
  )

  return { scan, cancel, progress, error, scanning: progress !== null }
}

/** Small helper so pages can be fetched lazily by the reader. */
export function documentFileUrl(doc: Pick<DocumentMeta, 'id'>) {
  return `/api/documents/${doc.id}`
}
