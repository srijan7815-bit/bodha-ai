'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import AppShell from '@/components/AppShell'
import DocumentReader, { type ReaderDoc } from '@/components/DocumentReader'
import { useAuth } from '@/components/AuthProvider'
import { authFetch } from '@/lib/firebase/client-token'

export default function ReaderPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const [doc, setDoc] = useState<ReaderDoc | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading')

  useEffect(() => {
    if (!user || !id) return
    let cancelled = false
    void (async () => {
      try {
        const res = await authFetch(`/api/documents/${id}?meta=1`, { cache: 'no-store' })
        if (!res.ok) {
          if (!cancelled) setStatus('missing')
          return
        }
        const data = await res.json()
        if (!cancelled) {
          setDoc(data.document as ReaderDoc)
          setStatus('ready')
        }
      } catch {
        if (!cancelled) setStatus('missing')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user, id])

  if (!user) return null

  return (
    <AppShell>
      {status === 'loading' && (
        <div className="flex h-full items-center justify-center">
          <p className="font-serif text-reading-sm italic text-muted-foreground">Fetching your book…</p>
        </div>
      )}
      {status === 'missing' && (
        <div className="flex h-full items-center justify-center px-6">
          <p className="max-w-sm text-center font-serif text-reading italic text-muted-foreground">
            That document is no longer in your library.
          </p>
        </div>
      )}
      {status === 'ready' && doc && <DocumentReader doc={doc} />}
    </AppShell>
  )
}
