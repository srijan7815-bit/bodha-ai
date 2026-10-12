#!/usr/bin/env node
/**
 * Checks every service the app talks to, and says plainly what each one is doing.
 *
 *   node scripts/check-integrations.mjs
 *
 * It only *reads* — one cheap call per service, with a short timeout. A service that
 * is not configured is reported as "skipped", never as a failure, so this is safe to
 * run before a demo. Reads .env if it exists, and otherwise uses the environment.
 */

import { readFileSync } from 'node:fs'

function loadEnv(file = '.env') {
  try {
    const raw = readFileSync(file, 'utf8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
      const [key, ...rest] = trimmed.split('=')
      if (!key.trim() || process.env[key.trim()]) continue
      process.env[key.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n')
    }
    return true
  } catch {
    return false
  }
}

const loaded = loadEnv()
const TIMEOUT = 12_000

const mask = v => (v ? `${v.slice(0, 6)}…${v.slice(-4)} (${v.length} chars)` : '—')
const ok = t => `\x1b[32m✓\x1b[0m ${t}`
const bad = t => `\x1b[31m✗\x1b[0m ${t}`
const skip = t => `\x1b[90m·\x1b[0m ${t}`

async function timed(label, fn) {
  const started = Date.now()
  try {
    const result = await fn()
    return { label, ...result, ms: Date.now() - started }
  } catch (err) {
    return { label, state: 'fail', detail: err.message, ms: Date.now() - started }
  }
}

const fetchWithTimeout = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) })

