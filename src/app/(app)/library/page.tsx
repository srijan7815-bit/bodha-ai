'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { BookOpen, CloudUpload, FileText, Loader2, MessageSquare, RefreshCw, ScanText, Trash2, TriangleAlert, UploadCloud } from 'lucide-react'
import AppShell from '@/components/AppShell'
import { useAuth } from '@/components/AuthProvider'
import { authFetch, getFirebaseIdToken } from '@/lib/firebase/client-token'
import { cn } from '@/lib/utils'
import { titleFromFilename } from '@/lib/slug'
import { useDocumentScan } from '@/lib/ocr-client'
import type { DocumentMeta } from '@/lib/types'

const ACCEPT = '.pdf,.txt,.md,.markdown,.csv,.json,.html,.js,.ts,.py,.java,.c,.cpp,.css,.png,.jpg,.jpeg'
/** The server caps a single upload at 4 MB; keep the two in step. */
const MAX_UPLOAD = 4 * 1024 * 1024

const KIND_LABEL: Record<string, string> = { pdf: 'PDF', text: 'Text', markdown: 'Notes', code: 'Code' }

function kindOf(filename: string): DocumentMeta['kind'] {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'pdf') return 'pdf'
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (['txt', 'csv', 'json', 'html'].includes(ext)) return 'text'
  return 'code'
}

