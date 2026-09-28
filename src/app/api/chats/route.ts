import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/firebase/server-auth'
import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

/**
 * GET /api/chats — list the signed-in user's chats.
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const store = await getStore()
  const chats = await store.listChats(user.id)
  return NextResponse.json({ chats })
}

/**
 * POST /api/chats — create a new chat.
 * Body: { title?, documentId? }
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 80) : 'New chat'
  const documentId = typeof body.documentId === 'string' ? body.documentId : null

  const store = await getStore()
  const chat = await store.createChat({ userId: user.id, title, documentId })
  return NextResponse.json({ chat })
}