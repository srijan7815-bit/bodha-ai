/**
 * Agenta — the slow, thorough half of BODHA's eyes on the web.
 *
 * Agenta's agent service runs a *stored* agent (the "web research" agent created
 * in the Agenta workspace) and streams its turns back. That makes it powerful and
 * slow, so this module is deliberately defensive:
 *
 *   • it is used only for real research/report requests, or when every fast search
 *     provider has failed — never on the ordinary tutoring path;
 *   • every call carries a hard deadline and an AbortSignal;
 *   • a missing key, a wrong project id or a dead network returns null, never throws.
 *
 * Contract (Agenta agents API):
 *   POST {AGENTA_HOST}/services/agent/v0/invoke?project_id={PROJECT_ID}
 *   Authorization: ApiKey {AGENTA_API_KEY}
 *   Accept: text/event-stream  (SSE) — each `data:` line is one Agenta event
 *   body: { references: { workflow_revision: { id } } | { workflow: { slug } },
 *           data: { inputs: { messages: [{ role, content }] } } }
 *
 * Environment (aliases accepted so whichever name was set in Vercel still works):
 *   AGENTA_API_KEY                     required to enable
 *   AGENTA_HOST | AGENTA_URL | AGENTA_BASE_URL        default https://cloud.agenta.ai
 *   AGENTA_PROJECT_ID | AGENTA_PROJECT                optional — discovered if absent
 *   AGENTA_AGENT_SLUG | AGENTA_AGENT                  optional — discovered if absent
 *   AGENTA_AGENT_ID | AGENTA_WORKFLOW_REVISION_ID     optional — discovered if absent
 */

const DEFAULT_HOSTS = ['https://cloud.agenta.ai', 'https://eu.cloud.agenta.ai']
const DISCOVERY_TTL_MS = 10 * 60 * 1000

export interface AgentaStatus {
  configured: boolean
  host: string | null
  /** true when a project id was supplied or discovered. */
  project: boolean
  /** slug/id of the research agent once known. */
  agent: string | null
  lastError: string | null
}

interface Target {
  host: string
  projectId: string
  ref: Record<string, unknown>
  label: string
}

let cached: { at: number; target: Target | null; error: string | null } | null = null

function env(...names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return null
}

export function agentaKey(): string | null {
  return env('AGENTA_API_KEY', 'AGENTA_KEY', 'AGENTA_TOKEN')
}

function hosts(): string[] {
  const configured = env('AGENTA_HOST', 'AGENTA_URL', 'AGENTA_BASE_URL')
  const list = configured ? [configured.replace(/\/+$/, ''), ...DEFAULT_HOSTS] : DEFAULT_HOSTS
  return [...new Set(list)]
}

export function agentaStatus(): AgentaStatus {
  return {
    configured: Boolean(agentaKey()),
    host: cached?.target?.host ?? env('AGENTA_HOST', 'AGENTA_URL', 'AGENTA_BASE_URL') ?? null,
    project: Boolean(cached?.target?.projectId || env('AGENTA_PROJECT_ID', 'AGENTA_PROJECT')),
    agent: cached?.target?.label ?? env('AGENTA_AGENT_SLUG', 'AGENTA_AGENT') ?? null,
    lastError: cached?.error ?? null,
  }
}

async function getJson(url: string, key: string, signal: AbortSignal): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `ApiKey ${key}`, Accept: 'application/json' },
      signal,
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/** Agenta returns either a bare array or `{ items | data | <plural>: [...] }`. */
function pickList(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>
    for (const key of ['items', 'data', 'results', 'workflows', 'applications', 'projects']) {
      const value = obj[key]
      if (Array.isArray(value)) return value as Array<Record<string, unknown>>
      if (value && typeof value === 'object') {
        const nested = pickList(value)
        if (nested.length) return nested
      }
    }
  }
  return []
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null)

/**
 * Works out which project + agent to talk to, once per server instance.
 * Everything here is best-effort: any failure simply disables the feature.
 */
