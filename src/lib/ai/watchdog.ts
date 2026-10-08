import { getStore } from '@/lib/store'
import { completeOnce, configFor, configuredModels, noteProviderResult } from './provider'
import { applySystemState } from './system-state'
import { synthesize } from '@/lib/speech'
import type { ModelProbe, ServiceProbe, SystemState, WatchdogAction } from '@/lib/types'

/**
 * BODHA's watchdog: a small, bounded self-repair loop.
 *
 *  1. TEST    — send a tiny live request to every answering model, check the
 *               Groq dictation service, the Fish voice (deep runs only) and storage.
 *  2. DECIDE  — fixed safety rules decide the repairs; a small model reads the
 *               report, writes the plain-language diagnosis and may *suggest*
 *               one of the allowed repairs, which is applied only if it passes
 *               the same rules.
 *  3. REPAIR  — the only things it can change: take a model out of rotation
 *               (after two failed checks in a row), put it back when it passes,
 *               or move a faster healthy model to the front. It cannot touch
 *               keys, files, user data or code.
 */

const STRIKES_TO_DISABLE = 2
const SLOW_MS = 6_000
const MAX_ACTION_LOG = 12

const WATCHDOG_MODEL = process.env.WATCHDOG_MODEL?.trim() || 'openai/gpt-oss-20b'

async function probeModel(model: string): Promise<ModelProbe> {
  const cfg = configFor(model)
  const started = Date.now()
  if (!cfg) return { model, ok: false, ms: 0, error: 'no API key configured' }
  try {
    const out = await completeOnce(cfg, [{ role: 'user', content: 'Reply with the single word: ready' }] as never, {
      maxTokens: 40,
      temperature: 0,
      signal: AbortSignal.timeout(14_000),
    })
    const ms = Date.now() - started
    return out ? { model, ok: true, ms } : { model, ok: false, ms, error: 'empty reply' }
  } catch (err) {
    const message = (err as Error).message || 'failed'
    // A rate limit means "busy", not "broken" — never hold it against a model.
    if (/HTTP 429/.test(message)) return { model, ok: true, busy: true, ms: Date.now() - started, error: 'rate limited' }
    return { model, ok: false, ms: Date.now() - started, error: message.slice(0, 120) }
  }
}

async function probeStt(): Promise<ServiceProbe> {
  const key = process.env.GROQ_API_KEY?.trim()
  if (!key) return { ok: false, detail: 'Groq key not set — backup recognisers are in use' }
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8_000),
    })
    return res.ok
      ? { ok: true, detail: 'Groq Whisper large v3 turbo is reachable' }
      : { ok: false, detail: `Groq answered HTTP ${res.status} — backups are in use` }
  } catch {
    return { ok: false, detail: 'Groq is unreachable — backups are in use' }
  }
}

async function probeTts(deep: boolean, previous?: ServiceProbe): Promise<ServiceProbe> {
  if (!process.env.FISH_AUDIO_API_KEY?.trim()) return { ok: false, detail: 'Fish Audio key not set' }
  // A real synthesis spends a little voice credit, so only a manual deep check does it.
  if (!deep) return previous ?? { ok: true, detail: 'Key present (run a deep check to test the voice)' }
  const audio = await synthesize('Namaste.', {}).catch(() => null)
  return audio ? { ok: true, detail: 'Fish Audio is speaking' } : { ok: false, detail: 'Fish Audio did not answer — the device voice will read instead' }
}

/** Ask the small model for a diagnosis and (optionally) a suggested repair. */
async function consult(
  models: ModelProbe[],
  services: SystemState['services'],
  disabled: string[],
): Promise<{ summary?: string; suggestions: Array<{ action: string; target?: string; reason: string }> }> {
  if (process.env.WATCHDOG_AI === 'false') return { suggestions: [] }
  const cfg = configFor(WATCHDOG_MODEL)
  if (!cfg) return { suggestions: [] }
  try {
    const text = await completeOnce(
      cfg,
      [
        {
          role: 'system',
          content:
            'You are the watchdog of BODHA, an AI tutor. You get a health report as JSON. Reply with ONLY a JSON object: ' +
            '{"summary": string (max 140 chars, plain English, for the operator), "actions": [{"action": "promote_model" | "none", "target": model id, "reason": string}]}. ' +
            'Only suggest promote_model for a model that passed and answered much faster than the first one. If everything is fine, use "none".',
        },
        { role: 'user', content: JSON.stringify({ models, services, disabled }) },
      ] as never,
      { maxTokens: 400, temperature: 0, signal: AbortSignal.timeout(15_000) },
    )
    const json = JSON.parse(text.replace(/^```(?:json)?|```$/gim, '').trim().match(/\{[\s\S]*\}/)?.[0] ?? '{}')
    return {
      summary: typeof json.summary === 'string' ? json.summary.slice(0, 160) : undefined,
      suggestions: Array.isArray(json.actions) ? json.actions.slice(0, 3) : [],
    }
  } catch {
    return { suggestions: [] }
  }
}

