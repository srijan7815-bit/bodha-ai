/** Core domain types for BODHA AI */

export type MessageRole = 'user' | 'assistant' | 'system'

export interface Message {
  id: string
  chatId: string
  role: MessageRole
  content: string
  createdAt: string
  // Optional metadata for tool calls
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ToolResult {
  toolCallId: string
  name: string
  content: string
}

export interface Chat {
  id: string
  userId: string
  title: string
  documentId: string | null
  createdAt: string
  updatedAt: string
}

export interface User {
  id: string
  email: string
  name: string
  createdAt: string
  avatarUrl?: string
}

export interface NewUser {
  email: string
  name: string
  passwordHash: string
  /**
   * Plaintext password, passed only so the Firestore store can mirror the
   * account into Firebase Auth when that service is enabled. Never stored.
   */
  password?: string
}

export interface Session {
  tokenHash: string
  userId: string
  expiresAt: string
}

export interface DocumentMeta {
  id: string
  userId: string
  title: string
  kind: 'pdf' | 'text' | 'markdown' | 'code'
  mime: string
  sizeBytes: number
  pageCount: number | null
  createdAt: string
  /** True once we hold readable text for this document (text layer or OCR). */
  hasText?: boolean
}

export interface DocumentRecord extends DocumentMeta {
  content: Buffer
  textContent: string
}

export interface TutorMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface TutorContext {
  history: Message[]
  document?: DocumentRecord | null
}

export interface AIProviderConfig {
  name: string
  baseUrl: string
  apiKey: string
  model: string
  thinking: boolean
}

/** Store interface - implemented by FirebaseStore and the file-store fallback */
/**
 * A student's own OpenAI-compatible endpoint.
 *
 * Anything that speaks `POST {baseUrl}/chat/completions` works: OpenAI,
 * OpenRouter, Together, Groq, a university gateway, or a model running on the
 * student's own machine. The key is written through our API and read only on
 * the server — it is never sent back to the browser.
 */
export interface CustomEndpoint {
  /** Shown on the model toggle, e.g. "GPT-4o mini". */
  label: string
  baseUrl: string
  model: string
  apiKey: string
}

/** Which brain answers: BODHA's own models, or the student's endpoint. */
export type ModelChoice = 'bodha' | 'custom'

export interface UserSettings {
  custom: CustomEndpoint | null
  /** The toggle's position, kept across devices. */
  preferredModel: ModelChoice
  /** Named voice for read-aloud and Live Mode (null = BODHA's default). */
  voice: string | null
  updatedAt: string
}

/** What the browser is allowed to know: everything except the key. */
export type PublicSettings = Omit<UserSettings, 'custom'> & {
  custom: Omit<CustomEndpoint, 'apiKey'> | null
}

export interface Store {
  mode: 'firebase' | 'file'
  init(): Promise<void>
  close(): Promise<void>

  // Users
  createUser(user: NewUser): Promise<User>
  getUserByEmail(email: string): Promise<User | null>
  getUser(id: string): Promise<User | null>
  updateUser(id: string, patch: Partial<Pick<User, 'name' | 'avatarUrl'>>): Promise<User | null>
  /** Local demo mode only — Firebase Auth owns passwords in cloud mode. */
  verifyUserPassword(userId: string, password: string): Promise<boolean>

  // Sessions (handled by Firebase Auth client-side, but we keep for server ops)
  createSession(session: Session): Promise<void>
  getSession(tokenHash: string): Promise<Session | null>
  deleteSession(tokenHash: string): Promise<void>

  // Chats (ownerId is the authenticated user — required for direct doc access in Firebase mode)
  createChat(chat: Pick<Chat, 'userId' | 'title' | 'documentId'>): Promise<Chat>
  listChats(userId: string): Promise<Chat[]>
  getChat(id: string, ownerId?: string): Promise<Chat | null>
  updateChat(id: string, patch: { title?: string; documentId?: string | null }, ownerId?: string): Promise<Chat | null>
  deleteChat(id: string, ownerId?: string): Promise<void>

  // Messages
  createMessage(chatId: string, role: MessageRole, content: string, toolCalls?: ToolCall[], toolResults?: ToolResult[], ownerId?: string): Promise<Message>
  listMessages(chatId: string, ownerId?: string): Promise<Message[]>
  deleteMessage(id: string, ownerId?: string, chatId?: string): Promise<void>

  // Documents
  createDocument(doc: DocumentRecord): Promise<DocumentMeta>
  listDocuments(userId: string): Promise<DocumentMeta[]>
  getDocument(id: string, ownerId?: string): Promise<DocumentRecord | null>
  deleteDocument(id: string, ownerId?: string): Promise<void>
  /** Merge/replace a document's extracted text (OCR flow). */
  updateDocumentText(id: string, ownerId: string, text: string): Promise<void>

  // Settings (per student: their own model endpoint, voice, preferences)
  getUserSettings(userId: string): Promise<UserSettings | null>
  saveUserSettings(userId: string, settings: UserSettings): Promise<void>
}

export const DEFAULT_SETTINGS: UserSettings = {
  custom: null,
  preferredModel: 'bodha',
  voice: null,
  updatedAt: '',
}

/** Strip the secret. Everything leaving the server for the client goes through here. */
export function publicSettings(settings: UserSettings | null): PublicSettings {
  const value = settings ?? DEFAULT_SETTINGS
  return {
    preferredModel: value.preferredModel,
    voice: value.voice,
    updatedAt: value.updatedAt,
    custom: value.custom
      ? { label: value.custom.label, baseUrl: value.custom.baseUrl, model: value.custom.model }
      : null,
  }
}