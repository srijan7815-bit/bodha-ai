'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { auth } from '@/lib/firebase/client'
import { ArrowLeft, Loader2 } from 'lucide-react'

/**
 * Shared sign-in / create-account form.
 *
 * The httpOnly cookie session from /api/auth/* is the source of truth (it works
 * in the local file-store demo *and* against Firestore on Vercel). Google
 * sign-in is offered only when the server reports that Firebase Authentication
 * is actually enabled, because an unconfigured project makes every Firebase
 * sign-in call fail with auth/configuration-not-found.
 */

type Mode = 'login' | 'register'

interface Props {
  mode: Mode
}

const FIREBASE_ERROR_MESSAGES: Record<string, string> = {
  'auth/email-already-in-use': 'That email already has an account — sign in instead.',
  'auth/invalid-email': 'That email address does not look right.',
  'auth/weak-password': 'Please use a password of at least 6 characters.',
  'auth/user-not-found': 'That email or password is not right.',
  'auth/wrong-password': 'That email or password is not right.',
  'auth/invalid-credential': 'That email or password is not right.',
  'auth/too-many-requests': 'Too many attempts — please try again in a few minutes.',
  'auth/network-request-failed': 'Could not reach Firebase. Check your connection.',
  'auth/popup-closed-by-user': 'The sign-in window was closed before finishing.',
  'auth/popup-blocked': 'Your browser blocked the sign-in window. Allow popups and retry.',
  'auth/unauthorized-domain': 'This domain is not authorised for Google sign-in yet. Use email and password instead.',
  'auth/operation-not-allowed': 'Google sign-in is not enabled for this project yet. Use email and password instead.',
  'auth/configuration-not-found': 'Firebase sign-in is not enabled for this project yet. Use email and password instead.',
}

function friendlyFirebaseError(err: unknown): string {
  const code = (err as { code?: string })?.code
  if (code && FIREBASE_ERROR_MESSAGES[code]) return FIREBASE_ERROR_MESSAGES[code]
  const message = (err as Error)?.message
  return message ? `Sign-in failed: ${message}` : 'Sign-in failed. Please try again.'
}

export default function AuthForm({ mode }: Props) {
  const router = useRouter()
  const isRegister = mode === 'register'

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [firebaseAuth, setFirebaseAuth] = useState(false)
  const [demoMode, setDemoMode] = useState(false)

  // Ask the server what this deployment supports.
  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled || !data) return
        setFirebaseAuth(!!data.firebaseAuth)
        setDemoMode(data.store === 'file')
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setError(null)

    const cleanEmail = email.trim().toLowerCase()
    if (isRegister && !name.trim()) return setError('Please tell me your name.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return setError('That email address does not look right.')
    if (password.length < 6) return setError('Your password needs at least 6 characters.')

    setBusy(true)
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isRegister ? { name: name.trim(), email: cleanEmail, password } : { email: cleanEmail, password },
        ),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.')
        return
      }
      // The session cookie is set; reload the shell so it picks the user up.
      router.replace('/chat')
      router.refresh()
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function signInWithGoogle() {
    if (googleBusy || busy) return
    if (!auth) {
      setError('Google sign-in is not available in this deployment.')
      return
    }
    setError(null)
    setGoogleBusy(true)
    try {
      const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth')
      const credential = await signInWithPopup(auth, new GoogleAuthProvider())
      const idToken = await credential.user.getIdToken()
      const res = await fetch('/api/auth/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          name: credential.user.displayName?.trim() || credential.user.email?.split('@')[0] || 'Student',
          email: (credential.user.email ?? '').toLowerCase(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Google sign-in could not be completed.')
        return
      }
      router.replace('/chat')
      router.refresh()
    } catch (err) {
      setError(friendlyFirebaseError(err))
    } finally {
      setGoogleBusy(false)
    }
  }

  const title = isRegister ? 'Create your account' : 'Welcome back'
  const subtitle = isRegister
    ? 'A few seconds and BODHA is yours — your chats, books and progress follow you.'
    : 'Sign in to continue learning with BODHA.'

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>

        <Card className="shadow-warm-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 2c-3.5 3.6-5.5 7-5.5 10.2a5.5 5.5 0 0 0 11 0C17.5 9 15.5 5.6 12 2z" />
              </svg>
            </div>
            <CardTitle className="font-display text-2xl">{title}</CardTitle>
            <CardDescription className="font-serif italic">{subtitle}</CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={submit} className="space-y-4" noValidate>
              {isRegister && (
                <div className="space-y-1.5">
                  <Label htmlFor="name">Your name</Label>
                  <Input
                    id="name"
                    name="name"
                    autoComplete="name"
                    placeholder="Srijan"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    disabled={busy}
                    required
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  disabled={busy}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={isRegister ? 'new-password' : 'current-password'}
                  placeholder={isRegister ? 'At least 6 characters' : 'Your password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={busy}
                  required
                />
              </div>

              {error && (
                <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button type="submit" size="lg" className="w-full" disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isRegister ? 'Create account' : 'Sign in'}
              </Button>
            </form>

            {firebaseAuth && (
              <>
                <div className="my-5 flex items-center gap-3">
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
                  <span className="h-px flex-1 bg-border" />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="w-full"
                  onClick={signInWithGoogle}
                  disabled={googleBusy || busy}
                >
                  {googleBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GoogleMark />}
                  Continue with Google
                </Button>
              </>
            )}

            <p className="mt-6 text-center text-sm text-muted-foreground">
              {isRegister ? 'Already have an account? ' : 'New to BODHA? '}
              <Link href={isRegister ? '/login' : '/register'} className="font-medium text-primary underline-offset-4 hover:underline">
                {isRegister ? 'Sign in' : 'Create an account'}
              </Link>
            </p>

            {demoMode && (
              <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-center text-xs text-muted-foreground">
                Demo mode — sign in with <span className="font-medium">demo@bodha.ai</span> /{' '}
                <span className="font-medium">bodha-demo</span>
              </p>
            )}
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground/70">
          BODHA AI · created by <span className="font-medium text-muted-foreground">Srijan Singh and Parv Mishra</span>
        </p>
      </div>
    </main>
  )
}

function GoogleMark() {
  return (
    <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.4a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.6-5.2 3.6-8.8z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z"
      />
      <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6V6.7H1.4a12 12 0 0 0 0 10.8l4-3.1z" />
      <path
        fill="#EA4335"
        d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.7l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"
      />
    </svg>
  )
}
