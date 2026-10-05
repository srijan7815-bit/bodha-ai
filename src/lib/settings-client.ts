'use client'

import { useCallback, useEffect, useState } from 'react'
import { authFetch } from '@/lib/firebase/client-token'
import { BODHA_MODEL, DEFAULT_SETTINGS, type CustomModel, type PublicSettings } from '@/lib/types'

/**
 * The student's settings, shared across the app.
 *
 * One small module-level cache with subscribers rather than a context provider:
 * both the chat header (which needs the model toggle) and the settings page
 * (which edits it) read the same values, and a change in one is visible in the
 * other on the next paint — including after a page navigation, because the
 * cache survives it.
 */

interface State {
  settings: PublicSettings
  loading: boolean
  /** false until an endpoint is connected. */
  connected: boolean
}

let state: State = {
  settings: { ...DEFAULT_SETTINGS },
  loading: true,
  connected: false,
}

const listeners = new Set<(next: State) => void>()

function publish(next: Partial<State>) {
  state = { ...state, ...next }
  listeners.forEach(listener => listener(state))
}

export function setSettings(next: PublicSettings) {
  publish({ settings: next, loading: false, connected: Boolean(next.custom) })
}

let inflight: Promise<void> | null = null

/** Load once per session; later callers share the same request. */
export function refreshSettings(force = false): Promise<void> {
  if (inflight && !force) return inflight
  if (!force && !state.loading && state.settings.updatedAt !== '') return Promise.resolve()

  inflight = (async () => {
    try {
      const res = await authFetch('/api/settings', { cache: 'no-store' })
      if (res.ok) {
        const data = (await res.json()) as { settings: PublicSettings }
        setSettings(data.settings)
        return
      }
      publish({ loading: false })
    } catch {
      publish({ loading: false })
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/**
 * Which models the chat toggle should offer: बोध first, then every model on the
 * student's own endpoint, in the order they arranged them.
 */
export function toggleOptions(settings: PublicSettings): Array<{ id: string; label: string }> {
  const options = [{ id: BODHA_MODEL, label: 'बोध' }]
  for (const model of settings.custom?.models ?? []) {
    options.push({ id: model.id, label: model.label || model.id })
  }
  return options
}

/** The id the toggle should show as active, given what actually exists. */
export function activeModel(settings: PublicSettings): string {
  const ids = toggleOptions(settings).map(option => option.id)
  return ids.includes(settings.preferredModel) ? settings.preferredModel : BODHA_MODEL
}

/** Save preferences (the model toggle, the voice) with an optimistic UI. */
export async function savePreferences(patch: Partial<Pick<PublicSettings, 'preferredModel' | 'voice'>>) {
  const previous = state.settings
  publish({ settings: { ...previous, ...patch } })
  try {
    const res = await authFetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) {
      publish({ settings: previous })
      return { ok: false as const, error: 'Could not save that just now.' }
    }
    const data = (await res.json()) as { settings: PublicSettings }
    setSettings(data.settings)
    return { ok: true as const }
  } catch {
    publish({ settings: previous })
    return { ok: false as const, error: 'Could not save that just now.' }
  }
}

export interface ConnectResult {
  ok: boolean
  /** 'ok' when at least one model answered; 'untested' when saved anyway. */
  status?: 'ok' | 'untested'
  sample?: string
  warning?: string
  error?: string
  /** Per-model detail, so the form can mark each row. */
  results?: Array<{ id: string; ok: boolean; sample?: string; error?: string }>
  /** The failure is one the student may choose to override. */
  canSaveAnyway?: boolean
}

/** Connect or replace the student's own OpenAI-compatible endpoint. */
export async function connectEndpoint(input: {
  baseUrl: string
  apiKey: string
  models: CustomModel[]
  skipTest?: boolean
}): Promise<ConnectResult> {
  try {
    const res = await authFetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom: input }),
    })
    const data = (await res.json().catch(() => ({}))) as {
      settings?: PublicSettings
      results?: ConnectResult['results']
      warning?: string
      error?: string
      canSaveAnyway?: boolean
    }
    if (!res.ok || !data.settings) {
      return {
        ok: false,
        error: data.error || 'That endpoint could not be saved.',
        results: data.results,
        canSaveAnyway: data.canSaveAnyway,
      }
    }
    setSettings(data.settings)
    const firstOk = data.results?.find(result => result.ok)
    return {
      ok: true,
      status: data.warning ? 'untested' : 'ok',
      sample: firstOk?.sample ?? '',
      warning: data.warning,
      results: data.results,
    }
  } catch {
    return { ok: false, error: 'Could not reach the server. Check your connection and try again.' }
  }
}

/** Ask the endpoint which models it serves (best effort — many have no /models). */
export async function fetchModels(input: {
  baseUrl: string
  apiKey: string
}): Promise<{ ok: true; models: CustomModel[] } | { ok: false; error: string }> {
  try {
    const res = await authFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const data = (await res.json().catch(() => ({}))) as { models?: CustomModel[]; error?: string }
    if (!res.ok || !data.models) return { ok: false, error: data.error || 'Could not list the models.' }
    return { ok: true, models: data.models }
  } catch {
    return { ok: false, error: 'Could not reach the server. Check your connection and try again.' }
  }
}

/** Forget the endpoint and the key stored with it. */
export async function disconnectEndpoint(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await authFetch('/api/settings', { method: 'DELETE' })
    if (!res.ok) return { ok: false, error: 'Could not remove that just now.' }
    setSettings(((await res.json()) as { settings: PublicSettings }).settings)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not remove that just now.' }
  }
}

export interface UseSettings {
  settings: PublicSettings
  loading: boolean
  connected: boolean
  /** Which model answers right now (always a real one). */
  active: string
  savePreferences: typeof savePreferences
  connectEndpoint: typeof connectEndpoint
  fetchModels: typeof fetchModels
  disconnectEndpoint: typeof disconnectEndpoint
  refresh: () => Promise<void>
}

export function useSettings(): UseSettings {
  const [snapshot, setSnapshot] = useState<State>(state)

  useEffect(() => {
    listeners.add(setSnapshot)
    void refreshSettings()
    return () => {
      listeners.delete(setSnapshot)
    }
  }, [])

  const refresh = useCallback(() => refreshSettings(true), [])

  return {
    settings: snapshot.settings,
    loading: snapshot.loading,
    connected: snapshot.connected,
    active: activeModel(snapshot.settings),
    savePreferences,
    connectEndpoint,
    fetchModels,
    disconnectEndpoint,
    refresh,
  }
}
