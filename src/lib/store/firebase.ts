import type {
  Chat,
  DocumentMeta,
  DocumentRecord,
  Message,
  MessageRole,
  NewUser,
  Session,
  Store,
  User,
  UserSettings,
} from '@/lib/types'
import type { AdminServices } from '@/lib/firebase/admin'
import { firebaseAuthReady } from '@/lib/firebase/admin'
import { verifyPassword } from '@/lib/password'

/**
 * Firebase Store — the production store per the BODHA spec.
 *
 * Firestore layout (mirrored by firestore.rules):
 *   users/{uid}                                 profile
 *   users/{uid}/chats/{chatId}                   conversation metadata
 *   users/{uid}/chats/{chatId}/messages/{mid}    messages
 *   users/{uid}/documents/{docId}               document metadata + extracted text
 *
 * Raw uploads (Firebase Storage needs billing, so we do not depend on it):
 *   users/{uid}/documents/{docId}/chunks/{n}    the uploaded file, in ~700 KB parts
 *
 * Every lookup is owner-scoped (ownerId param from the authenticated request),
 * so a signed-in user can never touch another user's data at the storage layer.
 * Accounts: email/password is verified from the scrypt hash stored on the user
 * document, which keeps sign-up/sign-in working even when Firebase
 * Authentication is not enabled on the project. When Authentication *is*
 * enabled the account is mirrored into it as well, so the Firebase client SDK
 * and Google sign-in work for the same account. Sessions are cookie-backed
 * documents in the top-level `sessions` collection.
 */

// Firestore docs are limited to ~1 MB; keep the extracted text comfortably under.
const TEXT_LIMIT = 250_000

// Raw file parts. Comfortably below the 1 MiB document limit so a 20 MB book is
// a handful of part documents rather than a failed upload.
const CHUNK_BYTES = 700 * 1024

function toISO(v: unknown): string {
  if (v && typeof v === 'object' && 'toDate' in (v as Record<string, unknown>)) {
    return (v as { toDate(): Date }).toDate().toISOString()
  }
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'string') return v
  return new Date().toISOString()
}

type Fs = import('firebase-admin/firestore').Firestore
type FsDocRef = import('firebase-admin/firestore').DocumentReference
type FsDocData = import('firebase-admin/firestore').DocumentData
type FsSnapDoc = import('firebase-admin/firestore').QueryDocumentSnapshot

export class FirebaseStore implements Store {
  readonly mode = 'firebase' as const

  private async admin(): Promise<AdminServices> {
    const { requireAdmin } = await import('@/lib/firebase/admin')
    return requireAdmin()
  }

  async init(): Promise<void> {
    // Nothing to provision — the project is created in the Firebase console.
    await this.admin()
  }

  async close(): Promise<void> {}

  // ─── Users ────────────────────────────────────────────────────────────────

  async createUser(user: NewUser): Promise<User> {
    const admin = await this.admin()
    const { randomUUID } = await import('node:crypto')
    const id = randomUUID()
    const email = user.email.toLowerCase()
    const createdAt = new Date()

    await admin.db.collection('users').doc(id).set({
      email,
      name: user.name,
      createdAt,
      passwordHash: user.passwordHash,
    })

    // Best effort: mirror the account into Firebase Auth when that service is
    // actually enabled, so the client SDK (and Google sign-in) see the same
    // account. Sign-up must never fail because of it.
    const auth = admin.auth
    if (user.password && auth && (await firebaseAuthReady())) {
      try {
        await auth.createUser({ uid: id, email, displayName: user.name, password: user.password })
      } catch (err) {
        console.warn('[store] Firebase Auth mirror skipped:', (err as Error).message)
      }
    }

    return { id, email, name: user.name, createdAt: createdAt.toISOString() }
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const admin = await this.admin()
    const snap = await admin.db.collection('users').where('email', '==', email.toLowerCase()).limit(1).get()
    if (snap.empty) return null
    const doc = snap.docs[0]
    const data = (doc.data() ?? {}) as FsDocData
    return {
      id: doc.id,
      email: data.email ?? email.toLowerCase(),
      name: data.name ?? 'Student',
      createdAt: toISO(data.createdAt),
      avatarUrl: data.avatarUrl,
    }
  }

