'use client'

import { useEffect, useState } from 'react'
import { FileText, Library, Loader2, Unlink } from 'lucide-react'
import { authFetch } from '@/lib/firebase/client-token'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { DocumentMeta } from '@/lib/types'

interface DocPickerProps {
  open: boolean
  onClose: () => void
  onPick: (doc: DocumentMeta) => void
  onClear?: () => void
  selectedId?: string
}

const KIND_LABEL: Record<string, string> = { pdf: 'PDF', text: 'Text', markdown: 'Notes', code: 'Code' }

/** Links a document to the conversation so BODHA answers from its text. */
export default function DocPicker({ open, onClose, onPick, onClear, selectedId }: DocPickerProps) {
  const [docs, setDocs] = useState<DocumentMeta[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setDocs(null)
    setError(false)
    authFetch('/api/documents', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then(data => {
        if (!cancelled) setDocs((data.documents ?? []) as DocumentMeta[])
      })
      .catch(() => {
        if (!cancelled) {
          setError(true)
          setDocs([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={value => !value && onClose()}>
      <DialogContent className="max-w-lg gap-0 p-0">
        <DialogHeader className="border-b border-border/60 px-5 py-4 text-left">
          <DialogTitle className="text-[1.05rem]">Study from a document</DialogTitle>
          <DialogDescription className="font-serif text-reading-sm italic">
            Pick something from your Library and I will answer from its pages.
          </DialogDescription>
        </DialogHeader>

        <div className="scrollbar-quiet max-h-[52vh] overflow-y-auto p-2.5">
          {docs === null && (
            <p className="flex items-center gap-2 px-3 py-6 text-ui text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
              Opening your library…
            </p>
          )}

          {docs?.length === 0 && !error && (
            <div className="px-3 py-8 text-center">
              <Library className="mx-auto mb-2.5 h-5 w-5 text-muted-foreground/70" strokeWidth={1.7} />
              <p className="font-serif text-reading-sm italic text-muted-foreground">
                Nothing uploaded yet — add a book or notes in the Library.
              </p>
            </div>
          )}

          {error && (
            <p className="px-3 py-6 text-center font-serif text-reading-sm italic text-muted-foreground">
              I could not reach your library just now.
            </p>
          )}

          <ul className="space-y-1">
            {docs?.map(doc => {
              const selected = selectedId === doc.id
              return (
                <li key={doc.id}>
                  <button
                    type="button"
                    onClick={() => onPick(doc)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                      selected ? 'bg-primary/10 text-foreground' : 'hover:bg-foreground/[0.04]',
                    )}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-card text-primary">
                      <FileText className="h-4 w-4" strokeWidth={1.7} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ui font-medium text-foreground">{doc.title}</span>
                      <span className="block text-ui-sm text-muted-foreground">
                        {KIND_LABEL[doc.kind] ?? 'Document'}
                        {doc.pageCount ? ` · ${doc.pageCount} pages` : ''}
                        {doc.sizeBytes ? ` · ${Math.max(1, Math.round(doc.sizeBytes / 1024))} KB` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>

        {selectedId && onClear && (
          <div className="border-t border-border/60 px-3 py-2.5">
            <button
              type="button"
              onClick={onClear}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-ui text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
            >
              <Unlink className="h-4 w-4" strokeWidth={1.7} />
              Unlink this document
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
