'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { onAuthStateChanged, signOut as firebaseSignOut, type User as FirebaseUser } from 'firebase/auth'
import { auth, firebaseClientEnabled } from '@/lib/firebase/client'

export interface AuthUser {
  id: string
  email: string
  name: string
  createdAt: string
  avatarUrl?: string
}

export type AuthMode = 'firebase' | 'local'

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  firebaseUser: FirebaseUser | null
  mode: AuthMode
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  firebaseUser: null,
  mode: 'local',
  signOut: async () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

/**
 * Auth gate for the app shell.
 *
 *  - Firebase mode (public Firebase config set): listens to Firebase Auth and
 *    exposes the signed-in user + ID tokens (see authFetch).
 *  - Local demo mode (no Firebase config): httpOnly cookie sessions via
 *    /api/auth/me — the seeded demo account works out of the box.
 *
 * Redirects to /login whenever there is no signed-in user.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const mode: AuthMode = firebaseClientEnabled ? 'firebase' : 'local'

  const [state, setState] = useState<Omit<AuthContextValue, 'signOut' | 'mode'>>({
    user: null,
    loading: true,
    firebaseUser: null,
  })

  const signOut = useCallback(async () => {
    if (mode === 'firebase' && auth) {
      try {
        await firebaseSignOut(auth)
      } catch {}
    }
    // Always clear the local cookie too (no-op in Firebase mode).
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    window.location.href = '/login'
  }, [mode])

  useEffect(() => {
    let cancelled = false

    if (mode === 'firebase') {
      if (!auth) {
        setState({ user: null, loading: false, firebaseUser: null })
        return
      }
      const unsub = onAuthStateChanged(auth, fbUser => {
        if (cancelled) return
        if (!fbUser) {
          setState({ user: null, loading: false, firebaseUser: null })
          router.replace('/login')
          return
        }
        setState({
          user: {
            id: fbUser.uid,
            email: fbUser.email ?? '',
            name: fbUser.displayName ?? fbUser.email?.split('@')[0] ?? 'Student',
            createdAt: fbUser.metadata.creationTime ?? new Date().toISOString(),
            avatarUrl: fbUser.photoURL ?? undefined,
          },
          loading: false,
          firebaseUser: fbUser,
        })
      })
      return () => {
        cancelled = true
        unsub()
      }
    }

    // Local demo mode: cookie session.
    ;(async () => {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' })
        const data = res.ok ? await res.json() : { user: null }
        if (cancelled) return
        if (!data.user) {
          setState({ user: null, loading: false, firebaseUser: null })
          if (pathname !== '/login' && pathname !== '/register') router.replace('/login')
          return
        }
        setState({ user: data.user, loading: false, firebaseUser: null })
      } catch {
        if (!cancelled) setState({ user: null, loading: false, firebaseUser: null })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [mode, router, pathname])

  if (state.loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-pulse-soft rounded-xl bg-primary" />
          <p className="font-serif text-sm italic text-muted-foreground">Opening BODHA…</p>
        </div>
      </div>
    )
  }

  if (!state.user) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <p className="font-serif text-sm italic text-muted-foreground">Redirecting to sign in…</p>
      </div>
    )
  }

  return (
    <AuthContext.Provider value={{ ...state, mode, signOut }}>{children}</AuthContext.Provider>
  )
}
