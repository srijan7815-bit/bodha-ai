import type { DocumentRecord, Message, TutorMessage } from '@/lib/types'
import { buildSystemMessages } from './prompt'
import { getProviderConfig, streamCompletion, aiStatus as providerStatus, ProviderUnreachableError } from './provider'
import { streamDemoReply } from './demo'

/**
 * BODHA's tutor orchestration: builds the prompt (identity + document
 * context + conversation history) and streams the reply.
 *
 * Streams tagged chunks:
 *   { kind: 'delta',  text } — a piece of the answer
 *   { kind: 'notice', text } — an inline note for the student (e.g. the live
 *                             model being unreachable and the offline helper
 *                             taking over)
 */

const HISTORY_LIMIT = 20

export type TutorChunk = { kind: 'delta'; text: string } | { kind: 'notice'; text: string }

export interface TutorContext {
  history: Message[]
  document?: DocumentRecord | null
}

export function aiStatus(): { provider: string; model: string } {
  return providerStatus()
}

export async function* streamTutorReply(ctx: TutorContext, signal?: AbortSignal): AsyncGenerator<TutorChunk> {
  const messages: TutorMessage[] = buildSystemMessages({
    documentTitle: ctx.document?.title,
    documentText: ctx.document?.textContent,
  })

  const recent = ctx.history.slice(-HISTORY_LIMIT)
  for (const m of recent) {
    messages.push({ role: m.role, content: m.content })
  }

  const lastUser = [...recent].reverse().find(m => m.role === 'user')?.content ?? ''
  const cfg = getProviderConfig()

  if (!cfg) {
    yield { kind: 'notice', text: 'No AI provider configured — answering from the offline study helper.' }
    for await (const chunk of streamDemoReply(lastUser, signal)) {
      yield { kind: 'delta', text: chunk }
    }
    return
  }

  let sawContent = false
  try {
    for await (const delta of streamCompletion(cfg, messages, { signal, maxTokens: 2048, temperature: 0.6 })) {
      sawContent = true
      yield { kind: 'delta', text: delta }
    }
  } catch (err) {
    if (signal?.aborted) return

    // Never leave the student hanging: if the live model produced nothing
    // (unreachable / wedged route), fall back to the offline helper visibly.
    if (!sawContent) {
      const reason = err instanceof ProviderUnreachableError ? 'unreachable' : 'errored'
      console.warn('[ai] primary model failed before any content:', reason, (err as Error).message)
      yield {
        kind: 'notice',
        text: `Kimi K3 (moonshotai/kimi-k3 via NVIDIA NIM) could not be reached — I'm answering from my offline study helper instead. Everything else keeps working.`,
      }
      for await (const chunk of streamDemoReply(lastUser, signal)) {
        yield { kind: 'delta', text: chunk }
      }
      return
    }

    // Content already streamed — surface the interruption honestly.
    yield { kind: 'notice', text: '— connection interrupted —' }
  }
}
