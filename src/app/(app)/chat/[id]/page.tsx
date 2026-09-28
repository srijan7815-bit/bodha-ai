'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import AppShell from '@/components/AppShell'
import ChatView from '@/components/ChatView'
import { authFetch } from '@/lib/firebase/server-auth'
import type { Chat, DocumentMeta, Message } from '@/lib/types'

/**
 * /chat/:id — an existing conversation, loaded from Firestore.
 */
export default function ChatPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const [chat, setChat] = useState<Chat | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [documentMeta, setDocumentMeta] = useState<DocumentMeta | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading')

  useEffect(() => {
    if (!user || !id) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await authFetch(`/api/chats/${id}`, { cache: 'no-store' })
        if (!res.ok) {
          if (!cancelled) setStatus(res.status === 404 ? 'missing' : 'ready')
          return
        }
        const data = await res.json()
        if (cancelled) return
        setChat(data.chat)
        setMessages(data.messages ?? [])

        // resolve linked document metadata
        if (data.chat?.documentId) {
          const docRes = await authFetch(`/api/documents/${data.chat.documentId}?meta=1`, { cache: 'no-store' })
          if (docRes.ok && !cancelled) {
            const docData = await docRes.json()
            setDocumentMeta(docData.document ?? null)
          }
        }
        if (!cancelled) setStatus('ready')
      } catch {
        if (!cancelled) setStatus('ready')
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
        <div className="flex min-h-dvh items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-4 h-10 w-10 animate-pulse-soft rounded-xl bg-primary" />
            <p className="font-serif text-sm italic text-muted-foreground">Opening the conversation…</p>
          </div>
        </div>
      )}
      {status === 'missing' && (
        <div className="flex min-h-dvh items-center justify-center px-4">
          <div className="text-center">
            <p className="font-display text-xl font-semibold text-foreground">Conversation not found</p>
            <p className="mt-2 font-serif text-sm italic text-muted-foreground">
              It may have been deleted.
            </p>
          </div>
        </div>
      )}
      {status === 'ready' && (
        <ChatView user={user} chat={chat} initialMessages={messages} documentMeta={documentMeta} />
      )}
    </AppShell>
  )
}