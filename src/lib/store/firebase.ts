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
 * Firebase Storage:
 *   users/{uid}/uploads/{docId}                 the raw uploaded file
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
    if (user.password && (await firebaseAuthReady())) {
      try {
        await admin.auth.createUser({ uid: id, email, displayName: user.name, password: user.password })
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
    }
  }

  async createMessage(
    chatId: string,
    role: MessageRole,
    content: string,
    toolCalls?: Message['toolCalls'],
    toolResults?: Message['toolResults'],
    ownerId?: string,
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
    }
  }

  private storagePath(userId: string, docId: string): string {
    return `users/${userId}/uploads/${docId}`
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

    // Raw bytes live in Firebase Storage; the extracted text is already in
    // Firestore, so a Storage hiccup (bucket not created yet, quota) must not
    // fail the whole upload.
    try {
      await admin.storage
        .bucket()
        .file(this.storagePath(doc.userId, doc.id))
        .save(doc.content, { contentType: doc.mime })
    } catch (err) {
      console.warn('[store] Firebase Storage upload failed:', (err as Error).message)
    }

    return { ...doc, createdAt: new Date().toISOString() }
  }

  async listDocuments(userId: string): Promise<DocumentMeta[]> {
    const admin = await this.admin()
    const snap = await this.dbDocuments(admin, userId).orderBy('createdAt', 'desc').get()
    return snap.docs.map((d: FsSnapDoc) => this.mapDocMeta(d.id, d.data()))
  }

  async getDocument(id: string, ownerId?: string): Promise<DocumentRecord | null> {
    if (!ownerId) return null
    const admin = await this.admin()
    const doc = await this.dbDocuments(admin, ownerId).doc(id).get()
    if (!doc.exists) return null
    const data = doc.data()!
    const meta = this.mapDocMeta(doc.id, data)

    let content: Buffer = Buffer.alloc(0)
    try {
      const [buf] = await admin.storage.bucket().file(this.storagePath(ownerId, id)).download()
      content = buf
    } catch {
      // Bytes may be absent for small text documents kept inline.
    }

    return { ...meta, content, textContent: data.textContent ?? '' }
  }

  async deleteDocument(id: string, ownerId?: string): Promise<void> {
    if (!ownerId) return
    const admin = await this.admin()
    try {
      await admin.storage.bucket().file(this.storagePath(ownerId, id)).delete()
    } catch {}
    await this.dbDocuments(admin, ownerId).doc(id).delete()
  }

  async updateDocumentText(id: string, ownerId: string, text: string): Promise<void> {
    const admin = await this.admin()
    const clip =
      text.length > 250_000 ? text.slice(0, 250_000) + '\n\n[…truncated for storage limits…]' : text
    await this.dbDocuments(admin, ownerId).doc(id).set({ textContent: clip }, { merge: true })
  }
}
