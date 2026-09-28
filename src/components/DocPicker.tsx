'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { DocumentMeta } from '@/lib/types'
import { authFetch } from '@/lib/firebase/server-auth'
import { BookOpen, FileText } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  onPick: (docId: string) => void
}

/**
 * Dialog that lists the user's uploaded documents so one can be
 * linked to the current conversation.
 */
export default function DocPicker({ open, onClose, onPick }: Props) {
  const [docs, setDocs] = useState<DocumentMeta[] | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    authFetch('/api/documents', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Failed'))))
      .then(data => {
        if (!cancelled) setDocs(data.documents ?? [])
      })
      .catch(() => {
        if (!cancelled) setDocs([])
      })
    return () => {
      cancelled = true
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Discuss a document</DialogTitle>
          <DialogDescription>
            Pick one of your uploaded documents and BODHA will answer from its text.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-80 space-y-1.5 overflow-y-auto">
          {docs === null && (
            <div className="space-y-2 py-2">
              {[0, 1, 2].map(i => (
                <div key={i} className="h-12 animate-pulse-soft rounded-xl bg-accent" />
              ))}
            </div>
          )}
          {docs !== null && docs.length === 0 && (
            <p className="py-6 text-center font-serif text-sm italic text-muted-foreground">
              Nothing uploaded yet — add a book in the Library first.
            </p>
          )}
          {docs !== null &&
            docs.map(doc => (
              <Button
                key={doc.id}
                variant="outline"
                className="w-full justify-start gap-3 px-3 py-3 text-left"
                onClick={() => onPick(doc.id)}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  {doc.kind === 'pdf' ? <BookOpen className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">{doc.title}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {doc.kind === 'pdf' ? `PDF${doc.pageCount ? ` · ${doc.pageCount} pages` : ''}` : 'Text'}
                    {' · '}
                    {Math.max(1, Math.round(doc.sizeBytes / 1024))} KB
                  </span>
                </span>
              </Button>
            ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}