'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createUserWithEmailAndPassword, updateProfile, signInWithPopup, GoogleAuthProvider } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

export default function RegisterPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setLoading(true)
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password)
      await updateProfile(cred.user, { displayName: name })
      // Sync user profile to backend Firestore via our API
      await fetch('/api/auth/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email }),
      }).catch(() => {})
      router.push('/chat')
    } catch (err: any) {
      const code = err?.code ?? ''
      if (code === 'auth/email-already-in-use') {
        setError('That email already has an account — try signing in.')
      } else if (code === 'auth/weak-password') {
        setError('Password must be at least 6 characters.')
      } else if (code === 'auth/invalid-email') {
        setError('That email address does not look right.')
      } else {
        setError('Could not create the account. Please try again.')
      }
      setLoading(false)
    }
  }

  async function onGoogle() {
    setError(null)
    setLoading(true)
    try {
      const provider = new GoogleAuthProvider()
      await signInWithPopup(auth, provider)
      router.push('/chat')
    } catch (err: any) {
      setError('Could not sign in with Google. Please try again.')
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Link href="/" className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-warm">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 2c-3.5 3.6-5.5 7-5.5 10.2a5.5 5.5 0 0 0 11 0C17.5 9 15.5 5.6 12 2z" />
            </svg>
          </Link>
          <CardTitle className="text-2xl">Create your account</CardTitle>
          <CardDescription>Start learning with BODHA today</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="w-full" onClick={onGoogle} disabled={loading}>
            <svg className="h-4 w-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.22 1.13-.84 2.09-1.8 2.73v2.26h2.91c1.7-1.57 2.53-3.86 2.53-7z" />
              <path fill="#34A853" d="M12 23c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.35 0-4.34-1.59-5.05-3.72H4v2.34C5.49 21.25 8.48 23 12 23z" />
              <path fill="#FBBC05" d="M6.95 15.7c-.18-.53-.28-1.1-.28-1.7s.1-1.17.28-1.7v-2.34H4.04C3.37 11.31 3 12.61 3 14s.37 2.69 1.04 4.04l2.91-2.34z" />
              <path fill="#EA4335" d="M12 5.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C16.47 2.84 14.43 2 12 3 8.48 2 5.49 5.75 4.04 7.96l2.91 2.34C7.66 8.17 9.65 5.58 12 5.58z" />
            </svg>
            Continue with Google
          </Button>

          <div className="my-6 flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs uppercase tracking-widest text-muted-foreground">or</span>
            <Separator className="flex-1" />
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Your name</Label>
              <Input
                id="name"
                type="text"
                placeholder="Ada Lovelace"
                value={name}
                onChange={e => setName(e.target.value)}
                autoComplete="name"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@school.edu"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="At least 6 characters"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={6}
              />
            </div>

            {error && (
              <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={loading || !name || !email || !password}>
              {loading ? 'Creating account…' : 'Create account'}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link href="/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}