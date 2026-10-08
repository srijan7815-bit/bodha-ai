'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { BookMarked, BookOpen, Boxes, LogOut, Monitor, Menu, MessageSquare, Moon, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings, Sun, Trash2 } from 'lucide-react'
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

/** What pages inside the shell can ask of it (open the menu, flip the theme…). */
interface ShellApi {
  openDrawer: () => void
  newChat: () => void
  dark: boolean
  toggleTheme: () => void
  /** Desktop only: the permanent sidebar can be tucked away. */
  sidebarCollapsed: boolean
  toggleSidebar: () => void
}
const ShellContext = createContext<ShellApi>({ openDrawer: () => {}, newChat: () => {}, dark: false, toggleTheme: () => {}, sidebarCollapsed: false, toggleSidebar: () => {} })
export const useShell = () => useContext(ShellContext)

const NAV = [
  { href: '/chat', label: 'Chats', icon: MessageSquare },
  { href: '/library', label: 'Library', icon: BookOpen },
  { href: '/iks', label: 'Knowledge Shelf', icon: BookMarked },
  { href: '/computer', label: 'Computer', icon: Monitor },
  { href: '/sandbox', label: 'Sandbox', icon: Boxes },
  { href: '/settings', label: 'Settings', icon: Settings },
]

const DRAWER_WIDTH = '84vw'
const EASE = [0.22, 1, 0.36, 1] as const

interface AppShellProps {
  children: React.ReactNode
}

/**
 * The shell. On a phone the menu is a drawer that sits *behind* the page and
 * the page slides aside to reveal it; on desktop it is a quiet permanent
 * sidebar. Both draw the same list, so there is one thing to learn.
 */
