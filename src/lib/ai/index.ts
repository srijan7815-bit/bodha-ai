import type { DocumentRecord, Message, TutorMessage } from '@/lib/types'
import { buildSystemMessages } from './prompt'
import { completeOnce, getProviderChain, noteProviderResult, streamCompletion, ProviderUnreachableError, DEFAULT_MODEL } from './provider'
import { streamDemoReply } from './demo'

/**
 * BODHA's tutor orchestration: build the prompt (identity + document context +
 * history), then stream the reply — walking down the model chain if the primary
 * model stalls, and finally falling back to the offline study helper.
 *
 * Streamed chunks:
 *   { kind: 'delta',  text } — a piece of the answer
 *   { kind: 'notice', text } — an inline note (e.g. which model answered)
 */

const HISTORY_LIMIT = 20

export type TutorChunk = { kind: 'delta'; text: string } | { kind: 'notice'; text: string }

export interface TutorContext {
  history: Message[]
  document?: DocumentRecord | null
}

const PRETTY: Record<string, string> = {
  'z-ai/glm-5.3': 'GLM 5.3',
  'z-ai/glm-5.3-flash': 'GLM 5.3 Flash',
  'nvidia/nemotron-3-super-120b-a12b': 'Nemotron 3 Super',
  'openai/gpt-oss-20b': 'GPT-OSS 20B',
  'moonshotai/kimi-k3': 'Kimi K3',
}

function prettyName(model: string) {
  return PRETTY[model] ?? model.split('/').pop() ?? model
}

export function aiStatus(): { provider: string; model: string; chain: string[] } {
  const chain = getProviderChain()
  return {
    provider: 'nvidia',
    model: chain[0]?.model ?? DEFAULT_MODEL,
    chain: chain.map(c => c.model),
  }
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
  const chain = getProviderChain()

  if (!chain.length) {
    yield { kind: 'notice', text: 'No AI provider is configured, so I am answering from my offline study helper.' }
    for await (const chunk of streamDemoReply(lastUser, signal)) yield { kind: 'delta', text: chunk }
    return
  }

  let sawContent = false
  const stalled: string[] = []

  for (let i = 0; i < chain.length; i++) {
    const cfg = chain[i]
    let produced = false

    try {
      for await (const delta of streamCompletion(cfg, messages, { signal, maxTokens: 2048, temperature: 0.6 })) {
        if (!produced) {
          produced = true
          sawContent = true
          noteProviderResult(cfg.model, true)
          const gaveWay = stalled.find(model => model !== cfg.model)
          if (gaveWay) {
            yield {
              kind: 'notice',
              text: `${prettyName(gaveWay)} was not responding, so ${prettyName(cfg.model)} answered this one.`,
            }
          }
        }
        yield { kind: 'delta', text: delta }
      }

      if (!produced) {
        // The stream ended without a single content byte. That is flakiness on
        // the provider's streaming route rather than a dead model, so ask the
        // same model once without streaming before moving down the chain.
        console.warn(`[ai] ${cfg.model} streamed no content — retrying without streaming`)
        try {
          const text = await completeOnce(cfg, messages, { signal, maxTokens: 2048, temperature: 0.6 })
          if (text) {
            sawContent = true
            noteProviderResult(cfg.model, true)
            const gaveWay = stalled.find(model => model !== cfg.model)
            if (gaveWay) {
              yield {
                kind: 'notice',
                text: `${prettyName(gaveWay)} was not responding, so ${prettyName(cfg.model)} answered this one.`,
              }
            }
            yield { kind: 'delta', text }
            return
          }
        } catch (err) {
          console.warn(`[ai] ${cfg.model} non-streaming retry failed:`, (err as Error).message)
        }
        stalled.push(cfg.model)
        continue
      }
      return
    } catch (err) {
      if (signal?.aborted) return

      const reason = err instanceof ProviderUnreachableError ? 'stalled' : 'failed'
      console.warn(`[ai] ${cfg.model} ${reason}:`, (err as Error).message)

      if (produced) {
        // Text already reached the student; do not silently restart.
        yield { kind: 'notice', text: '— connection interrupted —' }
        return
      }

      // Nothing came back: bench this model for a while and try the next one.
      stalled.push(cfg.model)
      noteProviderResult(cfg.model, false)
      continue
    }
  }

  if (!sawContent) {
    yield {
      kind: 'notice',
      text: 'My teaching models are not reachable right now — I am answering from my offline study helper. Everything else keeps working.',
    }
    for await (const chunk of streamDemoReply(lastUser, signal)) yield { kind: 'delta', text: chunk }
  }
}