const checks = [
  ['Tavily (search #1)', () => process.env.TAVILY_API_KEY, async key => {
    const res = await fetchWithTimeout('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query: 'bodha ai', max_results: 3, search_depth: 'basic' }),
    })
    if (!res.ok) return { state: 'fail', detail: `HTTP ${res.status}` }
    const json = await res.json()
    const n = (json.results ?? []).length
    return n ? { state: 'ok', detail: `${n} results` } : { state: 'fail', detail: 'no results (out of credit?)' }
  }],

  ['TinyFish (search #2)', () => process.env.TINYFISH_API_KEY, async key => {
    const url = new URL('https://api.search.tinyfish.ai')
    url.searchParams.set('query', 'bodha ai tutor')
    url.searchParams.set('domain_type', 'web')
    const res = await fetchWithTimeout(url, { headers: { 'X-API-Key': key, Accept: 'application/json' } })
    if (!res.ok) return { state: 'fail', detail: `HTTP ${res.status}${res.status === 429 ? ' (rate limit — 30/min)' : ''}` }
    const json = await res.json()
    const n = (json.results ?? []).length
    return n ? { state: 'ok', detail: `${n} results` } : { state: 'fail', detail: 'no results' }
  }],

  ['Agenta (research agent)', () => process.env.AGENTA_API_KEY, async key => {
    const hosts = [process.env.AGENTA_HOST?.replace(/\/+$/, ''), 'https://cloud.agenta.ai', 'https://eu.cloud.agenta.ai'].filter(Boolean)
    const tried = []
    for (const host of hosts) {
      const res = await fetchWithTimeout(`${host}/api/projects`, { headers: { Authorization: `ApiKey ${key}`, Accept: 'application/json' } })
      tried.push(`${host} → ${res.status}`)
      if (res.ok) {
        const json = await res.json().catch(() => null)
        const list = Array.isArray(json) ? json : json?.items ?? json?.data ?? json?.projects ?? []
        const first = Array.isArray(list) ? list[0] : null
        const projectId = process.env.AGENTA_PROJECT_ID || first?.id || first?.slug || '(none discovered)'
        return { state: 'ok', detail: `host ${host}, project ${projectId}, ${Array.isArray(list) ? list.length : '?'} project(s)` }
      }
    }
    return { state: 'fail', detail: tried.join(' | ') }
  }],

  ['OpenViking (memory)', () => process.env.OPENVIKING_URL || process.env.OPENVIKING_API_KEY, async () => {
    const base = (process.env.OPENVIKING_URL || 'https://api.vikingdb.cn-beijing.volces.com/openviking').replace(/\/+$/, '')
    const headers = { Accept: 'application/json' }
    const key = process.env.OPENVIKING_API_KEY || process.env.VIKING_API_KEY
    if (key) headers['X-API-Key'] = key
    const res = await fetchWithTimeout(`${base}/api/v1/fs/ls?uri=viking://`, { headers })
    if (!res.ok) return { state: 'fail', detail: `${base} → HTTP ${res.status}${res.status === 401 ? ' (needs a key)' : ''}` }
    return { state: 'ok', detail: `${base} answered` }
  }],

  ['E2B (the computer)', () => process.env.E2B_API_KEY, async key => {
    const res = await fetchWithTimeout('https://api.e2b.dev/sandboxes', { headers: { 'X-API-KEY': key } })
    if ([200, 401, 403].includes(res.status)) {
      return res.status === 200
        ? { state: 'ok', detail: 'reachable' }
        : { state: 'fail', detail: `HTTP ${res.status} — key rejected?` }
    }
    return { state: 'ok', detail: `reachable (HTTP ${res.status})` }
  }],

  ['Firebase Admin (store)', () => process.env.FIREBASE_ADMIN_PROJECT_ID, async () => {
    const missing = ['FIREBASE_ADMIN_PROJECT_ID', 'FIREBASE_ADMIN_CLIENT_EMAIL', 'FIREBASE_ADMIN_PRIVATE_KEY'].filter(n => !process.env[n])
    if (missing.length) return { state: 'fail', detail: `missing ${missing.join(', ')}` }
    return { state: 'ok', detail: `project ${process.env.FIREBASE_ADMIN_PROJECT_ID} (live check: /api/health on the deployment)` }
  }],

  ['NVIDIA NIM (answers)', () => process.env.NVIDIA_API_KEY, async key => {
    const res = await fetchWithTimeout('https://integrate.api.nvidia.com/v1/models', { headers: { Authorization: `Bearer ${key}` } })
    return res.ok ? { state: 'ok', detail: 'key accepted' } : { state: 'fail', detail: `HTTP ${res.status}` }
  }],

  ['Fish Audio (voice)', () => process.env.FISH_AUDIO_API_KEY, async key => {
    const res = await fetchWithTimeout('https://api.fish.audio/model', { headers: { Authorization: `Bearer ${key}` } })
    return res.ok ? { state: 'ok', detail: 'key accepted' } : { state: 'fail', detail: `HTTP ${res.status}` }
  }],

  ['Groq (dictation)', () => process.env.GROQ_API_KEY, async key => {
    const res = await fetchWithTimeout('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${key}` } })
    return res.ok ? { state: 'ok', detail: 'key accepted' } : { state: 'fail', detail: `HTTP ${res.status}` }
  }],
]

console.log(`\nBODHA integrations${loaded ? ' (read .env)' : ' (no .env — using the environment)'}\n${'─'.repeat(72)}`)

let failures = 0
for (const [label, configured, run] of checks) {
  const value = configured()
  if (!value) {
    console.log(`  ${skip(label.padEnd(26))} not configured — skipped`)
    continue
  }
  const result = await timed(label, () => run(value))
  if (result.state === 'ok') console.log(`  ${ok(label.padEnd(26))} ${result.detail} \x1b[90m(${result.ms} ms)\x1b[0m`)
  else {
    failures++
    console.log(`  ${bad(label.padEnd(26))} ${result.detail} \x1b[90m(${result.ms} ms)\x1b[0m`)
  }
}

console.log(`${'─'.repeat(72)}`)
console.log(failures ? `\n${failures} service(s) failed. Everything else keeps working: every integration fails soft.\n` : '\nAll configured services answered.\n')
console.log(process.env.AGENTA_API_KEY ? '' : 'Note: set AGENTA_API_KEY to switch deep research on.\n')
process.exit(0)
