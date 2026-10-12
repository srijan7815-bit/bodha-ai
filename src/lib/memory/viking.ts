/**
 * OpenViking — BODHA's long-term memory.
 *
 * OpenViking (volcengine/OpenViking) is a "context database" for agents: memory,
 * resources and skills live in one `viking://` filesystem with L0 abstracts, L1
 * overviews and L2 detail. BODHA uses the memory half only, and uses it the way a
 * tutor should: a few durable facts about the student (what they are studying, how
 * they like to be taught, what they got stuck on) recalled into the prompt, and the
 * conversation's lessons written back afterwards.
 *
 * Two rules shape this module:
 *   1. **Never slow the answer down.** Recall has a hard deadline and runs in
 *      parallel with the reads the chat route already does; the write-back happens
 *      after the response has been sent (`after()`), so the student waits for nothing.
 *   2. **Never break the answer.** Every call fails open — no server, no key, a 500,
 *      a timeout: the tutor simply answers without memories.
 *
 * Written against the documented HTTP API (same contract the official
 * `@openviking/sdk` uses) so BODHA takes on no new runtime dependency:
 *   POST /api/v1/search/find      { query, target_uri, limit, score_threshold? }
 *   POST /api/v1/content/write    { uri, content, mode: 'replace' | 'append' }
 *   GET  /api/v1/fs/ls?uri=…      directory listing
 *   headers: X-API-Key: <key>
 */

const DEFAULT_HOSTED = 'https://api.vikingdb.cn-beijing.volces.com/openviking'
const DEFAULT_TIMEOUT_MS = 3_000
const MAX_MEMORY_CHARS = 240

export interface VikingStatus {
  configured: boolean
  baseUrl: string | null
  /** Result of the last call, for /api/health and Settings. */
  reachable: boolean | null
  lastError: string | null
}

let state: { reachable: boolean | null; lastError: string | null } = { reachable: null, lastError: null }

function env(...names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return null
}

function apiKey(): string | null {
  return env('OPENVIKING_API_KEY', 'VIKING_API_KEY', 'OV_API_KEY')
}

/** A viking:// user prefix, unless the deployment is configured with an explicit one. */
function root(ownerId: string): string {
  const configured = env('OPENVIKING_USER_ROOT', 'VIKING_USER_ROOT')
  if (configured) return configured.replace(/\/+$/, '')
  return `viking://user/${ownerId}`
}

/**
 * Where to reach the server. An explicit URL wins; otherwise, if a key is present,
 * assume Volcengine's hosted OpenViking Service.
 */
export function vikingBase(): string | null {
  const explicit = env('OPENVIKING_URL', 'OPENVIKING_BASE_URL', 'OPENVIKING_HOST', 'VIKING_URL')
  if (explicit) return explicit.replace(/\/+$/, '')
  return apiKey() ? DEFAULT_HOSTED : null
}

export function vikingStatus(): VikingStatus {
  const baseUrl = vikingBase()
  return { configured: Boolean(baseUrl), baseUrl, reachable: state.reachable, lastError: state.lastError }
}

interface Ctx {
  baseUrl: string
  key: string | null
}

/** Resolves the connection once per call; returns null when memory is off. */
function ctx(): Ctx | null {
  const baseUrl = vikingBase()
  if (!baseUrl) return null
  return { baseUrl, key: apiKey() }
}

