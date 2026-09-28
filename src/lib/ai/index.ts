import type { DocumentRecord, Message, TutorMessage } from '@/lib/types'
import { buildSystemMessages } from './prompt'
import { getProviderConfig, streamCompletion, aiStatus as providerStatus } from './provider'
import { streamDemoReply } from './demo'

/**
 * BODHA's tutor orchestration: builds the prompt (identity + document
 * context + conversation history) and streams the reply.
 */

const HISTORY_LIMIT = 20

export interface TutorContext {
  history: Message[]
  document?: DocumentRecord | null
}

export function aiStatus(): { provider: string; model: string } {
  return providerStatus()
}

export async function* streamTutorReply(ctx: TutorContext, signal?: AbortSignal): AsyncGenerator<string> {
  const messages: TutorMessage[] = buildSystemMessages({
    documentTitle: ctx.document?.title,
    documentText: ctx.document?.textContent,
  })

  const recent = ctx.history.slice(-HISTORY_LIMIT)
  for (const m of recent) {
    messages.push({ role: m.role, content: m.content })
  }

  const cfg = getProviderConfig()
  if (!cfg) {
    const lastUser = [...recent].reverse().find(m => m.role === 'user')
    yield* streamDemoReply(lastUser?.content ?? '', signal)
    return
  }

  yield* streamCompletion(cfg, messages, { signal, maxTokens: 2048, temperature: 0.6 })
}