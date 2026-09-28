'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged, signOut as firebaseSignOut, User as FirebaseUser } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'

interface AuthUser {
  id: string
  email: string
  name: string
  createdAt: string
  avatarUrl?: string
}

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  firebaseUser: FirebaseUser | null
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  firebaseUser: null,
})

export function useAuth() {
  return useContext(AuthContext)
}

/**
 * Client-side auth gate: listens to Firebase auth state, resolves the
 * display profile, and redirects to /login when signed out.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [state, setState] = useState<AuthContextValue>({
    user: null,
    loading: true,
    firebaseUser: null,
  })

  useEffect(() => {
    if (!auth) {
      setState({ user: null, loading: false, firebaseUser: null })
      return
    }

    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setState({ user: null, loading: false, firebaseUser: null })
        router.replace('/login')
        return
      }


      const user: AuthUser = {
        id: fbUser.uid,
        email: fbUser.email ?? '',
        name: fbUser.displayName ?? fbUser.email?.split('@')[0] ?? 'Student',
        createdAt: fbUser.metadata.creationTime ?? new Date().toISOString(),
        avatarUrl: fbUser.photoURL ?? undefined,
      }
      setState({ user, loading: false, firebaseUser: fbUser })
    })

    return () => unsub()
  }, [router])

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

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}