  async getUser(id: string): Promise<User | null> {
    const admin = await this.admin()
    const doc = await admin.db.collection('users').doc(id).get()
    if (!doc.exists) return null
    const data = doc.data()!
    return { id, email: data.email ?? '', name: data.name ?? 'Student', createdAt: toISO(data.createdAt), avatarUrl: data.avatarUrl }
  }

  async updateUser(id: string, patch: Partial<Pick<User, 'name' | 'avatarUrl'>>): Promise<User | null> {
    const admin = await this.admin()
    const ref = admin.db.collection('users').doc(id)
    await ref.update(patch)
    const doc = await ref.get()
    if (!doc.exists) return null
    const data = doc.data()!
    return { id, email: data.email ?? '', name: data.name ?? 'Student', createdAt: toISO(data.createdAt), avatarUrl: data.avatarUrl }
  }

  async verifyUserPassword(userId: string, password: string): Promise<boolean> {
    const admin = await this.admin()
    const doc = await admin.db.collection('users').doc(userId).get()
    const stored = (doc.data() ?? {}).passwordHash
    return typeof stored === 'string' && verifyPassword(password, stored)
  }

  // ─── Sessions: sessions/{tokenHash} ───────────────────────────────────────

  private sessionRef(admin: AdminServices, tokenHash: string) {
    return admin.db.collection('sessions').doc(tokenHash)
  }

  async createSession(session: Session): Promise<void> {
    const admin = await this.admin()
    await this.sessionRef(admin, session.tokenHash).set({
      userId: session.userId,
      expiresAt: new Date(session.expiresAt),
      createdAt: new Date(),
    })
  }

  async getSession(tokenHash: string): Promise<Session | null> {
    const admin = await this.admin()
    const doc = await this.sessionRef(admin, tokenHash).get()
    if (!doc.exists) return null
    const data = (doc.data() ?? {}) as FsDocData
    if (!data.userId || !data.expiresAt) return null

    const expiresAt = toISO(data.expiresAt)
    if (new Date(expiresAt).getTime() < Date.now()) {
      await this.deleteSession(tokenHash).catch(() => {})
      return null
    }
    return { tokenHash, userId: data.userId, expiresAt }
  }

  async deleteSession(tokenHash: string): Promise<void> {
    const admin = await this.admin()
    await this.sessionRef(admin, tokenHash).delete().catch(() => {})
  }

  // ─── Chats: users/{uid}/chats/{chatId} ────────────────────────────────────

  private chatRef(db: Fs, ownerId: string, chatId: string): FsDocRef {
    return db.collection('users').doc(ownerId).collection('chats').doc(chatId)
  }

  private mapChat(id: string, data: FsDocData): Chat {
    return {
      id,
      userId: data.userId,
      title: data.title ?? 'New chat',
      documentId: data.documentId ?? null,
      createdAt: toISO(data.createdAt),
      updatedAt: toISO(data.updatedAt),
    }
  }

  async createChat(chat: Pick<Chat, 'userId' | 'title' | 'documentId'>): Promise<Chat> {
    const admin = await this.admin()
    const now = new Date()
    const ref = await this.dbChats(admin, chat.userId).add({
      userId: chat.userId,
      title: chat.title,
      documentId: chat.documentId,
      createdAt: now,
      updatedAt: now,
    })
    return {
      id: ref.id,
      userId: chat.userId,
      title: chat.title,
      documentId: chat.documentId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }
  }

  private dbChats(admin: AdminServices, userId: string) {
    return admin.db.collection('users').doc(userId).collection('chats')
  }

  async listChats(userId: string): Promise<Chat[]> {
    const admin = await this.admin()
    const snap = await this.dbChats(admin, userId).orderBy('updatedAt', 'desc').get()
    return snap.docs.map((d: FsSnapDoc) => this.mapChat(d.id, d.data()))
  }

