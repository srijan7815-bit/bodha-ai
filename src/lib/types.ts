/** Core domain types for BODHA AI */

export type MessageRole = 'user' | 'assistant' | 'system'

/** A passage from the IKS shelf that an answer was built on. */
export interface MessageSource {
  /** The number the answer cites: [1], [2]. */
  id: string
  workId: string
  title: string
  ref: string
  translator: string
  year: number
  sourceUrl: string
  excerpt: string
}

export interface Message {
  id: string
  chatId: string
  role: MessageRole
  content: string
  createdAt: string
  // Optional metadata for tool calls
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  /** Which passages of the IKS shelf this answer was grounded in. */
  sources?: MessageSource[]
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
 * One model on a student's own endpoint.
 *
 * `id` is the string the provider wants in the `model` field; `label` is what
 * the student wants to read. They are separate because model ids are usually
 * unreadable (`claude-sonnet-4-5-20250929`) and a student may connect several
 * on one endpoint.
 */
export interface CustomModel {
  id: string
  label: string
}

/**
 * A student's own OpenAI-compatible endpoint.
 *
 * Anything that speaks `POST {baseUrl}/chat/completions` works: OpenAI,
 * OpenRouter, Together, Groq, a university gateway, or a model running on the
 * student's own machine. One endpoint can carry several models.
 *
 * The key is written through our API and read only on the server — it never
 * travels back to the browser.
 */
export interface CustomEndpoint {
  baseUrl: string
  apiKey: string
  models: CustomModel[]
  /**
   * Whether the endpoint answered our test when it was saved. A student may
   * save an endpoint we could not reach (a machine that is off right now, a
   * provider blocking datacenter IPs) and we keep trying it in chat.
   */
  verified: boolean
  verifiedAt?: string
}

/** 'bodha' means BODHA's own models; anything else is a CustomModel id. */
export const BODHA_MODEL = 'bodha'

export interface UserSettings {
  custom: CustomEndpoint | null
  /** The toggle's position, kept across devices: BODHA_MODEL or a model id. */
  preferredModel: string
  /** Named voice for read-aloud and Live Mode (null = BODHA's default). */
  voice: string | null
  updatedAt: string
}

/** What the browser is allowed to know: the endpoint, never the key. */
export interface PublicCustomEndpoint extends Omit<CustomEndpoint, 'apiKey'> {}

export type PublicSettings = Omit<UserSettings, 'custom'> & {
  custom: PublicCustomEndpoint | null
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
  createMessage(chatId: string, role: MessageRole, content: string, toolCalls?: ToolCall[], toolResults?: ToolResult[], ownerId?: string, sources?: MessageSource[]): Promise<Message>
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
  preferredModel: BODHA_MODEL,
  voice: null,
  updatedAt: '',
}

/**
 * Read settings that may have been written by an older version of the app.
 *
 * The first release stored a single `{ label, model }` pair; anything already in
 * the database keeps working by being folded into the list shape. Storage
 * formats change; a student's saved endpoint should not disappear because of it.
 */
export function migrateSettings(raw: unknown): UserSettings | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const custom = value.custom as Record<string, unknown> | null | undefined
  if (!custom) {
    return {
      custom: null,
      preferredModel: typeof value.preferredModel === 'string' ? value.preferredModel : BODHA_MODEL,
      voice: typeof value.voice === 'string' ? value.voice : null,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
    }
  }

  let models: CustomModel[] = []
  if (Array.isArray(custom.models)) {
    models = custom.models
      .map(entry => {
        const model = entry as Record<string, unknown>
        const id = typeof model.id === 'string' ? model.id.trim() : ''
        const label = typeof model.label === 'string' ? model.label.trim() : ''
        return id ? { id, label: label || id } : null
      })
      .filter((model): model is CustomModel => Boolean(model))
  } else if (typeof custom.model === 'string' && custom.model.trim()) {
    // The single-model shape.
    const id = custom.model.trim()
    const label = typeof custom.label === 'string' && custom.label.trim() ? custom.label.trim() : id
    models = [{ id, label }]
  }

  const preferred = typeof value.preferredModel === 'string' ? value.preferredModel : BODHA_MODEL
  // 'custom' was the old word for "use my endpoint" — point it at the model.
  const resolved = preferred === 'custom' ? (models[0]?.id ?? BODHA_MODEL) : preferred
  const stillExists = resolved === BODHA_MODEL || models.some(model => model.id === resolved)

  return {
    custom: {
      baseUrl: typeof custom.baseUrl === 'string' ? custom.baseUrl : '',
      apiKey: typeof custom.apiKey === 'string' ? custom.apiKey : '',
      models,
      verified: custom.verified === true,
      verifiedAt: typeof custom.verifiedAt === 'string' ? custom.verifiedAt : undefined,
    },
    preferredModel: stillExists ? resolved : BODHA_MODEL,
    voice: typeof value.voice === 'string' ? value.voice : null,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
  }
}

/** Strip the secret. Everything leaving the server for the client goes through here. */
export function publicSettings(settings: UserSettings | null): PublicSettings {
  const value = settings ?? DEFAULT_SETTINGS
  return {
    preferredModel: value.preferredModel,
    voice: value.voice,
    updatedAt: value.updatedAt,
    custom: value.custom
      ? {
          baseUrl: value.custom.baseUrl,
          models: value.custom.models,
          verified: value.custom.verified,
          verifiedAt: value.custom.verifiedAt,
        }
      : null,
  }
}