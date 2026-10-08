import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { verifyPassword } from '@/lib/auth'
import type {
  SystemState,
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

const FILES = {
  users: 'users.json',
  passwords: 'passwords.json',
  sessions: 'sessions.json',
  chats: 'chats.json',
  messages: 'messages.json',
  documents: 'documents.json',
} as const

interface FileData {
  users: User[]
  passwords: Record<string, string>
  sessions: Session[]
  chats: Chat[]
  messages: Message[]
  documents: DocumentRecord[]
}

const emptyData: FileData = {
  users: [],
  passwords: {},
  sessions: [],
  chats: [],
  messages: [],
  documents: [],
}

function iso(v: Date | string | null | undefined): string {
  return v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : new Date().toISOString()
}

/**
 * Zero-config file-based store for local development / demo.
 * All data lives in a single JSON file per collection under data/bodha/.
 */
export class FileStore implements Store {
  readonly mode = 'file' as const
  private dir: string
  private data: FileData = { ...emptyData }
  private loaded = false
  private saveTimer: NodeJS.Timeout | null = null

  constructor(dir: string) {
    this.dir = dir
  }

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    await this.load()
    this.loaded = true
  }

  async close(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    await this.save()
  }

  private async load(): Promise<void> {
    await Promise.all(
      Object.entries(FILES).map(async ([key, file]) => {
        try {
          const content = await fs.readFile(join(this.dir, file), 'utf-8')
          ;(this.data as unknown as Record<string, unknown>)[key] = JSON.parse(content)
        } catch {
          ;(this.data as unknown as Record<string, unknown>)[key] = []
        }
      }),
    )
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.save(), 100)
  }

  private async save(): Promise<void> {
    await Promise.all(
      Object.entries(FILES).map(([key, file]) =>
        fs.writeFile(join(this.dir, file), JSON.stringify((this.data as unknown as Record<string, unknown>)[key], null, 2)),
      ),
    )
  }

  // ─── Users ────────────────────────────────────────────────────────────────

  async createUser(user: NewUser): Promise<User> {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const newUser: User = { id, email: user.email.toLowerCase(), name: user.name, createdAt: now }
    this.data.users.push(newUser)
    this.data.passwords[id] = user.passwordHash
    this.scheduleSave()
    return newUser
  }

  async getUserByEmail(email: string): Promise<User | null> {
    return this.data.users.find(u => u.email === email.toLowerCase()) ?? null
  }

  async getUser(id: string): Promise<User | null> {
    return this.data.users.find(u => u.id === id) ?? null
  }

  async updateUser(id: string, patch: Partial<Pick<User, 'name' | 'avatarUrl'>>): Promise<User | null> {
    const idx = this.data.users.findIndex(u => u.id === id)
    if (idx === -1) return null
    this.data.users[idx] = { ...this.data.users[idx], ...patch }
    this.scheduleSave()
    return this.data.users[idx]
  }

  // ─── Sessions ─────────────────────────────────────────────────────────────

  async createSession(session: Session): Promise<void> {
    this.data.sessions = this.data.sessions.filter(s => s.tokenHash !== session.tokenHash)
    this.data.sessions.push(session)
    this.scheduleSave()
  }

  async getSession(tokenHash: string): Promise<Session | null> {
    const session = this.data.sessions.find(s => s.tokenHash === tokenHash)
    if (!session) return null
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      await this.deleteSession(tokenHash)
      return null
    }
    return session
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.data.sessions = this.data.sessions.filter(s => s.tokenHash !== tokenHash)
    this.scheduleSave()
  }

  async verifyLogin(email: string, password: string): Promise<User | null> {
    const user = await this.getUserByEmail(email)
    if (!user) return null
    const stored = this.data.passwords[user.id]
    if (!stored || !verifyPassword(password, stored)) return null
    return user
  }

  async verifyUserPassword(userId: string, password: string): Promise<boolean> {
    const stored = this.data.passwords[userId]
    return !!stored && verifyPassword(password, stored)
  }

  // ─── Chats ────────────────────────────────────────────────────────────────

  async createChat(chat: Pick<Chat, 'userId' | 'title' | 'documentId'>): Promise<Chat> {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const newChat: Chat = { id, userId: chat.userId, title: chat.title, documentId: chat.documentId, createdAt: now, updatedAt: now }
    this.data.chats.push(newChat)
    this.scheduleSave()
    return newChat
  }

  async listChats(userId: string): Promise<Chat[]> {
    return this.data.chats
      .filter(c => c.userId === userId)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }

  async getChat(id: string, _ownerId?: string): Promise<Chat | null> {
    return this.data.chats.find(c => c.id === id) ?? null
  }

  async updateChat(id: string, patch: { title?: string; documentId?: string | null }, _ownerId?: string): Promise<Chat | null> {
    const idx = this.data.chats.findIndex(c => c.id === id)
    if (idx === -1) return null
    const now = new Date().toISOString()
    this.data.chats[idx] = {
      ...this.data.chats[idx],
      title: patch.title ?? this.data.chats[idx].title,
      documentId: patch.documentId !== undefined ? patch.documentId : this.data.chats[idx].documentId,
      updatedAt: now,
    }
    this.scheduleSave()
    return this.data.chats[idx]
  }

  async deleteChat(id: string, _ownerId?: string): Promise<void> {
    this.data.chats = this.data.chats.filter(c => c.id !== id)
    this.data.messages = this.data.messages.filter(m => m.chatId !== id)
    this.scheduleSave()
  }

  // ─── Messages ─────────────────────────────────────────────────────────────

  async createMessage(
    chatId: string,
    role: MessageRole,
    content: string,
    toolCalls?: Message['toolCalls'],
    toolResults?: Message['toolResults'],
    _ownerId?: string,
    sources?: Message['sources'],
  ): Promise<Message> {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const message: Message = { id, chatId, role, content, createdAt: now, toolCalls, toolResults, sources }
    this.data.messages.push(message)

    // Update chat's updatedAt
    const chatIdx = this.data.chats.findIndex(c => c.id === chatId)
    if (chatIdx !== -1) {
      this.data.chats[chatIdx].updatedAt = now
    }
    this.scheduleSave()
    return message
  }

  async listMessages(chatId: string, _ownerId?: string): Promise<Message[]> {
    return this.data.messages
      .filter(m => m.chatId === chatId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }

  async deleteMessage(id: string, _ownerId?: string, _chatId?: string): Promise<void> {
    this.data.messages = this.data.messages.filter(m => m.id !== id)
    this.scheduleSave()
  }

  // ─── Documents ────────────────────────────────────────────────────────────

  async createDocument(doc: DocumentRecord): Promise<DocumentMeta> {
    const now = new Date().toISOString()
    const meta: DocumentMeta = {
      id: doc.id,
      userId: doc.userId,
      title: doc.title,
      kind: doc.kind,
      mime: doc.mime,
      sizeBytes: doc.sizeBytes,
      pageCount: doc.pageCount,
      createdAt: now,
    }
    this.data.documents.push({ ...doc, createdAt: now })
    this.scheduleSave()
    return meta
  }

  async listDocuments(userId: string): Promise<DocumentMeta[]> {
    return this.data.documents
      .filter(d => d.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map(({ content, textContent, ...meta }) => ({
        ...meta,
        hasText: typeof textContent === 'string' && textContent.trim().length > 0,
      }))
  }

  private systemState: SystemState | null = null

  async getSystemState(): Promise<SystemState | null> {
    return this.systemState
  }

  async saveSystemState(state: SystemState): Promise<void> {
    this.systemState = state
  }

  private uploadDir(userId: string, uploadId: string) {
    return join(this.dir, 'uploads', userId.replace(/[^\w-]/g, '_'), uploadId.replace(/[^\w-]/g, '_'))
  }

  async saveUploadPart(userId: string, uploadId: string, index: number, bytes: Buffer): Promise<void> {
    const dir = this.uploadDir(userId, uploadId)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, `${String(index).padStart(4, '0')}.part`), bytes)
  }

  async takeUpload(userId: string, uploadId: string, total: number): Promise<Buffer | null> {
    const dir = this.uploadDir(userId, uploadId)
    const parts: Buffer[] = []
    try {
      for (let i = 0; i < total; i++) parts.push(await fs.readFile(join(dir, `${String(i).padStart(4, '0')}.part`)))
    } catch {
      return null
    }
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    return Buffer.concat(parts)
  }

  async getDocument(id: string, _ownerId?: string, _opts?: { content?: boolean }): Promise<DocumentRecord | null> {
    return this.data.documents.find(d => d.id === id) ?? null
  }

  async deleteDocument(id: string, _ownerId?: string): Promise<void> {
    this.data.documents = this.data.documents.filter(d => d.id !== id)
    this.scheduleSave()
  }

  async updateDocumentText(id: string, _ownerId: string, text: string): Promise<void> {
    const idx = this.data.documents.findIndex(d => d.id === id)
    if (idx === -1) return
    this.data.documents[idx].textContent = text
    this.scheduleSave()
  }

  // ─── Settings ───────────────────────────────────────────────────────────
  // Kept in memory only: the file store is the zero-config demo mode, and a
  // student's own API key should never be written to a plain JSON file on disk.
  private settings = new Map<string, UserSettings>()

  async getUserSettings(userId: string): Promise<UserSettings | null> {
    return this.settings.get(userId) ?? null
  }

  async saveUserSettings(userId: string, settings: UserSettings): Promise<void> {
    this.settings.set(userId, settings)
  }
}