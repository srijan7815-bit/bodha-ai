import { getStore } from '@/lib/store'
import { setChainOverrides } from './provider'
import type { SystemState } from '@/lib/types'

let cache: { at: number; state: SystemState | null } | null = null

/** Pushes a state's repairs into the live model chain. */
export function applySystemState(state: SystemState | null) {
  cache = { at: Date.now(), state }
  setChainOverrides({ disabled: state?.disabledModels ?? [], primary: state?.promoted ?? null })
}

/**
 * Called before a chat answer: picks up the watchdog's latest repairs (at most
 * one storage read every 30 s per server instance). Never throws — a storage
 * hiccup must not stop a student's question.
 */
export async function syncSystemState(maxAgeMs = 30_000): Promise<SystemState | null> {
  if (cache && Date.now() - cache.at < maxAgeMs) return cache.state
  try {
    const state = await (await getStore()).getSystemState()
    applySystemState(state)
    return state
  } catch {
    cache = { at: Date.now(), state: cache?.state ?? null }
    return cache.state
  }
}
