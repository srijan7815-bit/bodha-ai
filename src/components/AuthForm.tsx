'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Eye, EyeOff, Loader2 } from 'lucide-react'
import { auth } from '@/lib/firebase/client'
import { BodhaWordmark } from '@/components/Brand'

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

function Field({
  id,
  label,
  hint,
  ...input
}: {
  id: string
  label: string
  hint?: string
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-ui font-medium text-foreground/90">
          {label}
        </label>
        {hint && <span className="text-ui-sm text-muted-foreground">{hint}</span>}
      </div>
      <input
        id={id}
        className="h-11 w-full rounded-xl border border-border/80 bg-surface px-3.5 text-[15px] text-foreground shadow-soft outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/50"
        {...input}
      />
    </div>
  )
}

export default function AuthForm({ mode }: Props) {
  const router = useRouter()
  const isRegister = mode === 'register'

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
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
    ? 'A few seconds, and बोध is yours — your chats, books and progress follow you to any device.'
    : 'Sign in to pick up your conversations where you left them.'

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background px-5 py-10">
      <div aria-hidden className="pointer-events-none absolute -left-32 -top-40 h-[360px] w-[360px] rounded-full bg-primary/[0.07] blur-3xl" />

      <div className="relative z-10 w-full max-w-[420px]">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-ui text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.8} />
          Back to home
        </Link>

        <div className="rounded-3xl border border-border/70 bg-surface/80 p-6 shadow-card backdrop-blur-sm sm:p-8">
          <div className="mb-7 text-center">
            <div className="mb-4 flex justify-center">
              <BodhaWordmark size="lg" />
            </div>
            <h1 className="mt-1 font-display text-[1.5rem] font-semibold tracking-[-0.02em] text-foreground">{title}</h1>
            <p className="mx-auto mt-2 max-w-[36ch] font-serif text-reading-sm text-muted-foreground text-pretty">{subtitle}</p>
          </div>

          <form onSubmit={submit} className="space-y-4" noValidate>
            {isRegister && (
              <Field
                id="name"
                label="Your name"
                placeholder="Srijan"
                autoComplete="name"
                value={name}
                onChange={e => setName(e.target.value)}
                disabled={busy}
                required
              />
            )}

            <Field
              id="email"
              label="Email"
              type="email"
              inputMode="email"
              placeholder="you@example.com"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={busy}
              required
            />

            <div className="relative">
              <Field
                id="password"
                label="Password"
                hint={isRegister ? 'at least 6 characters' : undefined}
                type={showPassword ? 'text' : 'password'}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                placeholder={isRegister ? 'Choose a password' : 'Your password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={busy}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="icon-btn-sm absolute bottom-1 right-1"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" strokeWidth={1.7} /> : <Eye className="h-4 w-4" strokeWidth={1.7} />}
              </button>
            </div>

            {error && (
              <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/[0.06] px-3.5 py-2.5 text-ui text-destructive">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary text-[15px] font-medium text-primary-foreground shadow-soft transition-transform hover:scale-[1.01] disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />}
              {isRegister ? 'Create account' : 'Sign in'}
            </button>
          </form>

          {firebaseAuth && (
            <>
              <div className="my-5 flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-ui-xs uppercase tracking-[0.14em] text-muted-foreground">or</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <button
                type="button"
                onClick={signInWithGoogle}
                disabled={googleBusy || busy}
                className="inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-full border border-border/80 bg-background text-[15px] font-medium text-foreground transition-colors hover:border-primary/40 disabled:opacity-60"
              >
                {googleBusy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <GoogleMark />}
                Continue with Google
              </button>
            </>
          )}

          <p className="mt-6 text-center text-ui text-muted-foreground">
            {isRegister ? 'Already have an account? ' : 'New to बोध? '}
            <Link href={isRegister ? '/login' : '/register'} className="font-medium text-primary underline-offset-4 hover:underline">
              {isRegister ? 'Sign in' : 'Create an account'}
            </Link>
          </p>

          {demoMode && (
            <p className="mt-4 rounded-xl bg-muted px-3.5 py-2.5 text-center text-ui-sm text-muted-foreground">
              Demo mode — try <span className="font-medium text-foreground">demo@bodha.ai</span> /{' '}
              <span className="font-medium text-foreground">bodha-demo</span>
            </p>
          )}
        </div>

        <p className="mt-6 text-center text-ui-sm text-muted-foreground/70">
          BODHA AI · created by <span className="font-medium text-muted-foreground">Srijan Singh and Parv Mishra</span>
        </p>
      </div>
    </main>
  )
}

function GoogleMark() {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" aria-hidden>
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
