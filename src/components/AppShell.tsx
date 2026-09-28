'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { BookOpen, Boxes, LogOut, Menu, MessageSquare, Moon, MoreHorizontal, Plus, Sun, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/components/AuthProvider'
import { BodhaMark, BodhaWordmark } from '@/components/Brand'
import { authFetch } from '@/lib/firebase/client-token'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Chat } from '@/lib/types'

export const CHATS_EVENT = 'bodha:chats-changed'
export function announceChatsChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CHATS_EVENT))
}

const NAV = [
  { href: '/chat', label: 'Chat', icon: MessageSquare },
  { href: '/library', label: 'Library', icon: BookOpen },
  { href: '/sandbox', label: 'Sandbox', icon: Boxes },
]

interface AppShellProps {
  children: React.ReactNode
}

/**
 * The shell: a quiet sidebar on desktop, a drawer on phones, one content area.
 * Navigation stays out of the way so the answer is the loudest thing on screen.
 */
export default function AppShell({ children }: AppShellProps) {
  const { user, signOut } = useAuth()
  const pathname = usePathname()
  const router = useRouter()

  const [chats, setChats] = useState<Chat[] | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [dark, setDark] = useState(false)

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'))
  }, [])

  const refresh = useCallback(async () => {
    try {
      const res = await authFetch('/api/chats', { cache: 'no-store' })
      if (res.ok) setChats(((await res.json()).chats ?? []) as Chat[])
      else setChats([])
    } catch {
      setChats([])
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, pathname])

  useEffect(() => {
    const onChange = () => void refresh()
    window.addEventListener(CHATS_EVENT, onChange)
    return () => window.removeEventListener(CHATS_EVENT, onChange)
  }, [refresh])

  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  function toggleTheme() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('bodha:theme', next ? 'dark' : 'light')
    } catch {}
  }

  async function removeChat(id: string) {
    setChats(prev => (prev ? prev.filter(c => c.id !== id) : prev))
    await authFetch(`/api/chats/${id}`, { method: 'DELETE' }).catch(() => {})
    announceChatsChanged()
    if (pathname === `/chat/${id}`) router.push('/chat')
  }

  const newChat = () => {
    setDrawerOpen(false)
    router.push('/chat')
  }

  const sidebar = (
    <div className="flex h-full flex-col bg-surface/60">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <Link href="/chat" className="inline-flex items-center gap-2" aria-label="BODHA home">
          <BodhaMark size={30} />
          <BodhaWordmark size="md" />
        </Link>
      </div>

      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={newChat}
          className="flex w-full items-center gap-2 rounded-xl border border-border/80 bg-background px-3 py-2.5 text-ui font-medium text-foreground shadow-soft transition-colors hover:border-primary/40"
        >
          <Plus className="h-4 w-4 text-primary" strokeWidth={1.9} />
          New chat
        </button>
      </div>

      <nav className="px-3 py-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === '/chat' ? pathname.startsWith('/chat') : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-ui transition-colors',
                active ? 'bg-foreground/[0.06] font-medium text-foreground' : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
              {label}
            </Link>
          )
        })}
      </nav>

      <div className="mt-3 flex items-center justify-between px-4 pb-1.5">
        <span className="text-ui-xs font-medium uppercase tracking-[0.12em] text-muted-foreground/70">Recents</span>
      </div>

      <div className="scrollbar-quiet min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {chats === null && (
          <div className="space-y-1 px-1">
            {[0, 1, 2].map(i => (
              <div key={i} className="h-8 animate-pulse-soft rounded-lg bg-foreground/[0.04]" />
            ))}
          </div>
        )}
        {chats?.length === 0 && (
          <p className="px-3 py-2 font-serif text-reading-sm italic text-muted-foreground/80">
            No conversations yet — ask your first question.
          </p>
        )}
        <ul className="space-y-0.5">
          {chats?.map(chat => {
            const active = pathname === `/chat/${chat.id}`
            return (
              <li key={chat.id} className="group/item relative">
                <Link
                  href={`/chat/${chat.id}`}
                  className={cn(
                    'block truncate rounded-lg py-2 pl-3 pr-8 text-ui transition-colors',
                    active ? 'bg-foreground/[0.06] font-medium text-foreground' : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
                  )}
                >
                  {chat.title}
                </Link>
                <button
                  type="button"
                  onClick={() => void removeChat(chat.id)}
                  aria-label={`Delete ${chat.title}`}
                  className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded-md p-1.5 text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive group-hover/item:block"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="border-t border-border/60 p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-foreground/[0.04]"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/12 font-serif text-ui font-semibold text-primary">
                {(user?.name ?? 'S').trim().charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ui font-medium text-foreground">{user?.name}</span>
                <span className="block truncate text-ui-sm text-muted-foreground">{user?.email}</span>
              </span>
              <MoreHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.7} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <span className="block text-ui-sm text-muted-foreground">Signed in as</span>
              <span className="block truncate text-ui font-medium">{user?.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={toggleTheme} className="cursor-pointer">
              {dark ? <Sun className="mr-2 h-4 w-4" strokeWidth={1.7} /> : <Moon className="mr-2 h-4 w-4" strokeWidth={1.7} />}
              {dark ? 'Paper mode' : 'Night mode'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void signOut()} className="cursor-pointer text-destructive focus:text-destructive">
              <LogOut className="mr-2 h-4 w-4" strokeWidth={1.7} />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden w-sidebar shrink-0 border-r border-border/70 md:block">{sidebar}</aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {drawerOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0 bg-foreground/25 backdrop-blur-[2px]"
              onClick={() => setDrawerOpen(false)}
            />
            <motion.aside
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: 'spring', stiffness: 420, damping: 38 }}
              className="absolute inset-y-0 left-0 w-[86%] max-w-[304px] border-r border-border/70 bg-surface shadow-lift"
            >
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="icon-btn absolute right-2 top-2.5 z-10"
                aria-label="Close menu"
              >
                <X className="h-4 w-4" strokeWidth={1.8} />
              </button>
              {sidebar}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-13 shrink-0 items-center gap-2 border-b border-border/60 bg-background/90 px-3 py-2 backdrop-blur md:hidden">
          <button type="button" onClick={() => setDrawerOpen(true)} className="icon-btn" aria-label="Open menu">
            <Menu className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </button>
          <Link href="/chat" className="inline-flex items-center gap-2" aria-label="BODHA home">
            <BodhaMark size={26} />
            <BodhaWordmark size="sm" />
          </Link>
          <div className="flex-1" />
          <button type="button" onClick={newChat} className="icon-btn" aria-label="New chat">
            <Plus className="h-[18px] w-[18px]" strokeWidth={1.9} />
          </button>
        </header>

        <main className="relative min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  )
}
