import { getStore } from '@/lib/store'
import type { DocumentMeta } from '@/lib/types'

/**
 * Largest file BODHA accepts. A file is sent in 3 MB pieces, so the only real
 * ceilings are storage and the time one server function has to read the book —
 * 40 MB of PDF is a very large book.
 */
export const MAX_FILE_BYTES = 40 * 1024 * 1024

/** What one request body can safely carry through the hosting platform. */
export const PART_BYTES = 3 * 1024 * 1024

export type IngestResult =
  | { ok: true; document: DocumentMeta; ocrPending: boolean }
  | { ok: false; status: number; error: string }

/**
 * Turns an uploaded file into a stored document: text extraction for PDFs, OCR
 * for photos, plain read for text. Shared by the one-shot upload and the
 * chunked upload, so both behave identically.
 */
export async function ingestDocument(input: {
  userId: string
  buffer: Buffer
  name: string
  mime: string
  title?: string
}): Promise<IngestResult> {
  const { userId, buffer } = input
  const mime = input.mime || 'application/octet-stream'
  const name = input.name || 'document'

  if (buffer.length > MAX_FILE_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `That file is over ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB, which is more than BODHA can read in one go. Split it into volumes and upload them separately.`,
    }
  }

  const isPdf = mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf')
  const isImage = /^image\/(png|jpe?g)$/i.test(mime) || /\.(png|jpe?g)$/i.test(name)
  const isText = mime.startsWith('text/') || /\.(txt|md|markdown|csv|json)$/i.test(name)

  if (!isPdf && !isImage && !isText) {
    return { ok: false, status: 415, error: 'Only PDFs, images and text files are supported for now.' }
  }

  const store = await getStore()
  const id = crypto.randomUUID()

  let pageCount: number | null = null
  let textContent = ''
  let ocrPending = false

  if (isPdf) {
    // Real text-layer extraction with pdfjs-dist (works with no API key).
    try {
      const { extractPdfText } = await import('@/lib/pdf-server')
      const result = await extractPdfText(buffer)
      pageCount = result.pageCount
      textContent = result.text
    } catch (e) {
      console.warn('[documents] PDF text extraction failed:', e)
    }
    // Scanned book? Flag it so the client can rasterize pages → /api/ocr.
    try {
      const { looksScanned } = await import('@/lib/ocr')
      ocrPending = looksScanned(textContent, pageCount ?? 0)
    } catch {}
  } else if (isImage) {
    try {
      const { ocrImage } = await import('@/lib/ocr')
      textContent = await ocrImage(buffer, mime)
    } catch (e) {
      console.warn('[documents] image OCR failed:', (e as Error).message)
      ocrPending = true
    }
  } else {
    textContent = buffer.toString('utf-8')
  }

  const title = input.title?.trim() ? input.title.trim().slice(0, 120) : name.replace(/\.[^.]+$/, '')

  const meta = await store.createDocument({
    id,
    userId,
    title,
    kind: isPdf ? 'pdf' : 'text',
    mime,
    sizeBytes: buffer.length,
    pageCount,
    content: buffer,
    textContent,
    createdAt: new Date().toISOString(),
  })

  return { ok: true, document: meta, ocrPending }
}
