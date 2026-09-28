'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { RunnableLang } from '@/components/Markdown'
import SandboxWorkbench, { TEMPLATES, type Project } from '@/components/SandboxWorkbench'
import { Button } from '@/components/ui/button'

interface Props {
  code: { lang: RunnableLang; code: string } | null
  onClose: () => void
  onFull: () => void
}

/**
 * Slide-over sandbox inside the chat — code blocks from BODHA's answers
 * land here with a live preview, without leaving the conversation.
 */
export default function SandboxDrawer({ code, onClose, onFull }: Props) {
  const [visible, setVisible] = useState(false)
  const [project, setProject] = useState<Project | null>(null)

  useEffect(() => {
    if (code) {
      const base = TEMPLATES.blank.project
      const next: Project =
        code.lang === 'html'
          ? { ...base, html: code.code }
          : code.lang === 'css'
            ? { ...base, css: code.code }
            : { ...base, js: code.code }
      setProject(next)
      setVisible(true)
    } else {
      setVisible(false)
    }
  }, [code])

  // close on Escape
  useEffect(() => {
    if (!visible) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [visible, onClose])

  if (!code) return null

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Code sandbox">
      <Button
        variant="ghost"
        aria-label="Close sandbox"
        className="absolute inset-0 animate-fade-in bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        className={`absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-border bg-background shadow-warm-lg transition-transform duration-300 ${
          visible ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="font-display text-sm font-semibold text-foreground">Live sandbox</span>
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              safe · runs in your browser
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/sandbox"
              onClick={onFull}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-primary"
            >
              Open full sandbox ↗
            </Link>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <SandboxWorkbench initialProject={project ?? undefined} embedded />
        </div>
      </div>
    </div>
  )
}