  async getChat(id: string, ownerId?: string): Promise<Chat | null> {
    if (!ownerId) return null
    const admin = await this.admin()
    const doc = await this.chatRef(admin.db, ownerId, id).get()
    if (!doc.exists) return null
    return this.mapChat(doc.id, doc.data() ?? {})
  }

  async updateChat(id: string, patch: { title?: string; documentId?: string | null }, ownerId?: string): Promise<Chat | null> {
    if (!ownerId) return null
    const admin = await this.admin()
    const ref = this.chatRef(admin.db, ownerId, id)
    const update: Record<string, unknown> = { updatedAt: new Date() }
    if (patch.title !== undefined) update.title = patch.title
    if (patch.documentId !== undefined) update.documentId = patch.documentId
    await ref.update(update)
    const doc = await ref.get()
    return doc.exists ? this.mapChat(doc.id, doc.data() ?? {}) : null
  }

  async deleteChat(id: string, ownerId?: string): Promise<void> {
    if (!ownerId) return
    const admin = await this.admin()
    const ref = this.chatRef(admin.db, ownerId, id)
    // Delete the nested messages first (no recursive delete in the SDK).
    const messages = await ref.collection('messages').get()
    const batch = admin.db.batch()
    messages.docs.forEach((m: FsSnapDoc) => batch.delete(m.ref))
    batch.delete(ref)
    await batch.commit()
  }

  // ─── Messages: users/{uid}/chats/{chatId}/messages/{mid} ───────────────────

  private mapMessage(id: string, data: FsDocData): Message {
    return {
      id,
      chatId: data.chatId,
      role: data.role,
      content: data.content,
      createdAt: toISO(data.createdAt),
      toolCalls: data.toolCalls ?? undefined,
      toolResults: data.toolResults ?? undefined,
      sources: Array.isArray(data.sources) ? data.sources : undefined,
    }
  }

  async createMessage(
    chatId: string,
    role: MessageRole,
    content: string,
    toolCalls?: Message['toolCalls'],
    toolResults?: Message['toolResults'],
    ownerId?: string,
    sources?: Message['sources'],
  ): Promise<Message> {
    if (!ownerId) throw new Error('ownerId is required in Firebase mode')
    const admin = await this.admin()
    const chatRef = this.chatRef(admin.db, ownerId, chatId)
    const now = new Date()
    const msgRef = await chatRef.collection('messages').add({
      chatId,
      role,
      content,
      createdAt: now,
      toolCalls: toolCalls ?? null,
      toolResults: toolResults ?? null,
      sources: sources ?? null,
    })
    await chatRef.update({ updatedAt: now })
    return {
      id: msgRef.id,
      chatId,
      role,
      content,
      createdAt: now.toISOString(),
      toolCalls: toolCalls ?? undefined,
      toolResults: toolResults ?? undefined,
      sources: sources ?? undefined,
    }
  }

  async listMessages(chatId: string, ownerId?: string): Promise<Message[]> {
    if (!ownerId) return []
    const admin = await this.admin()
    const snap = await this.chatRef(admin.db, ownerId, chatId)
      .collection('messages')
      .orderBy('createdAt', 'asc')
      .get()
    return snap.docs.map((d: FsSnapDoc) => this.mapMessage(d.id, d.data()))
  }

  async deleteMessage(id: string, ownerId?: string, chatId?: string): Promise<void> {
    if (!ownerId || !chatId) return
    const admin = await this.admin()
    await this.chatRef(admin.db, ownerId, chatId).collection('messages').doc(id).delete()
  }

  // ─── Documents: users/{uid}/documents/{docId} (+ Storage) ──────────────────

  private dbDocuments(admin: AdminServices, userId: string) {
    return admin.db.collection('users').doc(userId).collection('documents')
  }

  private mapDocMeta(id: string, data: FsDocData): DocumentMeta {
    return {
      id,
      userId: data.userId,
      title: data.title,
      kind: data.kind,
      mime: data.mime,
      sizeBytes: data.sizeBytes ?? 0,
      pageCount: data.pageCount ?? null,
      createdAt: toISO(data.createdAt),
      hasText: typeof data.textContent === 'string' && data.textContent.trim().length > 0,
    }
  }

