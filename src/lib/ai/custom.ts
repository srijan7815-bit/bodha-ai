import type { CustomEndpoint, CustomModel, TutorMessage } from '@/lib/types'
import type { ProviderConfig } from './provider'

/**
 * A student's own model, treated as a first-class member of the chain.
 *
 * Anything OpenAI-compatible is accepted — OpenAI, OpenRouter, Together, Groq,
 * a university gateway, or a model running on the student's laptop. Three rules
 * make that safe:
 *
 *   • No BODHA tuning is applied. `extraBody` carries provider-specific
 *     arguments (Nemotron's thinking switch, GPT-OSS's effort hint) that other
 *     vendors reject outright, so a custom entry sends a plain request.
 *   • The budget is generous. A model on someone's own machine may take ten
 *     seconds to load and answer, and a 6-second leash would call that broken.
 *   • The key lives only on the server: this object is built inside an API route
 *     from the stored settings and never travels back to the browser.
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
  let url = String(input ?? '').trim().replace(/\s+/g, '')
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  // A student will paste a full endpoint URL; take the part before the verb.
  return url
    .replace(/\/+$/, '')
    .replace(/\/(chat\/completions|models|completions|embeddings)$/i, '')
}

/** A friendly name for a model when the student does not give one. */
export function defaultModelLabel(id: string): string {
  const raw = id.trim()
  if (!raw) return 'My model'
  // `anthropic/claude-sonnet-4-5-20250929` reads better as `claude-sonnet-4-5`.
  const tail = raw.split('/').pop() || raw
  return tail.replace(/-\d{8}$/, '').slice(0, 32)
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

  const models = endpoint.models ?? []
  if (!models.length) return 'Add at least one model — the name your provider expects in the `model` field.'
  if (models.some(model => !model.id.trim())) return 'Every model needs an id — the exact name your provider expects.'
  return null
}

/** Clean up whatever the form sent before it is stored. */
export function normalizeEndpoint(input: Partial<CustomEndpoint>): CustomEndpoint {
  const models: CustomModel[] = []
  for (const entry of input.models ?? []) {
    const id = String(entry?.id ?? '').trim()
    if (!id) continue
    const label = String(entry?.label ?? '').trim() || defaultModelLabel(id)
    if (models.some(model => model.id === id)) continue // one entry per model id
    models.push({ id, label: label.slice(0, 32) })
  }
  return {
    baseUrl: normalizeBaseUrl(input.baseUrl ?? ''),
    apiKey: String(input.apiKey ?? '').trim(),
    models,
    verified: input.verified === true,
    verifiedAt: input.verifiedAt,
  }
}

/** The chain entry for one model on a student's endpoint. */
export function customProviderConfig(endpoint: CustomEndpoint, model: CustomModel): ProviderConfig {
  return {
    name: 'custom',
    baseUrl: normalizeBaseUrl(endpoint.baseUrl),
    apiKey: endpoint.apiKey,
    model: model.id.trim(),
    thinking: true, // never inject BODHA's provider-specific tuning
    firstByteMs: CUSTOM_FIRST_BYTE_MS,
    label: model.label.trim() || defaultModelLabel(model.id),
  }
}

/* ─── Talking to the endpoint ─────────────────────────────────────────────── */

function headersFor(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  // Self-hosted endpoints (Ollama, LM Studio, vLLM) usually want no key at all,
  // so an empty one sends no header rather than an empty one.
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return headers
}

/** Turn a fetch failure into something a student can act on. */
function describeNetworkFailure(err: unknown, timeoutMs: number): string {
  const message = (err as Error)?.message ?? ''
  const name = (err as Error)?.name ?? ''
  if (name === 'TimeoutError' || /abort|timed? ?out/i.test(message)) {
    return `The service accepted the connection but sent nothing back within ${Math.round(timeoutMs / 1000)} seconds. That usually means the provider is down, or that it refuses requests from datacenter servers — a server-side app like BODHA cannot call it even when the same URL works in your browser.`
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) {
    return 'That host name could not be found. Check the address is spelled correctly.'
  }
  if (/ECONNREFUSED|ECONNRESET|fetch failed|network/i.test(message)) {
    return 'Could not reach that address. Check the URL is spelled correctly, that the service is running, and that it is reachable from the internet.'
  }
  return `That endpoint could not be used — ${message}`
}

/**
 * Recognise a request that never reached the provider at all.
 *
 * Cloudflare and friends sit in front of a lot of API providers and refuse
 * traffic from datacenter IPs — which every hosted app is. Their blocks look
 * nothing like an API error, and telling a student "check your key" when the
 * firewall is the problem sends them hunting for a bug that is not theirs.
 */
function describeFirewallBlock(res: Response, body: string): string | null {
  const server = (res.headers.get('server') ?? '').toLowerCase()
  const text = body.toLowerCase()
  const looksLikeCloudflare =
    server.includes('cloudflare') ||
    res.headers.has('cf-ray') ||
    text.includes('error code: 1010') ||
    text.includes('attention required') ||
    text.includes('just a moment') ||
    text.includes('cf-error-details')
  if (!looksLikeCloudflare) return null

  const code = /error code:\s*(\d{3,4})/i.exec(body)?.[1]
  return `The provider's firewall refused this request before it reached the API${code ? ` (error code ${code})` : ''}. This usually means the service blocks requests from datacenter servers — BODHA runs on one, so it cannot call this provider even though the same URL may work from your own computer. Saving it anyway is allowed: BODHA will keep trying, and fall back to its own models while it cannot connect.`
}

