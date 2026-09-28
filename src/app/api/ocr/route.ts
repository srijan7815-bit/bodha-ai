import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/firebase/server-auth'
import { getStore } from '@/lib/store'
import { ocrConfigured, ocrImage } from '@/lib/ocr'
import { clientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_IMAGE_BYTES = 8 * 1024 * 1024

/**
 * POST /api/ocr — OCR one document image with nvidia/nemotron-parse.
 * Multipart form: { image: File, documentId?: string }
 *
 * When `documentId` is provided, the extracted text is also merged into that
 * document's textContent (used by the browser-side rasterize-and-OCR flow for
 * scanned PDFs).
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  if (!ocrConfigured()) {
    return NextResponse.json({ error: 'OCR is not configured (missing NVIDIA_API_KEY).' }, { status: 503 })
  }

  const limited = rateLimit(`ocr:${user.id}:${clientIp(req)}`, 60, 10 * 60 * 1000)
  if (!limited.ok) {
    return NextResponse.json({ error: 'Too many OCR requests — try again shortly.' }, { status: 429 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 })
  }

  const image = form.get('image')
  if (!(image instanceof File)) {
    return NextResponse.json({ error: 'Missing image' }, { status: 400 })
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: 'That page image is too large.' }, { status: 413 })
  }

  const mime = image.type || 'image/png'
  if (!/^image\/(png|jpe?g)$/i.test(mime)) {
    return NextResponse.json({ error: 'Only PNG and JPEG page images are supported.' }, { status: 415 })
  }

  let text: string
  try {
    text = await ocrImage(Buffer.from(await image.arrayBuffer()), mime)
  } catch (err) {
    console.warn('[ocr] nemotron-parse failed:', (err as Error).message)
    return NextResponse.json({ error: 'The OCR service could not be reached. Please try again later.' }, { status: 502 })
  }

  // Optionally merge the page text into a document.
  let merged = false
  const documentId = form.get('documentId')
  if (typeof documentId === 'string' && documentId.trim()) {
    try {
      const store = await getStore()
      const doc = await store.getDocument(documentId, user.id)
      if (doc && doc.userId === user.id) {
        const divider = doc.textContent.trim() ? '\n\n' : ''
        const existing = doc.textContent
        if (!existing.includes(text.slice(0, 200))) {
          const { appendDocumentText } = await import('@/lib/store/helpers')
          await appendDocumentText(store, documentId, user.id, divider + text)
        }
        merged = true
      }
    } catch (e) {
      console.warn('[ocr] merge failed:', (e as Error).message)
    }
  }

  return NextResponse.json({ text, merged })
}
