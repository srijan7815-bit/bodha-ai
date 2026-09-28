import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthUser } from '@/lib/firebase/server-auth'
import { getStore } from '@/lib/store'
import { streamTutorReply } from '@/lib/ai'
import { clientIp, rateLimit } from '@/lib/rate-limit'
import type { Message } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

type Params = { params: { id: string } }

const bodySchema = z
  .object({
    content: z.string().trim().max(12_000, 'That message is a bit too long').optional(),
    regenerate: z.boolean().optional(),
  })
  .refine(b => b.regenerate === true || (typeof b.content === 'string' && b.content.length > 0), {
    message: 'Message is empty',
  })

/**
 * POST /api/chats/:id/messages
 * Body: { content } to send, or { regenerate: true } to retry the last answer.
 * Streams BODHA's reply as NDJSON:
 *   {"t":"delta","v":"..."}      incremental answer text
 *   {"t":"done","message":{...}} final, persisted assistant message
 *   {"t":"error","errorMessage":"..."}
 */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getAuthUser(req)
  if (!user) return json({ t: 'error', errorMessage: 'Not signed in' }, 401)

  const limited = rateLimit(`msg:${user.id}:${clientIp(req)}`, 40, 5 * 60 * 1000)
  if (!limited.ok) {
    return json({ t: 'error', errorMessage: 'You are sending messages very quickly — take a short breath.' }, 429)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ t: 'error', errorMessage: 'Invalid request' }, 400)
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return json({ t: 'error', errorMessage: parsed.error.issues[0]?.message ?? 'Invalid request' }, 400)
  }

  const store = await getStore()
  const chat = await store.getChat(params.id)
  if (!chat || chat.userId !== user.id) {
    return json({ t: 'error', errorMessage: 'Chat not found' }, 404)
  }

  const isRegenerate = parsed.data.regenerate === true

  // Save the student's message (or drop the old answer when regenerating)
  let userMessage: Message | null = null
  if (isRegenerate) {
    const existing = await store.listMessages(params.id)
    // remove any trailing assistant messages so the model retries the last question
    for (let i = existing.length - 1; i >= 0 && existing[i].role === 'assistant'; i--) {
      await store.deleteMessage(existing[i].id)
      existing.splice(i, 1)
    }
    const lastUser = [...existing].reverse().find(m => m.role === 'user')
    if (!lastUser) {
      return json({ t: 'error', errorMessage: 'Nothing to regenerate yet.' }, 400)
    }
    userMessage = lastUser
  } else {
    userMessage = await store.createMessage(params.id, 'user', parsed.data.content!)
  }

  // Auto-title from the first message
  if (chat.title === 'New chat') {
    const raw = (parsed.data.content ?? '').trim().replace(/\s+/g, ' ')
    const short = raw.length > 52 ? `${raw.slice(0, 52)}…` : raw || 'New chat'
    await store.updateChat(params.id, { title: short }).catch(() => {})
  }

  // Gather context: history + linked document
  const history = await store.listMessages(params.id)
  let document = null
  if (chat.documentId) {
    document = await store.getDocument(chat.documentId).catch(() => null)
  }

  const encoder = new TextEncoder()
  const abortCtl = new AbortController()
  req.signal.addEventListener('abort', () => abortCtl.abort())

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`))
        } catch {
          /* client disconnected */
        }
      }

      let full = ''
      try {
        if (!isRegenerate) send({ t: 'user', message: userMessage })
        for await (const delta of streamTutorReply({ history, document }, abortCtl.signal)) {
          full += delta
          send({ t: 'delta', v: delta })
        }
      } catch (err) {
        const message =
          err instanceof Error && /timeout|aborted/i.test(err.message)
            ? 'My thoughts took too long to arrive — the connection was interrupted. Please try again.'
            : 'I hit a problem reaching my teaching model. Please try again in a moment.'
        if (full) full += '\n\n*— connection interrupted —*'
        send({ t: 'error', errorMessage: full ? undefined : message })
      }

      // Persist whatever BODHA managed to say (even partial, if content arrived)
      if (full.trim()) {
        try {
          const assistantMessage = await store.createMessage(params.id, 'assistant', full)
          send({ t: 'done', message: assistantMessage })
        } catch {
          send({ t: 'done', message: null })
        }
      } else {
        send({ t: 'done', message: null })
      }
      controller.close()
    },
    cancel() {
      abortCtl.abort()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}