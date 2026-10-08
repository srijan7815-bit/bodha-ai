import { syncSystemState } from './system-state'
import type { DocumentRecord, Message, TutorMessage } from '@/lib/types'
import { buildSystemMessages } from './prompt'
import {
  completeOnce,
  getProviderChain,
  noteProviderResult,
  providerKey,
  streamCompletion,
  ProviderUnreachableError,
  DEFAULT_MODEL,
  type ProviderConfig,
} from './provider'
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
  /**
   * Extra entries to try BEFORE BODHA's own models — the student's own
   * endpoint, when they have turned it on. If it fails we still answer, but we
   * say which model did, so nobody wonders why their model sounded different.
   */
  preferred?: ProviderConfig[]
  /** Retrieved passages from the IKS shelf, already formatted for the prompt. */
  iksContext?: string | null
  /** The answer will be spoken in Live Mode: shorter, no Markdown. */
  live?: boolean
}

const PRETTY: Record<string, string> = {
  'z-ai/glm-5.3': 'GLM 5.3',
  'z-ai/glm-5.3-flash': 'GLM 5.3 Flash',
  'nvidia/nemotron-3-super-120b-a12b': 'Nemotron 3 Super',
  'openai/gpt-oss-20b': 'GPT-OSS 20B',
  'moonshotai/kimi-k3': 'Kimi K3',
  'moonshotai/kimi-k2.6': 'Kimi K2.6',
}

function prettyName(cfg: ProviderConfig | string) {
  if (typeof cfg !== 'string' && cfg.label) return cfg.label
  const model = typeof cfg === 'string' ? cfg : cfg.model
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
  // Pick up any repairs the watchdog has made to the model chain.
  await syncSystemState()
  const messages: TutorMessage[] = buildSystemMessages({
    documentTitle: ctx.document?.title,
    documentText: ctx.document?.textContent,
    iksContext: ctx.iksContext,
    live: ctx.live,
  })

  const recent = ctx.history.slice(-HISTORY_LIMIT)
  for (const m of recent) {
    messages.push({ role: m.role, content: m.content })
  }

  const lastUser = [...recent].reverse().find(m => m.role === 'user')?.content ?? ''

  // Their model first when they asked for it, then ours as a safety net: a
  // student whose own endpoint is down should still get a lesson, not an error.
  const own = getProviderChain({ live: ctx.live })
  const preferred = ctx.preferred ?? []
  const chain = [...preferred, ...own.filter(bodha => !preferred.some(p => providerKey(p) === providerKey(bodha)))]

  if (!chain.length) {
    yield { kind: 'notice', text: 'No AI provider is configured, so I am answering from my offline study helper.' }
    for await (const chunk of streamDemoReply(lastUser, signal)) yield { kind: 'delta', text: chunk }
    return
  }

  let sawContent = false
  // Models that had to give way, remembered by their identity *and* by the name
  // the student knows them by — a custom endpoint should be named in the notice
  // the way they named it, not by its internal key.
  const stalled: Array<{ key: string; label: string }> = []

  for (let i = 0; i < chain.length; i++) {
    const cfg = chain[i]
    let produced = false

    try {
      for await (const delta of streamCompletion(cfg, messages, { signal, maxTokens: ctx.live ? 450 : 2048, temperature: 0.6 })) {
        if (!produced) {
          produced = true
          sawContent = true
          noteProviderResult(providerKey(cfg), true)
          const gaveWay = stalled.find(entry => entry.key !== providerKey(cfg))
          if (gaveWay) {
            yield {
              kind: 'notice',
              text: `${gaveWay.label} was not responding, so ${prettyName(cfg)} answered this one.`,
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
          const text = await completeOnce(cfg, messages, { signal, maxTokens: ctx.live ? 450 : 2048, temperature: 0.6 })
          if (text) {
            sawContent = true
            noteProviderResult(providerKey(cfg), true)
            const gaveWay = stalled.find(entry => entry.key !== providerKey(cfg))
            if (gaveWay) {
              yield {
                kind: 'notice',
                text: `${gaveWay.label} was not responding, so ${prettyName(cfg)} answered this one.`,
              }
            }
            yield { kind: 'delta', text }
            return
          }
        } catch (err) {
          console.warn(`[ai] ${cfg.model} non-streaming retry failed:`, (err as Error).message)
        }
        stalled.push({ key: providerKey(cfg), label: prettyName(cfg) })
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
      // A student's own endpoint is never benched — only its own health matters
      // to them, and they can see the result in the settings test.
      stalled.push({ key: providerKey(cfg), label: prettyName(cfg) })
      if (cfg.name !== 'custom') noteProviderResult(providerKey(cfg), false)
      continue
    }
  }

  if (!sawContent) {
    yield {
      kind: 'notice',
      text: preferred.length
        ? 'Neither your endpoint nor my own models are answering right now, so I am answering from my offline study helper.'
        : 'My teaching models are not reachable right now — I am answering from my offline study helper. Everything else keeps working.',
    }
    for await (const chunk of streamDemoReply(lastUser, signal)) yield { kind: 'delta', text: chunk }
  }
}