export default function LibraryPage() {
  const { user } = useAuth()
  const [docs, setDocs] = useState<DocumentMeta[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [uploading, setUploading] = useState<{ name: string; progress: number; stage: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const scanner = useDocumentScan()

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/documents', { cache: 'no-store' })
      const list = res.ok ? (((await res.json()).documents ?? []) as DocumentMeta[]) : []
      setDocs(list)
      return list
    } catch {
      setDocs([])
      return [] as DocumentMeta[]
    }
  }, [])

  useEffect(() => {
    if (user) void load()
  }, [user, load])

  /**
   * Read a scanned document: the browser rasterises each page and
   * nvidia/nemotron-parse recognises the text, which is saved back onto the
   * document so every later question can use it.
   */
  const runOcr = useCallback(
    async (doc: DocumentMeta) => {
      setBusyId(doc.id)
      setError(null)
      const result = await scanner.scan(doc.id, 12)
      if (result.ok > 0 && result.chars === 0) {
        setError(`I read ${result.ok} page${result.ok === 1 ? '' : 's'} of “${doc.title}” but found no text on them.`)
      }
      setBusyId(null)
      await load()
    },
    [load, scanner],
  )

  const remove = useCallback(
    async (doc: DocumentMeta) => {
      setBusyId(doc.id)
      setDocs(prev => (prev ? prev.filter(d => d.id !== doc.id) : prev))
      await authFetch(`/api/documents/${doc.id}`, { method: 'DELETE' }).catch(() => {})
      setBusyId(null)
      await load()
    },
    [load],
  )

  const upload = useCallback(
    async (file: File) => {
      setError(null)
      if (file.size > MAX_UPLOAD) {
        setError(`“${file.name}” is larger than 4 MB. Try compressing it, or upload the book as chapters — one at a time.`)
        return
      }

      const title = titleFromFilename(file.name)
      setUploading({ name: file.name, progress: 5, stage: 'Uploading…' })

      try {
        const form = new FormData()
        form.append('file', file)
        form.append('title', title)
        form.append('kind', kindOf(file.name))

        // XHR so the student can actually see the upload move on a slow phone
        // connection; the auth header matches authFetch for Firebase mode.
        const token = await getFirebaseIdToken()
        const { ok, status, body } = await new Promise<{ ok: boolean; status: number; body: { error?: string; ocrPending?: boolean } }>(
          resolve => {
            const xhr = new XMLHttpRequest()
            xhr.open('POST', '/api/documents')
            xhr.withCredentials = true
            if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
            xhr.upload.onprogress = e => {
              if (!e.lengthComputable) return
              const pct = Math.round((e.loaded / e.total) * 74)
              setUploading(current =>
                current ? { ...current, progress: Math.max(5, pct), stage: 'Uploading…' } : current,
              )
            }
            xhr.onload = () => {
              let parsed: { error?: string; ocrPending?: boolean } = {}
              try {
                parsed = JSON.parse(xhr.responseText)
              } catch {}
              resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, body: parsed })
            }
            xhr.onerror = () => resolve({ ok: false, status: 0, body: {} })
            xhr.send(form)
          },
        )

        if (!ok) throw new Error(body.error ?? 'That upload did not work. Please try again.')

        // Born-digital PDFs are already searchable; scans get read page by page.
        if (body.ocrPending) {
          setUploading({ name: file.name, progress: 82, stage: 'Reading the scanned pages…' })
          const newDoc = await load()
          const target = newDoc?.find(d => d.title === title) ?? newDoc?.[0]
          if (target) {
            await scanner.scan(target.id, 12)
            await load()
          }
        }

        setUploading({ name: file.name, progress: 100, stage: 'Ready' })
        await load()
        setTimeout(() => setUploading(null), 650)
      } catch (err) {
        setUploading(null)
        setError((err as Error).message || 'That upload did not work. Please try again.')
      }
    },
    [load, scanner],
  )

  if (!user) return null

  return (
    <AppShell>
      <div className="scrollbar-quiet h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-4 pb-20 pt-8 md:px-8">
          <header className="mb-7">
            <h1 className="font-display text-[1.65rem] font-semibold tracking-[-0.02em] text-foreground">Library</h1>
            <p className="mt-1.5 font-serif text-reading text-muted-foreground text-pretty">
              Upload your books and notes. BODHA reads them, answers from their pages, and can read them with you in
              the page-turn reader.
            </p>
          </header>

          {/* Upload */}
          <div
            onDragOver={e => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => {
              e.preventDefault()
              setDragging(false)
              const file = e.dataTransfer.files?.[0]
              if (file) void upload(file)
            }}
            className={cn(
              'rounded-2xl border border-dashed p-6 text-center transition-colors',
              dragging ? 'border-primary/60 bg-primary/[0.04]' : 'border-border bg-surface/60',
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) void upload(file)
                e.target.value = ''
              }}
            />

            {uploading ? (
              <div className="mx-auto max-w-sm">
                <p className="mb-2.5 truncate text-ui font-medium text-foreground">{uploading.stage}</p>
                <div className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.08]">
                  <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${uploading.progress}%` }} />
                </div>
                <p className="mt-2 truncate text-ui-sm text-muted-foreground">{uploading.name}</p>
              </div>
            ) : (
              <>
                <CloudUpload className="mx-auto mb-3 h-6 w-6 text-primary/80" strokeWidth={1.6} />
                <p className="text-ui font-medium text-foreground">Drop a file here, or choose one</p>
                <p className="mx-auto mt-1 max-w-[38ch] font-serif text-reading-sm text-muted-foreground">
                  PDF (including scans), a photo of a page, notes and code. Up to 4 MB per file — chapters work best.
                </p>
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-ui font-medium text-primary-foreground shadow-soft transition-transform hover:scale-[1.02]"
                >
                  <UploadCloud className="h-4 w-4" strokeWidth={1.8} />
                  Choose a file
                </button>
              </>
            )}
          </div>

          {error && (
            <p className="mt-3 rounded-xl border border-destructive/25 bg-destructive/[0.06] px-3.5 py-2.5 text-ui text-destructive">
              {error}
            </p>
          )}

          {/* Documents */}
          <h2 className="mb-3 mt-9 text-ui-xs font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
            Your documents {docs ? `· ${docs.length}` : ''}
          </h2>

          {docs === null && (
            <div className="grid gap-2.5 sm:grid-cols-2">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="h-[86px] animate-pulse-soft rounded-2xl bg-foreground/[0.04]" />
              ))}
            </div>
          )}

          {docs?.length === 0 && (
            <p className="rounded-2xl border border-border/70 bg-surface/50 px-5 py-10 text-center font-serif text-reading italic text-muted-foreground">
              Nothing here yet. Add your first book above and I will start reading it with you.
            </p>
          )}

          <ul className="grid gap-2.5 sm:grid-cols-2">
            {docs?.map(doc => {
              const ocrPending = doc.hasText === false
              const scanning = busyId === doc.id && scanner.scanning
              return (
                <li key={doc.id} className="group relative rounded-2xl border border-border/70 bg-surface/70 p-3.5 shadow-soft transition-colors hover:border-primary/35">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <FileText className="h-[18px] w-[18px]" strokeWidth={1.7} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link href={`/library/${doc.id}`} className="block truncate text-ui font-medium text-foreground hover:text-primary">
                        {doc.title}
                      </Link>
                      <p className="mt-0.5 text-ui-sm text-muted-foreground">
                        {KIND_LABEL[doc.kind] ?? 'Document'}
                        {doc.pageCount ? ` · ${doc.pageCount} pages` : ''}
                        {doc.sizeBytes ? ` · ${Math.max(1, Math.round(doc.sizeBytes / 1024))} KB` : ''}
                      </p>

                      {scanning ? (
                        <p className="mt-1.5 inline-flex items-center gap-1.5 text-ui-sm text-primary">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
                          Reading page {scanner.progress?.page ?? 1} of {scanner.progress?.total ?? '…'}
                        </p>
                      ) : ocrPending ? (
                        <p className="mt-1.5 inline-flex items-center gap-1.5 text-ui-sm text-amber-700 dark:text-amber-500">
                          <ScanText className="h-3.5 w-3.5" strokeWidth={1.8} />
                          Scanned pages — no text yet
                        </p>
                      ) : (
                        <div className="mt-2 flex items-center gap-1">
                          <Link
                            href={`/library/${doc.id}`}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground/[0.05] px-2.5 py-1.5 text-ui-sm font-medium text-foreground/80 transition-colors hover:bg-foreground/[0.08]"
                          >
                            <BookOpen className="h-3.5 w-3.5" strokeWidth={1.8} />
                            Read
                          </Link>
                          <Link
                            href={`/chat?document=${doc.id}`}
                            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-ui-sm text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
                          >
                            <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.8} />
                            Ask
                          </Link>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      {ocrPending && (
                        <button
                          type="button"
                          onClick={() => void runOcr(doc)}
                          disabled={busyId === doc.id}
                          className="icon-btn-sm"
                          title="Read the scanned pages again"
                          aria-label="Run text recognition again"
                        >
                          {busyId === doc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} /> : <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.7} />}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void remove(doc)}
                        disabled={busyId === doc.id}
                        className="icon-btn-sm hover:text-destructive"
                        title="Delete"
                        aria-label={`Delete ${doc.title}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                      </button>
                    </div>
                  </div>

                  {ocrPending && (
                    <p className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-amber-500/[0.08] px-2.5 py-1.5 text-ui-sm text-amber-800 dark:text-amber-400">
                      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                      This file has no text layer, so I am reading it with OCR. Answers may take a little longer.
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </AppShell>
  )
}
