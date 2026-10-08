import type { TutorMessage } from '@/lib/types'

/**
 * Model access — NVIDIA NIM (OpenAI-compatible).
 *
 * Primary is whatever AI_MODEL says (z-ai/glm-5.3), but a hosted model can be
 * entitled and still never produce a first byte, so the app walks a short chain
 * of models instead of leaving the student staring at a spinner. The first
 * model that starts streaming wins; the chain is env-configurable.
 */

export interface ProviderConfig {
  /** BODHA's own NIM route, or the student's OpenAI-compatible endpoint. */
  name: 'nvidia' | 'custom'
  baseUrl: string
  apiKey: string
  model: string
  thinking: boolean
  /** First-byte budget for this entry in the chain. */
  firstByteMs: number
  /** Provider-specific request tweaks (e.g. turn a model's thinking off). */
  extraBody?: Record<string, unknown>
  /** How the entry is described to the student in a notice or the model toggle. */
  label?: string
}

/**
 * The identity used for benching and logging.
 *
 * A custom endpoint is keyed separately from BODHA's models: a student's own
 * "gpt-4o-mini" must never inherit the health of a model we serve with the
 * same name, in either direction.
 */
export function providerKey(cfg: ProviderConfig): string {
  return cfg.name === 'custom' ? `custom:${cfg.model}` : cfg.model
}

export class ProviderUnreachableError extends Error {
  constructor(public readonly detail: string) {
    super(`Provider unreachable: ${detail}`)
    this.name = 'ProviderUnreachableError'
  }
}

export const DEFAULT_MODEL = 'moonshotai/kimi-k2.6'

/** Fast, reliable models to fall back on when the primary stalls. */
export const DEFAULT_FALLBACKS = ['z-ai/glm-5.3-flash', 'nvidia/nemotron-3-super-120b-a12b', 'openai/gpt-oss-20b']

const DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1'

function apiKey(): string | null {
  return process.env.NVIDIA_API_KEY?.trim() || process.env.AI_API_KEY?.trim() || null
}

function baseUrl(): string {
  return (process.env.AI_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '')
}

/**
 * Per-model request tuning.
 *
 * The Nemotron family streams a private reasoning trace before its answer; with
 * a normal token budget that trace can swallow the whole answer and the student
 * gets an empty bubble. Asking it not to think out loud makes it faster (under
 * a second) and reliable. GPT-OSS gets the equivalent low-effort hint.
 */
function tuneFor(model: string, thinking: boolean): Record<string, unknown> | undefined {
  if (thinking) return undefined
  if (/nemotron/i.test(model)) return { chat_template_kwargs: { enable_thinking: false } }
  if (/gpt-oss/i.test(model)) return { reasoning_effort: 'low' }
  if (/kimi-k(2\.[5-9]|3)/i.test(model)) return { chat_template_kwargs: { thinking: false } }
  return undefined
}

/**
 * A model that accepts the request and then never speaks (a wedged route, a
 * cold deployment) should not cost the student ten seconds on every message.
 * We remember which models stalled and step them to the back of the chain for
 * a while — still wired in, still retried, just not in the way.
 */
const DEMOTE_MS = 10 * 60 * 1000
const demoted = new Map<string, number>()

export function noteProviderResult(model: string, ok: boolean) {
  if (ok) {
    demoted.delete(model)
    return
  }
  demoted.set(model, Date.now() + DEMOTE_MS)
}

/**
 * Repairs made by the watchdog: models it has taken out of rotation after
 * repeated failed checks, and one it has moved to the front. Always applied on
 * top of the configured chain, never instead of it.
 */
let overrides: { disabled: string[]; primary: string | null } = { disabled: [], primary: null }

export function setChainOverrides(next: { disabled: string[]; primary: string | null }) {
  overrides = next
}

/** Every model the chain is configured with, in configured order. */
export function configuredModels(): string[] {
  const primary = process.env.AI_MODEL?.trim() || DEFAULT_MODEL
  const fromEnv = process.env.AI_MODEL_FALLBACKS?.split(',')
    .map(s => s.trim())
    .filter(Boolean)
  return [primary, ...(fromEnv?.length ? fromEnv : DEFAULT_FALLBACKS).filter(m => m !== primary)]
}

/** A ready-to-call config for any one model (used by health probes). */
export function configFor(model: string): ProviderConfig | null {
  const key = apiKey()
  if (!key) return null
  const thinking = process.env.AI_THINKING === 'true'
  return { name: 'nvidia' as const, baseUrl: baseUrl(), apiKey: key, model, thinking, firstByteMs: 8_000, extraBody: tuneFor(model, thinking) }
}

export function providerHealth(): Array<{ model: string; state: 'ready' | 'benched' }> {
  const now = Date.now()
  return getProviderChain().map(cfg => ({
    model: cfg.model,
    state: (demoted.get(cfg.model) ?? 0) > now ? 'benched' : 'ready',
  }))
}

/**
 * The ordered list of models to try. The primary gets a patient budget (a large
 * model can take a while to warm up); the fallbacks get a short leash so the
 * student never waits long. Models benched by a recent stall move to the back.
 */
