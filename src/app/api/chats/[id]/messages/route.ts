import { gatherWeb } from '@/lib/web'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { retrieveForQuestion } from '@/lib/iks'
import { getAuthUser } from '@/lib/firebase/server-auth'
import { getStore } from '@/lib/store'
import { streamTutorReply } from '@/lib/ai'
import { blockedEndpointReason, customProviderConfig, normalizeBaseUrl } from '@/lib/ai/custom'
import type { ProviderConfig } from '@/lib/ai/provider'
import { BODHA_MODEL, migrateSettings } from '@/lib/types'
import { clientIp, rateLimit } from '@/lib/rate-limit'
import type { Message } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

type Params = { params: Promise<{ id: string }> }

const bodySchema = z
  .object({
    content: z.string().trim().max(12_000, 'That message is a bit too long').optional(),
    regenerate: z.boolean().optional(),
    /**
     * Which model answers: 'bodha' for BODHA's own chain, or the id of one of
     * the student's connected models.
     */
    model: z.string().trim().max(120).optional(),
    /** Live Mode: the reply is spoken aloud, so keep it short and Markdown-free. */
    live: z.boolean().optional(),
  })
  .refine(b => b.regenerate === true || (typeof b.content === 'string' && b.content.length > 0), {
    message: 'Message is empty',
  })

/**
 * POST /api/chats/:id/messages
 * Body: { content } to send, or { regenerate: true } to retry the last answer.
 * Streams BODHA's reply as NDJSON frames:
 *   {"t":"user","message":{...}}   the persisted student message
 *   {"t":"delta","v":"..."}        incremental answer text
 *   {"t":"notice","v":"..."}       inline notes (e.g. model fallback)
 *   {"t":"done","message":{...}}   final, persisted assistant message
 *   {"t":"error","errorMessage": "..."}
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
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
  const chat = await store.getChat(id, user.id)
  if (!chat || chat.userId !== user.id) {
    return json({ t: 'error', errorMessage: 'Chat not found' }, 404)
  }

  const isRegenerate = parsed.data.regenerate === true

  // Save the student's message (or drop the old answer when regenerating)
  let userMessage: Message | null = null
  if (isRegenerate) {
    const existing = await store.listMessages(id, user.id)
    // remove any trailing assistant messages so the model retries the last question
    for (let i = existing.length - 1; i >= 0 && existing[i].role === 'assistant'; i--) {
      await store.deleteMessage(existing[i].id, user.id, id)
      existing.splice(i, 1)
    }
    const lastUser = [...existing].reverse().find(m => m.role === 'user')
    if (!lastUser) {
      return json({ t: 'error', errorMessage: 'Nothing to regenerate yet.' }, 400)
    }
    userMessage = lastUser
  } else {
    userMessage = await store.createMessage(id, 'user', parsed.data.content!, undefined, undefined, user.id)
  }

  // Auto-title from the first message
  if (chat.title === 'New chat') {
    const raw = (parsed.data.content ?? '').trim().replace(/\s+/g, ' ')
    const short = raw.length > 52 ? `${raw.slice(0, 52)}…` : raw || 'New chat'
    await store.updateChat(id, { title: short }, user.id).catch(() => {})
  }

  // Their own model, when they have connected one and the toggle is on it.
  const settings = migrateSettings(await store.getUserSettings(user.id).catch(() => null))
  const wanted = parsed.data.model ?? settings?.preferredModel ?? BODHA_MODEL
  const preferred: ProviderConfig[] = []
  if (wanted !== BODHA_MODEL && settings?.custom) {
    const chosen = settings.custom.models.find(model => model.id === wanted)
    // Re-checked at use, not only when it was saved: a stored address that is
    // no longer acceptable must not be dialled just because it predates the rule.
    if (chosen && !blockedEndpointReason(normalizeBaseUrl(settings.custom.baseUrl))) {
      preferred.push(customProviderConfig(settings.custom, chosen))
    }
  }

  // Gather context: history + linked document
  const history = await store.listMessages(id, user.id)
  let document = null
  if (chat.documentId) {
    document = await store.getDocument(chat.documentId, user.id, { content: false }).catch(() => null)
  }

  // Read the Indian Knowledge Systems shelf for this question. Retrieved once,
  // before the model is called, so the answer can be grounded *and* attributed:
  // the same passages go into the prompt and onto the saved message.
  const question = isRegenerate
    ? ([...history].reverse().find(m => m.role === 'user')?.content ?? '')
    : (parsed.data.content ?? '')
  const [shelf, web] = await Promise.all([retrieveForQuestion(question), gatherWeb(question, { live: parsed.data.live })])

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
        if (!isRegenerate && shelf.sources.length) send({ t: 'sources', items: shelf.sources })
        for await (const chunk of streamTutorReply({ history, document, preferred, iksContext: shelf.context, live: parsed.data.live, webContext: web.context, webNotice: web.notice }, abortCtl.signal)) {
          if (chunk.kind === 'delta') {
            full += chunk.text
            send({ t: 'delta', v: chunk.text })
          } else {
            send({ t: 'notice', v: chunk.text })
          }
        }
      } catch (err) {
        if (!abortCtl.signal.aborted) {
          console.warn('[messages] stream failed:', (err as Error).message)
          send({ t: 'error', errorMessage: full ? undefined : 'I hit a problem reaching my teaching model. Please try again in a moment.' })
        }
        if (full) full += '\n\n*— connection interrupted —*'
      }

      // Persist whatever BODHA managed to say (even partial, if content arrived)
      if (full.trim()) {
        try {
          const assistantMessage = await store.createMessage(
            id,
            'assistant',
            full,
            undefined,
            undefined,
            user.id,
            shelf.sources.length ? shelf.sources : undefined,
          )
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