  /** Writes the uploaded file as part documents (Storage-free, works on Vercel). */
  private async writeChunks(
    admin: AdminServices,
    userId: string,
    docId: string,
    content: Buffer,
  ): Promise<number> {
    if (!content.length) return 0
    const ref = this.dbDocuments(admin, userId).doc(docId)
    const total = Math.ceil(content.length / CHUNK_BYTES)
    let batch = admin.db.batch()
    let pending = 0
    for (let i = 0; i < total; i++) {
      const part = content.subarray(i * CHUNK_BYTES, Math.min((i + 1) * CHUNK_BYTES, content.length))
      batch.set(ref.collection('chunks').doc(String(i).padStart(4, '0')), { index: i, bytes: Buffer.from(part) })
      pending += 1
      // A Firestore commit is capped near 10 MiB, so flush every few parts
      // rather than every 400 documents.
      if (pending === 8) {
        await batch.commit()
        batch = admin.db.batch()
        pending = 0
      }
    }
    if (pending) await batch.commit()
    return total
  }

  /** Re-assembles an uploaded file from its part documents. */
  private async readChunks(admin: AdminServices, userId: string, docId: string): Promise<Buffer> {
    const snap = await this.dbDocuments(admin, userId).doc(docId).collection('chunks').orderBy('index').get()
    if (snap.empty) return Buffer.alloc(0)
    const parts = snap.docs.map(d => {
      const raw = d.data().bytes
      if (Buffer.isBuffer(raw)) return raw as Buffer
      if (raw && typeof raw === 'object' && 'value' in raw) return Buffer.from((raw as { value: string }).value, 'base64')
      return Buffer.alloc(0)
    })
    return Buffer.concat(parts)
  }

  private uploadRef(admin: AdminServices, userId: string, uploadId: string) {
    return admin.db.collection('users').doc(userId).collection('uploads').doc(uploadId)
  }

