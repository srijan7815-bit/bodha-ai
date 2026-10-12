'use client'

import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, Check, Download, FileText, FolderOpen, Loader2, Pencil, RefreshCw, Save, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { authFetch } from '@/lib/firebase/client-token'

/**
 * The student's workspace — every file BODHA's computer has made for them.
 *
 * This is the answer to "where did that PDF go?": files are no longer handed over
 * once and lost, they live here. From this drawer a student can read a text file in
 * place, edit and save it, rename it, download it, or delete it — and the same files
 * are what the computer starts from on the next task.
 */

export interface WorkspaceFileMeta {
  name: string
  size: number
  mime: string
  updatedAt: string
}

interface WorkspaceDrawerProps {
  open: boolean
  onClose: () => void
  /** Fires whenever the list changes, so the composer can show a count. */
  onChange?: (files: WorkspaceFileMeta[]) => void
}

const EASE = [0.22, 1, 0.36, 1] as const

const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)

const when = (iso: string) => {
  const at = new Date(iso)
  const minutes = Math.round((Date.now() - at.getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`
  return at.toLocaleDateString()
}

export default function WorkspaceDrawer({ open, onClose, onChange }: WorkspaceDrawerProps) {
  const [files, setFiles] = useState<WorkspaceFileMeta[]>([])
  const [totalBytes, setTotalBytes] = useState(0)
  const [limits, setLimits] = useState<{ fileBytes: number; totalBytes: number; files: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [openName, setOpenName] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [editable, setEditable] = useState(false)
  const [loadedName, setLoadedName] = useState<string | null>(null)
  const [base64, setBase64] = useState<string | null>(null)

  const apply = useCallback(
    (list: WorkspaceFileMeta[], total?: number) => {
      setFiles(list)
      setTotalBytes(total ?? list.reduce((sum, f) => sum + f.size, 0))
      onChange?.(list)
    },
    [onChange],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await authFetch('/api/workspace')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not read the workspace')
      apply(data.files ?? [], data.totalBytes)
      setLimits(data.limits ?? null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [apply])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  async function openFile(name: string) {
    setBusy(name)
    setError(null)
    setNotice(null)
    try {
      const res = await authFetch(`/api/workspace?name=${encodeURIComponent(name)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not open that file')
      setOpenName(name)
      setLoadedName(name)
      setText(data.text ?? '')
      setBase64(data.base64 ?? null)
      setEditable(data.text !== null && data.text !== undefined)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function save() {
    if (!loadedName) return
    setBusy(loadedName)
    setError(null)
    try {
      const res = await authFetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: loadedName, content: text }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not save')
      apply(data.files ?? files, data.totalBytes)
      setNotice(`Saved ${loadedName}`)
      setTimeout(() => setNotice(null), 2500)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function remove(name: string) {
    if (!window.confirm(`Delete “${name}” from your workspace? This cannot be undone.`)) return
    setBusy(name)
    setError(null)
    try {
      const res = await authFetch(`/api/workspace?name=${encodeURIComponent(name)}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not delete')
      apply(data.files ?? [], data.totalBytes)
      if (openName === name) {
        setOpenName(null)
        setLoadedName(null)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function rename(name: string) {
    const next = window.prompt('New name', name)
    if (!next || next === name) return
    setBusy(name)
    setError(null)
    try {
      const res = await authFetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, renameTo: next }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not rename')
      apply(data.files ?? files)
      if (openName === name) {
        setOpenName(next)
        setLoadedName(next)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  /** Download without a round trip: the bytes are already here. */
  function download(file: WorkspaceFileMeta) {
    const save = (data: Uint8Array) => {
      // A fresh ArrayBuffer: a detached view (or one over a SharedArrayBuffer) is not
      // a valid BlobPart, and the compiler is right to insist on it.
      const buffer = Uint8Array.from(data).buffer as ArrayBuffer
      const url = URL.createObjectURL(new Blob([buffer], { type: file.mime }))
      const a = document.createElement('a')
      a.href = url
      a.download = file.name.split('/').pop() || 'file'
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    }
    if (openName === file.name && base64) {
      save(Uint8Array.from(atob(base64), c => c.charCodeAt(0)))
      return
    }
    if (openName === file.name && text) {
      save(new TextEncoder().encode(text))
      return
    }
    void (async () => {
      const res = await authFetch(`/api/workspace?name=${encodeURIComponent(file.name)}`)
      const data = await res.json()
      if (!res.ok) return
      if (data.base64) save(Uint8Array.from(atob(data.base64), c => c.charCodeAt(0)))
      else save(new TextEncoder().encode(data.text ?? ''))
    })()
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-foreground/25 backdrop-blur-[2px]"
          />
          <motion.aside
            key="panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.32, ease: EASE }}
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[520px] flex-col border-l border-border/80 bg-background shadow-card"
            aria-label="Your workspace"
          >
            <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/70 px-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FolderOpen className="h-[18px] w-[18px]" strokeWidth={1.7} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-ui font-medium">Your workspace</h2>
                <p className="truncate text-ui-sm text-muted-foreground">
                  {files.length} file{files.length === 1 ? '' : 's'}
                  {limits ? ` · ${size(totalBytes)} of ${size(limits.totalBytes)}` : ''}
                </p>
              </div>
              <button type="button" onClick={() => void load()} className="icon-btn h-10 w-10" aria-label="Refresh" title="Refresh">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" strokeWidth={1.7} />}
              </button>
              <button type="button" onClick={onClose} className="icon-btn h-10 w-10" aria-label="Close workspace">
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </header>

            {(error || notice) && (
              <p
                className={cn(
                  'mx-3 mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-ui-sm',
                  error ? 'border border-destructive/30 bg-destructive/5 text-destructive' : 'border border-emerald-600/25 bg-emerald-600/5 text-emerald-700',
                )}
              >
                {error ? <AlertCircle className="h-3.5 w-3.5 shrink-0" /> : <Check className="h-3.5 w-3.5 shrink-0" />}
                {error ?? notice}
              </p>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              {!files.length && !loading && (
                <div className="mt-10 text-center">
                  <p className="font-serif text-reading text-muted-foreground">Nothing here yet.</p>
                  <p className="mx-auto mt-2 max-w-[34ch] text-ui-sm text-muted-foreground/80">
                    Ask BODHA to make something — a PDF, a Word handout, a spreadsheet — or switch the Computer on in the chat, and the files will appear here.
                  </p>
                </div>
              )}

              <ul className="space-y-1.5">
                {files.map(file => (
                  <li key={file.name} className="rounded-2xl border border-border/70 bg-surface">
                    <div className="flex items-center gap-2.5 px-3 py-2.5">
                      <FileText className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.7} />
                      <button type="button" onClick={() => void openFile(file.name)} className="min-w-0 flex-1 text-left">
                        <span className="block truncate text-ui">{file.name}</span>
                        <span className="block text-ui-sm text-muted-foreground">
                          {size(file.size)} · {when(file.updatedAt)}
                        </span>
                      </button>
                      {busy === file.name ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : (
                        <div className="flex items-center gap-0.5">
                          <button type="button" onClick={() => download(file)} className="icon-btn h-9 w-9" aria-label={`Download ${file.name}`} title="Download">
                            <Download className="h-4 w-4" strokeWidth={1.7} />
                          </button>
                          <button type="button" onClick={() => void rename(file.name)} className="icon-btn h-9 w-9" aria-label={`Rename ${file.name}`} title="Rename">
                            <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void remove(file.name)}
                            className="icon-btn h-9 w-9 text-destructive/80 hover:text-destructive"
                            aria-label={`Delete ${file.name}`}
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                          </button>
                        </div>
                      )}
                    </div>

                    <AnimatePresence initial={false}>
                      {openName === file.name && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.24, ease: EASE }} className="overflow-hidden">
                          <div className="border-t border-border/60 px-3 py-2.5">
                            {editable ? (
                              <>
                                <textarea
                                  value={text}
                                  onChange={e => setText(e.target.value)}
                                  rows={10}
                                  spellCheck={false}
                                  className="w-full resize-y rounded-xl border border-border/70 bg-background px-3 py-2 font-mono text-[13px] leading-relaxed outline-none focus:border-primary/45"
                                  aria-label={`Edit ${file.name}`}
                                />
                                <div className="mt-2 flex items-center justify-end gap-2">
                                  <button type="button" onClick={() => void openFile(file.name)} className="rounded-full border border-border/70 px-3.5 py-1.5 text-ui-sm text-muted-foreground hover:text-foreground">
                                    Revert
                                  </button>
                                  <button type="button" onClick={() => void save()} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-ui-sm text-primary-foreground">
                                    <Save className="h-3.5 w-3.5" strokeWidth={2} /> Save
                                  </button>
                                </div>
                              </>
                            ) : (
                              <p className="text-ui-sm text-muted-foreground">
                                This is a {file.mime.replace('application/', '')} file — BODHA can read it, and you can download it, but it cannot be edited as text here.
                              </p>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </li>
                ))}
              </ul>

              {!!files.length && (
                <p className="mt-4 px-1 text-ui-sm text-muted-foreground/80">
                  These files are BODHA&rsquo;s own workspace, kept per student. The computer starts from them next time, so a task can carry on from yesterday&rsquo;s work.
                </p>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