export function getProviderChain(opts: { live?: boolean } = {}): ProviderConfig[] {
  const key = apiKey()
  if (!key) return []

  const primary = process.env.AI_MODEL?.trim() || DEFAULT_MODEL
  const fromEnv = process.env.AI_MODEL_FALLBACKS?.split(',')
    .map(s => s.trim())
    .filter(Boolean)
  const fallbacks = fromEnv?.length ? fromEnv : DEFAULT_FALLBACKS

  const thinking = process.env.AI_THINKING === 'true'
  let models = [primary, ...fallbacks.filter(m => m !== primary)]

  // Apply the watchdog's repairs — but never leave the chain empty.
  const usable = models.filter(m => !overrides.disabled.includes(m))
  if (usable.length) models = usable
  if (overrides.primary && models.includes(overrides.primary)) {
    models = [overrides.primary, ...models.filter(m => m !== overrides.primary)]
  }

  // Live Mode is a conversation: the quick model goes first so the first
  // sentence arrives fast; the smarter ones stay behind it as fallbacks.
  if (opts.live) {
    const quick = process.env.AI_LIVE_MODEL?.trim() || 'z-ai/glm-5.3-flash'
    if (models.includes(quick)) models = [quick, ...models.filter(m => m !== quick)]
  }

  // Benched models keep their relative order, but wait behind the healthy ones.
  const now = Date.now()
  const ordered = [
    ...models.filter(m => (demoted.get(m) ?? 0) <= now),
    ...models.filter(m => (demoted.get(m) ?? 0) > now),
  ]

  return ordered.map((model, index) => ({
    name: 'nvidia' as const,
    baseUrl: baseUrl(),
    apiKey: key,
    model,
    thinking,
    firstByteMs: index === 0 ? Number(process.env.AI_FIRST_BYTE_MS ?? 6_000) : 5_000,
    extraBody: tuneFor(model, thinking),
  }))
}

/** Back-compat: the first entry of the chain. */
export function getProviderConfig(): ProviderConfig | null {
  return getProviderChain()[0] ?? null
}

/**
 * One non-streaming completion.
 *
 * NVIDIA's streaming route occasionally ends a turn with zero content bytes
 * (more often under load) while the same model answers the same prompt
 * normally in a plain request. So when a stream comes back empty, BODHA asks
 * once more without streaming before moving on — it is a different code path on
 * the provider's side, and it usually just works.
 */
export async function completeOnce(
  cfg: ProviderConfig,
  messages: TutorMessage[],
  opts: { maxTokens?: number; temperature?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    stream: false,
    temperature: opts.temperature ?? 0.6,
    top_p: 0.95,
    max_tokens: opts.maxTokens ?? 2048,
    messages,
    ...(cfg.extraBody ?? {}),
  }

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: opts.signal ?? AbortSignal.timeout(25_000),
  })

  if (!res.ok) throw new Error(`${cfg.model} → HTTP ${res.status}`)

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>
  }
  return (data.choices?.[0]?.message?.content ?? '').trim()
}

/**
 * Streams assistant text deltas.
 *
 * Fails fast with ProviderUnreachableError when the endpoint accepts the
 * connection but sends no first byte within `firstByteMs` — that is precisely
 * how a wedged model route behaves, and it is what lets the chain move on.
 */
export async function* streamCompletion(
  cfg: ProviderConfig,
  messages: TutorMessage[],
  opts: { maxTokens?: number; temperature?: number; signal?: AbortSignal; firstByteMs?: number } = {},
): AsyncGenerator<string> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    stream: true,
    temperature: opts.temperature ?? 0.6,
    top_p: 0.95,
    max_tokens: opts.maxTokens ?? 2048,
    messages,
    ...(cfg.extraBody ?? {}),
  }

  const timeoutCtl = new AbortController()
  const firstByteMs = opts.firstByteMs ?? cfg.firstByteMs
  // "First byte" means the first *content* byte, not the response headers. A
  // wedged model answers 200 immediately and then says nothing, so a timer
  // cleared on headers would leave the student waiting on a dead route.
  let gotContent = false
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null

  const timer = setTimeout(() => {
    if (!gotContent) timeoutCtl.abort()
  }, firstByteMs)
  const onAbort = () => timeoutCtl.abort()
  opts.signal?.addEventListener('abort', onAbort, { once: true })

  const cleanup = () => {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
    try {
      reader?.cancel()
    } catch {}
  }

  let res: Response
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal: timeoutCtl.signal,
    })
  } catch (err) {
    cleanup()
    const aborted = (err as Error).name === 'AbortError'
    throw new ProviderUnreachableError(
      aborted ? `no first byte within ${Math.round(firstByteMs / 1000)}s` : (err as Error).message,
    )
  }

  if (!res.ok || !res.body) {
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 240)
    } catch {}
    cleanup()
    throw new Error(`${cfg.model} → HTTP ${res.status} ${detail}`.trim())
  }

  // The timer deliberately keeps running until the first content delta lands.
  reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (!payload || payload === '[DONE]') continue

        let json: { choices?: Array<{ delta?: { content?: string | null; reasoning_content?: string | null } }> }
        try {
          json = JSON.parse(payload)
        } catch {
          continue
        }

        // Reasoning traces are never shown to the student.
        const delta = json.choices?.[0]?.delta
        const text = delta?.content
        if (typeof text === 'string' && text.length) {
          if (!gotContent) {
            gotContent = true
            clearTimeout(timer)
          }
          yield text
        }
      }
    }
  } catch (err) {
    // An abort here means the model went quiet before saying anything.
    if ((err as Error).name === 'AbortError' && !gotContent) {
      throw new ProviderUnreachableError(`no content within ${Math.round(firstByteMs / 1000)}s`)
    }
    throw err
  } finally {
    cleanup()
    try {
      reader.releaseLock()
    } catch {}
  }
}
