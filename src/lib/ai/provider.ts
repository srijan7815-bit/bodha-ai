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

  // Fallback: custom OpenAI-compatible
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
 * The NIM endpoint requires stream:true for Kimi models.
 */
export async function* streamCompletion(
  cfg: ProviderConfig,
  messages: TutorMessage[],
  opts: { maxTokens?: number; temperature?: number; signal?: AbortSignal } = {},
): AsyncGenerator<string> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    stream: true,
    temperature: opts.temperature ?? 0.6,
    top_p: 0.95,
    max_tokens: opts.maxTokens ?? 2048,
    messages,
  }

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal: opts.signal ?? AbortSignal.timeout(120_000),
  })

  if (!res.ok || !res.body) {
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 300)
    } catch {}
    throw new Error(`AI provider error (HTTP ${res.status}) ${detail}`.trim())
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

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
        // partial/malformed frame — next read completes it
      }
    }
  }
}

export function aiStatus(): { provider: string; model: string } {
  const cfg = getProviderConfig()
  if (cfg) return { provider: cfg.name, model: cfg.model }
  return { provider: 'demo', model: 'demo-tutor' }
}