'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import AppShell from '@/components/AppShell'
import ChatView from '@/components/ChatView'
import { useAuth } from '@/components/AuthProvider'

function NewChat() {
  const params = useSearchParams()
  const { user } = useAuth()

  // A fresh conversation. `/chat?document=<id>` links a document from the
  // Library, and `?q=` prefills the composer (used by the reader's
  // “Ask BODHA about this” tab).
  const documentId = params.get('document')
  const draft = params.get('q')

  if (!user) return null

  return (
    <AppShell>
      <ChatView chat={null} initialMessages={[]} documentMeta={null} initialDocumentId={documentId} initialDraft={draft} />
    </AppShell>
  )
}

export default function NewChatPage() {
  return (
    <Suspense fallback={null}>
      <NewChat />
    </Suspense>
  )
}
