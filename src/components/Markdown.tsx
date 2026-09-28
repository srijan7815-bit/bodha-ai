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
  onRun?: (lang: RunnableLang, code: string) => void
}

/** Code block with copy + run-in-sandbox actions */
function CodeBlock({
  code,
  lang,
  onRun,
}: {
  code: string
  lang: RunnableLang | 'other'
  onRun?: (lang: RunnableLang, code: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const runnable = lang === 'html' || lang === 'css' || lang === 'js'

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  return (
    <div className="group/code relative my-4">
      <div className="flex items-center justify-between rounded-t-xl border border-b-0 border-black/10 bg-[#1e1912] px-4 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wider text-[#93866c]">{lang}</span>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/code:opacity-100">
          {runnable && onRun && (
            <button
              onClick={() => onRun(lang as RunnableLang, code)}
              className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-[#e8906c] transition-colors hover:bg-[#e8906c]/10"
              title="Run in sandbox"
            >
              <Play className="h-3 w-3" />
              Run
            </button>
          )}
          <button
            onClick={copy}
            className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-[#93866c] transition-colors hover:bg-white/10 hover:text-[#efe3cc]"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <pre className="!mt-0 !rounded-t-none">
        <code className={`language-${lang === 'other' ? 'text' : lang}`}>{code}</code>
      </pre>
    </div>
  )
}

const Markdown = memo(function Markdown({ content, onRun }: MarkdownProps) {
  return (
    <div className="prose-bodha">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={{
          pre: ({ children }) => {
            // Extract code from the pre element
            const child = Array.isArray(children) ? children[0] : children
            if (!child || typeof child !== 'object' || !('props' in child)) return <pre>{children}</pre>

            const props = child.props as { className?: string; children?: React.ReactNode }
            const className = props.className ?? ''
            const match = /language-(\w+)/.exec(className)
            const lang = (match?.[1] ?? 'other') as RunnableLang | 'other'

            // Extract raw text content
            let code = ''
            const extract = (node: React.ReactNode): void => {
              if (typeof node === 'string') {
                code += node
              } else if (Array.isArray(node)) {
                node.forEach(extract)
              } else if (node && typeof node === 'object' && 'props' in node) {
                extract((node.props as { children?: React.ReactNode }).children)
              }
            }
            extract(props.children)

            return <CodeBlock code={code} lang={lang} onRun={onRun} />
          },
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})

export default Markdown