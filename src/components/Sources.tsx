'use client'

/**
 * The citations under an answer.
 *
 * Every passage BODHA leaned on is shown as a numbered chip that matches the
 * [1] in the answer. Opening one shows the translator's own words, the edition
 * and a link to the full text — so a student can check the claim rather than
 * trust the tutor.
 */

import { useState } from 'react'
import { BookOpen, ChevronDown, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MessageSource } from '@/lib/types'

export function Sources({ sources, className }: { sources: MessageSource[]; className?: string }) {
  const [openId, setOpenId] = useState<string | null>(null)
  if (!sources.length) return null
  const open = sources.find(source => source.id === openId) ?? null

  return (
    <div className={cn('mt-3', className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-0.5 inline-flex items-center gap-1.5 text-ui-sm text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5 text-primary" strokeWidth={1.8} />
          From the shelf
        </span>
        {sources.map(source => (
          <button
            key={source.id}
            type="button"
            onClick={() => setOpenId(openId === source.id ? null : source.id)}
            aria-expanded={openId === source.id}
            title={`${source.title} — ${source.ref}`}
            className={cn(
              'inline-flex max-w-[16rem] items-center gap-1 rounded-full border px-2.5 py-1 text-ui-sm transition-colors',
              openId === source.id
                ? 'border-primary/40 bg-primary/[0.07] text-foreground'
                : 'border-border/70 bg-surface/60 text-muted-foreground hover:border-primary/30 hover:text-foreground',
            )}
          >
            <span className="font-medium text-primary">[{source.id}]</span>
            <span className="truncate">{source.title}</span>
            <ChevronDown
              className={cn('h-3 w-3 shrink-0 transition-transform', openId === source.id && 'rotate-180')}
              strokeWidth={2}
            />
          </button>
        ))}
      </div>

      {open && (
        <div className="mt-2 rounded-xl border border-border/70 bg-surface/60 p-3.5">
          <p className="text-ui-sm font-medium text-foreground">
            {open.title}
            {open.ref && open.ref !== 'Opening' && (
              <span className="font-normal text-muted-foreground"> · {open.ref}</span>
            )}
          </p>
          <p className="mt-0.5 text-ui-sm text-muted-foreground">
            {open.translator} · {open.year}
          </p>
          <blockquote className="mt-2 border-l-2 border-primary/30 pl-3 font-serif text-reading-sm leading-relaxed text-foreground/90">
            {open.excerpt}
          </blockquote>
          <a
            href={open.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-2.5 inline-flex items-center gap-1.5 text-ui-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Read the full text
            <ExternalLink className="h-3 w-3" strokeWidth={1.9} />
          </a>
        </div>
      )}
    </div>
  )
}
