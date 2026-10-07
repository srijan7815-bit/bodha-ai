import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/firebase/server-auth'
import { getStore } from '@/lib/store'
import { ingestDocument } from '@/lib/ingest'

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
 * POST /api/documents — upload a small document (multipart form).
 * Fields: file (File), title? (string)
 *
 * Files too big for one request go through /api/documents/upload in pieces;
 * both end in the same ingest step.
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

  const result = await ingestDocument({
    userId: user.id,
    buffer: Buffer.from(await file.arrayBuffer()),
    name: file.name,
    mime: file.type,
    title: typeof form.get('title') === 'string' ? String(form.get('title')) : undefined,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ document: result.document, ocrPending: result.ocrPending })
}
