import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/firebase/server-auth'
import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

/**
 * GET /api/documents/:id — return the document's raw content (for the reader)
 * or ?meta=1 for just metadata.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const store = await getStore()
  const doc = await store.getDocument(params.id)
  if (!doc || doc.userId !== user.id) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  const wantMeta = req.nextUrl.searchParams.get('meta') === '1'
  if (wantMeta) {
    const { content, textContent, ...meta } = doc
    return NextResponse.json({ document: { ...meta, textContent } })
  }

  const body = new Uint8Array(doc.content)
  return new Response(body, {
    headers: {
      'Content-Type': doc.mime || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${encodeURIComponent(doc.title)}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  })
}

/**
 * DELETE /api/documents/:id — delete a document.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const store = await getStore()
  const doc = await store.getDocument(params.id)
  if (!doc || doc.userId !== user.id) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  await store.deleteDocument(params.id)
  return NextResponse.json({ ok: true })
}