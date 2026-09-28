import type { TutorMessage } from '@/lib/types'

/**
 * Streaming chat completion against NVIDIA NIM (build.nvidia.com).
 * Primary model: moonshotai/kimi-k3
 */

export interface ProviderConfig {
  name: 'nvidia'
  baseUrl: string
  apiKey: string
  model: string
  thinking: boolean
}

/** Thrown when the provider never sends the first byte (routing trouble). */
export class ProviderUnreachableError extends Error {
  constructor(public readonly detail: string) {
    super(`Provider unreachable: ${detail}`)
    this.name = 'ProviderUnreachableError'
  }
}

export function getProviderConfig(): ProviderConfig | null {
  const env = process.env

  // Primary: NVIDIA NIM with moonshotai/kimi-k3
  if (env.NVIDIA_API_KEY?.trim()) {
    return {
      name: 'nvidia',
      baseUrl: env.AI_BASE_URL?.trim() || 'https://integrate.api.nvidia.com/v1',
      apiKey: env.NVIDIA_API_KEY.trim(),
      model: env.AI_MODEL?.trim() || 'moonshotai/kimi-k3',
      thinking: env.AI_THINKING === 'true',
    }
  }

  // Fallback: custom OpenAI-compatible endpoint
  const customKey = env.AI_API_KEY?.trim()
  if (customKey) {
    return {
      name: 'nvidia',
      baseUrl: env.AI_BASE_URL?.trim() || 'https://integrate.api.nvidia.com/v1',
      apiKey: customKey,
      model: env.AI_MODEL?.trim() || 'moonshotai/kimi-k3',
      thinking: env.AI_THINKING === 'true',
    }
  }

  return null
}

/**
 * Streams assistant text deltas from NVIDIA NIM.
 *
 * Fails fast with ProviderUnreachableError when the endpoint accepts the
 * connection but produces no first byte within `firstByteMs` — this keeps a
 * wedged model route from hanging the whole chat request.
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
  const firstByteMs = opts.firstByteMs ?? 30_000
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
    throw new ProviderUnreachableError(err instanceof Error ? err.message : 'connection failed')
  }

  if (!res.ok || !res.body) {
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 300)
    } catch {}
    cleanup()
    throw new Error(`AI provider error (HTTP ${res.status}) ${detail}`.trim())
  }
  gotFirstByte = true
  // Once streaming has started, stop the first-byte timer.
  clearTimeout(timer)

  reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const json = JSON.parse(payload)
          const delta = json.choices?.[0]?.delta
          if (delta?.content) yield delta.content as string
        } catch {
          // partial/malformed frame — the next read completes it
        }
      }
    }
  } finally {
    cleanup()
  }
}

export function aiStatus(): { provider: string; model: string } {
  const cfg = getProviderConfig()
  if (cfg) return { provider: cfg.name, model: cfg.model }
  return { provider: 'demo', model: 'demo-tutor' }
}
