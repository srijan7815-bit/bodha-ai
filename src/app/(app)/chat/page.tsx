'use client'

import { useAuth } from '@/components/AuthProvider'
import AppShell from '@/components/AppShell'
import ChatView from '@/components/ChatView'

/**
 * /chat — a fresh, untitled conversation. The first message creates
 * the chat server-side and the page swaps to /chat/:id.
 */
export default function NewChatPage() {
  const { user } = useAuth()
  if (!user) return null

  return (
    <AppShell>
      <ChatView user={user} chat={null} initialMessages={[]} documentMeta={null} />
    </AppShell>
  )
}