'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'

export interface AuthUser {
  id: string
  email: string
  name: string
  createdAt: string
  avatarUrl?: string
}

/** How the browser is authenticated: 'local' = httpOnly cookie session. */
export type AuthMode = 'firebase' | 'local'

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  /**
   * Kept for API compatibility. The session is an httpOnly cookie (see
   * /api/auth/*) in every deployment, so there is no client SDK user object.
   */
  firebaseUser: null
  mode: AuthMode
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  firebaseUser: null,
  mode: 'local',
  signOut: async () => {},
  refresh: async () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

/**
 * Auth gate for the app shell.
 *
 * The session lives in an httpOnly cookie (set by /api/auth/login,
 * /api/auth/register and /api/auth/sync, cleared by /api/auth/logout), so the
 * browser simply asks the server who it is. This is the same code path in the
 * local file-store demo and against Firestore in production.
 *
 * Redirects to /login whenever there is no signed-in user.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()

  const [user, setUser] = useState<AuthUser | null>(null)
  const [mode, setMode] = useState<AuthMode>('local')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' })
      const data = res.ok ? await res.json() : null
      setUser(data?.user ?? null)
      setMode(data?.mode === 'firebase' ? 'firebase' : 'local')
      return data?.user ?? null
    } catch {
      setUser(null)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const signedIn = await load()
      if (cancelled) return
      if (!signedIn && pathname !== '/login' && pathname !== '/register') router.replace('/login')
    })()
    return () => {
      cancelled = true
    }
  }, [load, pathname, router])

  const signOut = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    setUser(null)
    window.location.href = '/login'
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-pulse-soft rounded-xl bg-primary" />
          <p className="font-serif text-sm italic text-muted-foreground">Opening BODHA…</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <p className="font-serif text-sm italic text-muted-foreground">Redirecting to sign in…</p>
      </div>
    )
  }

  return (
    <AuthContext.Provider value={{ user, loading, firebaseUser: null, mode, signOut, refresh: load }}>
      {children}
    </AuthContext.Provider>
  )
}
