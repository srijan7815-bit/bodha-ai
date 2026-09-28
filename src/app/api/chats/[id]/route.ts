import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/firebase/server-auth'
import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

/**
 * GET /api/chats/:id — fetch one chat with its messages.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const store = await getStore()
  const chat = await store.getChat(params.id)
  if (!chat || chat.userId !== user.id) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
  }

  const messages = await store.listMessages(params.id)
  return NextResponse.json({ chat, messages })
}

/**
 * PATCH /api/chats/:id — update title or linked document.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const store = await getStore()
  const chat = await store.getChat(params.id)
  if (!chat || chat.userId !== user.id) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  const patch: { title?: string; documentId?: string | null } = {}
  if (typeof body.title === 'string') patch.title = body.title.trim().slice(0, 80)
  if (body.documentId !== undefined) patch.documentId = typeof body.documentId === 'string' ? body.documentId : null

  const updated = await store.updateChat(params.id, patch)
  return NextResponse.json({ chat: updated })
}

/**
 * DELETE /api/chats/:id — delete a chat and its messages.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const store = await getStore()
  const chat = await store.getChat(params.id)
  if (!chat || chat.userId !== user.id) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
  }

  await store.deleteChat(params.id)
  return NextResponse.json({ ok: true })
}