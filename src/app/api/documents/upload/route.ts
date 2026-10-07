import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/firebase/server-auth'
import { getStore } from '@/lib/store'
import { clientIp, rateLimit } from '@/lib/rate-limit'
import { ingestDocument, MAX_FILE_BYTES, PART_BYTES } from '@/lib/ingest'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UPLOAD_ID = /^[0-9a-f-]{36}$/i
const MAX_PARTS = Math.ceil(MAX_FILE_BYTES / PART_BYTES) + 1

/**
 * POST /api/documents/upload — a big file, one piece at a time.
 *
 * The hosting platform refuses any single request over ~4.5 MB, so the browser
 * cuts the file into 3 MB pieces:
 *
 *   ?uploadId=…&index=n&total=N            body = the raw bytes of piece n
 *   ?uploadId=…&total=N&complete=1         body = JSON { name, mime, title }
 *
 * Pieces are parked in the store; the final call joins them and runs the same
 * ingest step as a normal upload.
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const limited = rateLimit(`upload:${user.id}:${clientIp(req)}`, 200, 10 * 60 * 1000)
  if (!limited.ok) return NextResponse.json({ error: 'Too many uploads — give it a minute.' }, { status: 429 })

  const q = req.nextUrl.searchParams
  const uploadId = q.get('uploadId') ?? ''
  const total = Number(q.get('total'))
  if (!UPLOAD_ID.test(uploadId) || !Number.isInteger(total) || total < 1 || total > MAX_PARTS) {
    return NextResponse.json({ error: 'That upload request was not valid.' }, { status: 400 })
  }

  const store = await getStore()

  if (q.get('complete') === '1') {
    const meta = (await req.json().catch(() => ({}))) as { name?: string; mime?: string; title?: string }
    const buffer = await store.takeUpload(user.id, uploadId, total)
    if (!buffer) {
      return NextResponse.json({ error: 'Part of the file went missing on the way. Please upload it again.' }, { status: 409 })
    }
    const result = await ingestDocument({
      userId: user.id,
      buffer,
      name: String(meta.name ?? 'document').slice(0, 200),
      mime: String(meta.mime ?? ''),
      title: meta.title,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ document: result.document, ocrPending: result.ocrPending })
  }

  const index = Number(q.get('index'))
  if (!Number.isInteger(index) || index < 0 || index >= total) {
    return NextResponse.json({ error: 'That upload request was not valid.' }, { status: 400 })
  }
  const bytes = Buffer.from(await req.arrayBuffer())
  if (!bytes.length || bytes.length > PART_BYTES + 64 * 1024) {
    return NextResponse.json({ error: 'That piece of the file was the wrong size.' }, { status: 400 })
  }
  await store.saveUploadPart(user.id, uploadId, index, bytes)
  return NextResponse.json({ ok: true, index })
}