export interface ModelTestResult {
  id: string
  ok: boolean
  /** The model's own words, shown to the student as proof it really answered. */
  sample?: string
  error?: string
}

/**
 * One tiny round trip that proves the endpoint, the key and the model name all
 * work together — run before saving, so a typo is caught in the form rather
 * than surfacing later as a failed question.
 */
export async function testModel(
  endpoint: CustomEndpoint,
  model: CustomModel,
  timeoutMs = 12_000,
): Promise<ModelTestResult> {
  const cfg = customProviderConfig(endpoint, model)
  const messages: TutorMessage[] = [
    { role: 'system', content: 'Reply with the single word: ready' },
    { role: 'user', content: 'ping' },
  ]

  let res: Response
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { ...headersFor(cfg.apiKey), Accept: 'application/json' },
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
    return { id: model.id, ok: false, error: describeNetworkFailure(err, timeoutMs) }
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300)
    // Vendor errors are unrecognisable raw JSON; say what each one means.
    if (res.status === 401 || res.status === 403) {
      // A 401/403 has two very different causes and they need different fixes,
      // so look at who replied: a firewall in front of the provider answers in
      // its own words, and blocks servers rather than keys.
      const firewall = describeFirewallBlock(res, detail)
      if (firewall) return { id: model.id, ok: false, error: firewall }
      return {
        id: model.id,
        ok: false,
        error: `The endpoint refused this request (HTTP ${res.status}).${detail ? ` It said: “${detail.slice(0, 160)}”.` : ''} Check the key, and whether it may use ${model.id}.`,
      }
    }
    if (res.status === 404) {
      return { id: model.id, ok: false, error: `HTTP 404 — either the URL is wrong (it should be the part before /chat/completions, e.g. https://api.openai.com/v1) or the endpoint does not serve the model “${model.id}”.` }
    }
    if (res.status === 429) {
      return { id: model.id, ok: false, error: 'The endpoint is rate-limiting this key (HTTP 429). The details are right, but it may ask you to slow down.' }
    }
    return { id: model.id, ok: false, error: `The endpoint answered HTTP ${res.status}. ${detail.slice(0, 180)}`.trim() }
  }

  const data = (await res.json().catch(() => null)) as
    | { choices?: Array<{ message?: { content?: string | null; reasoning_content?: string | null } }> }
    | null
  const choice = data?.choices?.[0]?.message
  const sample = (choice?.content || choice?.reasoning_content || '').trim()
  if (!sample) {
    return { id: model.id, ok: false, error: 'The endpoint answered, but with no text — usually a sign that the model name is not one it serves.' }
  }
  return { id: model.id, ok: true, sample: sample.slice(0, 60) }
}

/** Test every model on an endpoint at once, so the form waits once, not N times. */
export async function testEndpointModels(
  endpoint: CustomEndpoint,
  timeoutMs = 12_000,
): Promise<ModelTestResult[]> {
  return Promise.all(endpoint.models.map(model => testModel(endpoint, model, timeoutMs)))
}

/**
 * Ask the endpoint what it serves, so the student can pick names instead of
 * typing them. Best effort by design: plenty of OpenAI-compatible servers have
 * no `/models` route at all, and that is not an error — it just means the list
 * has to be typed.
 */
export async function listEndpointModels(
  endpoint: Pick<CustomEndpoint, 'baseUrl' | 'apiKey'>,
): Promise<{ ok: true; models: CustomModel[] } | { ok: false; error: string }> {
  const baseUrl = normalizeBaseUrl(endpoint.baseUrl)
  if (!baseUrl) return { ok: false, error: 'Add the endpoint URL first.' }

  const blocked = blockedEndpointReason(baseUrl)
  if (blocked) return { ok: false, error: blocked }

  let res: Response
  try {
    res = await fetch(`${baseUrl}/models`, {
      headers: endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {},
      signal: AbortSignal.timeout(12_000),
    })
  } catch (err) {
    return { ok: false, error: describeNetworkFailure(err, 12_000) }
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      const detail = (await res.text().catch(() => '')).slice(0, 300)
      const firewall = describeFirewallBlock(res, detail)
      if (firewall) return { ok: false, error: firewall }
      return { ok: false, error: `The endpoint would not list its models without a valid key (HTTP ${res.status}).` }
    }
    return { ok: false, error: `This endpoint does not list its models (HTTP ${res.status}). Type the model name instead — it is the exact string your provider documents.` }
  }

  const data = (await res.json().catch(() => null)) as
    | { data?: Array<{ id?: string; name?: string }>; models?: Array<{ id?: string; name?: string }> }
    | null
  const raw = data?.data ?? data?.models ?? []
  const models: CustomModel[] = []
  for (const entry of raw) {
    const id = String(entry?.id ?? entry?.name ?? '').trim()
    if (!id || models.some(model => model.id === id)) continue
    models.push({ id, label: defaultModelLabel(id) })
  }
  if (!models.length) return { ok: false, error: 'The endpoint answered, but listed no models.' }
  return { ok: true, models }
}
