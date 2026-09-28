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
  name: 'nvidia'
  baseUrl: string
  apiKey: string
  model: string
  thinking: boolean
  /** First-byte budget for this entry in the chain. */
  firstByteMs: number
}

export class ProviderUnreachableError extends Error {
  constructor(public readonly detail: string) {
    super(`Provider unreachable: ${detail}`)
    this.name = 'ProviderUnreachableError'
  }
}

export const DEFAULT_MODEL = 'z-ai/glm-5.3'

/** Fast, reliable models to fall back on when the primary stalls. */
export const DEFAULT_FALLBACKS = ['nvidia/nemotron-3-super-120b-a12b', 'openai/gpt-oss-20b']

const DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1'

function apiKey(): string | null {
  return process.env.NVIDIA_API_KEY?.trim() || process.env.AI_API_KEY?.trim() || null
}

function baseUrl(): string {
  return (process.env.AI_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '')
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
export function getProviderChain(): ProviderConfig[] {
  const key = apiKey()
  if (!key) return []

  const primary = process.env.AI_MODEL?.trim() || DEFAULT_MODEL
  const fromEnv = process.env.AI_MODEL_FALLBACKS?.split(',')
    .map(s => s.trim())
    .filter(Boolean)
  const fallbacks = fromEnv?.length ? fromEnv : DEFAULT_FALLBACKS

  const thinking = process.env.AI_THINKING === 'true'
  const models = [primary, ...fallbacks.filter(m => m !== primary)]

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
    firstByteMs: index === 0 ? Number(process.env.AI_FIRST_BYTE_MS ?? 12_000) : 9_000,
  }))
}

/** Back-compat: the first entry of the chain. */
export function getProviderConfig(): ProviderConfig | null {
  return getProviderChain()[0] ?? null
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
  }

  const timeoutCtl = new AbortController()
  const firstByteMs = opts.firstByteMs ?? cfg.firstByteMs
  let gotFirstByte = false
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null

  const timer = setTimeout(() => {
    if (!gotFirstByte) timeoutCtl.abort()
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

  gotFirstByte = true
  clearTimeout(timer)

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
        if (typeof text === 'string' && text.length) yield text
      }
    }
  } finally {
    cleanup()
    try {
      reader.releaseLock()
    } catch {}
  }
}
