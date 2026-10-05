import type { CustomEndpoint, TutorMessage } from '@/lib/types'
import type { ProviderConfig } from './provider'

/**
 * A student's own model, treated as a first-class member of the chain.
 *
 * Anything OpenAI-compatible is accepted — OpenAI, OpenRouter, Together, Groq,
 * a university gateway, or a model running on the student's laptop. Two rules
 * make that safe:
 *
 *   • No BODHA tuning is applied. `extraBody` carries provider-specific
 *     arguments (Nemotron's thinking switch, GPT-OSS's effort hint) that other
 *     vendors reject outright, so a custom entry sends a plain request.
 *   • The budget is generous. A model on someone's own machine may take ten
 *     seconds to load and answer, and a 6-second leash would call that broken.
 *
 * The key lives only on the server: this object is built inside an API route
 * from the stored settings and never travels back to the browser.
 */

export const CUSTOM_FIRST_BYTE_MS = Number(process.env.AI_CUSTOM_FIRST_BYTE_MS ?? 20_000)

/**
 * Addresses a student's endpoint may not point at.
 *
 * This feature makes the server fetch a URL the student typed, so it needs the
 * same care as any other outbound proxy: the cloud metadata endpoint and the
 * loopback address are the two that turn a convenience feature into a way to
 * probe the machine it runs on. Private LAN addresses are deliberately allowed —
 * a model on a campus or home server is a legitimate thing to connect.
 */
const BLOCKED_HOSTS = /^(localhost|.*\.localhost|metadata\.google\.internal|0\.0\.0\.0|\[::1\]|::1)$/i
const BLOCKED_ADDRESS = /^(127\.|169\.254\.)/

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/** Returns a reason the endpoint cannot be used, or null when it is fine. */
export function blockedEndpointReason(url: string): string | null {
  // Local development and the test suite point at their own machine on purpose.
  if (process.env.BODHA_ALLOW_LOOPBACK_ENDPOINTS === '1') return null

  const host = hostOf(url)
  if (!host) return 'That endpoint URL could not be read.'
  if (BLOCKED_HOSTS.test(host) || BLOCKED_ADDRESS.test(host)) {
    return 'That address points back at the server itself, which is not allowed. Use the public URL of your endpoint.'
  }
  return null
}

/** Trim a base URL to the shape `{base}/chat/completions` expects. */
export function normalizeBaseUrl(input: string): string {
  let url = input.trim().replace(/\s+/g, '')
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  return url.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '')
}

/** A friendly default label when the student does not give one. */
export function defaultLabel(endpoint: Pick<CustomEndpoint, 'label' | 'model'>): string {
  const label = endpoint.label.trim()
  if (label) return label.slice(0, 32)
  const model = endpoint.model.trim()
  return (model.split('/').pop() || model || 'My model').slice(0, 32)
}

/** Problems a student can actually fix, phrased as such. */
export function validateEndpoint(endpoint: Partial<CustomEndpoint>): string | null {
  const baseUrl = normalizeBaseUrl(endpoint.baseUrl ?? '')
  if (!baseUrl) return 'Add the endpoint URL, for example https://api.openai.com/v1'
  if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(baseUrl) && !/^https?:\/\/localhost(:\d+)?/i.test(baseUrl)) {
    return 'That does not look like a URL. It should start with https://'
  }
  const blocked = blockedEndpointReason(baseUrl)
  if (blocked) return blocked
  if (!endpoint.model?.trim()) return 'Add the model name your endpoint expects, for example gpt-4o-mini'
  if (!endpoint.apiKey?.trim()) return 'Add your API key.'
  return null
}

/** The chain entry for one student's endpoint. */
export function customProviderConfig(endpoint: CustomEndpoint): ProviderConfig {
  return {
    name: 'custom',
    baseUrl: normalizeBaseUrl(endpoint.baseUrl),
    apiKey: endpoint.apiKey,
    model: endpoint.model.trim(),
    thinking: true, // never inject BODHA's provider-specific tuning
    firstByteMs: CUSTOM_FIRST_BYTE_MS,
    label: defaultLabel(endpoint),
  }
}

/**
 * One tiny round trip that proves the endpoint, the key and the model name all
 * work together — run before we save anything, so the student learns about a
 * typo from a message in the form rather than from a failed question.
 */
export async function testEndpoint(
  endpoint: CustomEndpoint,
  timeoutMs = 20_000,
): Promise<{ ok: true; sample: string } | { ok: false; error: string }> {
  const cfg = customProviderConfig(endpoint)
  const messages: TutorMessage[] = [
    { role: 'system', content: 'Reply with the single word: ready' },
    { role: 'user', content: 'ping' },
  ]

  let res: Response
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: cfg.model,
        stream: false,
        max_tokens: 16,
        temperature: 0,
        messages,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    const message = (err as Error).message
    if ((err as Error).name === 'TimeoutError' || /abort/i.test(message)) {
      return { ok: false, error: 'The endpoint did not answer in time. If it is your own machine, make sure it is running and reachable from the internet.' }
    }
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(message)) {
      return {
        ok: false,
        error: 'Could not reach that address. Check the URL is spelled correctly, that the service is running, and that it is reachable from the internet.',
      }
    }
    return { ok: false, error: `That endpoint could not be used — ${message}` }
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    // Vendor errors are unrecognisable raw JSON; say what each one means.
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: `The endpoint rejected the API key (HTTP ${res.status}). Check the key and whether it has access to ${cfg.model}.` }
    }
    if (res.status === 404) {
      return { ok: false, error: `HTTP 404 — the URL is probably wrong. It should be the part before /chat/completions, for example https://api.openai.com/v1` }
    }
    if (res.status === 429) {
      return { ok: false, error: 'The endpoint is rate-limiting this key (HTTP 429). It works, but you may be asked to slow down.' }
    }
    return { ok: false, error: `The endpoint answered HTTP ${res.status}. ${detail.slice(0, 180)}`.trim() }
  }

  const data = (await res.json().catch(() => null)) as
    | { choices?: Array<{ message?: { content?: string | null } }> }
    | null
  const sample = data?.choices?.[0]?.message?.content?.trim() ?? ''
  if (!sample) {
    return { ok: false, error: 'The endpoint answered, but with no text. That usually means the model name is not one it serves.' }
  }
  return { ok: true, sample: sample.slice(0, 60) }
}
