import { adminDb, adminAuth, adminStorage } from '@/lib/firebase/admin'
import { hashPassword, verifyPassword, hashToken, sessionExpiry } from '@/lib/auth'
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
import { Timestamp, FieldValue, Filter } from 'firebase-admin/firestore'

const COLLECTIONS = {
  users: 'users',
  sessions: 'sessions',
  chats: 'chats',
  messages: 'messages',
  documents: 'documents',
} as const

function toISO(v: Timestamp | Date | string | null | undefined): string {
  if (v instanceof Timestamp) return v.toDate().toISOString()
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'string') return v
  return new Date().toISOString()
}

function mapUser(doc: FirebaseFirestore.DocumentSnapshot): User {
  const data = doc.data()!
  return {
    id: doc.id,
    email: data.email,
    name: data.name,
    createdAt: toISO(data.createdAt),
    avatarUrl: data.avatarUrl,
  }
}

function mapChat(doc: FirebaseFirestore.DocumentSnapshot): Chat {
  const data = doc.data()!
  return {
    id: doc.id,
    userId: data.userId,
    title: data.title,
    documentId: data.documentId ?? null,
    createdAt: toISO(data.createdAt),
    updatedAt: toISO(data.updatedAt),
  }
}

function mapMessage(doc: FirebaseFirestore.DocumentSnapshot): Message {
  const data = doc.data()!
  return {
    id: doc.id,
    chatId: data.chatId,
    role: data.role,
    content: data.content,
    createdAt: toISO(data.createdAt),
    toolCalls: data.toolCalls,
    toolResults: data.toolResults,
  }
}

function mapDocumentMeta(doc: FirebaseFirestore.DocumentSnapshot): DocumentMeta {
  const data = doc.data()!
  return {
    id: doc.id,
    userId: data.userId,
    title: data.title,
    kind: data.kind,
    mime: data.mime,
    sizeBytes: data.sizeBytes,
    pageCount: data.pageCount ?? null,
    createdAt: toISO(data.createdAt),
  }
}

function mapDocumentRecord(doc: FirebaseFirestore.DocumentSnapshot): DocumentRecord {
  const data = doc.data()!
  return {
    ...mapDocumentMeta(doc),
    content: Buffer.from(data.contentBase64, 'base64'),
    textContent: data.textContent ?? '',
  }
}

/**
 * Firebase Store — uses Firestore for all data, Firebase Auth for auth,
 * Firebase Storage for document files.
 * Selected automatically when Firebase Admin env vars are set.
 */
export class FirebaseStore implements Store {
  readonly mode = 'firebase' as const

  async init(): Promise<void> {
    // Firestore indexes are created via firestore.indexes.json or console
    // Storage bucket exists if Firebase project is set up
  }

  async close(): Promise<void> {
    // No persistent connections to close
  }

  // ─── Users ────────────────────────────────────────────────────────────────

  async createUser(user: NewUser): Promise<User> {
    // Create Firebase Auth user
    const authUser = await adminAuth.createUser({
      email: user.email,
      password: user.passwordHash, // We store our own hash, but Firebase needs a password
      displayName: user.name,
    })

    // Store additional user data in Firestore
    const now = Timestamp.now()
    await adminDb.collection(COLLECTIONS.users).doc(authUser.uid).set({
      email: user.email.toLowerCase(),
      name: user.name,
      passwordHash: user.passwordHash,
      createdAt: now,
    })

    return {
      id: authUser.uid,
      email: user.email.toLowerCase(),
      name: user.name,
      createdAt: now.toDate().toISOString(),
    }
  }

  async getUserByEmail(email: string): Promise<User | null> {
    try {
      const authUser = await adminAuth.getUserByEmail(email.toLowerCase())
      const doc = await adminDb.collection(COLLECTIONS.users).doc(authUser.uid).get()
      if (!doc.exists) return null
      return mapUser(doc)
    } catch (e: any) {
      if (e.code === 'auth/user-not-found') return null
      throw e
    }
  }

  async getUser(id: string): Promise<User | null> {
    const doc = await adminDb.collection(COLLECTIONS.users).doc(id).get()
    if (!doc.exists) return null
    return mapUser(doc)
  }

  async updateUser(id: string, patch: Partial<Pick<User, 'name' | 'avatarUrl'>>): Promise<User | null> {
    const ref = adminDb.collection(COLLECTIONS.users).doc(id)
    await ref.update(patch)
    const doc = await ref.get()
    return doc.exists ? mapUser(doc) : null
  }

  // ─── Sessions (server-side session tokens for API routes) ────────────────

  async createSession(session: Session): Promise<void> {
    await adminDb.collection(COLLECTIONS.sessions).doc(session.tokenHash).set({
      userId: session.userId,
      expiresAt: Timestamp.fromDate(new Date(session.expiresAt)),
      createdAt: Timestamp.now(),
    })
  }

  async getSession(tokenHash: string): Promise<Session | null> {
    const doc = await adminDb.collection(COLLECTIONS.sessions).doc(tokenHash).get()
    if (!doc.exists) return null
    const data = doc.data()!
    if (data.expiresAt.toDate().getTime() < Date.now()) {
      await this.deleteSession(tokenHash)
      return null
    }
    return {
      tokenHash,
      userId: data.userId,
      expiresAt: toISO(data.expiresAt),
    }
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await adminDb.collection(COLLECTIONS.sessions).doc(tokenHash).delete()
  }