  async saveUploadPart(userId: string, uploadId: string, index: number, bytes: Buffer): Promise<void> {
    const admin = await this.admin()
    const ref = this.uploadRef(admin, userId, uploadId)
    // One 3 MB part becomes a few sub-700 KB documents; ids sort in order.
    const pieces = Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES))
    let batch = admin.db.batch()
    for (let i = 0; i < pieces; i++) {
      const piece = bytes.subarray(i * CHUNK_BYTES, Math.min((i + 1) * CHUNK_BYTES, bytes.length))
      const id = `${String(index).padStart(4, '0')}_${String(i).padStart(2, '0')}`
      batch.set(ref.collection('parts').doc(id), { bytes: Buffer.from(piece) })
    }
    await batch.commit()
  }

  async takeUpload(userId: string, uploadId: string, total: number): Promise<Buffer | null> {
    const admin = await this.admin()
    const ref = this.uploadRef(admin, userId, uploadId)
    const snap = await ref.collection('parts').get()
    if (snap.empty) return null
    const seen = new Set(snap.docs.map(d => Number(d.id.split('_')[0])))
    for (let i = 0; i < total; i++) if (!seen.has(i)) return null
    // Document ids are zero-padded, so sorting them restores the file order.
    const docs = [...snap.docs].sort((a, b) => (a.id < b.id ? -1 : 1))
    const buffer = Buffer.concat(
      docs.map(d => {
        const raw = d.data().bytes
        if (Buffer.isBuffer(raw)) return raw as Buffer
        if (raw && typeof raw === 'object' && 'value' in raw) return Buffer.from((raw as { value: string }).value, 'base64')
        return Buffer.alloc(0)
      }),
    )
    await admin.db.recursiveDelete(ref).catch(() => {})
    return buffer
  }

  async createDocument(doc: DocumentRecord): Promise<DocumentMeta> {
    const admin = await this.admin()
    const clipped =
      doc.textContent.length > TEXT_LIMIT
        ? doc.textContent.slice(0, TEXT_LIMIT) + '\n\n[…truncated for storage limits…]'
        : doc.textContent

    await this.dbDocuments(admin, doc.userId)
      .doc(doc.id)
      .set({
        userId: doc.userId,
        title: doc.title,
        kind: doc.kind,
        mime: doc.mime,
        sizeBytes: doc.sizeBytes,
        pageCount: doc.pageCount,
        textContent: clipped,
        createdAt: new Date(),
      })

    // The raw bytes are saved as part documents next to the metadata so the
    // reader and the OCR flow can fetch them on any device, with no Storage
    // bucket and no billing account required.
    try {
      const parts = await this.writeChunks(admin, doc.userId, doc.id, doc.content)
      if (parts) {
        await this.dbDocuments(admin, doc.userId).doc(doc.id).set({ chunkCount: parts }, { merge: true })
      }
    } catch (err) {
      console.warn('[store] Storing the uploaded file failed:', (err as Error).message)
    }

    return { ...doc, createdAt: new Date().toISOString() }
  }

  async listDocuments(userId: string): Promise<DocumentMeta[]> {
    const admin = await this.admin()
    const snap = await this.dbDocuments(admin, userId).orderBy('createdAt', 'desc').get()
    return snap.docs.map((d: FsSnapDoc) => this.mapDocMeta(d.id, d.data()))
  }

  async getDocument(id: string, ownerId?: string, opts?: { content?: boolean }): Promise<DocumentRecord | null> {
    if (!ownerId) return null
    const admin = await this.admin()
    const doc = await this.dbDocuments(admin, ownerId).doc(id).get()
    if (!doc.exists) return null
    const data = doc.data()!
    const meta = this.mapDocMeta(doc.id, data)

    let content: Buffer = Buffer.alloc(0)
    try {
      if (opts?.content !== false) content = await this.readChunks(admin, ownerId, id)
    } catch (err) {
      console.warn('[store] Reading the uploaded file failed:', (err as Error).message)
    }

    return { ...meta, content, textContent: data.textContent ?? '' }
  }

  async deleteDocument(id: string, ownerId?: string): Promise<void> {
    if (!ownerId) return
    const admin = await this.admin()
    const ref = this.dbDocuments(admin, ownerId).doc(id)
    // recursive delete until Firestore's own helper is available here.
    await admin.db.recursiveDelete(ref).catch(async () => {
      await ref.delete().catch(() => {})
    })
  }

  // ─── Settings: users/{uid}/settings/ai ────────────────────────────────────
  // A student's own endpoint and API key. Deliberately its own document rather
  // than a field on the profile: nothing but the server ever reads this path,
  // so the key cannot leak into a client-side Firestore read.
  private settingsRef(admin: AdminServices, userId: string): FsDocRef {
    return admin.db.doc(`users/${userId}/settings/ai`)
  }

  async getUserSettings(userId: string): Promise<UserSettings | null> {
    const admin = await this.admin()
    const snap = await this.settingsRef(admin, userId).get()
    if (!snap.exists) return null
    // Returned raw; every reader goes through migrateSettings, so a document
    // written by an older release still reads correctly.
    return snap.data() as UserSettings
  }

  async saveUserSettings(userId: string, settings: UserSettings): Promise<void> {
    const admin = await this.admin()
    // Firestore rejects `undefined` outright ("Cannot use undefined as a
    // Firestore value") where every other store treats it as absent — and an
    // optional field like verifiedAt is exactly that. Round-tripping through
    // JSON drops undefined keys, which is the behaviour every caller means.
    const clean = JSON.parse(JSON.stringify(settings)) as UserSettings
    await this.settingsRef(admin, userId).set(clean, { merge: true })
  }

  async updateDocumentText(id: string, ownerId: string, text: string): Promise<void> {
    const admin = await this.admin()
    const clip =
      text.length > 250_000 ? text.slice(0, 250_000) + '\n\n[…truncated for storage limits…]' : text
    await this.dbDocuments(admin, ownerId).doc(id).set({ textContent: clip }, { merge: true })
  }
}