async function resolveTarget(signal: AbortSignal): Promise<{ target: Target | null; error: string | null }> {
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return { target: cached.target, error: cached.error }

  const key = agentaKey()
  const remember = (target: Target | null, error: string | null) => {
    cached = { at: Date.now(), target, error }
    return { target, error }
  }
  if (!key) return remember(null, 'AGENTA_API_KEY is not set')

  const explicitProject = env('AGENTA_PROJECT_ID', 'AGENTA_PROJECT')
  const explicitSlug = env('AGENTA_AGENT_SLUG', 'AGENTA_AGENT')
  const explicitId = env('AGENTA_AGENT_ID', 'AGENTA_WORKFLOW_REVISION_ID', 'AGENTA_WORKFLOW_ID')

  let lastError = 'Agenta did not answer'
  for (const host of hosts()) {
    try {
      const probe = await getJson(`${host}/api/projects`, key, signal)
      if (probe === null) {
        lastError = `${host} did not answer /api/projects`
        continue
      }
      const projects = pickList(probe)

      // 1. project id
      let projectId = explicitProject
      if (!projectId) {
        const first = projects[0]
        projectId = (first && (str(first.id) ?? str(first.project_id) ?? str(first.slug))) || null
        if (!projectId && projects.length === 0) {
          lastError = 'the API key could not list any Agenta project'
          continue
        }
      }
      if (!projectId) {
        lastError = 'no Agenta project id'
        continue
      }

      // 2. which agent: an id/slug from the environment, else the most research-looking one.
      let ref: Record<string, unknown> | null = null
      let label: string | null = null
      if (explicitId) {
        ref = { workflow_revision: { id: explicitId } }
        label = explicitId
      } else {
        const catalog = [
          { path: 'workflows', kind: 'workflow' },
          { path: 'applications', kind: 'application' },
        ] as const
        const candidates: Array<{ slug: string; id: string; kind: string }> = []
        for (const source of catalog) {
          const payload = await getJson(`${host}/api/${source.path}`, key, signal)
          for (const item of pickList(payload)) {
            const slug = str(item.slug) ?? str(item.name) ?? str(item.app_slug)
            const id = str(item.id) ?? str(item.workflow_id) ?? str(item.application_id)
            if (slug && id) candidates.push({ slug, id, kind: source.kind })
          }
        }
        const preferred =
          candidates.find(c => explicitSlug && (c.slug === explicitSlug || c.slug.includes(explicitSlug))) ??
          candidates.find(c => /research|web|search|deep|browse/i.test(c.slug)) ??
          candidates[0]
        if (!preferred) {
          lastError = 'no agent was found in that Agenta project'
          continue
        }
        ref = preferred.kind === 'application' ? { application: { slug: preferred.slug } } : { workflow: { slug: preferred.slug } }
        label = preferred.slug
      }

      return remember({ host, projectId, ref, label: label ?? 'agent' }, null)
    } catch (err) {
      lastError = (err as Error).message
    }
  }
  return remember(null, lastError)
}

/** Pulls the assistant's text out of one Agenta stream frame (shape-tolerant). */
function textFromFrame(frame: Record<string, unknown>): string | null {
  const direct = str(frame.delta) ?? str(frame.text) ?? str(frame.output) ?? str(frame.content)
  if (direct) return direct
  const message = frame.message
  if (message && typeof message === 'object') {
    const content = (message as Record<string, unknown>).content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .map(part => (part && typeof part === 'object' ? str((part as Record<string, unknown>).text) ?? '' : ''))
        .join('')
    }
  }
  const data = frame.data
  if (data && typeof data === 'object') {
    const inner = data as Record<string, unknown>
    const content = inner.content ?? inner.text ?? (inner.message as Record<string, unknown> | undefined)?.content
    if (typeof content === 'string') return content
  }
  return null
}