async function call(
  c: Ctx,
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<unknown | null> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (c.key) headers['X-API-Key'] = c.key
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  const timeout = init.timeoutMs ?? DEFAULT_TIMEOUT_MS

  try {
    const timeoutSignal = AbortSignal.timeout(timeout)
    const signal = init.signal && init.signal !== timeoutSignal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal
    const res = await fetch(`${c.baseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal,
    })
    if (!res.ok) {
      state = { reachable: false, lastError: `HTTP ${res.status}` }
      return null
    }
    state = { reachable: true, lastError: null }
    const text = await res.text()
    if (!text) return {}
    try {
      return JSON.parse(text) as unknown
    } catch {
      return { raw: text }
    }
  } catch (err) {
    const name = (err as Error).name
    state = { reachable: false, lastError: name === 'TimeoutError' || name === 'AbortError' ? `no answer within ${timeout}ms` : (err as Error).message }
    return null
  }
}

/** Reads `{ data: … }` or a bare object, and returns the list of memories in it. */
function memoriesFrom(payload: unknown): Array<{ text: string; uri?: string; score?: number }> {
  const found: Array<{ text: string; uri?: string; score?: number }> = []
  const visit = (node: unknown, depth: number) => {
    if (!node || depth > 4 || found.length > 40) return
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1)
      return
    }
    if (typeof node !== 'object') return
    const obj = node as Record<string, unknown>
    const text = [obj.content, obj.text, obj.abstract, obj.memory, obj.value, obj.overview, obj.summary].find(
      v => typeof v === 'string' && v.trim().length > 12,
    )
    if (typeof text === 'string') {
      found.push({
        text: text.trim(),
        uri: typeof obj.uri === 'string' ? obj.uri : typeof obj.id === 'string' ? obj.id : undefined,
        score: typeof obj.score === 'number' ? obj.score : undefined,
      })
    }
    for (const key of ['memories', 'results', 'items', 'data', 'nodes', 'matches', 'resources']) {
      if (key in obj) visit(obj[key], depth + 1)
    }
  }
  visit(payload, 0)
  return found
}

/**
 * Recalls memories relevant to this question. Hard-capped at `timeoutMs` (default
 * 3 s) and returns [] on any problem, so it can be awaited in parallel with the
 * tutor's other reads without ever becoming the slowest thing in the answer.
 */
export async function recallMemories(
  ownerId: string,
  query: string,
  opts: { timeoutMs?: number; limit?: number; signal?: AbortSignal } = {},
): Promise<string[]> {
  const c = ctx()
  if (!c || !query.trim()) return []
  const payload = await call(c, '/api/v1/search/find', {
    method: 'POST',
    body: {
      query: query.slice(0, 500),
      target_uri: `${root(ownerId)}/memories`,
      limit: opts.limit ?? 6,
      score_threshold: 0.15,
    },
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    signal: opts.signal,
  })
  if (!payload) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of memoriesFrom(payload)) {
    const line = m.text.replace(/\s+/g, ' ').trim().slice(0, MAX_MEMORY_CHARS)
    const fingerprint = line.toLowerCase().slice(0, 80)
    if (line.length < 12 || seen.has(fingerprint)) continue
    seen.add(fingerprint)
    out.push(line)
    if (out.length >= (opts.limit ?? 6)) break
  }
  return out
}

/** Formats recalled memories as the prompt block the tutor reads. */
export function memoryBlock(memories: string[]): string | null {
  if (!memories.length) return null
  return (
    'WHAT YOU ALREADY KNOW ABOUT THIS STUDENT — durable notes kept from earlier lessons (OpenViking).\n' +
    'Use them to teach better: pick up their level, respect their stated preferences, and avoid re-explaining what they already know. ' +
    'They are background, not facts to recite: never list them back, never mention that you keep notes, and if one contradicts what the student says now, believe the student and move on.\n\n' +
    memories.map(m => `- ${m}`).join('\n')
  )
}

/** Writes one durable memory. Used sparingly — see rememberTurn. */
export async function rememberNote(ownerId: string, note: string, tag = 'lesson'): Promise<boolean> {
  const c = ctx()
  if (!c) return false
  const clean = note.replace(/\s+/g, ' ').trim().slice(0, 1_200)
  if (clean.length < 12) return false
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const uri = `${root(ownerId)}/memories/${tag}/${stamp}`
  const payload = await call(c, '/api/v1/content/write', {
    method: 'POST',
    body: { uri, content: clean, mode: 'replace', wait: false },
    timeoutMs: 6_000,
  })
  return payload !== null
}

/**
 * Sentences where a student says something durable about themselves — the only kind
 * worth keeping. Written to catch both "I'm preparing for boards" and "I am in class
 * 11", with or without the apostrophe's typographic form.
 */
const NOTE_VERBS =
  /\b(i(?:'m|’m| am)\s+(?:studying|learning|preparing|working on|revising|in class|in \d)|my (?:exam|board|goal|target|class|course|teacher|school|college|favourite|favorite|preferred|weak)|i (?:prefer|like|hate|struggle with|find\s.{3,30}\shard)|call me|remember (?:that|this)|from now on|i (?:always|never)\b)/i

/**
 * Turns a finished exchange into memories — without asking a model to summarise
 * (which would cost time and tokens). Only sentences where the student says something
 * durable about themselves are kept, so the memory store stays small and useful.
 */
export function lessonFrom(studentText: string, answer: string): string | null {
  const sentences = studentText
    .split(/(?<=[.!?।])\s+|\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 12 && s.length < 400)
  const durable = sentences.filter(s => NOTE_VERBS.test(s)).slice(0, 2)
  if (durable.length) return durable.join(' ')
  const question = sentences[0]
  if (!question) return null
  const topic = question.replace(/^(please|kindly|can you|could you|explain|tell me about|what is|what are|how do i|how does)\s+/i, '').trim()
  if (topic.length < 15 || answer.trim().length < 40) return null
  return `Asked about: ${topic.slice(0, 180)}`
}

/** One line for the student-facing notice, or null when nothing was written. */
export async function rememberTurn(ownerId: string, studentText: string, answer: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const note = lessonFrom(studentText, answer)
    if (!note) return false
    return await rememberNote(ownerId, note, NOTE_VERBS.test(studentText) ? 'preferences' : 'topics')
  } catch {
    void signal
    return false
  }
}
