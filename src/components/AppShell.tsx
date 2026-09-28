'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useAuth } from '@/components/AuthProvider'
import type { Chat, DocumentMeta } from '@/lib/types'
import {
  Plus,
  MessageCircle,
  BookOpen,
  Boxes,
  Trash2,
  Menu,
  X,
  LogOut,
  Sun,
  Moon,
} from 'lucide-react'

export const CHATS_EVENT = 'bodha:chats-changed'

/** Notify the sidebar (and anyone listening) that the chat list changed. */
export function announceChatsChanged() {
  window.dispatchEvent(new CustomEvent(CHATS_EVENT))
}

interface AppShellProps {
  children: React.ReactNode
}

export default function AppShell({ children }: AppShellProps) {
  const { user } = useAuth()
  const pathname = usePathname()
  const [chats, setChats] = useState<Chat[] | null>(null)
  const [docsCount, setDocsCount] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const refreshChats = useCallback(async () => {
    try {
      const [chatsRes, docsRes] = await Promise.all([
        fetch('/api/chats', { cache: 'no-store' }),
        fetch('/api/documents', { cache: 'no-store' }),
      ])
      if (chatsRes.ok) setChats((await chatsRes.json()).chats ?? [])
      if (docsRes.ok) setDocsCount(((await docsRes.json()).documents ?? []).length)
    } catch {
      setChats([])
    }
  }, [])

  useEffect(() => {
    refreshChats()
  }, [refreshChats, pathname])

  useEffect(() => {
    const handler = () => refreshChats()
    window.addEventListener(CHATS_EVENT, handler)
    return () => window.removeEventListener(CHATS_EVENT, handler)
  }, [refreshChats])

  // close mobile sidebar on navigation
  useEffect(() => {
    setSidebarOpen(false)
  }, [pathname])

  const firstName = user?.name.split(' ')[0] ?? 'Student'

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[280px] flex-col border-r border-border bg-card transition-transform duration-300 md:static md:translate-x-0',
          sidebarOpen ? 'translate-x-0 shadow-warm-lg' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between px-5 pt-5">
          <Link href="/chat" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-warm">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 2c-3.5 3.6-5.5 7-5.5 10.2a5.5 5.5 0 0 0 11 0C17.5 9 15.5 5.6 12 2z" />
              </svg>
            </span>
            <span className="font-display text-lg font-semibold tracking-tight text-foreground">BODHA</span>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(false)}
            className="md:hidden"
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="px-4 pt-5">
          <Button asChild className="w-full">
            <Link href="/chat" onClick={() => setSidebarOpen(false)}>
              <Plus className="h-4 w-4" />
              New chat
            </Link>
          </Button>
        </div>

        <nav className="mt-5 space-y-0.5 px-3">
          <NavItem
            href="/chat"
            icon={<MessageCircle className="h-4 w-4" />}
            label="Chats"
            active={pathname === '/chat' || pathname.startsWith('/chat/')}
          />
          <NavItem
            href="/library"
            icon={<BookOpen className="h-4 w-4" />}
            label={`Library${docsCount ? ` · ${docsCount}` : ''}`}
            active={pathname.startsWith('/library')}
          />
          <NavItem
            href="/sandbox"
            icon={<Boxes className="h-4 w-4" />}
            label="Sandbox"
            active={pathname.startsWith('/sandbox')}
          />
        </nav>

        <div className="mx-5 mt-5 mb-2 flex items-center justify-between text-[11px] font-medium uppercase tracking-widest text-muted-foreground/80">
          Recent
        </div>

        <ChatList chats={chats} pathname={pathname} />

        {/* footer */}
        <div className="mt-auto space-y-3 border-t border-border/70 p-4">
          <ThemeToggleRow />
          <div className="flex items-center justify-between rounded-xl bg-accent px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar className="h-8 w-8">
                {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.name} />}
                <AvatarFallback className="bg-primary/15 text-sm font-semibold text-primary">
                  {firstName?.[0]?.toUpperCase() ?? 'S'}
                </AvatarFallback>
              </Avatar>
              <span className="truncate text-sm font-medium text-foreground">{firstName}</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={async () => {
                try {
                  const { signOut } = await import('firebase/auth')
                  const { auth } = await import('@/lib/firebase/client')
                  if (auth) await signOut(auth)
                } catch {}
                window.location.href = '/'
              }}
              className="text-muted-foreground hover:bg-primary/15 hover:text-primary"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-center text-[11px] text-muted-foreground/70">
            BODHA AI · created by <span className="font-semibold text-muted-foreground">Srijan Singh & Parv Mishra</span>
          </p>
        </div>
      </aside>

      {/* mobile scrim */}
      {sidebarOpen && (
        <Button
          variant="ghost"
          aria-label="Close menu"
          className="fixed inset-0 z-30 animate-fade-in bg-black/30 backdrop-blur-[2px] md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Main ────────────────────────────────────────────────────── */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border/60 px-4 py-3 md:hidden">
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <Menu className="h-4 w-4" />
          </Button>
          <span className="font-display text-base font-semibold text-foreground">BODHA</span>
        </header>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  )
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function NavItem({
  href,
  icon,
  label,
  active,
}: {
  href: string
  icon: React.ReactNode
  label: string
  active?: boolean
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
        active ? 'bg-primary/15 text-primary' : 'text-foreground/75 hover:bg-accent hover:text-foreground',
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </Link>
  )
}

function ChatList({ chats, pathname }: { chats: Chat[] | null; pathname: string }) {
  const router = useRouter()

  async function remove(chat: Chat) {
    if (!window.confirm(`Delete "${chat.title}"? This cannot be undone.`)) return
    await fetch(`/api/chats/${chat.id}`, { method: 'DELETE' }).catch(() => {})
    announceChatsChanged()
    if (pathname === `/chat/${chat.id}`) router.push('/chat')
  }

  if (chats === null) {
    return (
      <div className="space-y-2 px-4 py-2">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="h-8 animate-pulse-soft rounded-lg bg-accent" />
        ))}
      </div>
    )
  }

  if (chats.length === 0) {
    return (
      <p className="px-5 py-3 text-sm italic text-muted-foreground/70">
        No conversations yet — ask your first question and it will appear here.
      </p>
    )
  }

  return (
    <ul className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-2">
      {chats.map(chat => {
        const active = pathname === `/chat/${chat.id}`
        return (
          <li key={chat.id} className="group relative">
            <Link
              href={`/chat/${chat.id}`}
              className={cn(
                'flex items-center rounded-xl py-2 pl-3 pr-9 text-sm transition-colors',
                active ? 'bg-primary/15 font-medium text-primary' : 'text-foreground/75 hover:bg-accent hover:text-foreground',
              )}
            >
              <span className="truncate">{chat.title}</span>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => remove(chat)}
              className="absolute right-1.5 top-1/2 h-6 w-6 -translate-y-1/2 opacity-0 transition-all hover:bg-destructive/15 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
              aria-label={`Delete ${chat.title}`}
              title="Delete conversation"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </li>
        )
      })}
    </ul>
  )
}

function ThemeToggleRow() {
  const [dark, setDark] = useState<boolean | null>(null)

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'))
  }, [])

  function toggle() {
    const next = !document.documentElement.classList.contains('dark')
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('bodha:theme', next ? 'dark' : 'light')
    } catch {}
    setDark(next)
    // theme-color follow-up for mobile chrome
    setTimeout(() => {
      const meta = document.querySelector('meta[name="theme-color"]')
      meta?.setAttribute('content', next ? '#1A1714' : '#FAF7F2')
    }, 50)
  }

  return (
    <Button
      variant="ghost"
      onClick={toggle}
      className="w-full justify-between text-foreground/75"
    >
      <span className="flex items-center gap-3">
        {dark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        {dark ? 'Warm night' : 'Warm paper'}
      </span>
      <span
        className={cn(
          'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
          dark ? 'bg-primary' : 'bg-border',
        )}
      >
        <span
          className={cn(
            'absolute h-3.5 w-3.5 rounded-full bg-background shadow transition-all',
            dark ? 'left-[18px]' : 'left-[3px]',
          )}
        />
      </span>
    </Button>
  )
}

export type { Chat, DocumentMeta }