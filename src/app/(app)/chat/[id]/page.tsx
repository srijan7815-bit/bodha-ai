'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import AppShell from '@/components/AppShell'
import ChatView from '@/components/ChatView'
import { useAuth } from '@/components/AuthProvider'
import { authFetch } from '@/lib/firebase/client-token'
import type { Chat, DocumentMeta, Message } from '@/lib/types'

/** /chat/:id — one conversation, loaded from the store (Firestore in production). */
export default function ChatPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const [state, setState] = useState<{
    status: 'loading' | 'ready' | 'missing'
    chat: Chat | null
    messages: Message[]
    documentMeta: DocumentMeta | null
  }>({ status: 'loading', chat: null, messages: [], documentMeta: null })

  useEffect(() => {
    if (!user || !id) return
    let cancelled = false

    void (async () => {
      try {
        const res = await authFetch(`/api/chats/${id}`, { cache: 'no-store' })
        if (!res.ok) {
          if (!cancelled) setState(s => ({ ...s, status: res.status === 404 ? 'missing' : 'ready' }))
          return
        }
        const data = await res.json()
        if (cancelled) return

        let documentMeta: DocumentMeta | null = null
        if (data.chat?.documentId) {
          const docRes = await authFetch(`/api/documents/${data.chat.documentId}?meta=1`, { cache: 'no-store' })
          if (docRes.ok) documentMeta = (await docRes.json()).document ?? null
        }
        if (cancelled) return

        setState({ status: 'ready', chat: data.chat ?? null, messages: data.messages ?? [], documentMeta })
      } catch {
        if (!cancelled) setState(s => ({ ...s, status: 'ready' }))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [user, id])

  if (!user) return null

  return (
    <AppShell>
      {state.status === 'loading' && (
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-3.5 h-9 w-9 animate-pulse-soft rounded-xl bg-primary/80" />
            <p className="font-serif text-reading-sm italic text-muted-foreground">Opening the conversation…</p>
          </div>
        </div>
      )}

      {state.status === 'missing' && (
        <div className="flex h-full items-center justify-center px-6">
          <div className="max-w-sm text-center">
            <h1 className="font-display text-xl font-semibold text-foreground">Conversation not found</h1>
            <p className="mt-2 font-serif text-reading-sm italic text-muted-foreground">
              It may have been deleted. Start a new one from the sidebar and we will pick up where you left off.
            </p>
          </div>
        </div>
      )}

      {state.status === 'ready' && (
        <ChatView chat={state.chat} initialMessages={state.messages} documentMeta={state.documentMeta} />
      )}
    </AppShell>
  )
}