  async verifyLogin(email: string, password: string): Promise<User | null> {
    const user = await this.getUserByEmail(email)
    if (!user) return null

    const doc = await adminDb.collection(COLLECTIONS.users).doc(user.id).get()
    const data = doc.data()!
    if (!verifyPassword(password, data.passwordHash)) return null

    return user
  }

  // ─── Chats ────────────────────────────────────────────────────────────────

  async createChat(chat: Pick<Chat, 'userId' | 'title' | 'documentId'>): Promise<Chat> {
    const now = Timestamp.now()
    const ref = await adminDb.collection(COLLECTIONS.chats).add({
      userId: chat.userId,
      title: chat.title,
      documentId: chat.documentId,
      createdAt: now,
      updatedAt: now,
    })
    const doc = await ref.get()
    return mapChat(doc)
  }

  async listChats(userId: string): Promise<Chat[]> {
    const snap = await adminDb
      .collection(COLLECTIONS.chats)
      .where('userId', '==', userId)
      .orderBy('updatedAt', 'desc')
      .get()
    return snap.docs.map(mapChat)
  }

  async getChat(id: string): Promise<Chat | null> {
    const doc = await adminDb.collection(COLLECTIONS.chats).doc(id).get()
    if (!doc.exists) return null
    return mapChat(doc)
  }

  async updateChat(id: string, patch: { title?: string; documentId?: string | null }): Promise<Chat | null> {
    const ref = adminDb.collection(COLLECTIONS.chats).doc(id)
    const updateData: Record<string, any> = { updatedAt: Timestamp.now() }
    if (patch.title !== undefined) updateData.title = patch.title
    if (patch.documentId !== undefined) updateData.documentId = patch.documentId
    await ref.update(updateData)
    const doc = await ref.get()
    return doc.exists ? mapChat(doc) : null
  }

  async deleteChat(id: string): Promise<void> {
    const batch = adminDb.batch()

    // Delete messages subcollection
    const messagesSnap = await adminDb.collection(COLLECTIONS.messages).where('chatId', '==', id).get()
    messagesSnap.docs.forEach(doc => batch.delete(doc.ref))

    // Delete chat
    batch.delete(adminDb.collection(COLLECTIONS.chats).doc(id))

    await batch.commit()
  }

  // ─── Messages ─────────────────────────────────────────────────────────────

  async createMessage(
    chatId: string,
    role: MessageRole,
    content: string,
    toolCalls?: Message['toolCalls'],
    toolResults?: Message['toolResults']
  ): Promise<Message> {
    const now = Timestamp.now()
    const ref = await adminDb.collection(COLLECTIONS.messages).add({
      chatId,
      role,
      content,
      createdAt: now,
      toolCalls: toolCalls ?? null,
      toolResults: toolResults ?? null,
    })

    // Update chat's updatedAt
    await adminDb.collection(COLLECTIONS.chats).doc(chatId).update({ updatedAt: now })

    const doc = await ref.get()
    return mapMessage(doc)
  }

  async listMessages(chatId: string): Promise<Message[]> {
    const snap = await adminDb
      .collection(COLLECTIONS.messages)
      .where('chatId', '==', chatId)
      .orderBy('createdAt', 'asc')
      .get()
    return snap.docs.map(mapMessage)
  }

  async deleteMessage(id: string): Promise<void> {
    await adminDb.collection(COLLECTIONS.messages).doc(id).delete()
  }

  // ─── Documents ────────────────────────────────────────────────────────────

  async createDocument(doc: DocumentRecord): Promise<DocumentMeta> {
    const now = Timestamp.now()
    await adminDb.collection(COLLECTIONS.documents).doc(doc.id).set({
      userId: doc.userId,
      title: doc.title,
      kind: doc.kind,
      mime: doc.mime,
      sizeBytes: doc.sizeBytes,
      pageCount: doc.pageCount,
      contentBase64: doc.content.toString('base64'),
      textContent: doc.textContent,
      createdAt: now,
    })
    return { ...doc, createdAt: now.toDate().toISOString() }
  }

  async listDocuments(userId: string): Promise<DocumentMeta[]> {
    const snap = await adminDb
      .collection(COLLECTIONS.documents)
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get()
    return snap.docs.map(mapDocumentMeta)
  }

  async getDocument(id: string): Promise<DocumentRecord | null> {
    const doc = await adminDb.collection(COLLECTIONS.documents).doc(id).get()
    if (!doc.exists) return null
    return mapDocumentRecord(doc)
  }

  async deleteDocument(id: string): Promise<void> {
    const doc = await adminDb.collection(COLLECTIONS.documents).doc(id).get()
    if (doc.exists) {
      const data = doc.data()!
      // Delete from Storage
      try {
        await adminStorage.bucket().file(`documents/${data.userId}/${id}`).delete()
      } catch {
        // Ignore storage errors
      }
    }
    await adminDb.collection(COLLECTIONS.documents).doc(id).delete()
  }
}