export async function runWatchdog(opts: { deep?: boolean } = {}): Promise<SystemState> {
  const store = await getStore()
  const previous = await store.getSystemState().catch(() => null)
  const configured = configuredModels()

  const [models, stt, tts] = await Promise.all([
    Promise.all(configured.map(probeModel)),
    probeStt(),
    probeTts(Boolean(opts.deep), previous?.services.tts),
  ])

  // Storage is proven by the very read above; a write proves the other half.
  let storage: ServiceProbe = { ok: true, detail: 'Reading and writing normally' }

  const strikes: Record<string, number> = { ...(previous?.strikes ?? {}) }
  let disabled = (previous?.disabledModels ?? []).filter(m => configured.includes(m))
  let promoted = previous?.promoted && configured.includes(previous.promoted) ? previous.promoted : null
  const actions: WatchdogAction[] = [...(previous?.actions ?? [])]
  const now = () => new Date().toISOString()
  const log = (a: Omit<WatchdogAction, 'at'>) => actions.unshift({ at: now(), ...a })

  // ── Rules (always on) ────────────────────────────────────────────────
  for (const probe of models) {
    if (probe.ok) {
      strikes[probe.model] = 0
      noteProviderResult(probe.model, true)
      if (disabled.includes(probe.model)) {
        disabled = disabled.filter(m => m !== probe.model)
        log({ action: 'enable_model', target: probe.model, reason: 'Passed its check again — back in rotation.', by: 'rules' })
      }
    } else {
      strikes[probe.model] = (strikes[probe.model] ?? 0) + 1
      noteProviderResult(probe.model, false)
    }
  }
  const passing = models.filter(m => m.ok)
  for (const probe of models) {
    if (probe.ok || disabled.includes(probe.model)) continue
    // Two failures in a row, and at least one other model still answering.
    if ((strikes[probe.model] ?? 0) >= STRIKES_TO_DISABLE && passing.length > 0) {
      disabled.push(probe.model)
      log({ action: 'disable_model', target: probe.model, reason: `Failed ${strikes[probe.model]} checks in a row (${probe.error ?? 'no answer'}).`, by: 'rules' })
    }
  }
  if (promoted && (disabled.includes(promoted) || !passing.some(m => m.model === promoted))) {
    log({ action: 'unpromote_model', target: promoted, reason: 'The promoted model stopped passing.', by: 'rules' })
    promoted = null
  }

  // ── Small model: diagnosis + optional suggestion, checked against the rules ──
  const first = models.find(m => !disabled.includes(m.model) && m.ok)
  const advice = await consult(models, { stt, tts, storage }, disabled)
  for (const s of advice.suggestions) {
    const target = models.find(m => m.model === s.target)
    if (s.action === 'promote_model' && target?.ok && !target.busy && first && target.model !== first.model && first.ms > SLOW_MS && target.ms < first.ms * 0.6 && !disabled.includes(target.model) && promoted !== target.model) {
      promoted = target.model
      log({ action: 'promote_model', target: target.model, reason: String(s.reason ?? 'Answers much faster than the current first model.').slice(0, 160), by: 'ai' })
    }
  }

  const failing = models.filter(m => !m.ok)
  const madeRepairs = actions.length > (previous?.actions.length ?? 0)
  const overall: SystemState['overall'] =
    passing.length === 0 || !stt.ok || !tts.ok || failing.length > 0 ? (madeRepairs && passing.length > 0 ? 'fixed' : 'degraded') : madeRepairs ? 'fixed' : 'ok'

  const fallbackSummary =
    overall === 'ok'
      ? `All ${models.length} answering models and the voice services passed.`
      : passing.length === 0
        ? 'No answering model passed its check — the backup chain will keep trying.'
        : `${failing.length} model${failing.length === 1 ? '' : 's'} failing; ${passing.length} still answering.`

  const state: SystemState = {
    checkedAt: now(),
    overall,
    summary: advice.summary || fallbackSummary,
    disabledModels: disabled,
    promoted,
    strikes,
    models,
    services: { stt, tts, storage },
    actions: actions.slice(0, MAX_ACTION_LOG),
  }

  try {
    await store.saveSystemState(state)
  } catch {
    storage = { ok: false, detail: 'Could not save the health report' }
    state.services.storage = storage
  }
  applySystemState(state)
  return state
}
