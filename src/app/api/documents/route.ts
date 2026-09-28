import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/firebase/server-auth'
import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/documents — list the signed-in user's documents.
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const store = await getStore()
  const documents = await store.listDocuments(user.id)
  return NextResponse.json({ documents })
}

/**
 * POST /api/documents — upload a document (multipart form).
 * Fields: file (File), title? (string)
 * Flow: save to Firebase Storage → extract text (client-side parse for txt/md,
 * server-side pdf-parse for PDFs) → store metadata + text in Firestore.
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 })
  }

  // Serverless request bodies are capped at ~4.5 MB, so this is the honest
  // ceiling for a single upload. The file itself is then kept in Firestore as
  // part documents (no Storage bucket required) and can be read back anywhere.
  const MAX_SIZE = 4 * 1024 * 1024
  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: 'That file is larger than 4 MB. Upload a chapter at a time, or compress the PDF and try again.' },
      { status: 413 },
    )
  }

  const mime = file.type || 'application/octet-stream'
  const name = file.name || 'document'
  const isPdf = mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf')
  const isImage = /^image\/(png|jpe?g)$/i.test(mime) || /\.(png|jpe?g)$/i.test(name)
  const isText = mime.startsWith('text/') || /\.(txt|md|markdown|csv|json)$/i.test(name)

  if (!isPdf && !isImage && !isText) {
    return NextResponse.json({ error: 'Only PDFs, images and text files are supported for now.' }, { status: 415 })
  }

  const store = await getStore()
  const id = crypto.randomUUID()
  const buffer = Buffer.from(await file.arrayBuffer())

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
    // Scanned book? Flag it so the client can rasterize pages → /api/ocr
    // (nvidia/nemotron-parse) and merge the text in.
    try {
      const { looksScanned } = await import('@/lib/ocr')
      ocrPending = looksScanned(textContent, pageCount ?? 0)
    } catch {}
  } else if (isImage) {
    // Direct OCR with nvidia/nemotron-parse — the server holds the API key.
    try {
      const { ocrImage } = await import('@/lib/ocr')
      textContent = await ocrImage(buffer, mime)
    } catch (e) {
      console.warn('[documents] image OCR failed:', (e as Error).message)
      ocrPending = true
    }
  } else {
    textContent = buffer.toString('utf-8')
    pageCount = null
  }

  const title =
    typeof form.get('title') === 'string' && (form.get('title') as string).trim()
      ? (form.get('title') as string).trim().slice(0, 120)
      : name.replace(/\.[^.]+$/, '')

  const meta = await store.createDocument({
    id,
    userId: user.id,
    title,
    kind: isPdf ? 'pdf' : 'text',
    mime,
    sizeBytes: file.size,
    pageCount,
    content: buffer,
    textContent,
    createdAt: new Date().toISOString(),
  })

  return NextResponse.json({ document: meta, ocrPending })
}