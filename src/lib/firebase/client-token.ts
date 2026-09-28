'use client'

import { auth, firebaseClientEnabled } from '@/lib/firebase/client'

/**
 * Client auth helpers:
 *  - getFirebaseIdToken(): the signed-in user's Firebase ID token (or null).
 *  - authFetch(): fetch wrapper that attaches the ID token (Firebase mode) —
 *    in local demo mode it just forwards the request; the httpOnly session
 *    cookie travels automatically.
 */

let cachedToken: string | null = null
let cachedAt = 0

export async function getFirebaseIdToken(): Promise<string | null> {
  if (typeof window === 'undefined' || !firebaseClientEnabled || !auth) return null

  const user = auth.currentUser
  if (!user) return null

  // Cache for 10 minutes; Firebase tokens last 1 hour.
  if (cachedToken && Date.now() - cachedAt < 10 * 60 * 1000) return cachedToken

  try {
    cachedToken = await user.getIdToken()
    cachedAt = Date.now()
    return cachedToken
  } catch {
    return null
  }
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  const token = await getFirebaseIdToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (!headers.has('Content-Type') && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json')
  }
  return fetch(input, { ...init, headers })
}
