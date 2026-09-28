'use client'

import { auth } from '@/lib/firebase/client'

/**
 * Returns the current user's Firebase ID token (refreshed if needed),
 * or null when signed out. Used by the authFetch wrapper.
 */

let cachedToken: string | null = null
let cachedAt = 0

export async function getFirebaseIdToken(): Promise<string | null> {
  if (typeof window === 'undefined' || !auth) return null

  const user = auth.currentUser
  if (!user) return null

  // Cache for 10 minutes; Firebase tokens last 1 hour
  if (cachedToken && Date.now() - cachedAt < 10 * 60 * 1000) {
    return cachedToken
  }

  try {
    cachedToken = await user.getIdToken()
    cachedAt = Date.now()
    return cachedToken
  } catch {
    return null
  }
}