import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/firebase/server-auth'
import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/documents/:id — return the document's raw content (for the reader)
 * or ?meta=1 for metadata + extracted text.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const wantMeta = req.nextUrl.searchParams.get('meta') === '1'
  const store = await getStore()
  const doc = await store.getDocument(id, user.id, { content: !wantMeta })
  if (!doc || doc.userId !== user.id) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  if (wantMeta) {
    const { content, ...meta } = doc
    return NextResponse.json({ document: { ...meta, textContent: doc.textContent } })
  }

  // Streamed in slices: a buffered response over ~4.5 MB is refused by the
  // hosting platform, a streamed one is not — this is what lets a 30 MB book open.
  const bytes = new Uint8Array(doc.content)
  const SLICE = 256 * 1024
  let offset = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close()
        return
      }
      controller.enqueue(bytes.subarray(offset, offset + SLICE))
      offset += SLICE
    },
  })
  return new Response(body, {
    headers: {
      'Content-Type': doc.mime || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${encodeURIComponent(doc.title)}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  })
}

/**
 * DELETE /api/documents/:id — delete a document (Firestore + Storage).
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const store = await getStore()
  const doc = await store.getDocument(id, user.id, { content: false })
  if (!doc || doc.userId !== user.id) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  await store.deleteDocument(id, user.id)
  return NextResponse.json({ ok: true })
}
