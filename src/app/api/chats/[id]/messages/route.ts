import { gatherWeb } from '@/lib/web'
import { NextRequest, NextResponse, after } from 'next/server'
import { z } from 'zod'
import { retrieveForQuestion } from '@/lib/iks'
import { getAuthUser } from '@/lib/firebase/server-auth'
import { getStore } from '@/lib/store'
import { streamTutorReply } from '@/lib/ai'
import { memoryBlock, recallMemories, rememberTurn } from '@/lib/memory/viking'
import { looksLikeTask, runAgent } from '@/lib/agent/run'
import { listWorkspaceFiles } from '@/lib/workspace/store'
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
    /**
     * The computer toggle in the composer. When it is on, task-shaped messages
     * (make a file, run code, download, convert) go to BODHA's computer instead of
     * the plain tutor — and everything it makes is saved in the student's workspace.
     */
    computer: z.boolean().optional(),
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

  // ── Start every independent fetch NOW, before the writes below. ──────────
  // These four reads used to happen one after another (settings → history →
  // document → shelf), and in Live Mode each of them was heard as silence
  // between the question and the first spoken word. None of them depends on
  // this turn's message being saved, so they all run alongside it. The two
  // that need the question wait for it — a regenerate only knows its question
  // after the history is read, so those still start later, exactly as before.
  const settingsP = store.getUserSettings(user.id).catch(() => null)
  const docP = chat.documentId
    ? store.getDocument(chat.documentId, user.id, { content: false }).catch(() => null)
    : Promise.resolve(null)
  let shelfP!: ReturnType<typeof retrieveForQuestion>
  let webP!: ReturnType<typeof gatherWeb>
  /**
   * Memory recall (OpenViking) starts here, alongside everything else: it is
   * hard-capped at 2.5 s and fails open, so it can never be the reason an answer
   * is late — and it is never awaited on its own.
   */
  let memoriesP!: Promise<string[]>
  if (!isRegenerate) {
    const question = parsed.data.content ?? ''
    shelfP = retrieveForQuestion(question)
    webP = gatherWeb(question, { live: parsed.data.live })
    memoriesP = recallMemories(user.id, question, { timeoutMs: 2_500, signal: req.signal }).catch(() => [])
  }

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
  const settings = migrateSettings(await settingsP)
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

  // Gather context: history + linked document. The message must be IN the
  // history before it is read, so these two keep their order — everything
  // else has been running alongside them since the line that started this
  // section.
  const history = await store.listMessages(id, user.id)
  const document = await docP

  // Read the Indian Knowledge Systems shelf for this question. Retrieved once,
  // before the model is called, so the answer can be grounded *and* attributed:
  // the same passages go into the prompt and onto the saved message.
  const askedQuestion = isRegenerate
    ? [...history].reverse().find(m => m.role === 'user')?.content ?? ''
    : parsed.data.content ?? ''
  if (isRegenerate) {
    shelfP = retrieveForQuestion(askedQuestion)
    webP = gatherWeb(askedQuestion, { live: parsed.data.live })
    memoriesP = recallMemories(user.id, askedQuestion, { timeoutMs: 2_500, signal: req.signal }).catch(() => [])
  }
  const [shelf, web, memories] = await Promise.all([shelfP, webP, memoriesP])

  // The computer toggle: only task-shaped messages go to the computer, so ordinary
  // questions keep their normal (and fast) tutoring path. Live Mode never does.
  const useComputer = parsed.data.computer === true && !parsed.data.live && looksLikeTask(askedQuestion)

  // Handed to after(): the memory write-back happens once the answer has been sent.
  let answerForMemory = ''

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

        if (useComputer) {
          // ── The computer answers this one ──────────────────────────────────
          // The student switched on the computer toggle and asked for a real
          // artefact, so the agent does the work in their workspace. Its steps
          // arrive as inline notices; its summary arrives as the answer; every
          // file it makes is saved to the workspace the drawer can open.
          send({ t: 'notice', v: 'Computer is on this task — working in your workspace…' })
          let failed = false
          for await (const frame of runAgent(askedQuestion, abortCtl.signal, { ownerId: user.id })) {
            if (frame.t === 'step') send({ t: 'notice', v: `${frame.tool}${frame.summary ? `: ${frame.summary}` : ''}` })
            else if (frame.t === 'result' && !frame.ok) send({ t: 'notice', v: `↳ ${frame.output.slice(0, 160)}` })
            else if (frame.t === 'final') {
              if (frame.message) {
                full += frame.message
                send({ t: 'delta', v: frame.message })
              }
            } else if (frame.t === 'error') {
              failed = true
              send({ t: 'notice', v: frame.message })
            }
          }
          const saved = failed ? [] : await listWorkspaceFiles(user.id).catch(() => [])
          if (saved.length) send({ t: 'files', items: saved.slice(0, 12).map(f => ({ name: f.name, size: f.size, mime: f.mime })) })
          if (failed && !full.trim()) {
            // The computer could not do it — answer as a tutor would instead of
            // leaving the student with an error and nothing else.
            for await (const chunk of streamTutorReply(
              { history, document, preferred, iksContext: shelf.context, live: parsed.data.live, webContext: web.context, memories: memoryBlock(memories), computer: true },
              abortCtl.signal,
            )) {
              if (chunk.kind === 'delta') {
                full += chunk.text
                send({ t: 'delta', v: chunk.text })
              } else send({ t: 'notice', v: chunk.text })
            }
          }
        } else {
          for await (const chunk of streamTutorReply({ history, document, preferred, iksContext: shelf.context, live: parsed.data.live, webContext: web.context, webNotice: web.notice, memories: memoryBlock(memories), computer: parsed.data.computer === true }, abortCtl.signal)) {
            if (chunk.kind === 'delta') {
              full += chunk.text
              send({ t: 'delta', v: chunk.text })
            } else {
              send({ t: 'notice', v: chunk.text })
            }
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
      answerForMemory = full
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

  /**
   * Memory write-back runs AFTER the answer has been streamed, so the student
   * never waits for it. `after()` keeps the function alive for it on Vercel,
   * which a bare floating promise would not survive.
   */
  after(async () => {
    try {
      if (answerForMemory.trim().length < 60) return
      await rememberTurn(user.id, askedQuestion, answerForMemory)
    } catch {
      /* memory is a bonus, never a failure the student should see */
    }
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
