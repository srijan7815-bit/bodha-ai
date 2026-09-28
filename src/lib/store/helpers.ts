import type { Store } from '@/lib/types'

/** Appends OCR'd page text to a document's extracted text (both store modes). */
export async function appendDocumentText(
  store: Store,
  documentId: string,
  ownerId: string,
  addition: string,
): Promise<void> {
  const doc = await store.getDocument(documentId, ownerId)
  if (!doc) throw new Error('Document not found')

  const merged = doc.textContent + addition

  if (store.mode === 'file') {
    // FileStore keeps records in memory — update through its save cycle.
    const fileStore = store as unknown as {
      data: { documents: Array<{ id: string; textContent: string }> }
      scheduleSave: () => void
    }
    const record = fileStore.data.documents.find(d => d.id === documentId)
    if (!record) throw new Error('Document not found')
    record.textContent = merged
    fileStore.scheduleSave()
    return
  }

  // FirebaseStore: write Firestore + keep Storage bytes untouched.
  const { getAdmin } = await import('@/lib/firebase/admin')
  const admin = await getAdmin()
  if (!admin) throw new Error('Firebase is not configured')

  const clip = merged.length > 250_000 ? merged.slice(0, 250_000) + '\n\n[…truncated for storage limits…]' : merged
  await admin.db
    .collection('users')
    .doc(ownerId)
    .collection('documents')
    .doc(documentId)
    .set({ textContent: clip }, { merge: true })
}