export default function AppShell({ children }: AppShellProps) {
  const { user, signOut } = useAuth()
  const pathname = usePathname()
  const router = useRouter()

  const [chats, setChats] = useState<Chat[] | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [dark, setDark] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [query, setQuery] = useState('')
  const touch = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'))
    try {
      setCollapsed(localStorage.getItem('bodha:sidebar') === 'closed')
    } catch {}
  }, [])

  const toggleSidebar = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev
      try {
        localStorage.setItem('bodha:sidebar', next ? 'closed' : 'open')
      } catch {}
      return next
    })
  }, [])

  // Ctrl/Cmd + B — the same shortcut other editors use for the sidebar.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b' && window.innerWidth >= 768) {
        event.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleSidebar])

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

  // The watchdog: while BODHA is open, ask for a health check every few minutes.
  // The server skips it if a recent one exists, so many tabs cost one run.
  useEffect(() => {
    const ping = () => {
      if (document.visibilityState !== 'visible') return
      void authFetch('/api/watchdog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {})
    }
    const first = setTimeout(ping, 20_000)
    const every = setInterval(ping, 5 * 60 * 1000)
    return () => {
      clearTimeout(first)
      clearInterval(every)
    }
  }, [])

  const toggleTheme = useCallback(() => {
    setDark(prev => {
      const next = !prev
      document.documentElement.classList.toggle('dark', next)
      try {
        localStorage.setItem('bodha:theme', next ? 'dark' : 'light')
      } catch {}
      return next
    })
  }, [])

  async function removeChat(id: string) {
    setChats(prev => (prev ? prev.filter(c => c.id !== id) : prev))
    await authFetch(`/api/chats/${id}`, { method: 'DELETE' }).catch(() => {})
    announceChatsChanged()
    if (pathname === `/chat/${id}`) router.push('/chat')
  }

  const newChat = useCallback(() => {
    setDrawerOpen(false)
    router.push('/chat')
  }, [router])

  const api = useMemo<ShellApi>(
    () => ({ openDrawer: () => setDrawerOpen(true), newChat, dark, toggleTheme, sidebarCollapsed: collapsed, toggleSidebar }),
    [newChat, dark, toggleTheme, collapsed, toggleSidebar],
  )

  // Swipe in from the left edge to open; swipe left anywhere to close.
  function onTouchStart(event: React.TouchEvent) {
    const t = event.touches[0]
    touch.current = { x: t.clientX, y: t.clientY }
  }
  function onTouchEnd(event: React.TouchEvent) {
    const start = touch.current
    touch.current = null
    if (!start || window.innerWidth >= 768) return
    const t = event.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = Math.abs(t.clientY - start.y)
    if (dy > 60) return
    if (!drawerOpen && start.x < 24 && dx > 70) setDrawerOpen(true)
    else if (drawerOpen && dx < -60) setDrawerOpen(false)
  }

  const visibleChats = (chats ?? []).filter(chat => chat.title.toLowerCase().includes(query.trim().toLowerCase()))

  /** `mobile` adds the staggered entrance; the desktop sidebar is static. */
  function renderMenu(mobile: boolean) {
    const reveal = (index: number) =>
      mobile
        ? {
            initial: false as const,
            animate: drawerOpen ? { opacity: 1, x: 0 } : { opacity: 0, x: -16 },
            transition: { duration: 0.32, ease: EASE, delay: drawerOpen ? 0.05 + index * 0.04 : 0 },
          }
        : {}

    return (
      <div className="relative flex h-full flex-col bg-surface">
        <motion.div {...reveal(0)} className="flex items-center gap-2.5 px-6 pb-2 pt-[max(1.1rem,env(safe-area-inset-top))] md:px-5">
          <Link href="/chat" className="inline-flex items-center gap-2.5" aria-label="BODHA home">
            <BodhaMark size={32} />
            <BodhaWordmark size="md" />
          </Link>
          {!mobile && (
            <button
              type="button"
              onClick={toggleSidebar}
              className="icon-btn ml-auto h-9 w-9"
              title="Close sidebar (Ctrl+B)"
              aria-label="Close sidebar"
            >
              <PanelLeftClose className="h-[18px] w-[18px]" strokeWidth={1.6} />
            </button>
          )}
        </motion.div>

        <nav className="px-3 pt-3 md:px-3">
          {NAV.map(({ href, label, icon: Icon }, index) => {
            const active = href === '/chat' ? pathname.startsWith('/chat') : pathname.startsWith(href)
            return (
              <motion.div key={href} {...reveal(index + 1)}>
                <Link
                  href={href}
                  className={cn(
                    'flex items-center gap-4 rounded-2xl px-3 py-3 text-[17px] transition-colors md:gap-2.5 md:rounded-lg md:py-2 md:text-ui',
                    active ? 'bg-foreground/[0.07] font-medium text-foreground' : 'text-foreground/80 hover:bg-foreground/[0.05]',
                  )}
                >
                  <Icon className="h-[22px] w-[22px] md:h-4 md:w-4" strokeWidth={1.6} />
                  {label}
                </Link>
              </motion.div>
            )
          })}
        </nav>

        <motion.div {...reveal(NAV.length + 1)} className="mx-6 mt-3 border-t border-border/70 md:mx-4" />

        <motion.div {...reveal(NAV.length + 2)} className="flex items-center justify-between px-6 pb-1 pt-4 md:px-5">
          <h2 className="text-[15px] font-medium text-muted-foreground md:text-ui-sm">Recents</h2>
        </motion.div>

        <div className="px-4 pb-1.5 md:px-4">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" strokeWidth={1.8} aria-hidden="true" />
            <span className="sr-only">Search conversations</span>
            <input
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search conversations"
              className="h-9 w-full rounded-xl border border-transparent bg-foreground/[0.05] pl-9 pr-3 text-ui text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-border focus-visible:bg-background"
            />
          </label>
        </div>

        <div className="scrollbar-quiet min-h-0 flex-1 overflow-y-auto px-3 pb-28 md:pb-24">
          {chats === null && (
            <div className="space-y-1 px-1 pt-1">
              {[0, 1, 2].map(i => (
                <div key={i} className="h-9 animate-pulse-soft rounded-xl bg-foreground/[0.04]" />
              ))}
            </div>
          )}
          {chats?.length === 0 && (
            <p className="px-3 py-2 font-serif text-reading-sm italic text-muted-foreground/80">No conversations yet — ask your first question.</p>
          )}
          {chats && chats.length > 0 && query.trim() && visibleChats.length === 0 && (
            <p className="px-3 py-2 text-ui-sm text-muted-foreground">Nothing matches “{query.trim()}”.</p>
          )}
          <ul className="space-y-0.5">
            {visibleChats.map((chat, index) => {
              const active = pathname === `/chat/${chat.id}`
              return (
                <motion.li
                  key={chat.id}
                  initial={mobile ? false : { opacity: 0, y: 4 }}
                  animate={mobile ? (drawerOpen ? { opacity: 1, x: 0 } : { opacity: 0, x: -14 }) : { opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: EASE, delay: mobile && drawerOpen ? 0.3 + Math.min(index, 8) * 0.03 : 0 }}
                  className="group/item relative"
                >
                  <Link
                    href={`/chat/${chat.id}`}
                    className={cn(
                      'flex items-center gap-3.5 rounded-xl py-2.5 pl-3 pr-10 text-[15.5px] transition-colors md:text-ui',
                      active ? 'bg-foreground/[0.07] font-medium text-foreground' : 'text-foreground/75 hover:bg-foreground/[0.05] hover:text-foreground',
                    )}
                  >
                    <MessageSquare className="h-[17px] w-[17px] shrink-0 text-muted-foreground" strokeWidth={1.6} />
                    <span className="truncate">{chat.title}</span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => void removeChat(chat.id)}
                    aria-label={`Delete ${chat.title}`}
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded-lg p-2 text-muted-foreground/45 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 md:opacity-0 md:group-hover/item:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                  </button>
                </motion.li>
              )
            })}
          </ul>
        </div>

        {/* Account + New chat float over the bottom of the list. */}
        <motion.div
          {...reveal(NAV.length + 3)}
          className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-surface from-60% to-transparent px-5 pb-[max(1.1rem,env(safe-area-inset-bottom))] pt-10"
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Account"
                className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary font-serif text-[20px] font-semibold text-primary-foreground shadow-card md:h-11 md:w-11 md:text-[17px]"
              >
                {(user?.name ?? 'S').trim().charAt(0).toUpperCase()}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-60">
              <DropdownMenuLabel className="font-normal">
                <span className="block truncate text-ui font-medium">{user?.name}</span>
                <span className="block truncate text-ui-sm text-muted-foreground">{user?.email}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => router.push('/settings')} className="cursor-pointer">
                <Settings className="mr-2 h-4 w-4" strokeWidth={1.7} />
                Settings
              </DropdownMenuItem>
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

          <button
            type="button"
            onClick={newChat}
            className="pointer-events-auto inline-flex h-14 items-center gap-2 rounded-full bg-foreground px-6 text-[17px] font-medium text-background shadow-card md:h-11 md:px-5 md:text-ui"
          >
            <Plus className="h-5 w-5 md:h-4 md:w-4" strokeWidth={1.9} />
            New chat
          </button>
        </motion.div>
      </div>
    )
  }

  const onChat = pathname.startsWith('/chat')

  return (
    <ShellContext.Provider value={api}>
      <div className="relative h-dvh overflow-hidden bg-surface md:flex" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {/* Desktop sidebar */}
        <aside
          className={cn('hidden shrink-0 overflow-hidden transition-[width] duration-300 ease-out md:block', collapsed ? 'w-0 border-r-0' : 'w-sidebar border-r border-border/70')}
          aria-hidden={collapsed}
          {...(collapsed ? ({ inert: '' } as object) : {})}
        >
          <div className="h-full w-sidebar">{renderMenu(false)}</div>
        </aside>

        {/* Phone drawer: lives behind the page and is revealed as the page slides aside. */}
        <div
          className="fixed inset-y-0 left-0 z-0 md:hidden"
          style={{ width: DRAWER_WIDTH }}
          aria-hidden={!drawerOpen}
          {...(!drawerOpen ? ({ inert: '' } as object) : {})}
        >
          {renderMenu(true)}
        </div>

        {/* The page */}
        <motion.div
          initial={false}
          animate={{ x: drawerOpen ? DRAWER_WIDTH : '0vw', scale: drawerOpen ? 0.98 : 1, borderRadius: drawerOpen ? 28 : 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 36, mass: 0.9 }}
          className={cn(
            'relative z-10 flex h-dvh min-w-0 flex-1 flex-col overflow-hidden bg-background will-change-transform',
            drawerOpen && 'shadow-lift',
          )}
          style={{ transformOrigin: 'left center' }}
        >
          {drawerOpen && (
            <button type="button" aria-label="Close menu" onClick={() => setDrawerOpen(false)} className="absolute inset-0 z-50 cursor-default md:hidden" />
          )}

          {/* Pages that have no header of their own get a slim one on phones. */}
          {!onChat && (
            <header className="flex h-14 shrink-0 items-center gap-2 px-2 md:hidden">
              <button type="button" onClick={() => setDrawerOpen(true)} className="icon-btn h-11 w-11" aria-label="Open menu">
                <Menu className="h-[22px] w-[22px]" strokeWidth={1.6} />
              </button>
              <div className="flex-1" />
              <button type="button" onClick={toggleTheme} className="icon-btn h-11 w-11" aria-label={dark ? 'Switch to paper mode' : 'Switch to night mode'}>
                {dark ? <Sun className="h-5 w-5" strokeWidth={1.6} /> : <Moon className="h-5 w-5" strokeWidth={1.6} />}
              </button>
            </header>
          )}

          {!onChat && collapsed && (
            <header className="hidden h-14 shrink-0 items-center px-3 md:flex">
              <button type="button" onClick={toggleSidebar} className="icon-btn h-10 w-10" title="Open sidebar (Ctrl+B)" aria-label="Open sidebar">
                <PanelLeftOpen className="h-5 w-5" strokeWidth={1.6} />
              </button>
            </header>
          )}

          <main className="relative min-h-0 flex-1 overflow-hidden">{children}</main>
        </motion.div>
      </div>
    </ShellContext.Provider>
  )
}