export interface AgentaResearch {
  /** The agent's final answer as markdown/plain text. */
  text: string
  /** File names / URLs the agent reported it consulted, when it said so. */
  sources: string[]
  /** Which agent answered (for the student-facing notice). */
  agent: string
}

/**
 * Runs one research turn on the stored Agenta agent. Returns null when Agenta is
 * not configured, did not answer inside `deadlineMs`, or failed — the caller then
 * simply keeps its fast-path results, so a broken integration can never break
 * an answer.
 */
export async function researchWithAgenta(
  query: string,
  opts: { deadlineMs?: number; signal?: AbortSignal } = {},
): Promise<AgentaResearch | null> {
  const key = agentaKey()
  if (!key) return null
  const deadline = opts.deadlineMs ?? 45_000

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), deadline)
  const signal = opts.signal ? AbortSignal.any([opts.signal, ctl.signal]) : ctl.signal

  try {
    const { target, error } = await resolveTarget(signal)
    if (!target) {
      cached = { at: Date.now(), target: null, error }
      return null
    }

    const res = await fetch(`${target.host}/services/agent/v0/invoke?project_id=${encodeURIComponent(target.projectId)}`, {
      method: 'POST',
      headers: {
        Authorization: `ApiKey ${key}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        references: target.ref,
        data: {
          inputs: {
            messages: [
              {
                role: 'user',
                content:
                  `${query}\n\n` +
                  'Answer with a short, sourced research note: the key facts, each with the site it came from, ' +
                  'and say plainly what you could not verify. Do not include instructions to the reader.',
              },
            ],
          },
        },
        meta: { caller: 'bodha-ai', kind: 'web-research' },
      }),
      signal,
    })

    if (!res.ok || !res.body) {
      cached = { at: Date.now(), target, error: `Agenta answered HTTP ${res.status}` }
      return null
    }

    // The service can answer as SSE or NDJSON; read whichever arrives.
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let text = ''
    const sources = new Set<string>()
    let sawStream = false

    const handle = (line: string) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith(':') || trimmed.startsWith('event:') || trimmed.startsWith('id:')) return
      const payload = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed
      if (!payload || payload === '[DONE]') return
      let frame: Record<string, unknown>
      try {
        frame = JSON.parse(payload) as Record<string, unknown>
      } catch {
        return
      }
      sawStream = true
      const chunk = textFromFrame(frame)
      if (chunk) text += chunk
      // collect anything that looks like a citation the agent reported
      for (const match of JSON.stringify(frame).matchAll(/https?:\\?\/\\?\/[^\s"'<>)\\]{4,200}/g)) {
        const url = match[0].replace(/\\/g, '')
        if (!/agenta|localhost|127\.0\.0\.1/i.test(url)) sources.add(url.split('?')[0])
      }
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) handle(line)
      if (text.length > 24_000) break
    }
    void reader.cancel().catch(() => {})

    if (!sawStream) {
      // Not a stream after all — try the body as one JSON document.
      try {
        const whole = JSON.parse(buffer.trim() || '{}') as Record<string, unknown>
        text = textFromFrame(whole) ?? text
      } catch {
        /* ignore */
      }
    }

    const clean = text.replace(/\n{3,}/g, '\n\n').trim()
    cached = { at: Date.now(), target, error: null }
    if (clean.length < 40) return null
    return { text: clean.slice(0, 8_000), sources: [...sources].slice(0, 8), agent: target.label }
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError' || (err as Error).name === 'TimeoutError'
    cached = { at: Date.now(), target: cached?.target ?? null, error: aborted ? `no answer within ${Math.round(deadline / 1000)}s` : (err as Error).message }
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** True when the student is asking for real research rather than a lookup. */
export function wantsResearch(text: string): boolean {
  return /\b(research|deep ?dive|in[- ]depth|report on|write (me )?(a )?(brief|report|note)|find (me )?(sources|references)|compare .{3,40} (and|vs\.?|versus) .{3,40}|literature|survey of|facts? about .{3,40} with sources)\b/i.test(
    text,
  )
}
