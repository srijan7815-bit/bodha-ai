'use client'

import { useCallback, useEffect, useState } from 'react'
import { authFetch } from '@/lib/firebase/client-token'
import { DEFAULT_SETTINGS, type PublicSettings } from '@/lib/types'

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
  /** null until the first fetch resolves; false when the student has none. */
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

/** Connect or replace the student's own OpenAI-compatible endpoint. */
export async function connectEndpoint(input: {
  baseUrl: string
  apiKey: string
  model: string
  label?: string
}): Promise<{ ok: true; sample: string } | { ok: false; error: string }> {
  try {
    const res = await authFetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom: input }),
    })
    const data = (await res.json().catch(() => ({}))) as {
      settings?: PublicSettings
      test?: { sample?: string }
      error?: string
    }
    if (!res.ok || !data.settings) {
      return { ok: false, error: data.error || 'That endpoint could not be saved.' }
    }
    setSettings(data.settings)
    return { ok: true, sample: data.test?.sample ?? '' }
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
  savePreferences: typeof savePreferences
  connectEndpoint: typeof connectEndpoint
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
    savePreferences,
    connectEndpoint,
    disconnectEndpoint,
    refresh,
  }
}
