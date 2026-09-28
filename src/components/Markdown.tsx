'use client'

import { memo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import { Check, Copy, Play } from 'lucide-react'
import { cn } from '@/lib/utils'

export type RunnableLang = 'html' | 'css' | 'js'

interface MarkdownProps {
  content: string
  className?: string
  /** When provided, code blocks get a “Run in sandbox” action. */
  onRun?: (lang: RunnableLang, code: string) => void
}

const RUNNABLE: Record<string, RunnableLang> = {
  html: 'html',
  htm: 'html',
  css: 'css',
  js: 'js',
  javascript: 'js',
  jsx: 'js',
}

function CodeBlock({ code, lang, onRun }: { code: string; lang: string; onRun?: MarkdownProps['onRun'] }) {
  const [copied, setCopied] = useState(false)
  const runnable = RUNNABLE[lang]

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {}
  }

  return (
    <div className="group/code not-prose my-4">
      <div className="flex items-center justify-between gap-2 rounded-t-xl border border-b-0 border-black/20 bg-code px-3.5 py-1.5">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink/45">
          {runnable ?? (lang || 'text')}
        </span>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/code:opacity-100">
          {runnable && onRun && (
            <button
              type="button"
              onClick={() => onRun(runnable, code)}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-ink/70 transition-colors hover:bg-white/[0.07] hover:text-ink"
            >
              <Play className="h-3 w-3" strokeWidth={2} />
              Run
            </button>
          )}
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-ink/70 transition-colors hover:bg-white/[0.07] hover:text-ink"
          >
            {copied ? <Check className="h-3 w-3" strokeWidth={2} /> : <Copy className="h-3 w-3" strokeWidth={2} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <pre className="mt-0 rounded-b-xl rounded-t-none border border-t-0 border-black/20">
        <code className={lang ? `language-${lang} hljs` : 'hljs'}>{code}</code>
      </pre>
    </div>
  )
}

/**
 * Reading-first markdown.
 *
 * Composition lives in `.reading` (globals.css) so chat answers, document text
 * and the reader share one typographic voice.
 */
function MarkdownInner({ content, className, onRun }: MarkdownProps) {
  return (
    <div className={cn('reading', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }], [rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code({ className: cls, children, ...props }) {
            const text = String(children ?? '')
            const match = /language-([\w+-]+)/.exec(cls ?? '')
            const isBlock = !!match || text.includes('\n')
            if (!isBlock) {
              return (
                <code className={cls} {...props}>
                  {children}
                </code>
              )
            }
            return <CodeBlock code={text.replace(/\n$/, '')} lang={match?.[1]?.toLowerCase() ?? ''} onRun={onRun} />
          },
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="not-prose my-4 overflow-x-auto rounded-xl border border-border/70">
              <table className="w-full">{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export default memo(MarkdownInner)
